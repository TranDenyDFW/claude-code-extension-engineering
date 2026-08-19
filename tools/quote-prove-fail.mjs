/**
 * End-to-end must-fail proofs for tools/quote-check.mjs.
 *
 * The self-test proves classifyLine and quotesIn behave; it does NOT prove that `npm run quotes`
 * returns non-zero. So each proof below mutates a REAL artifact, runs the gate AS ITS OWN PROCESS,
 * then restores the exact bytes and verifies that.
 *
 * Three proofs, each closing a hole a review found in the one before it:
 *
 *   1. COMMUNITY-quote rule. Append an offending line to a real reference file.
 *
 *   2. HEADER coverage rule. Strip the quote sentence from a file that carries quotes. Added
 *      2026-08-19: an adversarial panel found the header check silently exempting any file that
 *      claimed nothing, which is how the two files holding 34 of the 46 quotes escaped it.
 *
 *   3. THE SELF-TEST ROWS THEMSELVES. Revert each property of the header check in turn and require
 *      that the row NAMED for it goes red. The same panel found a row labelled for the class fix
 *      that exercised a different branch, so deleting the branch it named left every gate green.
 *      A row that cannot fail is indistinguishable from a row that is not there.
 *
 * RESTORATION IS VERIFIED AGAINST THE BYTES WE SAVED, not against git. A first version compared
 * `git diff --stat` and reported "restored false" on every proof, because the files under test had
 * legitimate uncommitted edits: it was measuring the working tree rather than the experiment. The
 * git comparison remains as a second opinion, but only where the file was already clean.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFS = `${ROOT}/skills/claude-code-extension-engineering/references`;
const CHECK = `${ROOT}/tools/quote-check.mjs`;

const gate = () => spawnSync('node', ['tools/quote-check.mjs'], { cwd: ROOT, encoding: 'utf8' });
const selfTest = () => spawnSync('node', ['tools/quote-check.mjs', '--self-test'], { cwd: ROOT, encoding: 'utf8' });
const gitClean = (p) => execFileSync('git', ['diff', '--stat', '--', p], { cwd: ROOT, encoding: 'utf8' }).trim() === '';

/**
 * The self-test rows belonging to the header check are marked `// @header-row` in quote-check.mjs,
 * so they can be enumerated mechanically rather than guessed from wording. A first attempt matched
 * labels by keyword and reported "9 of 8", which is the shape of a denominator nobody measured.
 *
 * Every marked row must be covered by a revert below, or listed in ROWS_EXEMPT with a reason. A new
 * header row with neither fails this tool, which is the only thing that keeps the revert list from
 * falling behind the check it protects.
 */
