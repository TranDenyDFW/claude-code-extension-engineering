#!/usr/bin/env node
/**
 * Harvest EVERY issue comment body from anthropics/claude-code.
 *
 * WHY THIS EXISTS
 * ---------------
 * `data/gh/all-issues.jsonl` stores `comments` as an INTEGER COUNT. 293,226 comments exist
 * across the corpus and not one body was captured; only 1,300 threads (10,778 comments,
 * 3.7%) were ever fetched, and those were deliberately narrow. So the corpus answers "what
 * were people confused about" and cannot answer "what was the answer". That gap matters
 * because only 18.2% of closed issues are `state_reason: completed`: 50.2% are `not_planned`
 * and 31.6% are `duplicate`, and for those 55,114 issues the reasoning ("by design", "use X
 * instead", "duplicate of #N") exists nowhere but the comments.
 *
 * THE TRAP THIS FILE IS SHAPED AROUND
 * -----------------------------------
 * `repos/{o}/{r}/issues/comments` reports `rel="last"` as page 300. At per_page=100 that is
 * 30,000 comments, about TEN PERCENT of what exists. A naive `--paginate` harvest returns
 * HTTP 200 for every request and writes a clean, complete-looking file holding a tenth of
 * the data. Nothing errors. That is the whole reason for the coverage check in
 * gh-comments-coverage.mjs, which compares against each issue's own `comments` integer.
 *
 * The workaround was PROBED, not assumed:
 *   - `since` filters on `updated_at`, NOT `created_at`. A `since=2026-06-01` window
 *     returned a comment created 2026-02-12. Pairing `since` with `sort=created` is
 *     therefore incoherent and silently returns the wrong set.
 *   - `sort=updated&direction=asc` plus `since=<last updated_at>` advances monotonically.
 *     Three probe windows returned 298 distinct ids of 300 fetched; the 2 duplicates were
 *     the window-boundary comment, removed by deduping on `id`.
 *
 * THREE CONSTRAINTS ALREADY PAID FOR ELSEWHERE IN THIS REPO
 * ---------------------------------------------------------
 * 1. This machine's GITHUB_TOKEN env var is EXPIRED and OUTRANKS the keyring credential.
 *    Both existing harvesters delete GITHUB_TOKEN and GH_TOKEN from the child env. So does
 *    this one. The value is never read, logged or printed.
 * 2. The SECONDARY rate limit is invisible to `gh api rate_limit`: a 403 arrives while core
 *    still reports 4999/5000, and it fires on CONCURRENCY. Six workers once produced 1,381
 *    failures of 1,579. This harvester is strictly SERIAL with a per-request delay.
 * 3. Never pipe this through head/tail/grep -m. SIGPIPE kills the producer while the
 *    pipeline reports exit 0. Redirect to a file and read the file afterwards.
 *
 * usage:
 *   node tools/gh-comments-harvest.mjs --out data/gh/rev/2026-08-13
 *   node tools/gh-comments-harvest.mjs --out <dir> --max-windows 5   short wiring run
 *   node tools/gh-comments-harvest.mjs --selftest
 */
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = 'anthropics/claude-code';

/* Run the main path ONLY when executed directly, matching gh-corpus-harvest.mjs line 34.
   Without it, importing this module to reuse issueNumberOf() or planWindow() would start a
   live 3,000-request harvest as a side effect of the import. An independent reviewer caught
   the same defect in the sibling coverage tool. */
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* ---------------- pure helpers, so the selftest runs with no network ---------------- */

