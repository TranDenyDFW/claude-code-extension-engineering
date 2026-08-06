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
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadScenarios } from './tier3-strip.mjs';
import { GRADED_FIELDS, ARMS } from './tier3-pack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SET = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : 'v1';
const SFX = SET === 'v2' ? '-v2' : '';

/**
 * REPLICATES. --rep N scores one independent answering pass on its own, which is
 * a PRECONDITION for pooling: a replicate must pass the strict completeness gate
 * by itself before it may enter --replicates. A pool that silently absorbs an
 * incomplete replicate is the same defect class as a merged grade file that
 * cannot be re-derived.
 *
 * Replicate 1 reads the ORIGINAL unsuffixed paths, byte for byte, because those
 * artifacts are committed and drift-gated.
 */
const REP = (() => {
  const i = process.argv.indexOf('--rep');
  if (i < 0) return 1;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) { console.log('FAIL: --rep must be an integer >= 1'); process.exit(2); }
  return n;
})();
const RSFX = REP > 1 ? `-r${REP}` : '';
const GRADES = join(ROOT, 'tests', 'tier3', `grades${SFX}${RSFX}.jsonl`);
const MAP_PATH = join(ROOT, 'tests', 'tier3', `blinding-map${SFX}${RSFX}.json`);
const ANSWER_DIR = join(ROOT, 'tests', 'tier3', `answers${SFX}${RSFX}`);
const DOC = join(ROOT, 'tests', 'results-tier3.md');
const MIRROR = process.argv.includes('--mirror') ? process.argv[process.argv.indexOf('--mirror') + 1] : null;

const BEGIN = `<!-- tier3-score:begin set=${SET} -->`;
// The block names the set it governs, so `--check` and `--check --set v2` each own
// only their own numbers instead of the v1 checker failing on a v2 block.
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

/**
 * v2 endpoint, committed 2026-08-02 BEFORE any v2 answer agent runs, per the
 * same discipline as DECISION_MARGIN. The v2 instrument ships the workflow
 * only when ALL THREE hold for D versus B: paired sign test p below
 * SIGN_ALPHA, overall margin at least DECISION_MARGIN, and the significance
 * SURVIVING every single-grader and single-batch drop. The third clause
 * exists because one grader manufactured the retracted v1 headline.
 */
export const SIGN_ALPHA = 0.05;

/**
 * Replicate expansion, committed 2026-08-02 BEFORE replicate 2 or 3 data
 * existed and before replicate 1's grades were read. The user directive was a
 * more comprehensive combine test; the design answer is replication, not a
 * bigger scenario set, because answer-agent nondeterminism is the variance the
 * single-run design cannot see.
 *
 * Pooled primary endpoint for D versus B across replicates:
 *   1. sign test over PER-SCENARIO MEAN deltas (mean across replicates,
 *      so n stays 60 and scenarios stay the unit of inference), p < SIGN_ALPHA;
 *   2. pooled overall margin >= DECISION_MARGIN;
 *   3. significance surviving every leave-one-grader, leave-one-batch, AND
 *      leave-one-replicate drop.
 * All three or no ship, same as the single-run rule it extends.
 */
export const REPLICATE_RULE = 'pooled-per-scenario-mean, all-drops-robust';

export function pooledPerScenarioDeltas(replicates, armX, armY) {
  // replicates: array of { grades, map } per replicate run.
  const perScenario = new Map();
  for (const { grades, map } of replicates) {
    const flat = aggregateCellsLenient(grades);
    const cell = new Map();
    for (const g of flat) {
      const arm = map[g.scenario]?.[String(g.sheet)];
      if (arm !== armX && arm !== armY) continue;
      const k = `${g.scenario}|${arm}`;
      cell.set(k, (cell.get(k) || 0) + g.score);
    }
    for (const id of new Set([...cell.keys()].map(k => k.split('|')[0]))) {
      const x = cell.get(`${id}|${armX}`), y = cell.get(`${id}|${armY}`);
      if (x === undefined || y === undefined) continue;
      if (!perScenario.has(id)) perScenario.set(id, []);
      perScenario.get(id).push(x - y);
    }
  }
  return [...perScenario.entries()].map(([id, ds]) => ({
    id, meanDelta: ds.reduce((s, v) => s + v, 0) / ds.length, reps: ds.length,
  }));
}

export function pooledVerdict(replicates, rowsPooled, batchOf) {
  const deltas = pooledPerScenarioDeltas(replicates, 'd', 'b');
  const wins = deltas.filter(x => x.meanDelta > 0).length;
  const losses = deltas.filter(x => x.meanDelta < 0).length;
  const p = signTest(wins, losses);
  const d = rowsPooled.find(r => r.arm === 'd'), b = rowsPooled.find(r => r.arm === 'b');
  const margin = d && b ? d.overall - b.overall : -100;

  const dropPs = [];
  // leave-one-replicate
  if (replicates.length > 1) {
    for (let i = 0; i < replicates.length; i++) {
      const rest = replicates.filter((_, j) => j !== i);
      const dd = pooledPerScenarioDeltas(rest, 'd', 'b');
      dropPs.push({ kind: 'replicate', dropped: i + 1, p: signTest(dd.filter(x => x.meanDelta > 0).length, dd.filter(x => x.meanDelta < 0).length) });
    }
  }
  // leave-one-grader and leave-one-batch, within each replicate's contribution
  replicates.forEach(({ grades, map }, i) => {
    const graders = [...new Set(grades.filter(g => g.grader && g.grader !== 'adj').map(g => g.grader))];
    for (const gr of graders) {
      const reps2 = replicates.map((r, j) => j === i ? { grades: r.grades.filter(g => g.grader !== gr), map: r.map } : r);
      const dd = pooledPerScenarioDeltas(reps2, 'd', 'b');
      dropPs.push({ kind: 'grader', dropped: `r${i + 1}:${gr}`, p: signTest(dd.filter(x => x.meanDelta > 0).length, dd.filter(x => x.meanDelta < 0).length) });
    }
  });
  const batches = [...new Set(deltas.map(x => batchOf(x.id)))];
  for (const bch of batches) {
    const dd = deltas.filter(x => batchOf(x.id) !== bch);
    dropPs.push({ kind: 'batch', dropped: bch, p: signTest(dd.filter(x => x.meanDelta > 0).length, dd.filter(x => x.meanDelta < 0).length) });
  }

  const robust = dropPs.every(x => x.p < SIGN_ALPHA);
  const ship = p < SIGN_ALPHA && margin >= DECISION_MARGIN && robust;
  return {
    headline: ship ? 'SHIP' : (wins > losses ? 'INCONCLUSIVE' : 'NEGATIVE'),
    detail: `pooled sign test ${wins}W ${losses}L p=${p.toFixed(4)} (need < ${SIGN_ALPHA}); pooled margin ${margin} pts (need >= ${DECISION_MARGIN}); ${dropPs.filter(x => x.p < SIGN_ALPHA).length}/${dropPs.length} drops stay significant (need all)`,
    wins, losses, p, margin, dropPs,
  };
}

