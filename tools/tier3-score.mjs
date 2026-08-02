#!/usr/bin/env node
/**
 * Tier 3 step 3: un-blind the grades, gate them for completeness, score the
 * arms, and apply the decision rule that was written before the data existed.
 *
 *   node tools/tier3-score.mjs             score and print the tables
 *   node tools/tier3-score.mjs --markdown  emit the block for results-tier3.md
 *   node tools/tier3-score.mjs --check     re-derive and diff against the doc
 *   node tools/tier3-score.mjs --self-test fixtures, including must-fail cases
 *
 * Why the completeness gate exists. In the 2026-08-02 re-run, S055 received no
 * grade because a grader returned nine records instead of ten, and nobody
 * noticed until after the percentages were computed and published over 59
 * scenarios instead of 60. Nothing was wrong with the grader that a count could
 * not have caught. This refuses to score at all until every scenario, every
 * sheet and every field is present exactly once.
 *
 * Why the decision rule lives in code. A threshold chosen after seeing the
 * numbers is not a threshold. These constants were committed before the first
 * answer agent ran, so the verdict below is applied to the data rather than
 * fitted to it.
 *
 * Self-reporting: prints the gate result, the tables, and the verdict, and
 * exits non-zero if the grades are incomplete or the doc has drifted.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadScenarios } from './tier3-strip.mjs';
import { GRADED_FIELDS, ARMS } from './tier3-pack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GRADES = join(ROOT, 'tests', 'tier3', 'grades.jsonl');
const MAP_PATH = join(ROOT, 'tests', 'tier3', 'blinding-map.json');
const ANSWER_DIR = join(ROOT, 'tests', 'tier3', 'answers');
const DOC = join(ROOT, 'tests', 'results-tier3.md');

const BEGIN = '<!-- tier3-score:begin -->';
const END = '<!-- tier3-score:end -->';

/** Human labels. Kept out of the packets on purpose; only the scorer knows. */
export const ARM_LABEL = {
  a: 'A: unaided (calibration)',
  b: 'B: official docs',
  bplus: 'B+: docs, staged procedure, no skill',
  d: 'D: docs + skill, staged procedure',
};

/**
 * The four fields an arm is supposed to pin against the documentation rather
 * than reason out. Citation rate is measured over these, because an arm that
 * answers them from memory has quietly become arm A and the overall number
 * would not show it.
 */
export const FACTUAL_FIELDS = ['enforcement_owner', 'lifecycle', 'failure_mode', 'version_caveat'];

/**
 * Pre-committed 2026-08-02, before any answer agent ran. results-tier3.md puts
 * the noise floor near 6 points: n=60 gives roughly plus or minus 6 at 95%, and
 * enforcement_owner moved 8 points between two runs of a change that never
 * touched it. So 6 is the smallest gap this benchmark can call a result.
 */
export const DECISION_MARGIN = 6;

export const VALID_SCORES = new Set([0, 0.5, 1]);

// ------------------------------------------------------------------- gating --

/**
 * Every (scenario, sheet, field) must appear exactly once, every scenario must
 * be present, and every score must be one of the three allowed values. Returns
 * the list of reasons the set is unscoreable, empty when it is sound.
 */