/** Issue number from an API issue_url. Returns null rather than guessing. */
export function issueNumberOf(url) {
  const m = /\/issues\/(\d+)(?:$|[?#])/.exec(String(url || ''));
  return m ? Number(m[1]) : null;
}

/** The projection actually stored. Keeping the full payload would roughly double the bytes. */
export function project(c) {
  return {
    id: c.id,
    issue_number: issueNumberOf(c.issue_url),
    user: c.user ? c.user.login : null,
    user_type: c.user ? c.user.type : null,
    author_association: c.author_association,
    created_at: c.created_at,
    updated_at: c.updated_at,
    reactions: c.reactions ? c.reactions.total_count : 0,
    url: c.html_url,
    body: c.body || '',
  };
}

/**
 * Decide what to keep from a window and where the cursor goes next.
 *
 * `stalled` is the case that matters. If every id in a window has already been seen the
 * cursor cannot advance, and the loop spins forever fetching the same 100 comments. That
 * failure is indistinguishable from slow progress from the outside, so it is detected here
 * and the caller nudges `since` forward by a second.
 */
export function planWindow(items, seen, since) {
  if (!items.length) return { fresh: [], nextSince: since, done: true, stalled: false };
  const fresh = items.filter((c) => !seen.has(c.id));
  const last = items[items.length - 1].updated_at;
  if (!fresh.length) return { fresh: [], nextSince: since, done: false, stalled: true };
  return { fresh, nextSince: last, done: false, stalled: false };
}

/** Bump an ISO timestamp by one second, for the stall case. */
export function bumpSecond(iso) {
  return new Date(Date.parse(iso) + 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* ---------------- selftest ---------------- */
if (argv.includes('--selftest')) {
  let fail = 0; const ok = (n, c) => { if (!c) fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}`); };

  ok('parses an issue number from issue_url',
    issueNumberOf('https://api.github.com/repos/anthropics/claude-code/issues/83804') === 83804);
  ok('MUST NOT mistake a pull url for an issue url',
    issueNumberOf('https://api.github.com/repos/a/b/pulls/12') === null);
  ok('returns null rather than guessing on junk', issueNumberOf('nonsense') === null);

  const p = project({ id: 7, issue_url: 'https://api.github.com/repos/a/b/issues/9', user: { login: 'x', type: 'User' }, author_association: 'MEMBER', created_at: 'c', updated_at: 'u', reactions: { total_count: 3 }, html_url: 'h', body: 'text' });
  ok('projection keeps the body', p.body === 'text' && p.issue_number === 9 && p.reactions === 3);
  ok('a null body becomes an empty string, never undefined', project({ id: 1, issue_url: 'x/issues/1', body: null }).body === '');

  const mk = (id, u) => ({ id, updated_at: u });
  const seen = new Set([1, 2]);
  let r = planWindow([mk(1, 'a'), mk(2, 'b'), mk(3, 'c')], seen, 'start');
  ok('keeps only unseen comments', r.fresh.length === 1 && r.fresh[0].id === 3);
  ok('advances the cursor to the last updated_at', r.nextSince === 'c');

  /* THE guard. Without it the loop spins forever on a repeated window. */
  r = planWindow([mk(1, 'a'), mk(2, 'b')], seen, 'start');
  ok('MUST detect a stalled window where nothing is fresh', r.stalled === true && r.nextSince === 'start');

  r = planWindow([], seen, 'start');
  ok('an empty window ends the harvest', r.done === true && r.stalled === false);

  ok('bumpSecond moves the cursor forward by exactly one second',
    bumpSecond('2026-01-01T00:00:00Z') === '2026-01-01T00:00:01Z');

  console.log(`\n${10 - fail} passed, ${fail} failed`);
  process.exit(fail ? 3 : 0);
}

/* ---------------- run ---------------- */
if (!IS_MAIN) {
  /* Imported for its pure functions. Never harvest as an import side effect. */
} else {
const OUT = flag('--out');
if (!OUT) { console.error('usage: node gh-comments-harvest.mjs --out <revision dir> [--max-windows N]'); process.exit(2); }
const OUTDIR = resolve(OUT);
mkdirSync(OUTDIR, { recursive: true });
const FILE = join(OUTDIR, 'all-comments.jsonl');
const CKPT = join(OUTDIR, 'comments-checkpoint.json');
const LOG = join(OUTDIR, 'comments-harvest-log.jsonl');
const MAXW = Number(flag('--max-windows', '0'));
const DELAY_MS = Number(flag('--delay', '900'));   // 4000/hr, 80% of the 5000/hr core limit

/* gh with the expired env token stripped, so it reaches the keyring credential. */
const ghEnv = () => { const e = { ...process.env }; delete e.GITHUB_TOKEN; delete e.GH_TOKEN; return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isSecondary = (s) => /rate limit exceeded|secondary rate limit|abuse detection|\b403\b/i.test(s || '');

async function ghJson(path, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = spawnSync('gh', ['api', path], { encoding: 'utf8', env: ghEnv(), maxBuffer: 1 << 28 });
    if (r.status === 0) { try { return JSON.parse(r.stdout); } catch (e) { throw new Error(`${label}: unparseable JSON`); } }
    const err = String(r.stderr || '').trim();
    /* Back off HARD on the secondary limit. Retrying straight back into it is what produced
       1,381 failures of 1,579 last time. */
    const wait = isSecondary(err) ? 60000 * attempt : 5000 * attempt;
    console.error(`  ${label}: attempt ${attempt} failed (${err.slice(0, 120)}), waiting ${wait / 1000}s`);
    await sleep(wait);
  }
  throw new Error(`${label}: gave up after 4 attempts`);
}

/* Resume from a checkpoint rather than restarting a 3,000-request harvest. */
let since = '2025-01-01T00:00:00Z';
const seen = new Set();
let written = 0;
if (existsSync(CKPT)) {
  const c = JSON.parse(readFileSync(CKPT, 'utf8'));
  since = c.since; written = c.written;
  for (const line of readFileSync(FILE, 'utf8').split('\n')) { if (line.trim()) { try { seen.add(JSON.parse(line).id); } catch { /* partial last line */ } } }
  console.log(`resuming from ${since}, ${seen.size} comment ids already on disk`);
}

console.log(`harvesting ${REPO} comments -> ${FILE}`);
console.log(`serial, ${DELAY_MS}ms between requests, resumable\n`);

let windows = 0; let stalls = 0; const t0 = Date.now();
for (;;) {
  if (MAXW && windows >= MAXW) { console.log(`stopping at --max-windows ${MAXW}`); break; }
  const path = `repos/${REPO}/issues/comments?per_page=100&sort=updated&direction=asc&since=${encodeURIComponent(since)}`;
  let items;
  try { items = await ghJson(path, `window ${windows}`); }
  catch (e) { console.error(`STOPPING: ${e.message}. Re-run to resume from the checkpoint.`); break; }
  if (!Array.isArray(items)) { console.error('STOPPING: response was not an array'); break; }

  const { fresh, nextSince, done, stalled } = planWindow(items, seen, since);
  if (done) { console.log('window returned nothing: harvest complete'); break; }

  if (stalled) {
    /* >100 comments share one updated_at. Nudge past it and say so, loudly and in the log. */
    stalls++;
    const bumped = bumpSecond(since);
    appendFileSync(LOG, JSON.stringify({ window: windows, since, n: items.length, fresh: 0, stalled: true, bumpedTo: bumped }) + '\n');
    console.log(`  window ${windows}: STALLED at ${since} (all ${items.length} already seen), bumping to ${bumped}`);
    since = bumped; windows++;
    await sleep(DELAY_MS);
    continue;
  }

  let buf = '';
  for (const c of fresh) { seen.add(c.id); buf += JSON.stringify(project(c)) + '\n'; }
  appendFileSync(FILE, buf);
  written += fresh.length;
  appendFileSync(LOG, JSON.stringify({ window: windows, since, n: items.length, fresh: fresh.length, nextSince, written }) + '\n');
  writeFileSync(CKPT, JSON.stringify({ since: nextSince, written, windows: windows + 1, updatedAt: new Date().toISOString() }, null, 1) + '\n');

  if (windows % 25 === 0) {
    const rate = (Date.now() - t0) / (windows + 1);
    console.log(`  window ${windows}: +${fresh.length} (${written} total) up to ${nextSince}  ~${Math.round(rate)}ms/window`);
  }
  since = nextSince; windows++;
  await sleep(DELAY_MS);
}

const mins = Math.round((Date.now() - t0) / 60000);
console.log(`\n${written} comments written across ${windows} windows in ${mins} minutes, ${stalls} stall bumps`);
console.log(`file  : ${FILE} (${existsSync(FILE) ? (statSync(FILE).size / 1048576).toFixed(1) : 0} MB)`);
console.log(`log   : ${LOG}`);
console.log('Coverage is NOT verified here. Run gh-comments-coverage.mjs: a harvest that stops');
console.log('near 30,000 looks identical to a complete one from inside this script.');
}
