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
  const CLAIM = 'this file carries ONE verbatim quote';
  const m = withMutation(
    TARGET,
    (orig) => {
      const t = orig.toString('utf8');
      if (!t.includes(CLAIM)) throw new Error(`the header of testing.md no longer contains ${JSON.stringify(CLAIM)}`);
      return Buffer.from(t.replace(CLAIM, 'this file says nothing about quotes'), 'utf8');
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
  ];

  console.log('\n  3. the header self-test rows, one revert at a time:');
  for (const rv of REVERTS) {
    const from = c(rv.from);
    if (src.split(from).length - 1 !== 1) {
      console.log(`     COULD NOT RUN  ${rv.label}: anchor is not unique in quote-check.mjs`);
      problems++;
      continue;
    }
    const m = withMutation(CHECK, () => Buffer.from(src.replace(from, c(rv.to)), 'utf8'), () => selfTest());
    const out = m.result;
    const red = out.status !== 0;
    const named = String(out.stdout).split(/\r?\n/).some((l) => /^\s*FAIL/.test(l) && rv.row.test(l));
    const restored = restoredExactly(CHECK, m);
    console.log(`     ${red && named && restored ? 'PROVEN  ' : 'SURVIVED'}  ${rv.label}  (self-test exit ${out.status}, row named ${named}, restored ${restored})`);
    if (!(red && named && restored)) problems++;
  }
}

const finalGate = gate();
const finalSelf = selfTest();
console.log(`\n  gate exit after every restore: ${finalGate.status} (must be 0); self-test: ${finalSelf.status} (must be 0)`);
if (finalGate.status !== 0 || finalSelf.status !== 0) problems++;

console.log(`\n  ${problems ? `FAIL  ${problems} proof(s) did not hold` : 'GATE CAN FAIL  the COMMUNITY-quote rule, the header-coverage rule, and every header self-test row are enforced end to end.'}`);
process.exit(problems ? 1 : 0);