export function completenessProblems(grades, scenarioIds, map, partial = false) {
  const problems = [];
  const seen = new Map();

  // Scope. By default every scenario in the set must be graded, which is the
  // publishing posture. --partial narrows scope to the scenarios that actually
  // have sheets, for a pilot or a single-batch re-grade, and the caller prints
  // the denominator loudly. Completeness WITHIN scope stays absolute: S055 was
  // a record lost inside the scope, not a deliberate subset, and a silent
  // denominator is what made it a published error rather than a caught one.
  if (partial) scenarioIds = scenarioIds.filter(id => map[id]);

  for (const g of grades) {
    if (!scenarioIds.includes(g.scenario)) {
      problems.push(`unknown scenario id ${g.scenario}`);
      continue;
    }
    // Surplus records addressed to a sheet that does not exist were silently
    // absorbed before, so a grader inventing a fourth sheet went unreported
    // while the real sheets still looked complete. Independent review finding.
    if (map[g.scenario] && !(String(g.sheet) in map[g.scenario])) {
      problems.push(`${g.scenario}: graded a sheet ${g.sheet} that does not exist (this scenario has sheets ${Object.keys(map[g.scenario]).join(', ')})`);
      continue;
    }
    if (!GRADED_FIELDS.includes(g.field)) {
      problems.push(`${g.scenario} sheet ${g.sheet}: unknown field ${g.field}`);
      continue;
    }
    if (!VALID_SCORES.has(g.score)) {
      problems.push(`${g.scenario} sheet ${g.sheet} ${g.field}: score ${JSON.stringify(g.score)} is not 0, 0.5 or 1`);
      continue;
    }
    const k = `${g.scenario}|${g.sheet}|${g.field}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }

  for (const [k, n] of seen) {
    if (n > 1) problems.push(`${k.replace(/\|/g, ' sheet ').replace(' sheet ', ' sheet ')}: graded ${n} times`);
  }

  for (const id of scenarioIds) {
    const sheets = map[id] ? Object.keys(map[id]) : [];
    if (!sheets.length) {
      problems.push(`${id}: absent from the blinding map, so its sheets cannot be un-blinded`);
      continue;
    }
    for (const sheet of sheets) {
      const missing = GRADED_FIELDS.filter(f => !seen.has(`${id}|${Number(sheet)}|${f}`) && !seen.has(`${id}|${sheet}|${f}`));
      if (missing.length === GRADED_FIELDS.length) {
        problems.push(`${id} sheet ${sheet}: no grades at all (${GRADED_FIELDS.length} missing)`);
      } else if (missing.length) {
        problems.push(`${id} sheet ${sheet}: missing ${missing.join(', ')}`);
      }
    }
  }

  // Total arithmetic, checked independently of the per-cell sweep above. The
  // per-cell checks answer "is anything missing"; this answers "is the count
  // what it should be", and the two fail differently. Reported as a distinct
  // problem so a mismatch cannot hide behind a clean per-cell pass.
  const expected = scenarioIds.reduce((n, id) => n + (map[id] ? Object.keys(map[id]).length : 0), 0) * GRADED_FIELDS.length;
  const inScopeRecords = grades.filter(g => scenarioIds.includes(g.scenario)).length;
  if (expected && inScopeRecords !== expected) {
    problems.push(`record count is ${inScopeRecords}, expected ${expected} (${scenarioIds.length} scenarios x sheets x ${GRADED_FIELDS.length} fields)`);
  }

  return [...new Set(problems)];
}

/**
 * Per-scenario paired comparison. Declared BEFORE the full run, after a pilot
 * showed three docs-holding arms landing at 93 to 97 percent: at a ceiling,
 * two means differing by a few points is nearly uninformative, while the same
 * data compared scenario by scenario is not, because every arm answered the
 * identical scenario and the scenario's own difficulty cancels.
 *
 * This does NOT replace the pre-committed rule and does not change what ships.
 * DECISION_MARGIN still governs. This is a reported secondary that says whether
 * a small overall gap is consistent or noisy, and it is written down here
 * rather than chosen once the real numbers are visible.
 */
export function pairedComparison(grades, map, armX, armY) {
  const cell = new Map();
  for (const g of grades) {
    const arm = map[g.scenario]?.[String(g.sheet)];
    if (arm !== armX && arm !== armY) continue;
    cell.set(`${g.scenario}|${arm}`, (cell.get(`${g.scenario}|${arm}`) || 0) + g.score);
  }
  const ids = [...new Set([...cell.keys()].map(k => k.split('|')[0]))].sort();
  let wins = 0, losses = 0, ties = 0, deltaSum = 0, n = 0;
  const perScenario = [];
  for (const id of ids) {
    const x = cell.get(`${id}|${armX}`), y = cell.get(`${id}|${armY}`);
    if (x === undefined || y === undefined) continue;
    const delta = x - y;
    if (delta > 0) wins++; else if (delta < 0) losses++; else ties++;
    deltaSum += delta; n++;
    perScenario.push({ id, delta });
  }
  return {
    armX, armY, n, wins, losses, ties,
    meanDeltaPoints: n ? Math.round((100 * deltaSum) / (n * GRADED_FIELDS.length)) : 0,
    decided: wins + losses,
    perScenario,
  };
}

// ------------------------------------------------------------------ scoring --

export function score(grades, map, citations = {}) {
  const perArm = {};
  for (const arm of ARMS) {
    perArm[arm] = { fields: Object.fromEntries(GRADED_FIELDS.map(f => [f, []])), primaryStrict: 0, n: 0 };
  }

  const byScenario = new Map();
  for (const g of grades) {
    const arm = map[g.scenario]?.[String(g.sheet)];
    if (!arm) continue;
    perArm[arm].fields[g.field].push(g.score);
    if (g.field === 'primary') {
      if (!byScenario.has(arm)) byScenario.set(arm, 0);
      if (g.score === 1) perArm[arm].primaryStrict++;
      perArm[arm].n++;
    }
  }

  const rows = [];
  for (const arm of ARMS) {
    const a = perArm[arm];
    const all = GRADED_FIELDS.flatMap(f => a.fields[f]);
    if (!all.length) continue;
    const pct = xs => Math.round((100 * xs.reduce((s, v) => s + v, 0)) / xs.length);
    rows.push({
      arm,
      label: ARM_LABEL[arm],
      overall: pct(all),
      primaryStrict: a.primaryStrict,
      n: a.n,
      byField: Object.fromEntries(GRADED_FIELDS.map(f => [f, pct(a.fields[f])])),
      citationRate: citations[arm] ?? null,
    });
  }
  return rows;
}

/**
 * Applies DECISION_MARGIN to the scored rows. Deliberately mechanical: the
 * point of pre-committing the rule is that this function, not a person reading
 * the table, decides what the run means.
 */
export function verdict(rows) {
  const get = arm => rows.find(r => r.arm === arm);
  const b = get('b'), bplus = get('bplus'), d = get('d');
  if (!b || !d) return { headline: 'INCOMPLETE', detail: 'need at least arms b and d to apply the rule' };

  const gap = d.overall - b.overall;
  let headline, detail;
  if (gap >= DECISION_MARGIN) {
    headline = 'SHIP';
    detail = `D beats B by ${gap} points, at or above the pre-committed margin of ${DECISION_MARGIN}.`;
  } else if (gap > 0) {
    headline = 'INCONCLUSIVE';
    detail = `D beats B by ${gap} points, inside the noise floor of ${DECISION_MARGIN}. Publish, do not ship.`;
  } else {
    headline = 'NEGATIVE';
    detail = `D does not beat B (${gap} points). Publish the negative.`;
  }

  let attribution = null;
  if (bplus) {
    const g2 = d.overall - bplus.overall;
    attribution = g2 >= DECISION_MARGIN
      ? `The skill's decision content carried it: D is ${g2} points over B+, which had the same procedure without the skill.`
      : `The procedure carried it, not the reference: D is ${g2} points over B+, inside the noise floor. The honest headline is about the staged procedure.`;
  }
  return { headline, detail, attribution };
}

