#!/usr/bin/env node
/**
 * Advisory coverage report: which evidence-tagged claims have no Tier 1 answer
 * key matching their text. NOT a CI gate, and full coverage is NOT a goal;
 * the point is that "did the suite keep up with the content?" gets a
 * mechanical answer instead of a manual sweep.
 *
 *   node tools/coverage-report.mjs             per-file summary + uncovered list
 *   node tools/coverage-report.mjs --summary   per-file summary only
 *   node tools/coverage-report.mjs --doc-numbers
 *       Re-derives the live counts and fails on any documentation sentence that
 *       states a DIFFERENT number for the same thing. Three stale-count reports
 *       across two audit rounds is why this exists: prose drifts from the
 *       artifacts it describes, and only re-derivation catches it.
 *       This IS a gate (exit 1 on any hit) and CI runs it. That is affordable
 *       only because the fact list is deliberately narrow: each pattern is
 *       phrased so that a match can only be a claim about current state. A
 *       first version matched generic shapes like "N questions" and produced
 *       ten hits, all legitimate historical quotes; those were dropped rather
 *       than ship a gate that cries wolf. If a future document needs to quote a
 *       superseded count, rephrase it away from the canonical wording, and say
 *       in the text that it is historical.
 *
 * Ignore-list: claim classes never meant for one-question-per-line coverage.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SUMMARY_ONLY = process.argv.includes('--summary');
const DOC_NUMBERS = process.argv.includes('--doc-numbers');

/**
 * --prove-can-fail: THE MUST-FAIL PROOF THIS GATE NEVER HAD.
 *
 * Six review rounds established the pattern and this file sat outside it. Twice a
 * defect here was "fixed" by reshaping the counter, and twice the reshape was itself
 * a relocation, because nothing ever fed the gate a known-bad input and required it
 * to go red. The second time the commit message stated the invariant as a property
 * and a single edit falsified it. A claimed invariant with no mutation behind it is
 * the same defect as a check that cannot fail, one level up.
 *
 * This spawns the gate as a PROCESS against deliberately broken sources and requires
 * a non-zero exit, then against the real tree and requires zero. It is the cheapest
 * version of what --prove-gate-can-fail does for the scaffold, and it is what would
 * have caught both previous attempts mechanically instead of by review.
 */
if (process.argv.includes('--prove-can-fail')) {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const self = join(HERE, 'coverage-report.mjs');
  const run = (env) => spawnSync(process.execPath, [self, '--doc-numbers'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 180_000, env: { ...process.env, ...env } });

  let bad = 0;
  const check = (n, ok, d) => {
    console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + n + (ok ? '' : '  (' + (d || '') + ')'));
    if (!ok) bad++;
  };

  const clean = run({});
  check('the gate is GREEN on the real tree, so a red below means something', clean.status === 0, 'exit ' + clean.status);

  const dir = mkdtempSync(join(tmpdir(), 'covfail-'));
  try {
    const garbage = join(dir, 'results.json');
    writeFileSync(garbage, '{ this is not json');
    const r = run({ COVERAGE_VALIDATION_RESULTS: garbage });
    const out = String(r.stdout || '') + String(r.stderr || '');
    check('MUST FAIL: an unreadable validation record', r.status !== 0, 'exit ' + r.status);
    check('...and it SAYS the published number is unguarded rather than going quiet', /guarded by NOTHING/.test(out));
    check('...and never reports "none" in the same breath as a complaint', !/^ {2}none$/m.test(out),
      'printed a complaint and "none" together, which is how this defect survived twice');

    const r2 = run({ COVERAGE_VALIDATION_RESULTS: join(dir, 'absent.json') });
    check('MUST FAIL: a validation record that is not there at all', r2.status !== 0, 'exit ' + r2.status);

    writeFileSync(garbage, JSON.stringify({ prove: { caught: 'not a number' } }));
    const r3 = run({ COVERAGE_VALIDATION_RESULTS: garbage });
    check('MUST FAIL: a record whose caught value is not a number', r3.status !== 0, 'exit ' + r3.status);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const after = run({});
  check('the gate returns to GREEN once the override is gone', after.status === 0, 'exit ' + after.status);
  console.log(bad ? '\nGATE CANNOT FAIL: ' + bad + ' problem(s).' : '\nGATE CAN FAIL: every known-bad source was rejected.');
  process.exit(bad ? 1 : 0);
}

