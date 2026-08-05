#!/usr/bin/env node
/**
 * Harvest the FULL anthropics/claude-code issue population to a durable location.
 *
 * WHY THIS IS A SCRIPT AND NOT A ONE-LINER
 * ----------------------------------------
 * This corpus has now been lost twice: once when it lived in a harness session
 * scratchpad that was deleted with the session, and once when a `| head -30` on
 * the pipeline sent SIGPIPE and killed the producer at 800 of 1,300 while the
 * pipeline still reported exit 0. Both are recorded in the cli-toolkit gotcha
 * catalogue. A committed script with a verification step is the fix.
 *
 * THREE CONSTRAINTS THAT ARE NOT NEGOTIABLE
 * -----------------------------------------
 * 1. `page=` is HARD-CAPPED at page 99 (9,900 items) on list endpoints. Page 100
 *    returns HTTP 422 demanding cursor pagination. Cursors are sequential, so
 *    parallelising by page number is structurally impossible, not merely slow.
 *    `--paginate` follows the Link header and handles this.
 * 2. NEVER pipe this through `head`, `tail` or `grep -m`. Redirect to a file and
 *    read the file afterwards.
 * 3. Output is ~240 MB. It is written to data/gh/ and gitignored as bulk; only
 *    the derived summaries are ever committed.
 *
 * usage:
 *   node tools/gh-corpus-harvest.mjs            harvest, then verify
 *   node tools/gh-corpus-harvest.mjs --verify   verify an existing corpus only
 */
import { existsSync, statSync, createReadStream, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'data', 'gh');
const CORPUS = join(OUT_DIR, 'all-issues.jsonl');
const STATS = join(OUT_DIR, 'corpus-stats.json');

const JQ = '.[] | select(.pull_request==null) | {number,title,body:(.body//""),state,'
  + 'labels:[.labels[].name],comments,created_at,closed_at,state_reason,'
  + 'reactions:.reactions.total_count,user_type:.user.type,url:.html_url}';

function searchTotal() {
  const q = 'repo:anthropics/claude-code is:issue';
  const r = spawnSync('gh', ['api', `search/issues?q=${encodeURIComponent(q)}&per_page=1`, '--jq', '.total_count'],
    { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? Number(String(r.stdout).trim()) : null;
}

function harvest() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log('harvesting the full population via cursor pagination (never page=, never | head)');
  const t0 = Date.now();
  return new Promise((res) => {
    // Redirect straight to the file. No downstream pipe stage exists to SIGPIPE
    // the producer, which is what truncated a previous harvest at 800 of 1,300
    // while still reporting exit 0.
    const fd = openSync(CORPUS, 'w');
    const p = spawn('gh', ['api', '--paginate',
      'repos/anthropics/claude-code/issues?state=all&per_page=100&sort=created&direction=asc',
      '--jq', JQ], { stdio: ['ignore', fd, 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    const tick = setInterval(() => {
      if (existsSync(CORPUS)) process.stderr.write(`  ${(statSync(CORPUS).size / 1048576).toFixed(0)} MB\n`);
    }, 60_000);
    p.on('close', (code) => {
      clearInterval(tick);
      closeSync(fd);
      res({ code, err: err.trim().slice(0, 400), seconds: Math.round((Date.now() - t0) / 1000) });
    });
  });
}

async function verify() {
  if (!existsSync(CORPUS)) { console.error(`no corpus at ${CORPUS}`); return 1; }
  const bytes = statSync(CORPUS).size;
  let lines = 0; let parsed = 0; let malformed = 0;
  const seen = new Set();
  let oldest = null; let newest = null;
  const rl = createInterface({ input: createReadStream(CORPUS, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    lines++;
    let o;
    try { o = JSON.parse(line); parsed++; } catch { malformed++; continue; }
    seen.add(o.number);
    const c = o.created_at;
    if (c) { if (!oldest || c < oldest) oldest = c; if (!newest || c > newest) newest = c; }
  }
  const total = searchTotal();
  const stats = {
    generated: new Date().toISOString(),
    bytes, megabytes: Number((bytes / 1048576).toFixed(1)),
    lines, parsed, malformed,
    unique_issue_numbers: seen.size,
    duplicates: parsed - seen.size,
    oldest_created_at: oldest, newest_created_at: newest,
    search_api_total: total,
    delta_vs_search: total === null ? null : seen.size - total,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(STATS, JSON.stringify(stats, null, 2));

  console.log(`\ncorpus     : ${stats.megabytes} MB, ${lines} lines`);
  console.log(`parsed     : ${parsed}   malformed: ${malformed}`);
  console.log(`unique #   : ${seen.size}   duplicates: ${stats.duplicates}`);
  console.log(`created    : ${oldest} .. ${newest}`);
  console.log(`search API : ${total === null ? 'unavailable' : total}  delta ${stats.delta_vs_search}`);

  // A harvest is only complete if it matches the independent count. A small
  // positive delta is expected: issues filed DURING the run.
  const ok = malformed === 0 && stats.duplicates === 0
    && (total === null || (stats.delta_vs_search >= 0 && stats.delta_vs_search <= 50));
  console.log(ok ? 'STATUS: PASS' : 'STATUS: FAIL (see the deltas above)');
  return ok ? 0 : 1;
}

async function main() {
  if (process.argv.includes('--verify')) return verify();
  const r = await harvest();
  console.log(`gh exit=${r.code} in ${r.seconds}s`);
  if (r.err) console.log(`stderr: ${r.err}`);
  if (r.code !== 0) { console.error('harvest FAILED, not verifying a partial corpus'); return 1; }
  return verify();
}

if (IS_MAIN) main().then((c) => process.exit(c));
