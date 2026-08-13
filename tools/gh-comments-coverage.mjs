#!/usr/bin/env node
/**
 * Verify the comment harvest against each issue's own comment count.
 *
 * WHY THIS IS THE IMPORTANT FILE
 * ------------------------------
 * `repos/{o}/{r}/issues/comments` caps pagination at page 300, which at per_page=100 is
 * 30,000 comments, roughly TEN PERCENT of the ~293,000 that exist. Every request in a
 * truncated harvest returns HTTP 200. The output file is well formed. The harvester's own
 * summary says "harvest complete". Nothing anywhere errors.
 *
 * So the harvester CANNOT verify itself, and this check is the only thing standing between
 * a 10% corpus and a claim that we have all the comments. It works because the issues corpus
 * carries an INDEPENDENT number: each issue's `comments` integer, reported by a different
 * endpoint. Comparing harvested-per-issue against that integer is a falsifiability check,
 * not a self-report.
 *
 * A mismatch is listed per issue, never summarised as a percentage. "99.4% covered" reads
 * as success; "487 issues short, here they are" is actionable.
 *
 * usage:
 *   node tools/gh-comments-coverage.mjs --rev data/gh/rev/2026-08-13
 *   node tools/gh-comments-coverage.mjs --rev <dir> --issues <path>   explicit issues file
 *   node tools/gh-comments-coverage.mjs --selftest
 */