function headerRows() {
  const src = readFileSync(CHECK, 'utf8');
  const RE = new RegExp("check\\(\\s*'((?:[^'\\\\]|\\\\.)*)'[^\\n]*@header-row", 'g');
  return [...src.matchAll(RE)].map((m) => m[1].replace(/\\'/g, "'"));
}

const ROWS_EXEMPT = new Map([
  ['every reference header that states a quote count states the RIGHT one',
    'asserts the live corpus is clean rather than one code path, and proof 2 already exercises it end to end'],
  ['...and the header check can fail, given a count the gate contradicts',
    'is itself a must-fail probe, and the count-comparison revert reddens it as a side effect'],
  ['no upstream prose is quoted on a line this gate does not check',
    'asserts the live corpus is clean rather than one code path; proof 3b exercises the mechanism end to end by planting a real offender'],
]);

let PROVEN_ROWS = 0;
const REVERT_ROWS = [];

const before = gate();
console.log(`  baseline gate exit: ${before.status}  (must be 0, or the experiments prove nothing)`);
if (before.status !== 0) { console.error('  ABORT: gate was already red'); process.exit(1); }
const baseSelf = selfTest();
console.log(`  baseline self-test exit: ${baseSelf.status}  (must be 0)`);
if (baseSelf.status !== 0) { console.error('  ABORT: self-test was already red'); process.exit(1); }

let problems = 0;

/** Run `body` with `file` mutated, always restoring the original bytes. */
function withMutation(file, mutate, body) {
  const original = readFileSync(file); // Buffer, so CRLF survives byte for byte
  const wasClean = gitClean(file);
  try {
    writeFileSync(file, mutate(original));
    return { result: body(), original, wasClean };
  } finally {
    writeFileSync(file, original);
  }
}

function restoredExactly(file, m) {
  return readFileSync(file).equals(m.original) && (!m.wasClean || gitClean(file));
}

// ------------------------------------------------------- 1. the COMMUNITY-quote rule
{
  const TARGET = `${REFS}/skills.md`;
  const OFFENDER = '- Community practice holds that you should "always run the guard before the dispatcher fires"  [COMMUNITY]\n';
  const m = withMutation(TARGET, (orig) => Buffer.concat([orig, Buffer.from(OFFENDER, 'utf8')]), () => {
    const after = gate();
    return { status: after.status, said: /VERBATIM QUOTE ON A COMMUNITY-ONLY LINE/.test(after.stdout) };
  });
  const restored = restoredExactly(TARGET, m);
  const ok = m.result.status === 1 && m.result.said && restored && gate().status === 0;
  console.log(`\n  1. COMMUNITY-quote rule: exit ${m.result.status} (must be 1), names the rule ${m.result.said}, restored ${restored}`);
  if (!ok) problems++;
}

// ------------------------------------------------------- 2. the header coverage rule
{
  const TARGET = `${REFS}/testing.md`;
  /* Match whatever COUNT PHRASE the header uses rather than one exact sentence. A first version
     pinned the literal "this file carries ONE verbatim quote" and crashed the moment the header was
     reworded in a way the gate itself accepts, turning a passing rewrite into a failed proof. */
  const CLAIM = /carries\s+([A-Za-z]+(?:-[A-Za-z]+)?|\d+)\s+verbatim\s+quotes?/i;
  const m = withMutation(
    TARGET,
    (orig) => {
      const t = orig.toString('utf8');
      if (!CLAIM.test(t)) throw new Error('the header of testing.md states no quote count, so there is nothing to strip');
      return Buffer.from(t.replace(CLAIM, 'says nothing about quotes'), 'utf8');
    },
    () => {
      const after = gate();
      return { status: after.status, said: /HEADER MISDESCRIBES ITS OWN QUOTE COVERAGE/.test(after.stdout) };
    },
  );
  const restored = restoredExactly(TARGET, m);
  const ok = m.result.status === 1 && m.result.said && restored && gate().status === 0;
  console.log(`  2. header coverage rule: exit ${m.result.status} (must be 1), names the rule ${m.result.said}, restored ${restored}`);
  console.log('     a file carrying quotes cannot stay silent about how many');
  if (!ok) problems++;
}

// ------------------------------------------------------- 3b. the unchecked-quotation rule
{
  const TARGET = `${REFS}/themes.md`;
  /* An untagged line quoting a sentence that really is in the mirror. themes.md carries no quotes
     and claims none, so this is the cleanest place to plant one without disturbing a count. */
  const OFFENDER = '- Migration note: the docs say to "run Claude Code inside WSL2" on unsupported platforms.\n';
  const m = withMutation(TARGET, (orig) => Buffer.concat([orig, Buffer.from(OFFENDER, 'utf8')]), () => {
    const after = gate();
    return { status: after.status, said: /UPSTREAM PROSE QUOTED WHERE THIS GATE DOES NOT CHECK IT/.test(after.stdout) };
  });
  const restored = restoredExactly(TARGET, m);
  const ok = m.result.status === 1 && m.result.said && restored && gate().status === 0;
  console.log(`  3b. unchecked-quotation rule: exit ${m.result.status} (must be 1), names the rule ${m.result.said}, restored ${restored}`);
  console.log("     Anthropic's words cannot be quoted from a line this gate does not read");
  if (!ok) problems++;
}

// ------------------------------------------------------- 3. the self-test rows are load-bearing
{
  const src = readFileSync(CHECK, 'utf8');
  const crlf = src.includes('\r\n');
  const c = (s) => (crlf ? s.replace(/\n/g, '\r\n') : s);

  const REVERTS = [
    {
      label: 'the fixed line window that hid a wrapped claim',
      from: '  const head = headerBlock(text);',
      to: "  const head = String(text).replace(/\\r/g, '').split('\\n').slice(0, 8).join(' ').replace(/>\\s*/g, ' ');",
      row: /WRAPPED past the old fixed window/,
    },
    {
      label: 'silence exempting a file that carries quotes',
      from: "      if (actual > 0) out.push({ file: f, word: null, claimed: null, actual, reason: 'no claim' });",
      to: '      /* reverted by quote-prove-fail */',
      row: /header claiming nothing is a FAILURE/,
    },
    {
      label: 'reading one header dialect only',
      from: '  /all\\s+([A-Za-z]+(?:-[A-Za-z]+)?|\\d+)\\s+verbatim\\s+quotes?\\s+in\\s+this\\s+file/i,',
      to: '',
      row: /both header dialects parse/,
    },
    {
      label: 'the count comparison, which carries both the wrong-count and unknown-word cases',
      from: '    if (claim.claimed !== actual) {',
      to: '    if (false) {',
      row: /caught on the count branch instead/,
    },
    {
      label: 'the unknown-number-word parse, which must return null rather than a number',
      from: '    return { word: raw, claimed: n === undefined ? null : n };',
      to: '    return { word: raw, claimed: n === undefined ? 0 : n };',
      row: /number word the map does not know/,
    },
    {
      label: 'the blockquote boundary, without which body prose can forge a claim',
      from: '    if (started) break;',
      to: '    if (started) continue;',
      row: /blockquote stops at the first non-quoted line/,
    },
    {
      label: 'whitespace tolerance, guarded redundantly by the collapse AND the patterns',
      edits: [
        { from: "  return out.join(' ').replace(/\\s+/g, ' ').trim();", to: "  return out.join(' ').trim();" },
        { from: '  /carries\\s+([A-Za-z]+(?:-[A-Za-z]+)?|\\d+)\\s+verbatim\\s+quotes?/i,', to: '  /carries ([A-Za-z]+(?:-[A-Za-z]+)?|\\d+) verbatim quotes?/i,' },
      ],
      row: /doubled space does not make a claim invisible/,
    },
    {
      label: 'skipping fenced code blocks in the unchecked-quotation hunt',
      from: '      if (/^\\s*```/.test(line)) { fenced = !fenced; return; }',
      to: '      if (false) { fenced = !fenced; return; }',
      row: /ignores fenced code blocks/,
    },
    {
      label: 'the uncapped header window',
      from: '  for (const l of lines) {',
      to: '  for (const l of lines.slice(0, 40)) {',
      row: /past the old 40-line cap/,
    },
  ];

  console.log('\n  3. the header self-test rows, one revert at a time:');
  for (const rv of REVERTS) {
    /* A property can be protected by more than one line. Whitespace tolerance is guarded both by
       headerBlock's collapse and by the pattern's \\s+, so reverting either alone leaves the row
       green and the proof reads as a hole that is not one. A revert may therefore carry several
       edits, applied together. */
    const edits = rv.edits || [{ from: rv.from, to: rv.to }];
    const missing = edits.filter((e) => src.split(c(e.from)).length - 1 !== 1);
    if (missing.length) {
      console.log(`     COULD NOT RUN  ${rv.label}: ${missing.length} anchor(s) not unique in quote-check.mjs`);
      problems++;
      continue;
    }
    const mutated = edits.reduce((acc, e) => acc.replace(c(e.from), c(e.to)), src);
    const m = withMutation(CHECK, () => Buffer.from(mutated, 'utf8'), () => selfTest());
    const out = m.result;
    const red = out.status !== 0;
    const named = String(out.stdout).split(/\r?\n/).some((l) => /^\s*FAIL/.test(l) && rv.row.test(l));
    const restored = restoredExactly(CHECK, m);
    console.log(`     ${red && named && restored ? 'PROVEN  ' : 'SURVIVED'}  ${rv.label}  (self-test exit ${out.status}, row named ${named}, restored ${restored})`);
    REVERT_ROWS.push(rv.row);
    if (red && named && restored) PROVEN_ROWS++;
    else problems++;
  }
}

const finalGate = gate();
const finalSelf = selfTest();
console.log(`\n  gate exit after every restore: ${finalGate.status} (must be 0); self-test: ${finalSelf.status} (must be 0)`);
if (finalGate.status !== 0 || finalSelf.status !== 0) problems++;

const rows = headerRows();
const covered = new Set();
for (const rv of REVERT_ROWS) for (const r of rows) if (rv.test(r)) covered.add(r);
const uncovered = rows.filter((r) => !covered.has(r) && !ROWS_EXEMPT.has(r));
if (uncovered.length) {
  console.log('\n  HEADER ROWS WITH NEITHER A REVERT NOR AN EXEMPTION:');
  for (const r of uncovered) console.log(`    ${r}`);
  problems += uncovered.length;
}
console.log(`\n  header rows: ${rows.length} marked, ${covered.size} covered by a revert, ${ROWS_EXEMPT.size} exempt with a stated reason`);
console.log(`\n  ${problems
  ? `FAIL  ${problems} proof(s) did not hold`
  : `GATE CAN FAIL  the COMMUNITY-quote rule, the header-coverage rule, and every marked header self-test row, each covered by a revert that reddens it or exempt for a stated reason.`}`);
process.exit(problems ? 1 : 0);
