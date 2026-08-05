#!/usr/bin/env node
/**
 * tier3-grades.mjs - derive the merged grade file from its committed inputs.
 *
 * WHY THIS EXISTS
 * ---------------
 * grades-v2.jsonl could not be re-derived from anything committed. It holds 3369
 * records; the twelve per-batch grader files hold 3360; the 9 adjudication records
 * existed in the merged file and nowhere else. So the published Tier 3 result
 * depended on a file that had to be taken on trust.
 *
 * That was survivable while nothing changed. It stops being survivable the moment
 * a key is repaired and a scenario is re-graded, because splicing new records by
 * hand into an already-underivable file makes the provenance gap permanent. So the
 * merged file becomes DERIVED, and the inputs become the record.
 *
 * PRECEDENCE, later wins on (scenario, sheet, field, grader):
 *   1. grades-<set>[-rN]-g{1,2}-batch-*.jsonl   the original grading pass
 *   2. grades-<set>[-rN]-*-regrade-*.jsonl      re-grades after a key repair
 *   3. grades-<set>[-rN]-adj.jsonl              blind adjudication of split cells
 *
 * Adjudication records carry grader "adj", so they never collide with a base
 * record and are additive rather than superseding. Re-grades DO collide, by
 * design: that is how a repaired key replaces the cells it invalidated, without
 * ever editing the file that recorded what was graded against the OLD key.
 *
 * usage:
 *   node tools/tier3-grades.mjs --set v2 [--rep N] --check     gate: committed == derived
 *   node tools/tier3-grades.mjs --set v2 [--rep N] --write     regenerate the merged file
 *   node tools/tier3-grades.mjs --set v2 --status              what exists, what is missing
 *   node tools/tier3-grades.mjs --set v2 --extract-adj         one-time bootstrap
 *   node tools/tier3-grades.mjs --self-test
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const T3 = join(ROOT, 'tests', 'tier3');

export const KEY = (r) => `${r.scenario}|${r.sheet}|${r.field}|${r.grader}`;

/** Stable order so the derived file is byte-reproducible across machines. */
export function sortRows(rows) {
  return [...rows].sort((a, b) =>
    String(a.scenario).localeCompare(String(b.scenario))
    || Number(a.sheet) - Number(b.sheet)
    || String(a.field).localeCompare(String(b.field))
    || String(a.grader).localeCompare(String(b.grader)));
}

/**
 * Merge in precedence order. Returns the rows plus a supersession census, because
 * a re-grade that silently replaced nothing is the failure this tool exists to
 * prevent, and a count nobody printed is a count nobody checked.
 */
export function mergeGrades(sources) {
  const out = new Map();
  const superseded = [];
  for (const { name, rows } of sources) {
    for (const r of rows) {
      const k = KEY(r);
      if (out.has(k)) superseded.push({ key: k, by: name, from: out.get(k)._src });
      out.set(k, { ...r, _src: name });
    }
  }
  const rows = [...out.values()].map(({ _src, ...r }) => r);
  return { rows, superseded, count: rows.length };
}

