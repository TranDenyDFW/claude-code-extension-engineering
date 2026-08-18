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
import { join, dirname, resolve, sep, basename } from 'path';
import { fileURLToPath } from 'url';
import { referenceDirs, skillDirs, stripSkillPrefix } from './skill-roots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
/**
 * Where the PROSE is read from. Overridable for one reason only: proving the doc checks can
 * fail. A checker that can only ever be pointed at documents already known to be correct is
 * a checker nobody has watched reject anything, and this gate reported "none" over four real
 * disagreements because its patterns matched only the phrasings its author happened to write.
 * Independent review 4, 2026-08-13. The committed run always uses ROOT.
 */
const DOC_ROOT = process.env.COVERAGE_DOC_ROOT ? resolve(process.env.COVERAGE_DOC_ROOT) : ROOT;
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

  /**
   * THE COMPETITOR COLUMN, in results and in prose.
   *
   * Independent review 4 found four published sentences stating the competitor's old score
   * while this gate printed "none", and review 5 got eighteen more wordings past the fix.
   * The prose parser that chased them is GONE; what remains is a ban on the retired VALUE.
   * So the mutants below reintroduce the VALUE in the wordings that beat the parser, not the
   * claims the parser used to read. TWO CLASSES IT ONCE CAUGHT ARE NO LONGER COVERED: a
   * sentence naming a fixture with no number in it, and a "single catch is X" claim carrying
   * no digit. That is a coverage regression, recorded here rather than described as a
   * simplification, because a header that advertises checks the mutants do not contain is
   * the same defect this file exists to catch.
   */
  const { cpSync, readFileSync: rf, writeFileSync: wf } = await import('node:fs');
  const dir2 = mkdtempSync(join(tmpdir(), 'covdocs-'));
  try {
    const inflate = (src, dst) => {
      const r = JSON.parse(rf(src, 'utf8'));
      const rows = Array.isArray(r) ? r : (r.rows || Object.values(r).filter((x) => x && x.fixture));
      const victim = rows.find((x) => !x.control && (x.testHookSh || {}).score !== 'CATCH');
      if (!victim) throw new Error(src + ': no non-CATCH row to inflate, the mutant would be a no-op');
      victim.testHookSh = { ...victim.testHookSh, score: 'CATCH' };
      wf(dst, JSON.stringify(r, null, 2));
    };
    inflate(join(ROOT, 'tests/prove-bench/results.json'), join(dir2, 'main.json'));
    inflate(join(ROOT, 'tests/prove-bench/validation/results.json'), join(dir2, 'val.json'));
    const m1 = run({ COVERAGE_PROVE_RESULTS: join(dir2, 'main.json') });
    check('MUST FAIL: the published competitor total no longer matches its record',
      m1.status !== 0 && /prove-bench competitor caught/.test(String(m1.stdout)), 'exit ' + m1.status);
    const m2 = run({ COVERAGE_VALIDATION_RESULTS: join(dir2, 'val.json') });
    check('MUST FAIL: the validation competitor total no longer matches its record',
      m2.status !== 0 && /validation competitor caught/.test(String(m2.stdout)), 'exit ' + m2.status);

    const DOCS = join(dir2, 'docroot');
    for (const d of ['docs', 'tests', 'skills', '.claude-plugin']) cpSync(join(ROOT, d), join(DOCS, d), { recursive: true });
    for (const f of ['IMPROVEMENTS.md', 'README.md']) cpSync(join(ROOT, f), join(DOCS, f));
    const ctl = run({ COVERAGE_DOC_ROOT: DOCS });
    check('the copied docs are GREEN, so a doc mutant below means something', ctl.status === 0, 'exit ' + ctl.status);

    /* Mutants aimed at the RULE. Review 6 got 18 of 25 of its own wordings past the first
       version, so these are the wordings IT used, not ones chosen by the author: the value
       split across a hard wrap (the worst, because this repo hard-wraps), the word form,
       "out of" and the hyphenated form. NOT covered by a mutant, and named here rather than
       implied: no mutant exercises a file type, an extension in the scope list, or an
       individual spelling, so deleting `yml` or `json` from the scope, or dropping four of
       the eight spellings, leaves every gate green. Review 7 proved that by gutting each in
       turn. Those are unwatched parts of this rule. */
    const docMutants = [
      /* These two guard the PARAGRAPH scan of the FACTS table specifically. The wrapped mutant
         below exercises the RETIRED-VALUE scanner, which already flattened whitespace, so it left
         the FACTS scan unprotected: an independent review reverted the paragraph change and found
         all eleven gates still green, meaning nothing stopped the fix being silently undone. The
         first mutant here mutates a value ALREADY wrapped in the source; the second introduces a
         wrap around one that is not. A per-line scan catches neither. */
      { n: 'MUST FAIL: a FACTS value that is wrong and already hard-wrapped', f: 'docs/RESULTS.md',
        from: 'confirms all\n291 positive assertions',
        to: 'confirms all\n999 positive assertions',
        want: /positive assertions: doc says 999/ },
      { n: 'MUST FAIL: a FACTS value made wrong AND newly wrapped', f: 'docs/RESULTS.md',
        from: '**306 questions (set v2)',
        to: '**999\nquestions (set v2)',
        want: /doc says 999/ },
      { n: 'MUST FAIL: the retired total split across a hard wrap', f: 'docs/RESULTS.md',
        from: '**10 of 10 defects caught versus 2 of 10**',
        to: '**10 of 10 defects caught versus 3\nof 10**',
        want: /retired value "3 of 10" is still published/ },
      { n: 'MUST FAIL: the retired total written in words', f: 'docs/RESULTS.md',
        from: '**10 of 10 defects caught versus 2 of 10**',
        to: '**ten of ten defects caught versus three of ten**',
        want: /retired value "three of ten" is still published/ },
      { n: 'MUST FAIL: the retired total as "out of"', f: 'IMPROVEMENTS.md',
        from: '(10 of 10 versus 2 of 10,', to: '(10 of 10 versus 3 out of 10,',
        want: /retired value "3 out of 10" is still published/ },
      { n: 'MUST FAIL: the retired total hyphenated, the form found in two .mjs headers',
        f: 'tests/prove-bench/validation/run-bench.mjs',
        from: ' * so the published first-cohort experiment is untouched.',
        to: ' * so the published 10-of-10-versus-3-of-10 experiment is untouched.',
        want: /retired value "3-of-10" is still published/ },
      { n: 'MUST FAIL: the retired validation total in the runner output form',
        f: 'tests/results-prove-bench-validation.md',
        from: 'test-hook.sh    :  0 of 11 caught', to: 'test-hook.sh    :  1 of 11 caught',
        want: /retired value "1 of 11" is still published/ },
      { n: 'MUST FAIL: a table cell giving the competitor a CATCH the record does not have',
        f: 'tests/results-prove-bench-validation.md',
        from: 'so the handler never runs | CATCH | n/a |',
        to: 'so the handler never runs | CATCH | CATCH |',
        want: /competitor row for `handler-path-bare-variable`/ },
      { n: 'MUST FAIL: an allowlist entry that no longer matches any line',
        f: 'docs/RESULTS.md',
        from: '**This number was 3 of 10 until 2026-08-13, and the correction is against our own interest to',
        to: '**This number changed on 2026-08-13, and the correction is against our own interest to',
        want: /allowlist entry matches nothing/ },
    ];
    for (const m of docMutants) {
      const fp = join(DOCS, m.f);
      const origRaw = rf(fp, 'utf8');
      /* Normalise line endings before anchoring. The docs are CRLF on disk here, so an anchor
         that spans a hard wrap has to match \r\n, which would then break on any file that is LF.
         Normalising lets a mutant carry the wrap in its anchor and stay agnostic to the ending. */
      const orig = origRaw.replace(/\r\n/g, '\n');
      if (!orig.includes(m.from)) { check(m.n, false, 'anchor not found, the mutant would be a no-op'); continue; }
      wf(fp, orig.replace(m.from, m.to));
      const r = run({ COVERAGE_DOC_ROOT: DOCS });
      check(m.n, r.status !== 0 && m.want.test(String(r.stdout)), 'exit ' + r.status);
      wf(fp, orig);
      check('...and the docs return to GREEN once it is undone', run({ COVERAGE_DOC_ROOT: DOCS }).status === 0);
    }
  } finally { rmSync(dir2, { recursive: true, force: true }); }

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

  /* Every skill's references, not one skill's. Counting card and event rows from a quarter of
     the tree and calling it the manifest is the same shape as a coverage number that only ever
     looked at part of its population. */
  const SKS = referenceDirs(ROOT);
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

  /* Resolve a reference file across EVERY skill's references. After the split a named file lives
     in exactly one of four directories, so looking in one of them finds it a quarter of the time
     and returns 0 for the rest. A manifest count that silently shrinks still looks like a
     measurement, which is the failure mode this whole file exists to prevent. */
  const findRef = (file) => SKS.map((d) => join(d, file)).find((x) => existsSync(x)) || null;

  const tableRows = (file, header) => {
    const abs = findRef(file);
    if (!abs) return 0;
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
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
   * The COMPETITOR column of both cohorts, which is the measured half.
   *
   * The fact above guards OUR score and nothing guarded theirs. So when a scoring fix
   * moved the competitor from 3 to 2 in the first cohort and 1 to 0 in the second,
   * four published sentences kept the old numbers and every gate stayed green.
   * Independent review 3, 2026-08-13. Our own score is authored here against fixtures
   * authored here; theirs is the number a reader is actually asked to believe, so
   * leaving it unguarded had the coverage exactly backwards.
   */
  let mainCompetitor = null, validationCompetitor = null, competitorReadError = null;
  const competitorCatches = (p, what) => {
    const r = JSON.parse(readFileSync(p, 'utf8'));
    const rows = Array.isArray(r) ? r : (r.rows || Object.values(r).filter((x) => x && x.fixture));
    if (!rows.length) throw new Error(`${what} results.json holds no fixture rows`);
    return rows.filter((x) => !x.control && (x.testHookSh || {}).score === 'CATCH').length;
  };
  try {
    mainCompetitor = competitorCatches(process.env.COVERAGE_PROVE_RESULTS
      || join(ROOT, 'tests', 'prove-bench', 'results.json'), 'prove-bench');
  } catch (e) { competitorReadError = `prove-bench: ${e.message}`; }
  try {
    validationCompetitor = competitorCatches(process.env.COVERAGE_VALIDATION_RESULTS
      || join(ROOT, 'tests', 'prove-bench', 'validation', 'results.json'), 'validation');
  } catch (e) { competitorReadError = `${competitorReadError ? `${competitorReadError}; ` : ''}validation: ${e.message}`; }

  /**
   * PER-FIXTURE competitor claims, which is what the count facts above cannot cover.
   *
   * Those facts match canonical phrasings, so they stayed green over four sentences that
   * said the same wrong thing in other words: a fixture listed among the competitor's
   * catches, a table cell reading CATCH where the record says n/a, "the competitor's single
   * catch is X", and a headline in a form the regex did not anticipate. Independent review
   * 4, 2026-08-13. A pattern that only recognises the phrasing its author used measures the
   * author's memory, not the artifact, so this binds a NAMED FIXTURE to its RECORDED score
   * and does not care how the sentence is written.
   */
  const fixtureScores = new Map();
  const loadFixtureScores = (p, cohort) => {
    const r = JSON.parse(readFileSync(p, 'utf8'));
    const rows = Array.isArray(r) ? r : (r.rows || Object.values(r).filter((x) => x && x.fixture));
    for (const row of rows) {
      const s = (row.testHookSh || {}).score;
      if (!s) continue;
      const seen = fixtureScores.get(row.fixture);
      if (seen && seen.score !== s) throw new Error(`fixture ${row.fixture} appears in ${seen.cohort} and ${cohort} with different competitor scores`);
      fixtureScores.set(row.fixture, { score: s, cohort });
    }
  };
  try {
    loadFixtureScores(process.env.COVERAGE_PROVE_RESULTS || join(ROOT, 'tests', 'prove-bench', 'results.json'), 'prove-bench');
    loadFixtureScores(process.env.COVERAGE_VALIDATION_RESULTS || join(ROOT, 'tests', 'prove-bench', 'validation', 'results.json'), 'validation');
  } catch (e) { competitorReadError = `${competitorReadError ? `${competitorReadError}; ` : ''}fixture scores: ${e.message}`; }

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
    ...(mainCompetitor === null ? [] : [
      /* Anchored to the competitor's own line. Unanchored, `caught (\d+)/10 defects` also
         matched our own `extension-prove : caught 10/10 defects` and reported the gate's
         first run as a disagreement at 10 versus 2. */
      { label: 'prove-bench competitor caught', live: mainCompetitor, re: /test-hook\.sh\s*:\s*caught\s+(\d+)\/10 defects/gi },
      /* Both headline forms. The narrow one matched only `10 of 10 defects caught versus
         N of 10` and sailed past `10 of 10 versus 3 of 10` in IMPROVEMENTS.md, which is the
         line an independent review had already named. */
      { label: 'prove-bench competitor, headline', live: mainCompetitor, re: /10 of 10(?: defects caught)? versus (\d+) of 10/gi },
    ]),
    ...(validationCompetitor === null ? [] : [
      { label: 'validation competitor caught', live: validationCompetitor, re: /test-hook\.sh\s+:\s+(\d+) of 11 caught/gi },
    ]),
  ];

  // docs/SUBMISSION.md and .claude-plugin/plugin.json are the two MARKETPLACE-FACING
  // surfaces, and both were omitted here until 2026-08-05. A drift gate that skips the
  // listing copy protects the document nobody reads first.
  // docs/RESULTS.md was added 2026-08-06 IN THE SAME EDIT that moved every measured
  // number out of the README and into it. Relocating a claim from a gated file to an
  // ungated one silently stops it being checked, which is the same defect class as the
  // paraphrase misses above, so the list grows with the move rather than after it.
  const SKILL_ROOTS = skillDirs(ROOT).map((d) => join('skills', basename(d)));
  // The reference files and SKILL.md, added 2026-08-06. They were never scanned,
  // and this round wrote a numeric claim into 22 of them, so the omission stopped
  // being theoretical. Every FACT regex here is canonical-phrase based, which is
  // what makes scanning 26 more files affordable without crying wolf.
  const refFiles = (() => {
    try {
      return SKILL_ROOTS.flatMap((SKILL_ROOT) => {
        const dir = join(ROOT, SKILL_ROOT, 'references');
        const refs = existsSync(dir)
          ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => join(SKILL_ROOT, 'references', f))
          : [];
        return refs.concat([join(SKILL_ROOT, 'SKILL.md')]);
      });
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
  if (competitorReadError) {
    complain(
      `  a prove-bench results file is unreadable (${competitorReadError}), so the published`,
      '  COMPETITOR numbers are guarded by NOTHING. That is the half of the comparison a reader',
      '  is actually asked to believe, and it went stale in four places once already while every',
      '  gate stayed green. Regenerate with `--record` rather than letting this gate go quiet.');
  }
  if (fixtureScores.size) {
    const CATCH_WORD = /\bcatch(es|ing)?\b|\bcaught\b/i;
    for (const rel of docs) {
      const text = readFileSync(join(DOC_ROOT, rel), 'utf8');
      const lines = text.split(/\r?\n/);

      /* A markdown row naming a fixture publishes that fixture's scores in its cells, so
         the competitor's cell is compared directly. This is the one that caught a table
         reading CATCH eighteen lines below a correct summary of the same run. */
      lines.forEach((line, i) => {
        if (!line.trim().startsWith('|')) return;
        const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
        const nameCell = (cells[0] || '').match(/`([^`]+)`/);
        if (!nameCell || !fixtureScores.has(nameCell[1])) return;
        const rec = fixtureScores.get(nameCell[1]).score;
        const last = (cells[cells.length - 1] || '').replace(/\*/g, '');
        const claimed = (last.match(/\b(CATCH|MISS|clean|FALSE-POS|n\/a)\b/i) || [])[1];
        if (!claimed) return;
        if (claimed.toLowerCase() !== rec.toLowerCase()) {
          complain(`  ${rel}:${i + 1}  competitor row for \`${nameCell[1]}\`: doc says ${claimed}, record says ${rec}`,
            `      ${line.trim().slice(0, 110)}`);
        }
      });

      /* THE PROSE HEURISTIC IS GONE, DELIBERATELY.
         It tried to decide whether an English sentence ASSERTS a catch: catch word before
         the fixture name, negation words vetoing, past tense treated as superseded. An
         independent reviewer broke it four ways in one sitting (an unbackticked fixture
         name, the name before the catch word, an extra trailing table column, and a
         present-tense falsehood containing the word "was" anywhere in the span, since the
         veto was word presence and not tense). Every fix would have been another phrasing.
         A checker that catches some wordings and not others reads as coverage it does not
         have, which is worse than no checker, so the claim-parsing is replaced below by a
         rule that needs no parsing: the SUPERSEDED VALUE itself may not appear. */
    }
  }

  /**
   * RETIRED NUMBERS MAY NOT APPEAR ON THE PUBLICATION SURFACE.
   *
   * WHAT THIS COVERS, AND WHAT IT DOES NOT. It finds a retired VALUE in sixteen exact,
   * CASE-SENSITIVE literal spellings, in files with one of seven extensions, outside four
   * excluded directories. That is the whole of it, and it is not "any wording": review 7
   * walked 19 of 31 attacks straight through, including "Three of ten" capitalised at the
   * start of a sentence, the mixed forms `3 of ten` and `three of 10`, `3 out of ten`, a
   * non-breaking space, and `3 *of* 10` with markdown emphasis inside the number. Files
   * ending `.jsonl`, `.proposal`, `.sh` and `LICENSE` are never opened at all.
   *
   * It also does NOT understand claims: a stale sentence that names a fixture and states no
   * number is invisible to it. That is a real gap, not a simplification.
   *
   * THIS APPROACH HAS NOT CONVERGED. Seven review rounds have each broken it with a wording
   * its author did not imagine, and widening it an eighth time is the same move that failed
   * the previous seven. The replacement is single-sourcing: generate the numbers into marked
   * spans from the records so no prose states one independently, which turns "is a published
   * number stale" into a byte comparison that no wording can evade. That work is NOT done.
   *
   * WHITESPACE IS NORMALISED BEFORE MATCHING because this repository hard-wraps its prose,
   * so a value split across a line break was invisible, and its own correction sentences
   * were one reflow away from going silent. Review 6 called that the worst of the holes and
   * it was right.
   *
   * SCOPE is files matching seven extensions, outside `data/` (harvested GitHub comments
   * full of unrelated strings like "attempt 1/10"), `.md/` (dated plan artifacts that quote
   * superseded numbers ON PURPOSE), `node_modules`, `.git`, `tmp` and `coverage`. It is NOT
   * "every tracked text file": the extension list is the real gate, and files outside it are
   * invisible whether or not they are tracked.
   *
   * The allowlist entries are SUBSTRINGS of the whitespace-flattened file, not whole lines,
   * which makes them wider than their name suggests. Each must still match somewhere or the
   * gate fails, so a stale entry is caught. An ADDED entry is NOT reported: review 7 silenced
   * a real stale headline with one entry and nothing printed the word allowlist, so adding
   * one is currently a quiet way to publish a retired number. That is an open hole.
   */
  const RETIRED = [
    { value: '3 of 10', now: '2 of 10', why: 'prove-bench competitor, retired 2026-08-13 when a verdictless run stopped counting as a catch' },
    { value: '1 of 11', now: '0 of 11', why: 'validation-cohort competitor, retired 2026-08-13 for the same reason' },
  ];
  /* Every way the same value gets written. Digits, slash form, spaced slash, hyphenated,
     and the word form, because review 6 published "three of ten" and "3 out of 10" and both
     were silent. The list is closed and small on purpose: a value has few spellings, unlike
     a claim, which has unlimited ones. */
  const spellings = (n, d) => {
    const W = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
    return [`${n} of ${d}`, `${n} out of ${d}`, `${n} of the ${d}`, `${n}/${d}`, `${n} / ${d}`,
      `${n}-of-${d}`, `${W[n]} of ${W[d]}`, `${W[n]} out of ${W[d]}`];
  };
  const RETIRED_OK = new Map([
    ['**This number was 3 of 10 until 2026-08-13, and the correction is against our own interest to state, so it is stated first.** The competitor\'s third catch was `handler-path-missing`, whose', 'docs/RESULTS.md: the sentence that RECORDS the correction'],
    ['**This block said 1 of 11 until 2026-08-13, and it is the same error as the one above, not a second kind.** The single catch was `handler-path-bare-variable`, recorded with the detail', 'docs/RESULTS.md: the same, for the validation cohort'],
    ['**The competitor line said 1 of 11 until 2026-08-13, and the single catch was `handler-path-bare-variable`, whose recorded detail read `no verdict line`.** It exited non-zero', 'results-prove-bench-validation.md: the same correction in the cohort write-up'],
  ]);

  const TEXT = /\.(md|mjs|js|json|yml|yaml|txt)$/;
  const SKIP = new Set(['node_modules', '.git', 'data', '.md', 'tmp', 'coverage']);
  const walkText = (dir, base, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walkText(full, base, out);
      else if (TEXT.test(e.name)) out.push(full.slice(base.length + 1).split(sep).join('/'));
    }
    return out;
  };

  /* This file is excluded from its own ban, and the exclusion is a real boundary rather
     than a convenience: a checker has to be able to NAME the values it forbids, and its
     mutant table must contain them verbatim to prove the ban can fail. The cost is that a
     stale bench claim written into this file would not be caught here, which is why the
     bench numbers are published in the results docs and not in the tool. */
  const SELF = 'tools/coverage-report.mjs';
  const seenAllow = new Set();
  for (const rel of walkText(DOC_ROOT, DOC_ROOT)) {
    if (rel === SELF) continue;
    const raw = readFileSync(join(DOC_ROOT, rel), 'utf8');
    /* Match against the whole file with whitespace flattened, so a hard wrap cannot hide a
       value, then report the line the match starts on. */
    const flat = raw.replace(/\s+/g, ' ');
    /* Allowlisted SPANS, computed as offsets. The first version excused any match within
       200 characters of an allowlisted sentence, which meant a genuinely stale value sitting
       near a correction paragraph was silently forgiven: two of this tool's own mutants
       survived on exactly that. A match is now excused only if it falls INSIDE an allowlisted
       line, which is the thing the allowlist actually names. */
    const spans = [];
    for (const entry of RETIRED_OK.keys()) {
      const flatEntry = entry.replace(/\s+/g, ' ');
      const at = flat.indexOf(flatEntry);
      if (at < 0) continue;
      seenAllow.add(entry);
      spans.push([at, at + flatEntry.length]);
    }
    for (const r of RETIRED) {
      const [n, d] = r.value.split(' of ').map(Number);
      for (const sp of spellings(n, d)) {
        let at = flat.indexOf(sp);
        while (at >= 0) {
          const inside = spans.some(([lo, hi]) => at >= lo && at + sp.length <= hi);
          if (!inside) {
            const before = flat.slice(0, at);
            const line = raw.split(/\r?\n/).findIndex((_, i, arr) => arr.slice(0, i + 1).join(' ').replace(/\s+/g, ' ').length > before.length) + 1;
            complain(`  ${rel}:${line || '?'}  retired value "${sp}" is still published; it is now ${r.now}`,
              `      ${r.why}`);
          }
          at = flat.indexOf(sp, at + 1);
        }
      }
    }
  }

  for (const [entry, why] of RETIRED_OK) {
    if (!seenAllow.has(entry)) {
      complain(`  allowlist entry matches nothing: ${entry.slice(0, 70)}...`,
        `      ${why}`,
        '      An entry that excuses no line is either a silenced claim that moved or a rule',
        '      nobody enforces. Delete it or fix the text it was written for.');
    }
  }

  for (const rel of docs) {
  // Scan PARAGRAPHS, not lines. A per-line scan cannot see a published number whose sentence
  // hard-wraps before it. A stale 247 sat green against a live 280 for exactly as long as the
  // wrap sat between the words all and 247. Proven by rejoining the wrap with the VALUE
  // UNTOUCHED, which made this gate fail, then re-wrapping, which made it pass again. Same
  // defect class as a ledger pairing on a 400-character prefix: the scan's unit must match
  // the content's unit, or the gate reports clean while blind.
  //
  // Line numbers stay exact. Each paragraph records the offset at which every source line
  // begins inside it, so a match is attributed to the line it actually starts on.
  const paragraphsOf = (text) => {
    const out = [];
    let buf = null;
    text.split(/\r?\n/).forEach((raw, i) => {
      if (raw.trim() === '') { buf = null; return; }
      if (!buf) { buf = { text: '', starts: [] }; out.push(buf); }
      buf.starts.push({ at: buf.text.length, line: i });
      buf.text += (buf.text ? ' ' : '') + raw.trim();
    });
    return out;
  };
  const lineFor = (para, index) => {
    let best = para.starts[0];
    for (const st of para.starts) { if (st.at <= index) best = st; else break; }
    return best.line;
  };

    const srcLines = readFileSync(join(DOC_ROOT, rel), 'utf8').split(/\r?\n/);
    paragraphsOf(srcLines.join('\n')).forEach((para) => {
      const line = para.text;
      for (const f of FACTS) {
        f.re.lastIndex = 0;
        let m;
        while ((m = f.re.exec(line)) !== null) {
          // Attribute to the line the VALUE sits on, not where the phrase starts: a reader
          // chasing a reported number wants the line that contains it, and a wrap can put
          // those on different lines.  The excerpt comes from the JOINED text around the
          // match, so it always shows the value being reported.
          const vAt = m.index + m[0].indexOf(m[1]);
          const i = lineFor(para, vAt);
          const raw = m[1].replace(/,/g, '').toLowerCase();
          // Per-fact word map, defaulting to the conservative global one. A fact
          // whose phrasing is canonical enough can opt into the small words.
          const W = f.words || WORDS;
          const n = W[raw] !== undefined ? W[raw] : Number(raw);
          if (!Number.isFinite(n) || n === f.live) continue;
          complain(`  ${rel}:${i + 1}  ${f.label}: doc says ${m[1]}, live is ${f.live}`,
            `      ${line.slice(Math.max(0, vAt - 45), vAt + 65).trim()}`);
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
  const f = stripSkillPrefix(c.file);
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