// ---------------------------------------------------------------- rendering --

function fmtPct(n) { return `${n}%`; }

export function renderMarkdown(rows, v, meta = {}) {
  const L = [];
  L.push(BEGIN);
  L.push('');
  L.push(`Overall = mean across all seven fields, partial counted as half.${meta.note ? ` ${meta.note}` : ''}`);
  L.push('');
  L.push('| Arm | Overall | Primary (strict) | Primary | Rejected alt | Owner | Context | Lifecycle | Failure | Version |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    L.push(`| ${r.label} | ${fmtPct(r.overall)} | ${r.primaryStrict}/${r.n} | ${fmtPct(r.byField.primary)} | ${fmtPct(r.byField.rejected_alternative)} | ${fmtPct(r.byField.enforcement_owner)} | ${fmtPct(r.byField.context_boundary)} | ${fmtPct(r.byField.lifecycle)} | ${fmtPct(r.byField.failure_mode)} | ${fmtPct(r.byField.version_caveat)} |`);
  }
  L.push('');
  if (rows.some(r => r.citationRate !== null)) {
    L.push('Citation rate is the share of the four factual fields carrying a documentation URL. An arm');
    L.push('with a low rate answered from memory rather than looking it up, which the overall score hides.');
    L.push('');
    L.push('| Arm | Citation rate |');
    L.push('|---|---|');
    for (const r of rows) L.push(`| ${r.label} | ${r.citationRate === null ? 'not requested' : fmtPct(r.citationRate)} |`);
    L.push('');
  }
  if (meta.paired && meta.paired.length) {
    L.push('Paired per-scenario comparison. Every arm answered the identical scenario, so');
    L.push('comparing scenario by scenario cancels the scenario\'s own difficulty and detects a');
    L.push('small effect that two overall percentages near a ceiling cannot. Secondary and');
    L.push('reported only: the pre-committed margin above is what decides the outcome.');
    L.push('');
    L.push('| Comparison | Scenarios | Wins | Losses | Ties | Mean delta |');
    L.push('|---|---|---|---|---|---|');
    for (const p of meta.paired) {
      L.push(`| ${p.armX.toUpperCase()} vs ${p.armY.toUpperCase()} | ${p.n} | ${p.wins} | ${p.losses} | ${p.ties} | ${p.meanDeltaPoints >= 0 ? '+' : ''}${p.meanDeltaPoints} pts |`);
    }
    L.push('');
  }
  L.push(`**Verdict, by the rule committed before the run: ${v.headline}.** ${v.detail}`);
  if (v.attribution) { L.push(''); L.push(v.attribution); }
  L.push('');
  L.push(END);
  return L.join('\n');
}