import { existsSync, createReadStream, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

/* Run the main path ONLY when executed directly, the pattern gh-corpus-harvest.mjs already
   uses at its line 34. Without this the module runs a full coverage pass and calls
   process.exit() during evaluation, so `import()` never resolves and the exported pure
   functions cannot be tested or reused from anywhere. An independent reviewer found this by
   trying to call truncationSuspected() directly and never reaching the callback. */
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * Compare expected counts to harvested counts.
 *
 * `expected` is Map<issueNumber, count> from the issues corpus.
 * `actual`   is Map<issueNumber, count> from the harvested comments.
 *
 * SHORT is the failure that matters (we are missing bodies). OVER is reported too rather
 * than ignored: it means a comment was harvested for an issue whose count says otherwise,
 * which happens legitimately when a comment is added between the two harvests, and would
 * otherwise be quietly averaged away.
 */
export function compare(expected, actual) {
  const short = []; const over = []; const missingIssue = [];
  let expectedTotal = 0; let actualTotal = 0;
  for (const [num, exp] of expected) {
    expectedTotal += exp;
    const got = actual.get(num) || 0;
    if (got < exp) short.push({ issue: num, expected: exp, harvested: got, missing: exp - got });
    else if (got > exp) over.push({ issue: num, expected: exp, harvested: got });
  }
  for (const [num, got] of actual) {
    actualTotal += got;
    if (!expected.has(num)) missingIssue.push({ issue: num, harvested: got });
  }
  return { expectedTotal, actualTotal, short, over, missingIssue };
}

/** A harvest that stopped at the pagination cap has an unmistakable signature. */
export function truncationSuspected(actualTotal, expectedTotal) {
  if (expectedTotal <= 0) return false;
  return actualTotal < expectedTotal * 0.5;
}

/* Both spellings: the other 19 tools in this repo use `--self-test`, these two shipped
 * with `--selftest`, and a CI line copied from a neighbouring tool would otherwise go red
 * for the wrong reason. */
if (argv.includes('--selftest') || argv.includes('--self-test')) {
  let fail = 0; const ok = (n, c) => { if (!c) fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}`); };
  const exp = new Map([[1, 2], [2, 0], [3, 5]]);

  let r = compare(exp, new Map([[1, 2], [3, 5]]));
  ok('a fully covered corpus reports nothing short', r.short.length === 0 && r.expectedTotal === 7);

  r = compare(exp, new Map([[1, 2], [3, 1]]));
  ok('MUST list the issue that is short, with how many are missing',
    r.short.length === 1 && r.short[0].issue === 3 && r.short[0].missing === 4);

  r = compare(exp, new Map([[1, 3], [3, 5]]));
  ok('an over-count is reported, not silently accepted', r.over.length === 1 && r.over[0].issue === 1);

  r = compare(exp, new Map([[1, 2], [3, 5], [99, 1]]));
  ok('a comment for an unknown issue is reported (a PR comment, or a newer issue)',
    r.missingIssue.length === 1 && r.missingIssue[0].issue === 99);

  /* The whole point of the file. */
  ok('MUST flag a page-cap truncation', truncationSuspected(30000, 293226) === true);
  ok('does not cry truncation on a nearly complete harvest', truncationSuspected(292000, 293226) === false);
  ok('an empty expectation cannot claim truncation', truncationSuspected(0, 0) === false);

  console.log(`\n${7 - fail} passed, ${fail} failed`);
  process.exit(fail ? 3 : 0);
}

if (!IS_MAIN) {
  /* Imported for its pure functions. Do nothing else. */
} else {
const REV = resolve(flag('--rev') || '.');
const COMMENTS = join(REV, 'all-comments.jsonl');
const ISSUES = flag('--issues')
  ? resolve(flag('--issues'))
  : (existsSync(join(REV, 'all-issues.jsonl')) ? join(REV, 'all-issues.jsonl') : resolve('data/gh/all-issues.jsonl'));

for (const [label, p] of [['comments', COMMENTS], ['issues', ISSUES]]) {
  if (!existsSync(p)) { console.error(`missing ${label}: ${p}`); process.exit(2); }
}
console.log(`comments : ${COMMENTS}`);
console.log(`issues   : ${ISSUES}${ISSUES.includes('rev') ? '' : '   <- the OLD issue list; counts predate the comment harvest'}`);

const readCounts = (path, keyFn, valFn) => new Promise((res) => {
  const m = new Map(); let bad = 0;
  const rl = createInterface({ input: createReadStream(path) });
  rl.on('line', (l) => {
    if (!l.trim()) return;
    let o; try { o = JSON.parse(l); } catch { bad++; return; }
    const k = keyFn(o); if (k === null || k === undefined) { bad++; return; }
    m.set(k, (m.get(k) || 0) + valFn(o));
  });
  rl.on('close', () => res({ m, bad }));
});

const { m: expected, bad: badIssues } = await readCounts(ISSUES, (o) => o.number, (o) => (typeof o.comments === 'number' ? o.comments : 0));
const { m: actual, bad: badComments } = await readCounts(COMMENTS, (o) => o.issue_number, () => 1);

const r = compare(expected, actual);
const suspect = truncationSuspected(r.actualTotal, r.expectedTotal);

const out = {
  generated: new Date().toISOString(),
  comments_file: COMMENTS,
  issues_file: ISSUES,
  issues_seen: expected.size,
  expected_comments: r.expectedTotal,
  harvested_comments: r.actualTotal,
  coverage_note: 'expected comes from each issue\'s own `comments` integer, reported by a DIFFERENT endpoint than the comment harvest. That independence is what makes this a check rather than a self-report.',
  truncation_suspected: suspect,
  page_cap_note: 'The repo-wide comments endpoint caps at page 300 (30,000 comments). A truncated harvest returns HTTP 200 throughout and looks complete. This check exists to catch exactly that.',
  issues_short: r.short.length,
  issues_over: r.over.length,
  comments_for_unknown_issues: r.missingIssue.length,
  malformed_lines: { issues: badIssues, comments: badComments },
  short: r.short.slice(0, 500),
  over: r.over.slice(0, 200),
  unknown_issues_sample: r.missingIssue.slice(0, 200).map((x) => x.issue),
};
const OUTFILE = join(REV, 'comment-coverage.json');
writeFileSync(OUTFILE, JSON.stringify(out, null, 1) + '\n');

console.log('');
console.log(`issues in list        : ${expected.size}`);
console.log(`comments EXPECTED     : ${r.expectedTotal}`);
console.log(`comments HARVESTED    : ${r.actualTotal}`);
console.log(`issues short          : ${r.short.length}   (missing ${r.short.reduce((s, x) => s + x.missing, 0)} bodies)`);
console.log(`issues over           : ${r.over.length}   (comments added after the issue list was captured)`);
console.log(`for unknown issues    : ${r.missingIssue.length}   (PR comments, or issues newer than the list)`);
console.log(`malformed lines       : issues ${badIssues}, comments ${badComments}`);
console.log('');
if (suspect) {
  console.log('TRUNCATION SUSPECTED: harvested is under half of expected. This is the page-300 cap.');
  console.log('Do NOT treat this corpus as complete.');
}
console.log(`wrote ${OUTFILE}`);
process.exit(suspect || r.short.length ? 6 : 0);
}