export const VALID_SCORES = new Set([0, 0.5, 1]);

/**
 * Aggregated v2 cells are the MEAN of two independent grades, so they land on
 * the quarter lattice: 0 and 0.5 average to 0.25, 0.5 and 1 to 0.75. The raw
 * three-value set still governs what a grader may emit; this wider set governs
 * what the completeness gate accepts AFTER aggregation. Keeping them separate
 * means a grader inventing 0.25 is still rejected.
 */
export const VALID_AGGREGATED_SCORES = new Set([0, 0.25, 0.5, 0.75, 1]);

// -------------------------------------------------------- v2 aggregation --

/**
 * v2 grades carry a `grader` field and every cell is graded twice. Cell value
 * is the mean of the two base grades, EXCEPT where an adjudicator record
 * (grader 'adj') exists, which overrides. Returns flat one-score-per-cell
 * records shaped like v1 grades so score()/pairedComparison run unchanged,
 * plus the reliability numbers v1 never had.
 */
export function aggregateCells(grades) {
  const cells = new Map();
  for (const g of grades) {
    const k = `${g.scenario}|${g.sheet}|${g.field}`;
    if (!cells.has(k)) cells.set(k, { scenario: g.scenario, sheet: g.sheet, field: g.field, base: [], adj: null });
    const c = cells.get(k);
    if (g.grader === 'adj') c.adj = g.score;
    else c.base.push({ grader: g.grader, score: g.score });
  }

  const problems = [];
  const flat = [];
  const agreement = {};
  let disagreements = [];
  for (const c of cells.values()) {
    if (c.base.length !== 2) {
      problems.push(`${c.scenario} sheet ${c.sheet} ${c.field}: ${c.base.length} base grade(s), expected exactly 2`);
      continue;
    }
    if (c.base[0].grader === c.base[1].grader) {
      problems.push(`${c.scenario} sheet ${c.sheet} ${c.field}: both grades from ${c.base[0].grader}`);
      continue;
    }
    const [a, b] = [c.base[0].score, c.base[1].score];
    const diff = Math.abs(a - b);
    if (diff === 1 && c.adj === null) {
      problems.push(`${c.scenario} sheet ${c.sheet} ${c.field}: full-point disagreement (${a} vs ${b}) with no adjudication record`);
    }
    if (diff > 0) disagreements.push({ scenario: c.scenario, sheet: c.sheet, field: c.field, a, b, adjudicated: c.adj !== null });
    if (!agreement[c.field]) agreement[c.field] = { n: 0, exact: 0, close: 0 };
    const ag = agreement[c.field];
    ag.n++; if (diff === 0) ag.exact++; if (diff <= 0.5) ag.close++;
    flat.push({ scenario: c.scenario, sheet: c.sheet, field: c.field, score: c.adj !== null ? c.adj : (a + b) / 2 });
  }
  return { flat, agreement, disagreements, problems };
}

/**
 * Leave-one-GRADER-out: recompute a paired comparison with one grader's base
 * records removed (each cell falls back to the other grader's score, with
 * adjudications still overriding), the per-grader analogue of the per-batch
 * sweep that exposed the v1 artifact.
 */
export function graderRobustness(grades, map, armX, armY) {
  const graders = [...new Set(grades.filter(g => g.grader && g.grader !== 'adj').map(g => g.grader))].sort();
  const full = pairedComparison(aggregateCellsLenient(grades), map, armX, armY);
  const drops = graders.map(gr => {
    const kept = grades.filter(g => g.grader !== gr);
    // After dropping, cells have one base grade; aggregate leniently.
    const r = pairedComparison(aggregateCellsLenient(kept), map, armX, armY);
    return { dropped: gr, ...r };
  });
  return { full, drops, graders };
}

/** Aggregation that accepts 1..2 base grades per cell, for robustness sweeps only. */
export function aggregateCellsLenient(grades) {
  const cells = new Map();
  for (const g of grades) {
    const k = `${g.scenario}|${g.sheet}|${g.field}`;
    if (!cells.has(k)) cells.set(k, { scenario: g.scenario, sheet: g.sheet, field: g.field, base: [], adj: null });
    const c = cells.get(k);
    if (g.grader === 'adj') c.adj = g.score; else c.base.push(g.score);
  }
  return [...cells.values()].filter(c => c.base.length > 0 || c.adj !== null).map(c => ({
    scenario: c.scenario, sheet: c.sheet, field: c.field,
    score: c.adj !== null ? c.adj : c.base.reduce((s, v) => s + v, 0) / c.base.length,
  }));
}

/**
 * Verified quotes: an arm's citation counts only if its verbatim quote is
 * actually present in the cited mirror page, whitespace-normalized. Replaces
 * the v1 citation rate, which measured URL formatting and let arms cite pages
 * they had reported unreadable.
 */
export function verifiedQuoteRates(answersByArm, mirrorDir) {
  const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const pageCache = new Map();
  const page = f => {
    if (!pageCache.has(f)) {
      try { pageCache.set(f, norm(readFileSync(join(mirrorDir, f), 'utf8'))); }
      catch { pageCache.set(f, null); }
    }
    return pageCache.get(f);
  };
  const out = {};
  for (const [arm, rows] of Object.entries(answersByArm)) {
    if (!CITING_ARMS.includes(arm)) { out[arm] = null; continue; }
    let verified = 0, total = 0;
    for (const a of rows) {
      for (const f of FACTUAL_FIELDS) {
        // Denominator is EVERY factual field, not just the ones a citation was
        // supplied for. Skipping missing citations before incrementing made a
        // 97.9 percent rate print as a flat 100, which is the metric flattering
        // itself by dropping its own misses.
        total++;
        const c = a.citations?.[f];
        if (!c) continue;
        const p = typeof c === 'object' ? page(c.page) : null;
        const q = typeof c === 'object' ? norm(c.quote || '') : '';
        if (p && q.length >= 15 && p.includes(q)) verified++;
      }
    }
    out[arm] = total ? Math.round((100 * verified) / total) : null;
  }
  return out;
}

/** The v2 verdict. Mechanical; constants above; never edited after answers exist. */
export function verdictV2(rows, grades, map, batchOf) {
  const get = a => rows.find(r => r.arm === a);
  const d = get('d'), b = get('b');
  if (!d || !b) return { headline: 'INCOMPLETE', detail: 'need arms b and d' };
  const flat = aggregateCellsLenient(grades);
  const pc = pairedComparison(flat, map, 'd', 'b');
  const p = signTest(pc.wins, pc.losses);
  const margin = d.overall - b.overall;

  const gr = graderRobustness(grades, map, 'd', 'b');
  const br = batchRobustness(flat, map, 'd', 'b', batchOf);
  const dropP = [...gr.drops.map(x => signTest(x.wins, x.losses)), ...br.drops.map(x => signTest(x.wins, x.losses))];
  const robust = dropP.every(x => x < SIGN_ALPHA);

  const clauses = [
    `sign test p=${p.toFixed(3)} (need < ${SIGN_ALPHA})`,
    `margin ${margin} pts (need >= ${DECISION_MARGIN})`,
    `robustness: ${dropP.filter(x => x < SIGN_ALPHA).length}/${dropP.length} drops stay significant (need all)`,
  ];
  const ship = p < SIGN_ALPHA && margin >= DECISION_MARGIN && robust;
  return {
    headline: ship ? 'SHIP' : (pc.wins > pc.losses ? 'INCONCLUSIVE' : 'NEGATIVE'),
    detail: `${clauses.join('; ')}. ${ship ? 'All three clauses hold.' : 'Not all clauses hold; publish, do not ship.'}`,
  };
}

