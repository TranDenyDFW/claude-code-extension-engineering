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
/**
 * Every check() call in the self-test, tolerant of quoting and whitespace, each with the text of
 * its whole statement so a marker anywhere in the call counts. Keying on the literal "  check('"
 * let three spellings evade the enumerator, and a marked row with a double-quoted label left the
 * population silently while the tool still printed GATE CAN FAIL.
 */
function allCheckRows() {
  const src = readFileSync(CHECK, 'utf8');
  const RE = /check\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  const out = [];
  for (const m of src.matchAll(RE)) {
    const start = m.index;
    const next = src.indexOf('check(', start + 6);
    const body = src.slice(start, next === -1 ? start + 800 : next);
    out.push({ label: m[2].replace(/\\(['"])/g, '$1'), body, marked: /@header-row/.test(body) });
  }
  return out;
}

function headerRows() {
  return allCheckRows().filter((r) => r.marked).map((r) => r.label);
}

/**
 * A row that asserts the LIVE CORPUS is clean cannot be reddened by reverting a code path: breaking
 * the check makes it find less, not more. Such a row is exempt only if an end-to-end proof in this
 * same file plants a real offender and requires the gate to go red. The proof is named here and its
 * result is asserted below, so an exemption whose proof stops running is a failure rather than a
 * sentence that keeps being true on paper.
 */
const ROWS_EXEMPT = new Map([
  ['every reference header that states a quote count states the RIGHT one',
    { why: 'asserts the live corpus is clean; a code revert makes the check find less, never more', provenBy: 'header coverage rule' }],
  ['...and the header check can fail, given a count the gate contradicts',
    { why: 'is itself a must-fail probe over the live corpus', provenBy: 'header coverage rule' }],
  ['no upstream prose is quoted on a line this gate does not check',
    { why: 'asserts the live corpus is clean, same shape as the row above', provenBy: 'unchecked-quotation rule' }],
  ['no header states anything outside the build and the quote count',
    { why: 'asserts the live corpus is clean; a code revert makes the shape check find less, never more',
      provenByRows: [
        '...and that decision refuses a date',
        '...and refuses a figure nothing checks',
        '...and refuses a header that does not name the verified build',
      ] }],
  ['no header dates a fetch the source records contradict',
    { why: 'asserts the live corpus is clean, same shape as the row above',
      provenByRows: ['...and that decision fires when a cited source was retrieved on another day'] }],
  ['no header promises one source for every claim while the ledger says otherwise',
    { why: 'asserts the live corpus is clean; the pure decision beneath it is what can be reverted',
      provenByRows: [
        '...and that decision fires when such a header sits over records with two sources',
        '...and stays silent when every record shares one source',
        '...and stays silent for a header that makes no universal claim',
      ] }],
]);

/** Proof labels that passed in this run, so an exemption can be checked rather than believed. */
const PROOFS_PASSED = new Set();

let PROVEN_ROWS = 0;
const REVERT_ROWS = [];
const REDDENED = new Set();

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
  if (ok) PROOFS_PASSED.add('COMMUNITY-quote rule');
  else problems++;
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
  if (ok) PROOFS_PASSED.add('header coverage rule');
  else problems++;
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
  if (ok) PROOFS_PASSED.add('unchecked-quotation rule');
  else problems++;
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
      from: "  if (!claim) return actual > 0 ? { word: null, claimed: null, actual, reason: 'no claim' } : null;",
      to: '  if (!claim) return null;',
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
      from: '  if (claim.claimed !== actual) {',
      to: '  if (false) {',
      row: /caught on the count branch instead/,
    },
    {
      label: 'the unknown-number-word parse, which must return null rather than a number',
      from: "  })).map((p) => ({ word: p.word, claimed: p.claimed === undefined ? null : p.claimed }));",
      to: "  })).map((p) => ({ word: p.word, claimed: p.claimed === undefined ? 0 : p.claimed }));",
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
      label: 'joining a wrapped paragraph, back to physical lines',
      from: '    cur.text += ` ${l.trim()}`;',
      to: '    flush(); cur = { line: i + 1, text: l };',
      row: /paragraph wrapped across two lines is ONE logical line/,
    },
    {
      label: 'joining a wrapped BLOCKQUOTE, which flushed on every quoted line',
      from: "    if (quoted && cur && curQuoted) { cur.text += ` ${l.replace(/^\\s*>\\s?/, '').trim()}`; continue; }",
      to: '    if (false) { continue; }',
      row: /BLOCKQUOTE wrapped the same way is too/,
    },
    {
      label: 'the same-quotedness test, so a blockquote absorbs the paragraph above it',
      from: '    const curQuoted = cur ? /^\\s*>/.test(cur.text) : false;',
      to: '    const curQuoted = true;',
      row: /blockquote does NOT absorb the paragraph above it/,
    },
    {
      label: 'the fence rule in the joiner, so a fenced block is joined like prose',
      from: 'export const isFence = (l) => /^\\s*(```|~~~)/.test(String(l));',
      to: 'export const isFence = () => false;',
      row: /fenced block is never joined/,
    },
    {
      label: 'skipping code blocks in the unchecked-quotation hunt, fenced AND indented',
      edits: [
        { from: '      if (isFence(text)) { fenced = !fenced; continue; }', to: '      if (false) { fenced = !fenced; continue; }' },
        { from: '      if (isIndentedCode(text, false)) continue;', to: '      if (false) continue;' },
      ],
      row: /ignores fenced code blocks/,
    },
    {
      label: 'the uncapped header window',
      from: '  for (const l of lines) {',
      to: '  for (const l of lines.slice(0, 40)) {',
      row: /past the old 40-line cap/,
    },
    {
      label: 'the universal-sourcing test, without which any header is treated as claiming one source',
      from: '  if (!UNIVERSAL_SOURCING.test(String(headerText))) return null;',
      to: '  if (false) return null;',
      row: /stays silent for a header that makes no universal claim/,
    },
    {
      label: 'the more-than-one-source condition, loosened so a single source reports too',
      from: '  return sources.length > 1 ? { records: records.length, sources } : null;',
      to: '  return sources.length >= 1 ? { records: records.length, sources } : null;',
      row: /stays silent when every record shares one source/,
    },
    {
      label: 'the sourcing decision itself, disabled',
      from: '  return sources.length > 1 ? { records: records.length, sources } : null;',
      to: '  return null;',
      row: /decision fires when such a header sits over records with two sources/,
    },
    {
      label: 'the fetch-date construction test, so no header is ever checked against its sources',
      from: '  if (!FETCH_ON_THAT_DATE.test(head)) return null;',
      to: '  if (true) return null;',
      row: /decision fires when a cited source was retrieved on another day/,
    },
    {
      label: 'the named-dates set, so a header naming a second date is reported anyway',
      from: '  const wrong = [...new Set(retrievedDates)].filter((d) => d && !named.has(d));',
      to: '  const wrong = [...new Set(retrievedDates)].filter((d) => d && d !== claimed);',
      row: /stays silent when every cited source date is named in the header/,
    },
    {
      label: 'case and padding tolerance in the tag regexes',
      edits: [
        { from: 'const TAGGED = /\\[\\s*(OFFICIAL|ANTHROPIC(\\s+RECOMMENDATION)?|EXPERIMENTAL|LEGACY|DEPRECATED)\\s*\\]|\\[v\\d+\\.\\d+\\.\\d+\\]/i;', to: 'const TAGGED = /\\[(OFFICIAL|ANTHROPIC|EXPERIMENTAL|LEGACY|DEPRECATED)\\]|\\[v\\d+\\.\\d+\\.\\d+\\]/;' },
      ],
      row: /tag spelled with different case or padding/,
    },
    {
      label: 'case and padding tolerance in the COMMUNITY regex',
      from: String.raw`const COMMUNITY_TAGGED = /\[\s*COMMUNITY(\s+PRACTICE)?\s*\]/i;`,
      to: String.raw`const COMMUNITY_TAGGED = /\[COMMUNITY( PRACTICE)?\]/;`,
      row: /COMMUNITY spellings too/,
    },
    {
      label: 'the wider glyph set, back to double curly quotes only',
      from: "  return String(s).replace(/[\\u201C\\u201D\\u201E\\u201F\\u2018\\u2019\\u00AB\\u00BB\\u300C\\u300D\\u300E\\u300F]/g, '\"');",
      to: "  return String(s).replace(/[\\u201C\\u201D\\u201E\\u201F]/g, '\"');",
      row: /guillemets or CJK brackets is extracted/,
    },
    {
      label: 'the no-claim tolerance for a file with no quotes',
      from: '  if (!claim) return actual > 0 ? { word: null, claimed: null, actual, reason: \'no claim\' } : null;',
      to: '  if (!claim) return { word: null, claimed: null, actual, reason: \'no claim\' };',
      row: /silence is fine when the file carries none/,
    },
    {
      label: 'the equality that lets a correct count pass',
      from: '  if (claim.claimed !== actual) {',
      to: '  if (claim.claimed === actual) {',
      row: /stated count that matches passes/,
    },
    {
      label: 'the date refusal in the header shape',
      from: "  if (dates.length) problems.push(`states ${dates.length} date(s): ${dates.join(', ')}`);",
      to: '  if (false) problems.push(String(dates.length));',
      row: /decision refuses a date/,
    },
    {
      label: 'the unchecked-figure refusal in the header shape',
      from: "  if (nums.length) problems.push(`states ${nums.length} unchecked figure(s): ${nums.join(', ')}`);",
      to: '  if (false) problems.push(String(nums.length));',
      row: /refuses a figure nothing checks/,
    },
    {
      label: 'the build-name requirement in the header shape',
      from: "  if (version && !head.includes(version)) problems.push(`does not name the verified build ${version}`);",
      to: '  if (false) problems.push(String(version));',
      row: /refuses a header that does not name the verified build/,
    },
    {
      label: 'the quote-count exemption, so a stated numeral counts as an unchecked figure',
      from: "    .filter((n) => !(claim && String(claim.claimed) === n));",
      to: '    .filter(() => true);',
      row: /accepts the build plus a quote count written as a numeral/,
    },
    {
      label: 'the typographic-quote fold, without which a curly citation is invisible',
      from: '  line = foldQuoteMarks(line);',
      to: '  line = String(line);',
      row: /TYPOGRAPHIC quotes is extracted/,
    },
    {
      label: 'the same-count-twice tolerance, so a restated count reads as a conflict',
      from: '  const distinct = [...new Set(parsed.map((p) => String(p.claimed)))];',
      to: '  const distinct = parsed.map((p) => String(p.claimed));',
      row: /header restating the SAME count twice is still read/,
    },
    {
      label: 'the two-count refusal, back to first-match-wins',
      from: '  if (distinct.length > 1) return { word: found.join(\' and \'), claimed: null, conflicting: true };',
      to: '  if (false) return null;',
      row: /TWO DIFFERENT counts is refused/,
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
    for (const l of String(out.stdout).split(/\r?\n/)) {
      const mm = l.match(/^\s*FAIL\s+(.*?)\s\s+\(/);
      if (mm) REDDENED.add(mm[1]);
    }
    if (red && named && restored) PROVEN_ROWS++;
    else problems++;
  }
}

const finalGate = gate();
const finalSelf = selfTest();
console.log(`\n  gate exit after every restore: ${finalGate.status} (must be 0); self-test: ${finalSelf.status} (must be 0)`);
if (finalGate.status !== 0 || finalSelf.status !== 0) problems++;

const rows = headerRows();

/* A marked row must CALL something. Replacing its assertion with a literal passes any run, which is
   how three rows were gutted undetected. The assertion text has to mention one of the functions the
   header check is made of. */
/* The planted() helper is the self-test's own wrapper over headerQuoteMismatches; a row calling
   it is calling the header check one level down. Named explicitly rather than by pattern, so a
   future helper has to be added deliberately. */
const HEADER_FNS = /headerQuoteMismatches|headerQuoteClaim|headerBlock|headerClaimCoverage|collectUncheckedResolvingQuotes|headerSourcingMismatches|sourcingMismatch|planted\(|quotesIn|foldQuoteMarks|headerFetchDateMismatches|fetchDateMismatch|logicalLines|classifyLine|quoteCountProblem|headerShapeProblems|headerShapeViolations/;
const src = readFileSync(CHECK, 'utf8');
const gutted = [];

/* EVERY occurrence of a label, not the first. A literal twin placed AFTER the real row passed the
   guard, because the guard stopped looking once it found one honest copy. A duplicate marked label
   is now itself a failure, since two rows sharing a name make coverage unreadable either way. */
/* Duplicates across EVERY row, marked or not. An unmarked twin sharing a marked row's label
   supplies the FAIL line that credits it, which is how a literal `true` was recorded as OBSERVED
   to redden. Looking only at marked labels could not see the twin. */
const allLabels = allCheckRows().map((r) => r.label);
const dupes = allLabels.filter((r, i) => allLabels.indexOf(r) !== i);
if (dupes.length) {
  console.log('\n  DUPLICATE ROW LABELS, WHICH MAKE COVERAGE UNREADABLE:');
  for (const d of [...new Set(dupes)]) console.log(`    ${d}`);
  problems += new Set(dupes).size;
}

const HEADER_ONLY_FNS = /headerQuoteMismatches|headerQuoteClaim|headerBlock|headerClaimCoverage|headerSourcingMismatches|sourcingMismatch|headerFetchDateMismatches|fetchDateMismatch|collectUncheckedResolvingQuotes|planted\(|quoteCountProblem|headerShapeProblems|headerShapeViolations/;
const bodyAt = (i) => {
  const next = src.indexOf('  check(', i + 8);
  return src.slice(i, next === -1 ? i + 600 : next);
};
const everyRow = allCheckRows();
for (const r of rows) {
  const occurrences = everyRow.filter((x) => x.label === r);
  if (!occurrences.length) { gutted.push(`${r} (row not found)`); continue; }
  if (!occurrences.every((x) => HEADER_FNS.test(x.body))) gutted.push(r);
}

/* THE INVERSE RULE. Moving a marker one line down un-marks a row silently, so a row that plainly
   tests the header check must SAY so. Anything asserting over a header function without the marker
   is reported, which is the only way the marked set can be trusted as the population. */
const unmarked = [];
for (const r of everyRow) {
  if (r.marked || rows.includes(r.label)) continue;
  if (HEADER_ONLY_FNS.test(r.body)) unmarked.push(r.label);
}
if (unmarked.length) {
  console.log('\n  ROWS THAT TEST THE HEADER CHECK WITHOUT THE @header-row MARKER:');
  for (const u of unmarked) console.log(`    ${u}`);
  console.log('  An unmarked row is outside the population this tool measures coverage over.');
  problems += unmarked.length;
}
if (gutted.length) {
  console.log('\n  MARKED ROWS THAT ASSERT NOTHING ABOUT THE HEADER CHECK:');
  for (const r of gutted) console.log(`    ${r}`);
  console.log('  A row whose assertion calls none of the header functions cannot be testing them.');
  problems += gutted.length;
}

/* Covered means OBSERVED to go red under some revert, not matched by a label pattern. */
const covered = rows.filter((r) => REDDENED.has(r));
const exemptOk = [];
const exemptBad = [];
for (const r of rows) {
  if (covered.includes(r)) continue;
  const ex = ROWS_EXEMPT.get(r);
  if (!ex) { exemptBad.push(`${r}  (no revert reddened it and it is not exempt)`); continue; }
  if (ex.provenByRows) {
    const missing = ex.provenByRows.filter((x) => !covered.includes(x));
    if (missing.length) exemptBad.push(`${r}  (exempt on ${ex.provenByRows.length} rows, ${missing.length} of which no revert reddened)`);
    else exemptOk.push(r);
  } else if (PROOFS_PASSED.has(ex.provenBy)) exemptOk.push(r);
  else exemptBad.push(`${r}  (exempt on proof "${ex.provenBy}", which did not pass)`);
}
if (exemptBad.length) {
  console.log('\n  HEADER ROWS NEITHER REDDENED BY A REVERT NOR COVERED BY A PASSING PROOF:');
  for (const r of exemptBad) console.log(`    ${r}`);
  problems += exemptBad.length;
}
console.log(`\n  header rows: ${rows.length} marked, ${covered.length} OBSERVED to redden under a revert, ${exemptOk.length} exempt and covered by a named passing proof`);
console.log(`\n  ${problems
  ? `FAIL  ${problems} proof(s) did not hold`
  : `GATE CAN FAIL  the COMMUNITY-quote rule, the header-coverage rule, and every marked header self-test row, each OBSERVED to go red under a revert or covered by a named proof that passed.`}`);
process.exit(problems ? 1 : 0);