// ------------------------------------------------------------------ loading --

function loadGrades() {
  if (!existsSync(GRADES)) return null;
  const rows = [];
  readFileSync(GRADES, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try { rows.push(JSON.parse(t)); } catch (err) {
      console.error(`grades.jsonl line ${i + 1}: ${err.message}`);
      process.exit(2);
    }
  });
  return rows;
}

/**
 * Only the staged arms are asked to cite; citing is part of their procedure, so
 * requiring it of arm B would change the baseline into something other than the
 * baseline. Arm B therefore reports "not requested" rather than 0%, which would
 * read as a finding about arm B instead of a fact about its instructions.
 */
export const CITING_ARMS = ['bplus', 'd'];

/**
 * Share of the four factual fields that carry a documentation URL, per arm.
 * This is the detector for the premortem's likeliest failure: an arm that stops
 * fetching and answers from memory has silently become arm A, and the overall
 * percentage cannot show that.
 */
export function citationRates(answersByArm) {
  const out = {};
  for (const [arm, rows] of Object.entries(answersByArm)) {
    if (!CITING_ARMS.includes(arm)) { out[arm] = null; continue; }
    let cited = 0, total = 0;
    for (const a of rows) {
      for (const f of FACTUAL_FIELDS) {
        total++;
        const c = a.citations?.[f];
        if (typeof c === 'string' && /^https?:\/\//.test(c.trim())) cited++;
      }
    }
    out[arm] = total ? Math.round((100 * cited) / total) : null;
  }
  return out;
}

function loadAnswers() {
  if (!existsSync(ANSWER_DIR)) return {};
  const out = {};
  for (const file of readdirSync(ANSWER_DIR).filter(f => f.endsWith('.json')).sort()) {
    const m = file.match(/^(.+)-batch-(\d+)\.json$/);
    if (!m) continue;
    const parsed = JSON.parse(readFileSync(join(ANSWER_DIR, file), 'utf8'));
    out[m[1]] = (out[m[1]] || []).concat(parsed.answers || []);
  }
  return out;
}

// ---------------------------------------------------------------- self-test --

function selfTest() {
  const ids = ['S001', 'S002'];
  const map = {
    S001: { 1: 'b', 2: 'bplus', 3: 'd', 4: 'a' },
    S002: { 1: 'd', 2: 'b', 3: 'bplus', 4: 'a' },
  };
  // Scores chosen so the arms separate predictably: d strong, b weak, bplus mid.
  const perArmScore = { a: 0, b: 0.5, bplus: 0.5, d: 1 };
  const full = [];
  for (const id of ids) {
    for (const [sheet, arm] of Object.entries(map[id])) {
      for (const f of GRADED_FIELDS) full.push({ scenario: id, sheet: Number(sheet), field: f, score: perArmScore[arm] });
    }
  }

  let bad = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
    if (!ok) bad++;
  };

  check('a complete grade set passes the gate', completenessProblems(full, ids, map).length === 0,
    completenessProblems(full, ids, map)[0] || '');

  // The S055 defect, exactly: one grader returns one record short.
  const short = full.slice(0, -1);
  const shortProblems = completenessProblems(short, ids, map);
  check('a single missing field record is caught (the S055 defect)', shortProblems.length > 0, shortProblems[0] || '');

  const wholeSheetGone = full.filter(g => !(g.scenario === 'S002' && g.sheet === 3));
  check('a whole missing sheet is caught', completenessProblems(wholeSheetGone, ids, map).some(p => /no grades at all/.test(p)));

  check('a duplicated grade is caught', completenessProblems([...full, full[0]], ids, map).some(p => /graded 2 times/.test(p)));
  check('an out-of-range score is caught',
    completenessProblems([...full.slice(1), { ...full[0], score: 0.75 }], ids, map).some(p => /not 0, 0\.5 or 1/.test(p)));
  check('an unknown scenario id is caught',
    completenessProblems([...full, { scenario: 'S999', sheet: 1, field: 'primary', score: 1 }], ids, map).some(p => /unknown scenario/.test(p)));
  check('an unknown field name is caught',
    completenessProblems([...full, { scenario: 'S001', sheet: 1, field: 'vibes', score: 1 }], ids, map).some(p => /unknown field/.test(p)));

  // Independent review found both of these passing silently.
  check('a grade for a sheet that does not exist is caught',
    completenessProblems([...full, { scenario: 'S001', sheet: 9, field: 'primary', score: 1 }], ids, map)
      .some(p => /does not exist/.test(p)));
  check('a record-count mismatch is reported in its own right',
    completenessProblems([...full, { scenario: 'S001', sheet: 1, field: 'primary', score: 1 }], ids, map)
      .some(p => /record count is/.test(p)));

  // Partial scope: a legitimate pilot or single-batch re-grade must be
  // scoreable, but only within an explicitly narrowed scope.
  const oneScenarioMap = { S001: map.S001 };
  const oneScenario = full.filter(g => g.scenario === 'S001');
  check('a partial run is unscoreable by default',
    completenessProblems(oneScenario, ids, oneScenarioMap).some(p => /absent from the blinding map/.test(p)));
  check('a partial run scores cleanly when scope is narrowed explicitly',
    completenessProblems(oneScenario, ids, oneScenarioMap, true).length === 0);
  check('a record lost INSIDE a partial scope is still caught',
    completenessProblems(oneScenario.slice(0, -1), ids, oneScenarioMap, true).length > 0);

  const pc = pairedComparison(full, map, 'd', 'b');
  check('paired comparison counts every scenario both arms answered', pc.n === 2, `n=${pc.n}`);
  check('paired comparison scores d over b on the fixture', pc.wins === 2 && pc.losses === 0, `${pc.wins}W ${pc.losses}L ${pc.ties}T`);
  check('paired mean delta is expressed in points', pc.meanDeltaPoints === 50, `${pc.meanDeltaPoints} pts`);

  const rows = score(full, map);
  const d = rows.find(r => r.arm === 'd'), b = rows.find(r => r.arm === 'b');
  check('un-blinding routes each sheet to the right arm', d.overall === 100 && b.overall === 50, `d=${d.overall}% b=${b.overall}%`);
  check('strict primary counts only full marks', d.primaryStrict === 2 && b.primaryStrict === 0, `d=${d.primaryStrict} b=${b.primaryStrict}`);

  const mk = (bo, bpo, dov) => [
    { arm: 'b', overall: bo }, { arm: 'bplus', overall: bpo }, { arm: 'd', overall: dov },
  ];
  check('verdict SHIP at or above the margin', verdict(mk(80, 80, 86)).headline === 'SHIP');
  check('verdict INCONCLUSIVE inside the margin', verdict(mk(80, 80, 83)).headline === 'INCONCLUSIVE');
  check('verdict NEGATIVE at parity', verdict(mk(80, 80, 80)).headline === 'NEGATIVE');
  check('verdict NEGATIVE below', verdict(mk(80, 80, 74)).headline === 'NEGATIVE');
  check('attribution credits the skill when D clears B+', /decision content carried it/.test(verdict(mk(70, 76, 86)).attribution));
  check('attribution credits the procedure when D ties B+', /procedure carried it/.test(verdict(mk(70, 84, 86)).attribution));

  console.log(bad
    ? `SELF-TEST FAIL: ${bad} check(s) failed`
    : 'SELF-TEST PASS: the gate catches every incomplete shape, un-blinding is correct, and the verdict rule is mechanical.');
  process.exit(bad ? 1 : 0);
}