// ------------------------------------------------------------------- gating --

/**
 * Every (scenario, sheet, field) must appear exactly once, every scenario must
 * be present, and every score must be one of the three allowed values. Returns
 * the list of reasons the set is unscoreable, empty when it is sound.
 */
export function completenessProblems(grades, scenarioIds, map, partial = false, validScores = VALID_SCORES) {
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
    if (!validScores.has(g.score)) {
      problems.push(`${g.scenario} sheet ${g.sheet} ${g.field}: score ${JSON.stringify(g.score)} is not one of ${[...validScores].join(", ")}`);
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
 * Leave-one-batch-out robustness, added 2026-08-02 AFTER an independent review
 * found the published conclusion resting entirely on one of six graders.
 *
 * Each batch is graded by one grader, so a single lenient or strict grader can
 * manufacture an effect across ten scenarios that looks like a finding across
 * sixty. Published B+ over B was 22 wins to 7 at p=0.008; dropping batch 6
 * alone makes it 13 to 7 at p=0.263, while dropping any other batch moves it
 * barely at all. The overall table cannot show that, and neither could the
 * paired table, so both were reported and the conclusion drawn from them was
 * wrong.
 *
 * This runs for every comparison and every batch. A comparison whose sign or
 * significance depends on one batch is not a finding about the arms, it is a
 * finding about that grader.
 */
export function batchRobustness(grades, map, armX, armY, batchOf) {
  const full = pairedComparison(grades, map, armX, armY);
  const batches = [...new Set(Object.keys(map).map(batchOf))].sort();
  const drops = batches.map(b => {
    const kept = grades.filter(g => batchOf(g.scenario) !== b);
    const r = pairedComparison(kept, map, armX, armY);
    return { dropped: b, ...r };
  });
  // Fragility is about SIGNIFICANCE, not margin. A first version compared win
  // ratios and got both answers wrong: it flagged the two null comparisons,
  // which have nothing to be fragile about, and cleared B+ over B, whose p went
  // from 0.008 to 0.263 when one batch was removed. That is exactly the
  // comparison the conclusion rested on.
  //
  // So: a comparison that is not significant to begin with is reported as null,
  // never as fragile. A significant one is fragile if removing any single batch
  // either flips its direction or takes it out of significance.
  const ALPHA = 0.05;
  const fullP = signTest(full.wins, full.losses);
  const dir = Math.sign(full.wins - full.losses);
  const worst = drops.reduce((a, b) =>
    signTest(b.wins, b.losses) > signTest(a.wins, a.losses) ? b : a, drops[0]);
  const significant = fullP < ALPHA;
  const fragile = significant && (
    signTest(worst.wins, worst.losses) >= ALPHA ||
    drops.some(d => Math.sign(d.wins - d.losses) !== dir)
  );
  return { full, drops, worst, fragile, significant, fullP };
}

/** Two-sided exact sign test over the decided (non-tied) scenarios. */
export function signTest(wins, losses) {
  const n = wins + losses;
  if (!n) return 1;
  const C = (a, b) => { let r = 1; for (let i = 0; i < b; i++) r = r * (a - i) / (i + 1); return r; };
  let p = 0;
  for (let i = 0; i <= Math.min(wins, losses); i++) p += C(n, i);
  return Math.min(1, (2 * p) / Math.pow(2, n));
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
      : `D is ${g2} points over B+, inside the noise floor, so the reference did not add anything measurable on top of the procedure.`;
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
    L.push(meta.verifiedQuotes
      ? 'VERIFIED-quote rate: the share of the four factual fields whose citation carries a quote that'
      : 'Citation rate is the share of the four factual fields carrying a documentation URL. An arm');
    L.push(meta.verifiedQuotes
      ? 'appears VERBATIM in the cited mirror page, checked mechanically. Fields with no citation count'
      : 'with a low rate answered from memory rather than looking it up, which the overall score hides.');
    if (meta.verifiedQuotes) L.push('against the rate, so this measures verification, not formatting.');
    L.push('');
    L.push(meta.verifiedQuotes ? '| Arm | Verified-quote rate |' : '| Arm | Citation rate |');
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
    L.push('| Comparison | Scenarios | Wins | Losses | Ties | Mean delta | Sign test |');
    L.push('|---|---|---|---|---|---|---|');
    for (const p of meta.paired) {
      L.push(`| ${p.armX.toUpperCase()} vs ${p.armY.toUpperCase()} | ${p.n} | ${p.wins} | ${p.losses} | ${p.ties} | ${p.meanDeltaPoints >= 0 ? '+' : ''}${p.meanDeltaPoints} pts | p=${signTest(p.wins, p.losses).toFixed(3)} |`);
    }
    L.push('');
    L.push('Ties are reported because they dominate: a split like 22 to 7 describes only the');
    L.push('scenarios where the arms differed at all, and reading it without the tie column');
    L.push('overstates how often one arm actually beat the other.');
    L.push('');
  }
  if (meta.agreement && Object.keys(meta.agreement).length) {
    const dis = meta.disagreements || [];
    const adj = dis.filter(d => d.adjudicated).length;
    L.push('Inter-grader agreement. Every cell was graded twice by independent graders, so this');
    L.push('benchmark finally has a reliability number instead of assuming one. Full-point splits');
    L.push('(0 versus 1) went to a blind adjudicator who saw the key and the answer but neither');
    L.push('the two scores nor which arm produced the sheet.');
    L.push('');
    L.push('| Field | Cells | Exact agreement | Within half a point |');
    L.push('|---|---|---|---|');
    for (const f of GRADED_FIELDS) {
      const a = meta.agreement[f];
      if (!a) continue;
      L.push(`| ${f} | ${a.n} | ${Math.round((100 * a.exact) / a.n)}% | ${Math.round((100 * a.close) / a.n)}% |`);
    }
    const tot = Object.values(meta.agreement).reduce((s, a) => ({ n: s.n + a.n, exact: s.exact + a.exact, close: s.close + a.close }), { n: 0, exact: 0, close: 0 });
    L.push(`| **all fields** | **${tot.n}** | **${Math.round((100 * tot.exact) / tot.n)}%** | **${Math.round((100 * tot.close) / tot.n)}%** |`);
    L.push('');
    L.push(`Disagreements of any size: ${dis.length} of ${tot.n} cells. Full-point splits requiring adjudication: ${dis.length ? dis.filter(d => Math.abs(d.a - d.b) === 1).length : 0}.`);
    L.push('');
  }
  if (meta.robustness && meta.robustness.length) {
    L.push(meta.twoGraders
      ? 'Leave-one-batch-out. Every comparison is recomputed with each grading batch removed in'
      : 'Leave-one-batch-out. Each batch is graded by ONE grader, so a single lenient or');
    L.push(meta.twoGraders
      ? 'turn, because a batch that behaves unlike the rest can manufacture across ten scenarios'
      : 'strict grader can manufacture across ten scenarios what looks like a finding across');
    L.push(meta.twoGraders
      ? 'what looks like a finding across sixty. This is what caught the retracted v1 headline.'
      : 'sixty. Every comparison is recomputed with each batch removed in turn.');
    L.push('');
    L.push('| Comparison | All 60 | Worst single-batch drop | Verdict |');
    L.push('|---|---|---|---|');
    for (const r of meta.robustness) {
      const f = r.full, w = r.worst;
      const call = !r.significant
        ? 'not significant to begin with'
        : (r.fragile ? '**RESTS ON ONE GRADER**' : 'robust');
      L.push(`| ${f.armX.toUpperCase()} vs ${f.armY.toUpperCase()} | ${f.wins}W ${f.losses}L, p=${signTest(f.wins, f.losses).toFixed(3)} | drop batch ${w.dropped}: ${w.wins}W ${w.losses}L, p=${signTest(w.wins, w.losses).toFixed(3)} | ${call} |`);
    }
    L.push('');
  }
  L.push(`**Verdict, by the rule committed before the run: ${v.headline}.** ${v.detail}`);
  if (v.attribution) { L.push(''); L.push(v.attribution); }
  // The ship decision above is the pre-committed rule and is untouched. This
  // line is a post-hoc guard added after an independent review found the first
  // published attribution resting on a single grader's batch. It can only
  // WEAKEN a claim, never create one.
  if (meta.robustness && meta.robustness.length) {
    const fragile = meta.robustness.filter(r => r.fragile);
    const solid = meta.robustness.filter(r => r.significant && !r.fragile);
    L.push('');
    if (fragile.length) {
      L.push(`**Do not carry any of these forward as a finding about the arms.** ` +
        fragile.map(r => `${r.full.armX.toUpperCase()} over ${r.full.armY.toUpperCase()}`).join(' and ') +
        ` loses significance when a single batch is removed, so it is a fact about that grader, not about the arms.` +
        (solid.length ? ` What survives every drop: ${solid.map(r => `${r.full.armX.toUpperCase()} over ${r.full.armY.toUpperCase()}`).join(', ')}.` : ''));
    } else if (solid.length) {
      L.push(`Robust across every single-batch drop: ${solid.map(r => `${r.full.armX.toUpperCase()} over ${r.full.armY.toUpperCase()}`).join(', ')}.`);
    }
  }
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
  check('an out-of-range RAW score is caught',
    completenessProblems([...full.slice(1), { ...full[0], score: 0.75 }], ids, map).some(p => /is not one of/.test(p)));
  // The two lattices are deliberately different: a grader may only emit
  // 0/0.5/1, but the MEAN of two such grades legitimately lands on 0.25 or
  // 0.75, so the post-aggregation gate accepts the quarter lattice. Conflating
  // them made the v2 scorer reject 229 perfectly valid aggregated cells.
  check('a quarter-lattice score passes the AGGREGATED gate',
    completenessProblems([...full.slice(1), { ...full[0], score: 0.75 }], ids, map, false, VALID_AGGREGATED_SCORES)
      .every(p => !/is not one of/.test(p)));
  check('a value off BOTH lattices is still caught',
    completenessProblems([...full.slice(1), { ...full[0], score: 0.3 }], ids, map, false, VALID_AGGREGATED_SCORES)
      .some(p => /is not one of/.test(p)));
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

  check('sign test is two-sided and exact', Math.abs(signTest(5, 0) - 0.0625) < 1e-9, `p(5,0)=${signTest(5, 0)}`);
  check('sign test returns 1 with nothing decided', signTest(0, 0) === 1);

  // The defect an independent review found: a comparison carried entirely by one
  // grader's batch. Fixture: two batches, one where x sweeps and one where y does.
  const rMap = {}, rGrades = [];
  for (let s = 1; s <= 20; s++) {
    const id = 'S' + String(s).padStart(3, '0');
    rMap[id] = { 1: 'd', 2: 'b' };
    const dWins = s <= 10;
    for (const f of GRADED_FIELDS) {
      rGrades.push({ scenario: id, sheet: 1, field: f, score: dWins ? 1 : 0.5 });
      rGrades.push({ scenario: id, sheet: 2, field: f, score: dWins ? 0.5 : 1 });
    }
  }
  const bOf = id => Math.floor((Number(id.slice(1)) - 1) / 10) + 1;
  const rob = batchRobustness(rGrades, rMap, 'd', 'b', bOf);
  check('leave-one-batch-out recomputes per batch', rob.drops.length === 2, `${rob.drops.length} drop(s)`);
  check('a null comparison is reported as null, not fragile',
    rob.significant === false && rob.fragile === false, `p=${rob.fullP.toFixed(3)}`);

  // Batch 1 sweeps for x, batch 2 is a near-tie: significant overall, and the
  // significance evaporates when batch 1 is removed. This is the real shape.
  const cMap = {}, cGrades = [];
  for (let s = 1; s <= 20; s++) {
    const id = 'S' + String(s).padStart(3, '0');
    cMap[id] = { 1: 'd', 2: 'b' };
    const xWins = s <= 10;
    const tie = s > 10 && s <= 18;
    for (const f of GRADED_FIELDS) {
      cGrades.push({ scenario: id, sheet: 1, field: f, score: tie ? 1 : (xWins ? 1 : 0.5) });
      cGrades.push({ scenario: id, sheet: 2, field: f, score: tie ? 1 : (xWins ? 0.5 : 1) });
    }
  }
  const carried = batchRobustness(cGrades, cMap, 'd', 'b', bOf);
  check('a significant effect carried by ONE batch is flagged',
    carried.significant === true && carried.fragile === true,
    `full ${carried.full.wins}W ${carried.full.losses}L p=${carried.fullP.toFixed(3)}, worst drop ${carried.worst.wins}W ${carried.worst.losses}L p=${signTest(carried.worst.wins, carried.worst.losses).toFixed(3)}`);

  const stableGrades = [];
  for (let s = 1; s <= 20; s++) {
    const id = 'S' + String(s).padStart(3, '0');
    for (const f of GRADED_FIELDS) {
      stableGrades.push({ scenario: id, sheet: 1, field: f, score: 1 });
      stableGrades.push({ scenario: id, sheet: 2, field: f, score: 0.5 });
    }
  }
  const stable = batchRobustness(stableGrades, cMap, 'd', 'b', bOf);
  check('an effect consistent across batches is significant and NOT fragile',
    stable.significant === true && stable.fragile === false, `p=${stable.fullP.toFixed(3)}`);

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
  // Reworded after review: the old text asserted "the procedure carried it",
  // which claims a positive effect for B+ that D-versus-B+ parity cannot
  // support. Parity means the reference added nothing, and says nothing about
  // whether the procedure did anything.
  check('attribution claims only what D-versus-B+ parity supports',
    /did not add anything measurable/.test(verdict(mk(70, 84, 86)).attribution));
  check('attribution does NOT assert the procedure was the cause',
    !/procedure carried it/.test(verdict(mk(70, 84, 86)).attribution));

  // ------------------------------------------------------------ v2 layer --
  const g2 = [];
  for (const id of ids) for (const [sheet] of Object.entries(map[id])) for (const f of GRADED_FIELDS) {
    g2.push({ scenario: id, sheet: Number(sheet), field: f, score: 1, grader: 'g1' });
    g2.push({ scenario: id, sheet: Number(sheet), field: f, score: 1, grader: 'g2' });
  }
  check('two agreeing grades aggregate cleanly', (() => {
    const r = aggregateCells(g2);
    // The flat-count assertion is load-bearing: without it a gutted aggregator
    // returning empty arrays passed this check vacuously (independent-review
    // finding) and only crashed a later check by accident.
    return r.problems.length === 0 && r.flat.length === g2.length / 2 && r.flat.every(c => c.score === 1) && r.disagreements.length === 0;
  })());
  check('half-point disagreement means the cell, no adjudication needed', (() => {
    const gg = g2.map(x => ({ ...x }));
    gg[0] = { ...gg[0], score: 0.5 };
    const r = aggregateCells(gg);
    return r.problems.length === 0 && r.flat.find(c => c.scenario === gg[0].scenario && c.sheet === gg[0].sheet && c.field === gg[0].field).score === 0.75;
  })());
  check('full-point disagreement without adjudication is a completeness problem', (() => {
    const gg = g2.map(x => ({ ...x }));
    gg[0] = { ...gg[0], score: 0 };
    return aggregateCells(gg).problems.some(p => /full-point disagreement/.test(p));
  })());
  check('an adjudication record resolves and overrides', (() => {
    const gg = g2.map(x => ({ ...x }));
    gg[0] = { ...gg[0], score: 0 };
    gg.push({ scenario: gg[0].scenario, sheet: gg[0].sheet, field: gg[0].field, score: 0, grader: 'adj' });
    const r = aggregateCells(gg);
    return r.problems.length === 0 && r.flat.find(c => c.scenario === gg[0].scenario && c.sheet === gg[0].sheet && c.field === gg[0].field).score === 0;
  })());
  check('a single-graded cell is a completeness problem in strict mode', (() => {
    return aggregateCells(g2.slice(1)).problems.some(p => /1 base grade/.test(p));
  })());
  check('both grades from one grader is a completeness problem', (() => {
    const gg = g2.map(x => ({ ...x }));
    gg[1] = { ...gg[1], grader: 'g1' };
    return aggregateCells(gg).problems.some(p => /both grades from/.test(p));
  })());
  check('agreement stats count exact and close correctly', (() => {
    const gg = g2.map(x => ({ ...x }));
    gg[0] = { ...gg[0], score: 0.5 };
    const ag = aggregateCells(gg).agreement.primary;
    return ag && ag.exact === ag.n - 1 && ag.close === ag.n;
  })());

  {
    const tmp = join(tmpdir(), `score-st-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'hooks.md'), 'Hooks reference. Command hooks fail open when the handler exits nonzero without a decision.');
    const arms = {
      d: [{ id: 'S001', citations: { failure_mode: { page: 'hooks.md', quote: 'Command hooks fail open when the handler exits nonzero' } } }],
      bplus: [{ id: 'S001', citations: { failure_mode: { page: 'hooks.md', quote: 'this sentence appears nowhere in the page at all, invented' } } }],
    };
    const r = verifiedQuoteRates(arms, tmp);
    // One cited field out of four factual fields: a fully verified citation is
    // 25 percent of the fields, not 100 percent of the citations supplied.
    check('a real verbatim quote verifies', r.d === 25, `d=${r.d}`);
    check('an invented quote does NOT verify (planted fake)', r.bplus === 0, `bplus=${r.bplus}`);
    const rMissing = verifiedQuoteRates({ d: [{ id: 'S001', citations: {} }] }, tmp);
    check('missing citations count against the rate, not out of it', rMissing.d === 0, `d=${rMissing.d}`);
    rmSync(tmp, { recursive: true, force: true });
  }

  // The LOBO batch source, an independent-review finding: when grading batches
  // are a shuffle of the answer blocks, deriving batch membership from the
  // scenario NUMBER silently drops the wrong ten scenarios. This asserts the
  // two groupings are distinguishable and that a shuffled map is not equal to
  // the arithmetic one, which is the condition that made the bug invisible.
  {
    const arith = id => Math.floor((Number(String(id).slice(1)) - 1) / 10) + 1;
    const shuffled = new Map();
    const ids60 = Array.from({ length: 60 }, (_, i) => 'S' + String(i + 1).padStart(3, '0'));
    ids60.forEach((id, i) => shuffled.set(id, ((i * 7) % 6) + 1));
    const differ = ids60.filter(id => shuffled.get(id) !== arith(id)).length;
    check('a shuffled grading-batch map differs from the arithmetic one', differ > 30, `${differ} of 60 differ`);
    const lookup = id => shuffled.get(id) ?? arith(id);
    check('batch lookup prefers the map over the arithmetic fallback',
      lookup('S001') === shuffled.get('S001') && lookup('S999') === arith('S999'));
  }

  check('graderRobustness drops each grader once', (() => {
    const r = graderRobustness(g2, map, 'd', 'b');
    return r.graders.length === 2 && r.drops.length === 2;
  })());
  check('verdictV2 refuses to ship on an insignificant result', (() => {
    const rows2 = [{ arm: 'd', overall: 92 }, { arm: 'b', overall: 90 }];
    const v = verdictV2(rows2, g2, map, id => 1);
    return v.headline !== 'SHIP';
  })());

  // ---- pooled replicate path -------------------------------------------------
  // pooledPerScenarioDeltas, pooledVerdict and REPLICATE_RULE shipped with ZERO
  // coverage. They are the rule the replicate run will be judged by, so they are
  // exactly the code that must not be trusted untested.
  {
    // Two scenarios, four sheets each, one field. Sheet 1 is d and sheet 2 is b in
    // every replicate, so the expected deltas are arithmetic rather than guessed.
    // EIGHT scenarios, not two. A sign test needs at least 6 unanimous wins to
    // reach p < 0.05 (2 * 0.5^6 = 0.031), so a two-scenario fixture caps at
    // p = 0.5 and SHIP is unreachable by arithmetic rather than by rule. A
    // fixture that cannot exercise the positive branch would leave the ship path
    // permanently untested while every row still read green.
    const PIDS = Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(3, '0')}`);
    // Three batches of four. A single-batch fixture makes leave-one-batch-out
    // remove every scenario, so the robustness clause could never pass and the
    // ship path would look broken when only the fixture was.
    const pbatch = id => Math.ceil(Number(id.slice(1)) / 4);
    const pmap = Object.fromEntries(PIDS.map(id => [id, { 1: 'd', 2: 'b' }]));
    const rep = (dScore, bScore, ids = PIDS) => ({
      map: pmap,
      grades: ids.flatMap(id => [
        { scenario: id, sheet: 1, field: 'primary', score: dScore, grader: 'g1' },
        { scenario: id, sheet: 1, field: 'primary', score: dScore, grader: 'g2' },
        { scenario: id, sheet: 2, field: 'primary', score: bScore, grader: 'g1' },
        { scenario: id, sheet: 2, field: 'primary', score: bScore, grader: 'g2' },
      ]),
    });

    const three = [rep(1, 0), rep(1, 0), rep(1, 0)];
    const pooled = pooledPerScenarioDeltas(three, 'd', 'b');

    /**
     * THE SINGLE MOST IMPORTANT ROW IN THIS FILE.
     *
     * Pooling AVERAGES within a scenario; it does not stack. n stays at the number
     * of scenarios no matter how many replicates are pooled. A pooled endpoint that
     * treated three replicates of 60 scenarios as n = 180 would manufacture
     * significance out of nothing, and every downstream p-value would be a lie.
     */
    check('POOLING AVERAGES, IT DOES NOT STACK: n stays at the scenario count',
      pooled.length === 12, `n=${pooled.length}, expected 12 not 36`);
    check('each pooled scenario records how many replicates fed it',
      pooled.every(x => x.reps === 3));

    const mixed = pooledPerScenarioDeltas([rep(1, 0), rep(1, 0), rep(0, 1)], 'd', 'b');
    check('the pooled delta is a MEAN of the replicate deltas',
      Math.abs(mixed[0].meanDelta - (1 + 1 - 1) / 3) < 1e-9, `${mixed[0].meanDelta}`);
    const tied = pooledPerScenarioDeltas([rep(1, 0), rep(0, 1)], 'd', 'b');
    check('equal and opposite replicate deltas pool to a TIE, not a win',
      tied[0].meanDelta === 0);

    // A scenario missing from one replicate must still pool, on fewer replicates,
    // rather than being silently dropped from n.
    const withGap = pooledPerScenarioDeltas([rep(1, 0), rep(1, 0, PIDS.slice(0, 11)), rep(1, 0)], 'd', 'b');
    check('a scenario absent from one replicate still pools, on fewer reps',
      withGap.length === 12 && withGap.find(x => x.id === 'P012').reps === 2,
      `n=${withGap.length}, P012 reps=${withGap.find(x => x.id === 'P012')?.reps}`);

    check('pooling identical replicates reproduces the single-run comparison',
      (() => {
        const one = pairedComparison(aggregateCellsLenient(rep(1, 0).grades), pmap, 'd', 'b');
        const p3 = pooledPerScenarioDeltas([rep(1, 0), rep(1, 0), rep(1, 0)], 'd', 'b');
        return one.wins === p3.filter(x => x.meanDelta > 0).length
          && one.losses === p3.filter(x => x.meanDelta < 0).length;
      })());

    // The rule must be able to say BOTH things. A rule that can only refuse is not
    // a rule, and a rule that cannot refuse is decoration.
    const vWin = pooledVerdict(three, [{ arm: 'd', overall: 99 }, { arm: 'b', overall: 90 }], pbatch);
    check('the pooled rule CAN ship when every clause holds', vWin.headline === 'SHIP', vWin.detail);
    const vMargin = pooledVerdict(three, [{ arm: 'd', overall: 91 }, { arm: 'b', overall: 90 }], pbatch);
    check('the pooled rule refuses on margin alone even when p is significant',
      vMargin.headline !== 'SHIP', vMargin.detail);
    const vNeg = pooledVerdict([rep(0, 1), rep(0, 1), rep(0, 1)],
      [{ arm: 'd', overall: 80 }, { arm: 'b', overall: 90 }], pbatch);
    check('a pooled loss reads NEGATIVE', vNeg.headline === 'NEGATIVE', vNeg.detail);

    check('leave-one-replicate drops appear once per replicate',
      vWin.dropPs.filter(x => x.kind === 'replicate').length === 3);
    check('leave-one-grader drops span every replicate, 2 graders each',
      vWin.dropPs.filter(x => x.kind === 'grader').length === 6
      && vWin.dropPs.some(x => x.dropped === 'r3:g2'),
      vWin.dropPs.filter(x => x.kind === 'grader').map(x => x.dropped).join(','));
    check('a single replicate produces NO leave-one-replicate drop',
      pooledVerdict([rep(1, 0)], [{ arm: 'd', overall: 99 }, { arm: 'b', overall: 90 }], pbatch)
        .dropPs.filter(x => x.kind === 'replicate').length === 0);
    check('REPLICATE_RULE is the pre-committed string',
      REPLICATE_RULE === 'pooled-per-scenario-mean, all-drops-robust');
  }

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

let grades = loadGrades();
const scenarios = loadScenarios();
const ids = scenarios.map(s => s.id);

/**
 * POOLED MULTI-REPLICATE PATH.
 *
 * Reuses pooledPerScenarioDeltas, pooledVerdict and REPLICATE_RULE, all of which
 * were committed on 2026-08-02 before any replicate data existed. Nothing here
 * decides anything; it loads, gates, and applies that rule.
 *
 * Two refusals are load-bearing:
 *   1. A replicate that does not pass the STRICT completeness gate on its own may
 *      not enter the pool. A pool that silently absorbs a partial replicate is the
 *      same defect class as a merged grade file that cannot be re-derived.
 *   2. The grading-batch partition must be IDENTICAL across replicates. The
 *      leave-one-batch-out clause drops a batch from the POOLED deltas, so if
 *      batch 1 meant different scenarios in each pass the drop would remove an
 *      incoherent set and the robustness clause would assert nothing.
 */
if (argv.includes('--replicates')) {
  const raw = argv[argv.indexOf('--replicates') + 1] || '1,2,3';
  const reps = raw.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  if (reps.length < 2) { console.log('FAIL: --replicates needs at least two replicate numbers, e.g. 1,2,3'); process.exit(2); }

  const T3 = join(ROOT, 'tests', 'tier3');
  const loaded = [];
  const partitions = [];
  for (const n of reps) {
    const rs = n > 1 ? `-r${n}` : '';
    const gPath = join(T3, `grades${SFX}${rs}.jsonl`);
    const mPath = join(T3, `blinding-map${SFX}${rs}.json`);
    const pDir = join(T3, `packets${SFX}${rs}`);
    for (const [label, p] of [['grades', gPath], ['blinding map', mPath], ['packets', pDir]]) {
      if (!existsSync(p)) { console.log(`FAIL: replicate ${n} has no ${label} at ${p}`); process.exit(1); }
    }
    const g = readFileSync(gPath, 'utf8').split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
    const m = JSON.parse(readFileSync(mPath, 'utf8'));

    // Gate this replicate exactly as --rep N would, before it may be pooled.
    const agg = aggregateCells(g);
    if (agg.problems.length) {
      console.log(`\nREFUSING TO POOL: replicate ${n} has ${agg.problems.length} aggregation problem(s).`);
      for (const p of agg.problems.slice(0, 10)) console.log(`  ${p}`);
      process.exit(1);
    }
    const probs = completenessProblems(agg.flat, ids, m, false, VALID_AGGREGATED_SCORES);
    if (probs.length) {
      console.log(`\nREFUSING TO POOL: replicate ${n} has ${probs.length} completeness problem(s).`);
      for (const p of probs.slice(0, 10)) console.log(`  ${p}`);
      console.log('A --partial replicate is diagnostic only and may never enter a pool.');
      process.exit(1);
    }

    const part = new Map();
    for (const f of readdirSync(pDir).filter(x => /^batch-\d+\.json$/.test(x))) {
      const b = Number(f.match(/\d+/)[0]);
      for (const s of JSON.parse(readFileSync(join(pDir, f), 'utf8')).scenarios) part.set(s.id, b);
    }
    partitions.push({ n, part });
    // agg.agreement is per-field {field: {n, exact, close}}; roll it up rather than
    // interpolating the object, which rendered as "[object Object]" on first run.
    const av = Object.values(agg.agreement);
    const aPct = av.length
      ? Math.round(100 * av.reduce((s, f) => s + f.exact, 0) / av.reduce((s, f) => s + f.n, 0))
      : null;
    loaded.push({ n, grades: g, map: m, flat: agg.flat, agreement: aPct });
    console.log(`replicate ${n}: ${g.length} records, ${agg.flat.length} cells, grader agreement ${aPct}%`);
  }

  const canon = partitions[0];
  for (const p of partitions.slice(1)) {
    const differ = [...canon.part.keys()].filter(id => canon.part.get(id) !== p.part.get(id));
    if (differ.length) {
      console.log(`\nREFUSING TO POOL: replicate ${p.n}'s grading-batch partition differs from replicate ${canon.n}'s`);
      console.log(`  ${differ.length} scenario(s) sit in a different batch, e.g. ${differ.slice(0, 5).join(', ')}`);
      console.log('  The pooled leave-one-batch-out clause is undefined when a batch means different');
      console.log('  scenarios in different passes.');
      process.exit(1);
    }
  }
  console.log(`batch partition identical across all ${reps.length} replicates.`);

  const batchOfPooled = id => canon.part.get(String(id).replace(/^r\d+:/, ''))
    ?? Math.floor((Number(String(id).replace(/^r\d+:/, '').slice(1)) - 1) / 10) + 1;

  // Namespaced merge so one score() call covers every cell, rather than averaging
  // percentages by hand and quietly reweighting arms with unequal cell counts.
  const flatAll = loaded.flatMap(r => r.flat.map(c => ({ ...c, scenario: `r${r.n}:${c.scenario}` })));
  const mapAll = Object.assign({}, ...loaded.map(r =>
    Object.fromEntries(Object.entries(r.map).map(([id, v]) => [`r${r.n}:${id}`, v]))));
  const rowsPooled = score(flatAll, mapAll, {});
  const replicatesArg = loaded.map(r => ({ grades: r.grades, map: r.map }));
  const pooled = pooledVerdict(replicatesArg, rowsPooled, batchOfPooled);
  const deltas = pooledPerScenarioDeltas(replicatesArg, 'd', 'b');

  const perRep = loaded.map(r => {
    const rr = score(r.flat, r.map, {});
    const dl = pairedComparison(r.flat, r.map, 'd', 'b');
    return { n: r.n, rows: rr, dl, agreement: r.agreement };
  });

  const L = [];
  L.push(`<!-- tier3-pooled:begin set=${SET} -->`);
  L.push('');
  L.push(`Pooled over replicates ${reps.join(', ')}. Rule committed before any replicate data existed: \`${REPLICATE_RULE}\`.`);
  L.push('');
  L.push('Per-arm overall by replicate. The SPREAD is what three passes buy; a pooled mean alone');
  L.push('would hide it.');
  L.push('');
  L.push(`| Arm | ${reps.map(n => `Rep ${n}`).join(' | ')} | Pooled | Spread |`);
  L.push(`|---|${reps.map(() => '---').join('|')}|---|---|`);
  for (const arm of ARMS) {
    const vals = perRep.map(p => (p.rows.find(r => r.arm === arm) || {}).overall);
    if (vals.some(v => v === undefined)) continue;
    const pooledV = (rowsPooled.find(r => r.arm === arm) || {}).overall;
    L.push(`| ${arm} | ${vals.map(v => `${v}%`).join(' | ')} | ${pooledV}% | ${Math.max(...vals) - Math.min(...vals)} pts |`);
  }
  L.push('');
  L.push('D versus B by replicate, then pooled over per-scenario MEAN deltas. n stays at the');
  L.push('scenario count: pooling averages within a scenario, it does not stack.');
  L.push('');
  L.push('| Pass | n | Wins | Losses | Ties | Sign test |');
  L.push('|---|---|---|---|---|---|');
  for (const p of perRep) {
    L.push(`| Replicate ${p.n} | 60 | ${p.dl.wins} | ${p.dl.losses} | ${p.dl.ties} | p=${signTest(p.dl.wins, p.dl.losses).toFixed(3)} |`);
  }
  const pw = deltas.filter(x => x.meanDelta > 0).length;
  const pl = deltas.filter(x => x.meanDelta < 0).length;
  L.push(`| **Pooled** | **${deltas.length}** | **${pw}** | **${pl}** | **${deltas.length - pw - pl}** | **p=${signTest(pw, pl).toFixed(3)}** |`);
  L.push('');
  L.push(`Grader agreement by replicate: ${perRep.map(p => `rep ${p.n} ${p.agreement}%`).join(', ')}.`);
  L.push('');
  L.push(`**Pooled verdict: ${pooled.headline}.** ${pooled.detail}`);
  L.push('');
  const failed = pooled.dropPs.filter(x => x.p >= 0.05);
  L.push(`Robustness drops computed: ${pooled.dropPs.length} (${pooled.dropPs.filter(x => x.kind === 'replicate').length} leave-one-replicate, `
    + `${pooled.dropPs.filter(x => x.kind === 'grader').length} leave-one-grader, ${pooled.dropPs.filter(x => x.kind === 'batch').length} leave-one-batch). `
    + `${failed.length} of them do not reach p < 0.05.`);
  L.push('');
  L.push(`<!-- tier3-pooled:end -->`);
  const pooledBlock = L.join('\n');

  if (argv.includes('--markdown')) { console.log(pooledBlock); process.exit(0); }

  if (argv.includes('--check')) {
    const doc = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';
    const B = `<!-- tier3-pooled:begin set=${SET} -->`;
    const E = '<!-- tier3-pooled:end -->';
    const i = doc.indexOf(B); const j = doc.indexOf(E, i);
    if (i < 0 || j < 0) { console.log('FAIL: results-tier3.md carries no pooled block to check.'); process.exit(1); }
    const onDisk = doc.slice(i, j + E.length).split('\r\n').join('\n').trim();
    if (onDisk !== pooledBlock.trim()) {
      console.log('FAIL: the published pooled block does not match what the raw grades derive.');
      process.exit(1);
    }
    console.log('PASS: the published pooled block matches the raw grades exactly.');
    process.exit(0);
  }

  console.log('');
  console.log(pooledBlock);
  process.exit(0);
}

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

// v2 grades carry a `grader` field and two base grades per cell. Aggregate to
// one score per cell first, then every downstream path (completeness, score,
// paired, robustness) runs on the same shape v1 used.
let v2meta = null;
if (SET === 'v2') {
  const agg = aggregateCells(grades);
  v2meta = { agreement: agg.agreement, disagreements: agg.disagreements, aggProblems: agg.problems };
  if (agg.problems.length) {
    console.log(`\nREFUSING TO SCORE: ${agg.problems.length} two-grader aggregation problem(s).`);
    for (const p of agg.problems.slice(0, 30)) console.log(`  ${p}`);
    if (agg.problems.length > 30) console.log(`  ... and ${agg.problems.length - 30} more`);
    process.exit(1);
  }
  grades = agg.flat;
}

const PARTIAL = argv.includes('--partial');
const problems = completenessProblems(grades, ids, map, PARTIAL, SET === 'v2' ? VALID_AGGREGATED_SCORES : VALID_SCORES);
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

// v2 with a mirror uses VERIFIED quotes (the quote must appear verbatim in the
// cited page); v1 and any run without a mirror fall back to the format-only
// citation rate. The first v2 scoring pass still called the old function and
// reported 0 percent for both citing arms, because v2 citations are objects
// and the old counter expected a URL string. Wrong number, right complaint.
// The mirror is not committed (copyright), so CI cannot recompute verified
// quotes. When a mirror IS present the rates are computed and PERSISTED; when
// it is absent the persisted rates are reused, so the committed block stays
// verifiable in CI without shipping the documentation.
const QUOTE_RATES = join(ROOT, 'tests', 'tier3', `verified-quote-rates${SFX}.json`);
let citeRates, usingVerified = false;
if (SET === 'v2' && MIRROR) {
  citeRates = verifiedQuoteRates(loadAnswers(), MIRROR);
  usingVerified = true;
  writeFileSync(QUOTE_RATES, JSON.stringify(citeRates, null, 2) + '\n');
} else if (SET === 'v2' && existsSync(QUOTE_RATES)) {
  citeRates = JSON.parse(readFileSync(QUOTE_RATES, 'utf8'));
  usingVerified = true;
} else {
  citeRates = citationRates(loadAnswers());
}
const rows = score(grades, map, citeRates);
const v = verdict(rows);
const PAIRS = [['d', 'b'], ['d', 'bplus'], ['bplus', 'b'], ['b', 'a']]
  .filter(([x, y]) => rows.some(r => r.arm === x) && rows.some(r => r.arm === y));
const paired = PAIRS.map(([x, y]) => pairedComparison(grades, map, x, y));
// Batch = the grader who scored it. Scenario ids are S001..S060 in batches of 10.
// Grading-batch membership must come from the PACKETS, because v2 grading
// batches are a seeded shuffle: 48 of 60 scenarios sit in a different grading
// batch than their natural S001-S010 block. Deriving the batch arithmetically
// dropped answer blocks (which are exactly the six focus areas) while the prose
// claimed grading batches, so the run had no grader-batch robustness check at
// all. Independent-review finding; the arithmetic fallback stays only for v1,
// where answer and grading batches were the same thing.
const packetBatchOf = (() => {
  const dir = join(ROOT, 'tests', 'tier3', `packets${SFX}`);
  if (!existsSync(dir)) return null;
  const m = new Map();
  for (const f of readdirSync(dir).filter(x => /^batch-\d+\.json$/.test(x))) {
    const b = Number(f.match(/\d+/)[0]);
    for (const s of JSON.parse(readFileSync(join(dir, f), 'utf8')).scenarios) m.set(s.id, b);
  }
  return m.size ? m : null;
})();
const batchOf = id => packetBatchOf
  ? (packetBatchOf.get(id) ?? Math.floor((Number(String(id).slice(1)) - 1) / 10) + 1)
  : Math.floor((Number(String(id).slice(1)) - 1) / 10) + 1;
const robustness = PAIRS.map(([x, y]) => batchRobustness(grades, map, x, y, batchOf));
const block = renderMarkdown(rows, v, { paired, robustness, verifiedQuotes: usingVerified, twoGraders: SET === 'v2', agreement: v2meta && v2meta.agreement, disagreements: v2meta && v2meta.disagreements });

if (argv.includes('--markdown')) { console.log(block); process.exit(0); }

console.log('');
console.log(block.replace(BEGIN, '').replace(END, '').trim());

if (argv.includes('--check')) {
  /**
   * A REPLICATE ABOVE 1 OWNS NO PUBLISHED BLOCK.
   *
   * The `tier3-score:begin set=v2` markers belong to replicate 1. Comparing
   * replicate 2's derived table against them compared two different passes and
   * failed for a reason that had nothing to do with drift. What --check can
   * honestly assert for a later replicate is that it scores cleanly on its own,
   * which is the precondition for pooling, and every gate that got it here
   * (aggregation, completeness) has already run above by this point.
   *
   * The published pooled block is guarded separately by --replicates --check.
   */
  if (REP > 1) {
    console.log(`\nPASS: replicate ${REP} scores cleanly and owns no published block; the pooled`);
    console.log('block is guarded by --replicates --check.');
    process.exit(0);
  }
  const doc = readFileSync(DOC, 'utf8');
  const i = doc.indexOf(BEGIN), j = doc.indexOf(END);
  if (i === -1 || j === -1) {
    // A set whose tables have been demoted to frozen history owns no machine
    // block, and saying so is not a failure. v1 is in exactly that state: its
    // numbers are published as history and the v2 block is what CI guards.
    const other = readFileSync(DOC, 'utf8').match(/<!-- tier3-score:begin set=(\w+) -->/);
    if (other && other[1] !== SET) {
      console.log(`\nPASS: no block for set ${SET}; the published block governs set ${other[1]}, which owns the drift check.`);
      process.exit(0);
    }
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
