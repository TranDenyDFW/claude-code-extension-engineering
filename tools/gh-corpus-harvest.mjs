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
import { existsSync, statSync, createReadStream, writeFileSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
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

/**
 * PASS, UNVERIFIED or FAIL. Pure, so the three states can be pinned by a
 * self-test that feeds each one a known input and watches it come back.
 *
 * `delta` is `corpus_unique - population_at_the_corpus_boundary`. Because the
 * boundary is fixed, the expected value is ZERO, not "some small positive
 * number". The old tolerance window ran 0 to +50 against the LIVE total, which
 * was wrong in both respects: the live total grows, so a perfect corpus drifts
 * negative forever, and the window's own comment described the sign backwards.
 */
export function harvestStatus({ malformed, duplicates, total, delta }) {
  if (malformed !== 0 || duplicates !== 0) return 'FAIL';
  if (total === null || total === undefined) return 'UNVERIFIED';
  // Symmetric and tight, because the comparison is now against the count AT THE
  // CORPUS BOUNDARY, which does not move. A few missing issues are expected
  // (deleted, transferred, or converted to discussions between harvest and
  // check); a corpus EXCEEDING the population at its own boundary is impossible
  // and is a real defect. Both directions are bounded, neither is waved through.
  return Math.abs(delta) <= 5 ? 'PASS' : 'FAIL';
}

/**
 * gh env with GITHUB_TOKEN and GH_TOKEN stripped.
 *
 * This machine has an EXPIRED GITHUB_TOKEN environment variable, and gh honours
 * it over the valid keyring credential, producing "Bad credentials (HTTP 401)".
 * That is the proximate cause of the delta that never got measured.
 *
 * It must be applied to EVERY `gh` invocation in this file, not only the
 * verification query. An independent review caught the first version stripping
 * the token in `searchTotal` while `harvest()` still spawned `gh` with the
 * ambient environment, which left the harvest itself unable to run on this host.
 * Values are never read or logged, only deleted.
 */
function ghEnv() {
  const e = { ...process.env };
  delete e.GITHUB_TOKEN;
  delete e.GH_TOKEN;
  return e;
}

/**
 * The independent count this corpus is checked against.
 *
 * Returns `{ total, why }`. `why` is non-empty exactly when the count could NOT
 * be obtained, and it is surfaced, because the previous version returned a bare
 * null and the caller then treated "I could not look" as "I looked and it was
 * fine". That is how `data/gh/README.md` came to publish "search API : 81291
 * delta 0" for a run that never queried the search API at all.
 */
function searchTotal(extra = '') {
  const q = `repo:anthropics/claude-code is:issue${extra ? ` ${extra}` : ''}`;
  const r = spawnSync('gh', ['api', `search/issues?q=${encodeURIComponent(q)}&per_page=1`, '--jq', '.total_count'],
    { encoding: 'utf8', windowsHide: true, env: ghEnv() });
  if (r.status !== 0) {
    const err = String(r.stderr || '').trim().slice(0, 200);
    const auth = /bad credentials|401|authentication|gh auth login/i.test(err)
      ? ' (gh authentication failed; an invalid GITHUB_TOKEN env var outranks the keyring credential)'
      : '';
    return { total: null, why: `gh exited ${r.status}${auth}: ${err.replace(/\s+/g, ' ') || 'no stderr'}` };
  }
  const n = Number(String(r.stdout).trim());
  if (!Number.isFinite(n)) return { total: null, why: `gh returned a non-numeric total: ${String(r.stdout).trim().slice(0, 80)}` };
  return { total: n, why: '' };
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
      '--jq', JQ], { stdio: ['ignore', fd, 'pipe'], windowsHide: true, env: ghEnv() });
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
  /**
   * COMPARE AGAINST THE CORPUS BOUNDARY, NOT THE LIVE TOTAL.
   *
   * The live population grows continuously, so comparing a fixed snapshot to it
   * meant the gate drifted toward FAIL with every passing hour even on a perfect
   * corpus. Measured on 2026-08-05: live 81,627 against a corpus of 81,291 gives
   * -336, which reads as "336 issues missing" and is wrong. 335 of those were
   * simply created AFTER the harvest; the count of issues created up to the
   * corpus's own newest timestamp is 81,292, so the real discrepancy is ONE.
   *
   * The boundary count does not move, so this comparison is stable and the gate
   * means the same thing next month as it does today.
   */
  const live = searchTotal();
  const boundary = newest ? searchTotal(`created:<=${newest}`) : { total: null, why: 'corpus has no dated issues' };
  const total = boundary.total;
  const searchWhy = boundary.why;
  const stats = {
    generated: new Date().toISOString(),
    bytes, megabytes: Number((bytes / 1048576).toFixed(1)),
    lines, parsed, malformed,
    unique_issue_numbers: seen.size,
    duplicates: parsed - seen.size,
    oldest_created_at: oldest, newest_created_at: newest,
    search_api_total_at_boundary: total,
    search_api_total_live: live.total,
    boundary_query: newest ? `created:<=${newest}` : null,
    delta_vs_search: total === null ? null : seen.size - total,
    search_unavailable_reason: searchWhy || null,
    status: null,
  };

  console.log(`\ncorpus     : ${stats.megabytes} MB, ${lines} lines`);
  console.log(`parsed     : ${parsed}   malformed: ${malformed}`);
  console.log(`unique #   : ${seen.size}   duplicates: ${stats.duplicates}`);
  console.log(`created    : ${oldest} .. ${newest}`);
  console.log(`search API : ${total === null ? 'UNAVAILABLE' : total} at the corpus boundary  delta ${total === null ? 'n/a' : stats.delta_vs_search}`);
  console.log(`             live population is ${live.total === null ? 'UNAVAILABLE' : live.total}; the difference is issues filed AFTER the harvest and is not a defect`);
  if (searchWhy) console.log(`             ${searchWhy}`);

  /**
   * THREE STATES, NOT TWO, AND THAT IS THE WHOLE FIX.
   *
   * A harvest is only COMPLETE if it matches an independent count. The previous
   * version folded "could not obtain the count" into PASS with
   * `(total === null || ...)`, so a run that never reached the search API printed
   * STATUS: PASS while skipping the only check that distinguishes a complete
   * population from a truncated one. data/gh/README.md then published
   * "search API : 81291 delta 0" for exactly such a run.
   *
   * That is the same shape as the `| head -30` SIGPIPE this file's own header
   * warns about: a partial result reported as success. "I could not look" must
   * never share an exit code with "I looked and it was right".
   */
  stats.status = harvestStatus({
    malformed, duplicates: stats.duplicates, total, delta: stats.delta_vs_search,
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(STATS, JSON.stringify(stats, null, 2));

  if (stats.status === 'PASS') {
    console.log('STATUS: PASS');
  } else if (stats.status === 'UNVERIFIED') {
    console.log('STATUS: UNVERIFIED (shape is clean, but completeness was NOT checked)');
    console.log('  The corpus may be complete or truncated; this run cannot tell you which.');
    console.log('  Do not publish a delta. Fix the search count and re-run before citing this corpus.');
  } else {
    console.log('STATUS: FAIL (see the deltas above)');
  }
  const ok = stats.status === 'PASS';
  return ok ? 0 : 1;
}

/**
 * The gate had no self-test, which is how it shipped unable to fail on the one
 * condition it exists to detect. Each row feeds a known input and asserts the
 * state that must come back.
 */
function selfTest() {
  let pass = 0; let fail = 0;
  const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ` (${d})` : ''}`); } };
  const S = (o) => harvestStatus(o);

  check('an exact match passes', S({ malformed: 0, duplicates: 0, total: 81291, delta: 0 }) === 'PASS');
  check('the measured -1 passes (one issue deleted or transferred since the harvest)',
    S({ malformed: 0, duplicates: 0, total: 81292, delta: -1 }) === 'PASS');

  /**
   * THE OLD MOVING-TARGET BUG, pinned so it cannot come back.
   *
   * Comparing against the LIVE population gave -336 on a corpus this same run
   * proves is complete: 335 of those issues were created after the harvest. A
   * gate that fails purely because time passed is not a gate, it is a clock.
   */
  check('MUST FAIL: a live-total-sized delta is a real failure under the boundary rule',
    S({ malformed: 0, duplicates: 0, total: 81627, delta: -336 }) === 'FAIL');

  // THE ROW THAT WOULD HAVE CAUGHT THE SHIPPED DEFECT.
  check('MUST NOT PASS: an unavailable count is UNVERIFIED, never PASS',
    S({ malformed: 0, duplicates: 0, total: null, delta: null }) === 'UNVERIFIED',
    S({ malformed: 0, duplicates: 0, total: null, delta: null }));
  check('MUST NOT PASS: undefined is treated the same as null',
    S({ malformed: 0, duplicates: 0, total: undefined, delta: undefined }) === 'UNVERIFIED');

  check('a truncated corpus FAILS', S({ malformed: 0, duplicates: 0, total: 81291, delta: -400 }) === 'FAIL');
  check('the tolerance is SYMMETRIC: a corpus exceeding its own boundary FAILS',
    S({ malformed: 0, duplicates: 0, total: 81291, delta: 6 }) === 'FAIL');
  check('the tolerance is TIGHT: the old +50 window would no longer pass',
    S({ malformed: 0, duplicates: 0, total: 81291, delta: 50 }) === 'FAIL');
  check('the boundary of the window itself is inclusive on both sides',
    S({ malformed: 0, duplicates: 0, total: 1, delta: 5 }) === 'PASS'
    && S({ malformed: 0, duplicates: 0, total: 1, delta: -5 }) === 'PASS');
  check('malformed lines FAIL even with a perfect delta',
    S({ malformed: 3, duplicates: 0, total: 81291, delta: 0 }) === 'FAIL');
  check('duplicates FAIL even with a perfect delta',
    S({ malformed: 0, duplicates: 2, total: 81291, delta: 0 }) === 'FAIL');
  check('a broken shape outranks an unavailable count',
    S({ malformed: 1, duplicates: 0, total: null, delta: null }) === 'FAIL');
  check('the three states are distinct',
    new Set(['PASS', 'UNVERIFIED', 'FAIL']).size === 3
    && S({ malformed: 0, duplicates: 0, total: 1, delta: 0 }) !== S({ malformed: 0, duplicates: 0, total: null, delta: null }));

  if (existsSync(STATS)) {
    const s = JSON.parse(readFileSync(STATS, 'utf8'));
    console.log(`\non-disk corpus-stats.json: status=${s.status ?? '(absent, pre-dates this gate)'} `
      + `search_api_total_at_boundary=${s.search_api_total_at_boundary} delta=${s.delta_vs_search}`);
    check('the on-disk stats do not claim a delta they did not measure',
      !(s.search_api_total_at_boundary === null && typeof s.delta_vs_search === 'number'),
      `boundary=${s.search_api_total_at_boundary} delta=${s.delta_vs_search}`);
  }

  console.log(`\n${fail === 0 ? 'SELF-TEST PASS' : 'SELF-TEST FAIL'} ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  if (process.argv.includes('--verify')) return verify();
  const r = await harvest();
  console.log(`gh exit=${r.code} in ${r.seconds}s`);
  if (r.err) console.log(`stderr: ${r.err}`);
  if (r.code !== 0) { console.error('harvest FAILED, not verifying a partial corpus'); return 1; }
  return verify();
}

if (IS_MAIN) main().then((c) => process.exit(c));