// --------------------------------------------------------------------- main --

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) main();

function main() {
const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTest();

const grades = loadGrades();
const scenarios = loadScenarios();
const ids = scenarios.map(s => s.id);

if (!grades || !grades.length) {
  console.log('No grades in tests/tier3/grades.jsonl yet.');
  // --check must not pass by virtue of there being nothing to check once the
  // doc carries a generated block. Absent grades with a block present is drift.
  if (argv.includes('--check') && existsSync(DOC) && readFileSync(DOC, 'utf8').includes(BEGIN)) {
    console.log('FAIL: results-tier3.md carries a generated block but there are no grades to re-derive it from.');
    process.exit(1);
  }
  process.exit(0);
}

if (!existsSync(MAP_PATH)) {
  console.log('FAIL: blinding-map.json is missing, so grades cannot be un-blinded.');
  process.exit(1);
}
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));

const PARTIAL = argv.includes('--partial');
const problems = completenessProblems(grades, ids, map, PARTIAL);
const inScope = PARTIAL ? ids.filter(id => map[id]).length : ids.length;
console.log(`Grades: ${grades.length}  scenarios in set: ${ids.length}  arms: ${ARMS.join(', ')}`);
if (PARTIAL) console.log(`PARTIAL RUN: scoring over ${inScope} of ${ids.length} scenarios. Diagnostic only, not publishable as a full result.`);
if (problems.length) {
  console.log(`\nREFUSING TO SCORE: ${problems.length} completeness problem(s).`);
  for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
  if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
  console.log('\nFix the gaps and re-grade. Scoring over an incomplete set is how S055 went missing.');
  process.exit(1);
}
console.log('Completeness gate: PASS, every scenario, sheet and field graded exactly once.');