function readJsonl(p) {
  return readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const writeJsonl = (p, rows) => writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

/** Discover the input files for a set and replicate, in precedence order. */
export function discover(dir, set, rep = 1) {
  const sfx = set === 'v1' ? '' : `-${set}`;
  const rsfx = rep > 1 ? `-r${rep}` : '';
  const stem = `grades${sfx}${rsfx}`;
  const all = existsSync(dir) ? readdirSync(dir) : [];
  const pick = (re) => all.filter((n) => re.test(n)).sort();
  return {
    merged: join(dir, `${stem}.jsonl`),
    base: pick(new RegExp(`^${stem}-g\\d+-batch-\\d+\\.jsonl$`)),
    regrade: pick(new RegExp(`^${stem}-.*regrade.*\\.jsonl$`)),
    adj: pick(new RegExp(`^${stem}-adj\\.jsonl$`)),
  };
}

function loadSources(dir, d) {
  const src = [];
  for (const group of [d.base, d.regrade, d.adj]) {
    for (const n of group) src.push({ name: n, rows: readJsonl(join(dir, n)) });
  }
  return src;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function run() {
  const set = arg('--set', 'v2');
  const rep = Number(arg('--rep', '1'));
  const d = discover(T3, set, rep);

  if (process.argv.includes('--status')) {
    console.log(`set ${set} replicate ${rep}`);
    console.log(`  base grader files : ${d.base.length}  ${d.base.join(', ') || '(none)'}`);
    console.log(`  regrade files     : ${d.regrade.length}  ${d.regrade.join(', ') || '(none)'}`);
    console.log(`  adjudication      : ${d.adj.length}  ${d.adj.join(', ') || '(none)'}`);
    console.log(`  merged            : ${existsSync(d.merged) ? `${readJsonl(d.merged).length} records` : 'ABSENT'}`);
    return 0;
  }

  if (process.argv.includes('--extract-adj')) {
    // One-time bootstrap. The adjudication records only ever existed inside the
    // merged file; this lifts them out so the merged file can be derived.
    if (!existsSync(d.merged)) { console.error(`no merged file at ${d.merged}`); return 2; }
    const merged = readJsonl(d.merged);
    const baseKeys = new Set(loadSources(T3, { ...d, regrade: [], adj: [] }).flatMap((s) => s.rows).map(KEY));
    const orphans = merged.filter((r) => !baseKeys.has(KEY(r)));
    const out = join(T3, `grades-${set}-adj.jsonl`);
    if (existsSync(out)) { console.error(`refusing to overwrite ${out}`); return 2; }
    writeJsonl(out, sortRows(orphans));
    console.log(`extracted ${orphans.length} record(s) present in the merged file but in no input file`);
    console.log(`  grader labels: ${JSON.stringify(orphans.reduce((m, r) => (m[r.grader] = (m[r.grader] || 0) + 1, m), {}))}`);
    console.log(`  -> ${out}`);
    return 0;
  }

  if (!d.base.length) { console.error(`no base grader files for set ${set} replicate ${rep}`); return 2; }
  const sources = loadSources(T3, d);
  const { rows, superseded } = mergeGrades(sources);
  const sorted = sortRows(rows);

  console.log(`inputs: ${d.base.length} base, ${d.regrade.length} regrade, ${d.adj.length} adjudication`);
  console.log(`derived ${sorted.length} records, ${superseded.length} superseded`);
  for (const s of superseded.slice(0, 10)) console.log(`  ${s.key}  ${s.from} -> ${s.by}`);
  if (superseded.length > 10) console.log(`  ... and ${superseded.length - 10} more`);

  if (process.argv.includes('--write')) {
    writeJsonl(d.merged, sorted);
    console.log(`wrote ${d.merged}`);
    return 0;
  }

  // --check: the committed file must equal the derived one, as a SET of records.
  // Compared by key rather than by bytes, because the committed file predates this
  // tool and carries no ordering guarantee; a byte compare would fail for a reason
  // that has nothing to do with provenance.
  if (!existsSync(d.merged)) { console.error(`no merged file at ${d.merged}`); return 1; }
  const committed = readJsonl(d.merged);
  const cMap = new Map(committed.map((r) => [KEY(r), r]));
  const dMap = new Map(sorted.map((r) => [KEY(r), r]));
  const onlyCommitted = [...cMap.keys()].filter((k) => !dMap.has(k));
  const onlyDerived = [...dMap.keys()].filter((k) => !cMap.has(k));
  const differing = [...dMap.entries()].filter(([k, r]) => cMap.has(k) && cMap.get(k).score !== r.score);

  for (const k of onlyCommitted.slice(0, 10)) console.log(`  ONLY IN COMMITTED  ${k}  (derivable from no input file)`);
  for (const k of onlyDerived.slice(0, 10)) console.log(`  ONLY IN DERIVED    ${k}`);
  for (const [k, r] of differing.slice(0, 10)) console.log(`  SCORE DIFFERS      ${k}  committed ${cMap.get(k).score} derived ${r.score}`);

  const ok = !onlyCommitted.length && !onlyDerived.length && !differing.length;
  console.log(`${ok ? 'PASS' : 'FAIL'} committed ${committed.length} records, derived ${sorted.length}`
    + `, only-committed ${onlyCommitted.length}, only-derived ${onlyDerived.length}, score-differs ${differing.length}`);
  return ok ? 0 : 1;
}

function selfTest() {
  let pass = 0; let fail = 0;
  const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ` (${d})` : ''}`); } };

  const base = [
    { scenario: 'S001', sheet: 1, field: 'primary', score: 1, grader: 'g1' },
    { scenario: 'S001', sheet: 1, field: 'primary', score: 0, grader: 'g2' },
    { scenario: 'S002', sheet: 2, field: 'lifecycle', score: 0.5, grader: 'g1' },
  ];
  const regrade = [{ scenario: 'S001', sheet: 1, field: 'primary', score: 0.5, grader: 'g1' }];
  const adj = [{ scenario: 'S001', sheet: 1, field: 'primary', score: 1, grader: 'adj' }];

  const plain = mergeGrades([{ name: 'base', rows: base }]);
  check('a base-only merge is the base', plain.count === 3 && plain.superseded.length === 0);

  const m = mergeGrades([{ name: 'base', rows: base }, { name: 'regrade', rows: regrade }]);
  check('a regrade SUPERSEDES the matching base cell', m.superseded.length === 1, `${m.superseded.length}`);
  check('the superseding score wins',
    m.rows.find((r) => r.scenario === 'S001' && r.grader === 'g1').score === 0.5);
  check('the other grader is untouched',
    m.rows.find((r) => r.scenario === 'S001' && r.grader === 'g2').score === 0);
  check('the record count does NOT grow on supersession', m.count === 3, `${m.count}`);

  const a = mergeGrades([{ name: 'base', rows: base }, { name: 'adj', rows: adj }]);
  check('an adjudication record is ADDITIVE, not superseding',
    a.count === 4 && a.superseded.length === 0, `${a.count} rows, ${a.superseded.length} superseded`);

  // MUST-FAIL: a merger that ignores precedence would return the base unchanged.
  // This is the shape of the bug that would silently discard a re-grade.
  const gutted = (sources) => ({ rows: sources[0].rows, superseded: [], count: sources[0].rows.length });
  const g = gutted([{ name: 'base', rows: base }, { name: 'regrade', rows: regrade }]);
  check('MUST FAIL: a merger that drops later sources is detectable',
    g.rows.find((r) => r.scenario === 'S001' && r.grader === 'g1').score !== 0.5);

  check('sortRows is stable and total',
    sortRows(base).map(KEY).join(',') === sortRows([...base].reverse()).map(KEY).join(','));

  const d = discover(T3, 'v2', 1);
  check('discovery finds the 12 committed v2 base files', d.base.length === 12, `${d.base.length}`);
  check('discovery does not confuse replicate 1 with replicate 2',
    discover(T3, 'v2', 2).base.length === 0, `${discover(T3, 'v2', 2).base.length}`);

  if (existsSync(d.merged) && d.base.length) {
    const committed = readJsonl(d.merged);
    const derived = mergeGrades(loadSources(T3, d));
    const cKeys = new Set(committed.map(KEY));
    const dKeys = new Set(derived.rows.map(KEY));
    const missing = [...cKeys].filter((k) => !dKeys.has(k));
    check(`the committed merged file is fully derivable (${derived.count} vs ${committed.length})`,
      missing.length === 0, `${missing.length} record(s) derivable from no input`);
  }

  console.log(`\n${fail === 0 ? 'SELF-TEST PASS' : 'SELF-TEST FAIL'} ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

if (IS_MAIN) process.exit(process.argv.includes('--self-test') ? selfTest() : run());