const IGNORE = [
  /^#/,
  /Definition of Done/i,
  /\[LEGACY\]|\[DEPRECATED\]/,
  /^Layer:|^\*\*Layer:/,
];

const claims = readFileSync(join(ROOT, 'evidence', 'claims.jsonl'), 'utf8')
  .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));

if (DOC_NUMBERS) {
  const checker = readFileSync(join(ROOT, 'tools', 'check-validate-output.mjs'), 'utf8');

  // Only facts whose PHRASING is unique enough that a match is unambiguously a
  // claim about current state. Generic shapes like "N questions" or "N rows"
  // were tried and dropped: historical tables quote superseded numbers by
  // design, so those patterns produced ten hits and zero real findings. A
  // checker that cries wolf gets ignored, which is worse than no checker.
  const qRows = readFileSync(join(ROOT, 'tests', 'questions.jsonl'), 'utf8')
    .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));

  const SK = join(ROOT, 'skills', 'claude-code-extension-engineering', 'references');
  // Count the numbered card rows and the event rows from the reference files
  // themselves, so the manifest is checked against content rather than against
  // another sentence that could be equally stale.
  // Count DATA rows of a markdown table, skipping the header and the |---| rule.
  // `skipCol1` drops values that are themselves column headings: hook-events.md
  // holds two tables, and the second one's "Field" header would otherwise count as
  // a 32nd hook event. Getting this wrong makes the gate cry wolf, which this
  // file's own header warns is worse than having no gate.
  // Count DATA rows of ONE table, the one whose header row starts with `header`,
  // stopping at the first non-table line. Scoping to a single table matters:
  // hook-events.md holds several, and counting every pipe row in the file gave 36
  // against a real 31. A gate that miscounts cries wolf, which this file's own
  // header warns is worse than having no gate at all.
  /**
   * Word numbers. Extended UPWARD to fifty on 2026-08-06, and deliberately NOT
   * downward past six.
   *
   * The old map stopped at thirteen, so "fifteen committed fixtures" in the README
   * was read as a non-number and skipped rather than compared. The run still
   * printed "none", which is worse than having no rule at all.
   *
   * Adding one to five was tried and REVERTED in the same sitting: it immediately
   * produced three false positives on ordinary prose ("Two fixtures changed
   * afterwards", "Three fixtures"), because small word-numbers are quantifiers in
   * English before they are claims. The floor stays at six for that reason.
   */
  const WORDS = {
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50,
  };

  const tableRows = (file, header) => {
    if (!existsSync(join(SK, file))) return 0;
    const lines = readFileSync(join(SK, file), 'utf8').split(/\r?\n/);
    const start = lines.findIndex((l) => l.startsWith(`| ${header} `) || l.startsWith(`| ${header}|`));
    if (start < 0) return 0;
    const seen = new Set();
    for (let i = start + 1; i < lines.length; i++) {
      if (!lines[i].startsWith('|')) break;
      const col1 = (lines[i].split('|')[1] || '').trim().replace(/`/g, '');
      if (!col1 || /^-+$/.test(col1)) continue;
      seen.add(col1);
    }
    return seen.size;
  };
  const cardCount = tableRows('composition-cards.md', 'Pairing');
  const eventCount = tableRows('hook-events.md', 'Event');
  // Re-derived, never typed. The fixture count is the live tree count; the round
  // count is read out of the heading that publishes it.
  const benchFixtures = (() => {
    try { return readdirSync(join(ROOT, 'tests', 'lint-bench', 'fixtures')).length; } catch { return null; }
  })();
  /**
   * DERIVING a number and MATCHING one need different word maps, and conflating
   * them produced a NaN on the first run.
   *
   * `WORDS` is the MATCH map and its floor is six on purpose, because "two" and
   * "three" are quantifiers in prose. Here we are reading one specific heading in
   * one specific file, so there is no ambiguity to protect against and the small
   * words are legitimate. The published heading currently reads "Five".
   */
  // Current-status counts out of the capability catalog, which is itself gated by
  // tools/capability-catalog.mjs --check-integrity. Derived, never typed.
  const catCurrent = (sec) => {
    try {
      const cat = JSON.parse(readFileSync(join(ROOT, 'data', 'capabilities', 'catalog.json'), 'utf8'));
      return Object.values(cat[sec] || {}).filter((v) => v.status === 'current').length;
    } catch { return null; }
  };
  const currentTools = catCurrent('tools');
  const currentEvents = catCurrent('hookEvents');

  // Derived from the packs themselves, so a new pack or family updates the gate
  // without anyone remembering to.
  const { PACKS } = await import('./packs/index.mjs');
  const { FAMILIES } = await import('./packs/policy-schema.mjs');
  const packCount = PACKS.size;
  const familyCount = FAMILIES.size;
  const probeCount = [...PACKS.values()].reduce((n, p) => n + p.GATE_PROBES.length, 0);
  let contractCount = null;
  try {
    contractCount = (readFileSync(join(ROOT, 'tests', 'cli-contract.mjs'), 'utf8').match(/^ {4}id: '/gm) || []).length;
  } catch { contractCount = null; }
  /**
   * The validation cohort's headline, read out of its own results file. Independent
   * review 2026-08-07: nothing re-measured it and no fact covered it, so
   * results-prove-bench-validation.md could hold a stale number indefinitely.
   */
  let validationCaught = null;
  let validationReadError = null;
  try {
    const r = JSON.parse(readFileSync(process.env.COVERAGE_VALIDATION_RESULTS
      || join(ROOT, 'tests', 'prove-bench', 'validation', 'results.json'), 'utf8'));
    validationCaught = (r.prove || {}).caught;
    if (typeof validationCaught !== 'number') { validationReadError = 'results.json has no prove.caught number'; validationCaught = null; }
  } catch (e) { validationReadError = e.message; validationCaught = null; }
  /**
   * AN UNREADABLE SOURCE IS A GATE FAILURE, NOT A DROPPED FACT.
   *
   * The first version swallowed the error and omitted the fact from FACTS entirely,
   * so replacing results.json with garbage left `--doc-numbers` at exit 0 reporting
   * "none", with the published 10 of 10 unguarded in two files. Independent review
   * 2026-08-08. A fact whose absence is silent is worse than no fact, because the
   * green run reads as coverage.
   */
  const HEADING_WORDS = { ...WORDS, one: 1, two: 2, three: 3, four: 4, five: 5 };
  const hardeningRounds = (() => {
    try {
      const m = readFileSync(join(ROOT, 'tests', 'results-lint-bench.md'), 'utf8')
        .match(/^##\s+(\w+)\s+rounds of scoring hardening/mi);
      if (!m) return null;
      const w = m[1].toLowerCase();
      const n = HEADING_WORDS[w] !== undefined ? HEADING_WORDS[w] : Number(w);
      return Number.isFinite(n) ? n : null;
    } catch { return null; }
  })();
  const FACTS = [
    { label: 'checker fixtures', live: (checker.match(/^\s+name:/gm) || []).length, re: /(?:grown to\s+)?(\w+)\s+fixtures/gi },
    { label: 'ledger claims', live: claims.length, re: /(\d+)\s+source assignments/gi },
    // Added 2026-08-02 after the README was found claiming 184 questions and 174
    // positive assertions against a live 191 and 181. Both phrasings are specific
    // enough that a match can only be a claim about CURRENT state: a historical
    // quote does not say "questions (set v2)" or "all N positive assertions".
    { label: 'suite rows', live: qRows.length, re: /(\d+)\s+questions \(set v2\)/gi },
    { label: 'positive assertions', live: qRows.filter(r => r.answer_key && !r.must_not_match).length, re: /all\s+(\d+)\s+positive assertions/gi },
    // Added 2026-08-05 after independent review found .claude-plugin/plugin.json
    // advertising "18 composition cards, 30 hook-event contracts" against a live 24
    // and 31, while this gate reported "none disagree". The gate was real; it simply
    // did not scan the manifest, which is the FIRST surface a marketplace reader sees.
    { label: 'composition cards', live: cardCount, re: /(\d+)\s+composition cards/gi },
    { label: 'hook-event contracts', live: eventCount, re: /(\d+)\s+hook-event contracts/gi },
    /**
     * Added 2026-08-06. The two rules above are CANONICAL-PHRASE rules, and the
     * README broke both by paraphrasing ITSELF: line 86 said "28 composition
     * cards" and passed the gate, while line 241 of the same file said
     * "(24 cards)" and line 243 said "(30 events + deltas)", both stale, both
     * invisible. A gate keyed to one phrasing protects one phrasing.
     *
     * These two are anchored to the parenthesised table-row form, which is where
     * a count sits next to a link rather than inside a sentence.
     */
    { label: 'composition cards (table row)', live: cardCount, re: /\((\d+)\s+cards\)/gi },
    { label: 'hook events (table row)', live: eventCount, re: /\((\d+)\s+events\b/gi },
    /**
     * Added 2026-08-06 after the README was found claiming "fifteen committed
     * fixtures" against a live 30. It slipped the 'checker fixtures' rule because
     * that rule counts a DIFFERENT artifact, and it slipped the word conversion
     * because WORDS stopped at thirteen.
     */
    { label: 'lint-bench fixtures', live: benchFixtures, re: /(\w+)\s+committed (?:fixtures|trees)/gi },
    /**
     * Added 2026-08-06. The README said FOUR rounds of scoring hardening while
     * tests/results-lint-bench.md had said five ever since the fifth landed. Two
     * files in the same repo disagreeing about the same countable thing is what
     * this gate exists for, and nothing was reading the heading that publishes it.
     *
     * `words: HEADING_WORDS` is LOAD-BEARING, and its absence made this rule a
     * CHECK THAT COULD NOT FAIL for a day. Independent review found it by
     * replaying the real pre-fix README: the gate reported three disagreements,
     * not four, and stayed silent on "FOUR rounds of scoring hardening" sitting
     * on its own line.
     *
     * Cause: the global WORDS map floors at six so that "two fixtures" in
     * ordinary prose is not read as a claim, so "FOUR" parsed to NaN and was
     * skipped entirely. Both live sentences say "Five", so this rule was
     * comparing NOTHING repo-wide while appearing in the live-values list as
     * though it were working. The floor is right for a GENERIC shape and wrong
     * here, because "N rounds of scoring hardening" is canonical enough that a
     * small word cannot be innocent prose. So the map is per-fact.
     */
    { label: 'scoring-hardening rounds', live: hardeningRounds, words: HEADING_WORDS, re: /(\w+)\s+rounds of scoring hardening/gi },
    /**
     * Added 2026-08-06 after independent review pointed out that this gate does
     * not scan the reference files, and that the same round had just written a
     * fresh numeric claim into 22 of them: "the capability surface is unchanged
     * at N current tools and M current hook events". A gate whose own header
     * warns that prose drifts from its artifact, while not reading the 22 files
     * that just gained a claim, is the defect it names.
     */
    { label: 'current tools', live: currentTools, re: /(\d+)\s+current tools/gi },
    { label: 'current hook events', live: currentEvents, re: /(\d+)\s+current hook events/gi },
    /**
     * Added 2026-08-07 with the purpose-pack refactor. Every one is DERIVED from
     * the code that owns it, never typed here: the creator went from one family to
     * two packs in a single commit, and the number of places a stale "one
     * requirement family" could sit is precisely why this gate exists. A count
     * typed into this file would just be a second thing to forget.
     */
    { label: 'purpose packs', live: packCount, words: HEADING_WORDS, re: /(\w+)\s+purpose packs/gi },
    { label: 'validation families', live: familyCount, words: HEADING_WORDS, re: /(\w+)\s+validation families/gi },
    { label: 'scaffold gate probes', live: probeCount, re: /(\d+)\s+frozen (?:gate )?probes/gi },
    /**
     * The CLI contract's own count, DERIVED. Independent review 2026-08-08 pointed
     * out that the coverage figures published in docs/RESULTS.md sat outside this
     * gate entirely, which is the same class of stale-count risk the gate exists
     * for. The denominator (the verdict-line total) moves only when a tool gains
     * or loses an outcome line; the numerator moves whenever anyone edits the
     * contract file, so it is the half worth guarding mechanically.
     */
    ...(contractCount === null ? [] : [
      { label: 'cli contracts', live: contractCount, re: /now asserts \*\*(\d+) across/gi },
    ]),
    ...(validationCaught === null ? [] : [
      { label: 'validation cohort caught', live: validationCaught, re: /(\d+) of \d+ caught with the correct diagnosis/gi },
    ]),
  ];

  // docs/SUBMISSION.md and .claude-plugin/plugin.json are the two MARKETPLACE-FACING
  // surfaces, and both were omitted here until 2026-08-05. A drift gate that skips the
  // listing copy protects the document nobody reads first.
  // docs/RESULTS.md was added 2026-08-06 IN THE SAME EDIT that moved every measured
  // number out of the README and into it. Relocating a claim from a gated file to an
  // ungated one silently stops it being checked, which is the same defect class as the
  // paraphrase misses above, so the list grows with the move rather than after it.
  const SKILL_ROOT = join('skills', 'claude-code-extension-engineering');
  // The reference files and SKILL.md, added 2026-08-06. They were never scanned,
  // and this round wrote a numeric claim into 22 of them, so the omission stopped
  // being theoretical. Every FACT regex here is canonical-phrase based, which is
  // what makes scanning 26 more files affordable without crying wolf.
  const refFiles = (() => {
    try {
      return readdirSync(join(ROOT, SKILL_ROOT, 'references'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => join(SKILL_ROOT, 'references', f))
        .concat([join(SKILL_ROOT, 'SKILL.md')]);
    } catch { return []; }
  })();
  const docs = ['README.md', 'IMPROVEMENTS.md', 'docs/SUBMISSION.md', 'docs/RESULTS.md', '.claude-plugin/plugin.json',
    ...refFiles,
    ...readdirSync(join(ROOT, 'tests'))
      .filter(f => /^results.*\.md$/.test(f)).map(f => join('tests', f))]
    .filter(rel => existsSync(join(ROOT, rel)));

  console.log('Live values re-derived from the artifacts:');
  for (const f of FACTS) console.log(`  ${f.label.padEnd(32)}${f.live}`);
  console.log('\nDocumentation statements that disagree:');
  /**
   * PROBLEMS ARE AN ARRAY AND THE EXIT CODE IS ITS LENGTH.
   *
   * Two previous attempts at this were relocations, not fixes. `hits++` beside each
   * console.log meant deleting ONE increment left the gate printing "guarded by
   * NOTHING" and exiting 0 in the same output; introducing a helper for one of the
   * five sites left the other four unchanged, and the commit message then claimed
   * as a property something a single edit falsified. Independent review caught both.
   *
   * Every complaint now goes through `complain`, which pushes before it prints, and
   * the exit code reads the array. There is no counter to remove, and removing the
   * push breaks all five sites at once, which `--prove-can-fail` observes.
   *
   * The superseded `hits++` design was described in a comment that sat directly above
   * this one until 2026-08-12, asserting as a property the very thing round 6 proved
   * false: "the counter cannot be removed from the branch below without the message
   * going with it". It could. A stale comment claiming a guarantee, parked above the
   * code that replaced it, is the same defect this gate exists to catch, one level up.
   */
  const problems = [];
  const complain = (...lines) => { problems.push(lines[0]); for (const l of lines) console.log(l); };
  if (validationReadError) {
    complain(
      `  tests/prove-bench/validation/results.json is unreadable (${validationReadError}), so the`,
      '  published validation-cohort number is guarded by NOTHING. Regenerate it with',
      '  `node tests/prove-bench/validation/run-bench.mjs --record` rather than letting this',
      '  gate go quiet: a fact that disappears with its source reads as coverage it does not have.');
  }
  for (const rel of docs) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const f of FACTS) {
        f.re.lastIndex = 0;
        let m;
        while ((m = f.re.exec(line)) !== null) {
          const raw = m[1].replace(/,/g, '').toLowerCase();
          // Per-fact word map, defaulting to the conservative global one. A fact
          // whose phrasing is canonical enough can opt into the small words.
          const W = f.words || WORDS;
          const n = W[raw] !== undefined ? W[raw] : Number(raw);
          if (!Number.isFinite(n) || n === f.live) continue;
          complain(`  ${rel}:${i + 1}  ${f.label}: doc says ${m[1]}, live is ${f.live}`,
            `      ${line.trim().slice(0, 110)}`);
        }
      }
    });
  }
  // Key ambiguity: an answer key that matches more than once in its own source
  // file can survive deletion of the passage it guards. Item 13 was closed by
  // rescoping, then silently REOPENED when unrelated content added a second
  // occurrence of one key, and only a human reviewer noticed. Closing it by
  // construction instead: the ledger of intentional exceptions is explicit, and
  // anything else is a failure.
  //
  // Two exemptions, and they hold for DIFFERENT reasons. Keep them distinct:
  // an independent review caught this comment justifying both on A015's
  // grounds, which are wrong for A001.
  //
  // A015 ("are all upstream sources redistributable?"): each of the 13
  // Proprietary rows in sources.md is a separate falsifier, so the plurality
  // genuinely IS the answer, and the row degrades to red if they all go.
  //
  // A001 ("is Agent Teams stable and on by default?"): its 7 hits are
  // restatements of ONE fact, not joint evidence. It is exempt on a narrower
  // ground: every occurrence concerns the same feature's experimental status,
  // so no unrelated passage can prop the row up if the real answer changes.
  //
  // Adding to this list is not a fix. Rescope first; exempt only when
  // narrowing would make the test assert something false, and write down
  // which of the two grounds applies.
  const AMBIGUITY_EXEMPT = new Set(['A001', 'A015']);
  const qAll = readFileSync(join(ROOT, 'tests', 'questions.jsonl'), 'utf8')
    .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
  for (const q of qAll) {
    if (!q.answer_key || AMBIGUITY_EXEMPT.has(q.id)) continue;
    let src;
    try { src = readFileSync(join(ROOT, q.source_file), 'utf8'); } catch { continue; }
    let re;
    try { re = new RegExp(q.answer_key, 'gi'); } catch { continue; }
    const n = (src.match(re) || []).length;
    if (n > 1) {
      complain(`  ${q.source_file}  ${q.id}: answer key matches ${n} times, so the row can survive deletion of the passage it guards. Rescope it, or add it to AMBIGUITY_EXEMPT with a reason.`);
    }
  }

  // Stale "Last reviewed" header: the specific defect that prompted this mode.
  const impText = readFileSync(join(ROOT, 'IMPROVEMENTS.md'), 'utf8');
  const header = impText.match(/^Last reviewed (\d{4}-\d{2}-\d{2})/m);
  const allDates = [...impText.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m => m[1]).sort();
  const newest = allDates[allDates.length - 1];
  if (!header) {
    // Fail closed: a missing header is indistinguishable from a moved one, and
    // silently passing is how the stale header survived three rounds.
    complain('  IMPROVEMENTS.md  header date: no "Last reviewed YYYY-MM-DD" line found; the check cannot run, so it fails');
  } else if (newest && header[1] < newest) {
    complain(`  IMPROVEMENTS.md  header date: says ${header[1]}, but the file carries content dated ${newest}`);
  }

  if (!problems.length) console.log('  none');
  else console.log(`\n${problems.length} disagreement(s). Update the prose to the live value, or rephrase a deliberately historical quote away from the canonical wording.`);
  process.exit(problems.length ? 1 : 0);
}
const questions = readFileSync(join(ROOT, 'tests', 'questions.jsonl'), 'utf8')
  .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))
  .filter(q => q.answer_key);

const keys = questions.map(q => {
  try { return new RegExp(q.answer_key, 'i'); } catch { return null; }
}).filter(Boolean);

const byFile = new Map();
let covered = 0, uncovered = 0, ignored = 0;
const uncoveredList = [];
for (const c of claims) {
  if (IGNORE.some(re => re.test(c.text))) { ignored++; continue; }
  const hit = keys.some(re => re.test(c.text));
  const f = c.file.replace(/^skills\/claude-code-extension-engineering\//, '');
  if (!byFile.has(f)) byFile.set(f, { covered: 0, uncovered: 0 });
  if (hit) { covered++; byFile.get(f).covered++; }
  else { uncovered++; byFile.get(f).uncovered++; uncoveredList.push(c); }
}

console.log('file                                   covered  uncovered');
for (const [f, s] of [...byFile.entries()].sort((a, b) => b[1].uncovered - a[1].uncovered)) {
  console.log(`${f.padEnd(40)}${String(s.covered).padStart(5)}${String(s.uncovered).padStart(10)}`);
}
console.log(`\nTOTAL tagged claims: ${claims.length}  covered: ${covered}  uncovered: ${uncovered}  ignored (checklists/legacy/headers): ${ignored}`);
console.log('Advisory only: full coverage is not a goal; rising uncovered counts after content edits are the signal.');

if (!SUMMARY_ONLY && uncoveredList.length) {
  console.log('\nUncovered claims:');
  for (const c of uncoveredList) console.log(`  ${c.id}  ${c.text.slice(0, 100)}`);
}