const rows = score(grades, map, citationRates(loadAnswers()));
const v = verdict(rows);
const paired = [['d', 'b'], ['d', 'bplus'], ['bplus', 'b'], ['b', 'a']]
  .filter(([x, y]) => rows.some(r => r.arm === x) && rows.some(r => r.arm === y))
  .map(([x, y]) => pairedComparison(grades, map, x, y));
const block = renderMarkdown(rows, v, { paired });

if (argv.includes('--markdown')) { console.log(block); process.exit(0); }

console.log('');
console.log(block.replace(BEGIN, '').replace(END, '').trim());

if (argv.includes('--check')) {
  const doc = readFileSync(DOC, 'utf8');
  const i = doc.indexOf(BEGIN), j = doc.indexOf(END);
  if (i === -1 || j === -1) {
    console.log(`\nFAIL: results-tier3.md has no ${BEGIN} ... ${END} block to check.`);
    process.exit(1);
  }
  const inDoc = doc.slice(i, j + END.length).replace(/\r\n/g, '\n').trim();
  if (inDoc !== block.trim()) {
    console.log('\nFAIL: the published block does not match what the raw grades derive.');
    const a = inDoc.split('\n'), bb = block.trim().split('\n');
    for (let k = 0; k < Math.max(a.length, bb.length); k++) {
      if (a[k] !== bb[k]) {
        console.log(`  first difference at line ${k + 1}`);
        console.log(`    published: ${a[k] ?? '(missing)'}`);
        console.log(`    derived:   ${bb[k] ?? '(missing)'}`);
        break;
      }
    }
    process.exit(1);
  }
  console.log('\nPASS: the published tables match the raw grades exactly.');
  process.exit(0);
}
process.exit(0);
}
