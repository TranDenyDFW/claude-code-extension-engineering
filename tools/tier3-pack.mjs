#!/usr/bin/env node
/**
 * Tier 3 step 2: turn per-arm answer sheets into blinded grader packets.
 *
 *   node tools/tier3-pack.mjs              write packets + blinding-map.json
 *   node tools/tier3-pack.mjs --check      re-derive and verify, write nothing
 *   node tools/tier3-pack.mjs --self-test  fixtures, including must-fail cases
 *
 * Why this exists. The 2026-07-30 run recorded that graders saw "three
 * anonymous answer sheets whose order rotates per scenario id, so position
 * never encodes the arm". Like the keys-stripped claim, that was a description
 * of intent with nothing enforcing it. Here the packet is an artifact: the arm
 * labels are removed and the mapping lives in exactly one file that no grader
 * reads, so blinding can be checked after the fact instead of trusted.
 *
 * Position is assigned by a deterministic permutation of the scenario id, not a
 * rotation. A rotation preserves relative order (arm 1 always precedes arm 2
 * cyclically), which a grader who noticed could invert. Permuting reaches all
 * six orderings and leaks nothing.
 *
 * Self-reporting: prints per-batch counts and exits non-zero on any problem.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadScenarios, KEY_FIELDS } from './tier3-strip.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SET = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : 'v1';
const SFX = SET === 'v2' ? '-v2' : '';
const ANSWER_DIR = join(ROOT, 'tests', 'tier3', `answers${SFX}`);
const PACKET_DIR = join(ROOT, 'tests', 'tier3', `packets${SFX}`);
const MAP_PATH = join(ROOT, 'tests', 'tier3', `blinding-map${SFX}.json`);

/**
 * v2 grading batches are a SEEDED SHUFFLE of the scenario ids instead of the
 * natural S001..S010 blocks. In v1 each batch was exactly one focus area and
 * each batch had exactly one grader, so grader strictness and topic were
 * perfectly confounded; one grader's batch manufactured the retracted
 * headline. Shuffling breaks the confound; the fixed seed keeps the packing
 * reproducible and --check-able.
 */
export function shuffledBatches(ids, size = 10) {
  let h = 0x9e3779b9;
  const rand = () => {
    h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0;
    return h / 0x100000000;
  };
  const a = [...ids].sort();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const out = [];
  for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
  return out;
}

/** The seven GRADED fields. `rejection_reason` is key-only, never graded. */
export const GRADED_FIELDS = KEY_FIELDS.filter(f => f !== 'rejection_reason');

/**
 * Arm ids as they appear in answer filenames. Never in a packet.
 *
 * Arm A is the calibration anchor, added after the pilot. Three docs-holding
 * arms all landed at 93 to 97 percent, which leaves less headroom than the
 * decision margin needs, and nothing in that data distinguishes "the graders
 * were lenient" from "these scenarios saturate for anything holding the docs".
 * An unaided arm separates those: near its historical 71 percent means the
 * ceiling is real, up at 90 percent means the rubric is loose.
 */
export const ARMS = ['a', 'b', 'bplus', 'd'];

function allPermutations(n) {
  if (n <= 1) return [[0]];
  const out = [];
  for (const sub of allPermutations(n - 1)) {
    for (let i = 0; i <= sub.length; i++) {
      out.push([...sub.slice(0, i), n - 1, ...sub.slice(i)]);
    }
  }
  return out;
}

const PERMUTATIONS = allPermutations(ARMS.length);

/** FNV-1a over the scenario id. Deterministic across runs and machines. */
export function permutationFor(id) {
  let h = 0x811c9dc5;
  for (const ch of String(id)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return PERMUTATIONS[h % PERMUTATIONS.length];
}

/**
 * Blinding is only real if the packet cannot betray the mapping.
 *
 * The obvious tell is an arm label surviving on a sheet. The one that actually
 * shipped was subtler and an independent review caught it: arm B is never asked
 * to cite, so its sheet was the ONLY one carrying no `citations` object, and a
 * grader could pick out the baseline arm on every scenario at 20 of 20
 * precision and recall. The old version whitelisted `citations` as benign, and
 * the fixtures built every arm with the same key set, so the check could not
 * fail on the real shape.
 *
 * The invariant is therefore structural, not a list of forbidden words: every
 * sheet in a packet carries exactly `sheet` plus the seven graded fields, and
 * nothing else. Any per-arm difference in SHAPE is a tell no matter how
 * innocent the field looks. Citations are dropped at pack time; the citation
 * rate is computed from the answer files, which graders never see.
 */
export function blindingProblems(packet) {
  const problems = [];
  const text = JSON.stringify(packet).toLowerCase();
  for (const arm of ARMS) {
    for (const marker of [`"arm"`, `"${arm}"`, `arm_${arm}`, `arm-${arm}`]) {
      if (text.includes(marker.toLowerCase())) {
        problems.push(`packet for batch ${packet.batch} contains the marker ${marker}, so a grader could read the arm off the sheet`);
      }
    }
  }
  const EXPECTED = ['sheet', ...GRADED_FIELDS].sort().join(',');
  for (const s of packet.scenarios) {
    if (s.sheets.length !== ARMS.length) {
      problems.push(`${s.id}: ${s.sheets.length} sheet(s), expected ${ARMS.length}`);
    }
    for (const sheet of s.sheets) {
      const got = Object.keys(sheet).sort().join(',');
      if (got !== EXPECTED) {
        const extra = Object.keys(sheet).filter(k => k !== 'sheet' && !GRADED_FIELDS.includes(k));
        const missing = ['sheet', ...GRADED_FIELDS].filter(k => !(k in sheet));
        problems.push(`${s.id} sheet ${sheet.sheet}: key set differs from every other sheet${extra.length ? `, extra: ${extra.join(', ')}` : ''}${missing.length ? `, missing: ${missing.join(', ')}` : ''}. A structural difference identifies the arm.`);
      }
    }
  }
  return [...new Set(problems)];
}

export function pack(scenarios, answersByArm, regroup = null) {
  const byBatch = new Map();
  const map = {};

  // regroup: array of id-arrays (from shuffledBatches) that overrides the
  // answer files' own batch numbers for GRADING purposes. Answering batches
  // and grading batches no longer need to coincide, and in v2 they must not.
  const batchOf = id => {
    if (!regroup) return null;
    const i = regroup.findIndex(g => g.includes(id));
    return i >= 0 ? i + 1 : null;
  };

  for (const [arm, sheets] of Object.entries(answersByArm)) {
    if (!ARMS.includes(arm)) throw new Error(`unknown arm: ${arm}`);
    for (const a of sheets) {
      const batch = regroup ? batchOf(a.id) : a.batch;
      if (batch === null) throw new Error(`scenario ${a.id} not present in the regroup plan`);
      if (!byBatch.has(batch)) byBatch.set(batch, new Map());
      const b = byBatch.get(batch);
      if (!b.has(a.id)) b.set(a.id, {});
      b.get(a.id)[arm] = a;
    }
  }

  const packets = [];
  for (const batch of [...byBatch.keys()].sort((x, y) => x - y)) {
    const rows = [];
    for (const [id, perArm] of [...byBatch.get(batch).entries()].sort()) {
      const scenario = scenarios.find(s => s.id === id);
      if (!scenario) throw new Error(`answer references unknown scenario ${id}`);
      const order = permutationFor(id).map(i => ARMS[i]).filter(a => perArm[a]);
      const sheets = order.map((arm, i) => {
        const src = perArm[arm];
        // Exactly these keys, in this order, for every arm. Citations are
        // deliberately NOT carried through: a grader does not need them, and
        // only two arms are asked to produce them, so passing them along
        // labels the other arms by omission.
        const sheet = { sheet: i + 1 };
        for (const f of GRADED_FIELDS) sheet[f] = src[f] ?? '';
        return sheet;
      });
      map[id] = Object.fromEntries(order.map((arm, i) => [String(i + 1), arm]));
      rows.push({
        id,
        focus: scenario.focus,
        scenario: scenario.scenario,
        key: Object.fromEntries(KEY_FIELDS.map(f => [f, scenario[f]])),
        sheets,
      });
    }
    packets.push({ batch, scenarios: rows });
  }
  return { packets, map };
}

function loadAnswers() {
  if (!existsSync(ANSWER_DIR)) return {};
  const out = {};
  for (const file of readdirSync(ANSWER_DIR).filter(f => f.endsWith('.json')).sort()) {
    const m = file.match(/^(.+)-batch-(\d+)\.json$/);
    if (!m) {
      console.error(`FAIL: ${file} does not match <arm>-batch-<n>.json`);
      process.exit(1);
    }
    const [, arm, batch] = m;
    const parsed = JSON.parse(readFileSync(join(ANSWER_DIR, file), 'utf8'));
    const rows = (parsed.answers || []).map(a => ({ ...a, batch: Number(batch) }));
    out[arm] = (out[arm] || []).concat(rows);
  }
  return out;
}

// ---------------------------------------------------------------- self-test --

function selfTest() {
  const scenarios = [
    { id: 'S001', focus: 'enforcement', scenario: 'need one', primary: 'p1', rejected_alternative: 'r1', rejection_reason: 'why1', enforcement_owner: 'harness', context_boundary: 'main', lifecycle: 'event', failure_mode: 'open', version_caveat: 'none' },
    { id: 'S002', focus: 'delegation', scenario: 'need two', primary: 'p2', rejected_alternative: 'r2', rejection_reason: 'why2', enforcement_owner: 'model', context_boundary: 'isolated', lifecycle: 'spawn', failure_mode: 'closed', version_caveat: 'v2' },
  ];
  const mk = (id, tag) => ({ id, batch: 1, ...Object.fromEntries(GRADED_FIELDS.map(f => [f, `${tag}-${f}`])) });
  // Two arms carry citations and two do not, exactly as the real run does.
  // The previous fixtures gave every arm the same key set, which is why the
  // shape-based tell survived the self-test and reached an independent review.
  const withCites = o => ({ ...o, citations: { lifecycle: 'https://code.claude.com/docs/en/x' } });
  const answers = {
    a: [mk('S001', 'A'), mk('S002', 'A')],
    b: [mk('S001', 'B'), mk('S002', 'B')],
    bplus: [withCites(mk('S001', 'BP')), withCites(mk('S002', 'BP'))],
    d: [withCites(mk('S001', 'D')), withCites(mk('S002', 'D'))],
  };

  let bad = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
    if (!ok) bad++;
  };

  const { packets, map } = pack(scenarios, answers);
  check('packs one packet per batch', packets.length === 1, `${packets.length} packet(s)`);
  check('every scenario gets one sheet per arm', packets[0].scenarios.every(s => s.sheets.length === ARMS.length));
  check('clean packet has no blinding problems', blindingProblems(packets[0]).length === 0, blindingProblems(packets[0])[0] || '');

  // The defect an independent review found: arm B is the only arm never asked
  // to cite, so carrying citations through made its sheet the only one without
  // them, identifying the baseline arm on every scenario.
  const anyCitations = packets[0].scenarios.some(s => s.sheets.some(sh => 'citations' in sh));
  check('citations never reach a packet, so the arms that cite are not marked', !anyCitations);
  const keySets = new Set(packets[0].scenarios.flatMap(s => s.sheets.map(sh => Object.keys(sh).sort().join(','))));
  check('every sheet in a packet has an identical key set', keySets.size === 1, `${keySets.size} distinct key set(s)`);

  const roundTrip = packets[0].scenarios.every(s =>
    s.sheets.every(sheet => {
      const arm = map[s.id][String(sheet.sheet)];
      const tag = { a: 'A', b: 'B', bplus: 'BP', d: 'D' }[arm];
      return sheet.primary === `${tag}-primary`;
    }));
  check('the blinding map un-blinds every sheet back to its arm', roundTrip);

  const shapeTell = JSON.parse(JSON.stringify(packets[0]));
  shapeTell.scenarios[0].sheets[1].citations = { lifecycle: 'https://code.claude.com/docs/en/x' };
  check('a lone extra field on ONE sheet is caught as a structural tell',
    blindingProblems(shapeTell).some(p => /key set differs/.test(p)));

  // The threat the map exists to prevent: position encoding the arm. If every
  // scenario put the same arm in slot 1, blinding would be decorative.
  const slot1 = new Set(Object.values(map).map(m => m['1']));
  check('slot 1 is not always the same arm across the set', slot1.size > 1, `slot-1 arms: ${[...slot1].join(', ')}`);

  const leaky = JSON.parse(JSON.stringify(packets[0]));
  leaky.scenarios[0].sheets[0].arm = 'd';
  check('a leaked arm label on a sheet is caught', blindingProblems(leaky).length > 0);

  const short = JSON.parse(JSON.stringify(packets[0]));
  short.scenarios[0].sheets.pop();
  check('a missing sheet is caught', blindingProblems(short).length > 0);

  const perms = new Set(['S001', 'S002', 'S010', 'S033', 'S047', 'S060'].map(id => permutationFor(id).join('')));
  check('permutation is deterministic and varies by id', perms.size > 1, `${perms.size} distinct ordering(s) over 6 ids`);
  check('permutation is stable across calls', permutationFor('S038').join('') === permutationFor('S038').join(''));
  check('permutation space covers every ordering of the arms',
    PERMUTATIONS.length === [1, 1, 2, 6, 24, 120][ARMS.length], `${PERMUTATIONS.length} orderings for ${ARMS.length} arms`);

  // v2 grading batches: seeded shuffle must be deterministic, cover every id
  // exactly once, and actually break the focus-area blocks.
  const ids60 = Array.from({ length: 60 }, (_, i) => 'S' + String(i + 1).padStart(3, '0'));
  const sh1 = shuffledBatches(ids60), sh2 = shuffledBatches(ids60);
  check('shuffledBatches is deterministic', JSON.stringify(sh1) === JSON.stringify(sh2));
  check('shuffledBatches covers all 60 ids exactly once',
    sh1.flat().length === 60 && new Set(sh1.flat()).size === 60 && sh1.length === 6);
  const natural = ids60.slice(0, 10).join(',');
  check('shuffle breaks the natural focus blocks', sh1.every(b => [...b].sort().join(',') !== natural));
  const mk2 = (id, tag, batch) => ({ id, batch, ...Object.fromEntries(GRADED_FIELDS.map(f => [f, `${tag}-${f}`])) });
  const re = pack(
    [ { id: 'S001', focus: 'a', scenario: 's1', primary: 'p', rejected_alternative: 'r', rejection_reason: 'rr', enforcement_owner: 'e', context_boundary: 'c', lifecycle: 'l', failure_mode: 'f', version_caveat: 'v' },
      { id: 'S002', focus: 'b', scenario: 's2', primary: 'p', rejected_alternative: 'r', rejection_reason: 'rr', enforcement_owner: 'e', context_boundary: 'c', lifecycle: 'l', failure_mode: 'f', version_caveat: 'v' } ],
    { a: [mk2('S001', 'A', 1), mk2('S002', 'A', 1)], b: [mk2('S001', 'B', 1), mk2('S002', 'B', 1)],
      bplus: [mk2('S001', 'BP', 1), mk2('S002', 'BP', 1)], d: [mk2('S001', 'D', 1), mk2('S002', 'D', 1)] },
    [['S002'], ['S001']]);
  check('regroup overrides the answer files own batch numbers',
    re.packets.length === 2 && re.packets[0].scenarios[0].id === 'S002' && re.packets[1].scenarios[0].id === 'S001');

  console.log(bad
    ? `SELF-TEST FAIL: ${bad} check(s) failed`
    : 'SELF-TEST PASS: packets carry no arm labels, the map un-blinds them, and both leak shapes are caught.');
  process.exit(bad ? 1 : 0);
}

// --------------------------------------------------------------------- main --

// Same guard as tier3-strip.mjs, and for the same reason: tier3-score.mjs
// imports GRADED_FIELDS and ARMS from here, and without this the import re-runs
// main() with the importer's argv. That is how `tier3-score --self-test` first
// ran THIS file's self-test to completion and reported PASS.
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) main();

function main() {
const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTest();

const CHECK_ONLY = argv.includes('--check');
const scenPath = SET === 'v2' ? join(ROOT, 'tests', 'architecture-scenarios-v2.jsonl') : undefined;
const scenarios = scenPath ? loadScenarios(scenPath) : loadScenarios();
const answersByArm = loadAnswers();
const armsPresent = Object.keys(answersByArm).sort();

if (!armsPresent.length) {
  console.log('No answer sheets in tests/tier3/answers/ yet. Nothing to pack.');
  // A committed blinding map with no answers behind it is drift, not an empty
  // start: the map claims a packing that nothing can reproduce. The scorer
  // already guarded its equivalent case; an independent review found this one
  // passing, so it now fails the same way.
  if (CHECK_ONLY && existsSync(MAP_PATH)) {
    console.log('FAIL: blinding-map.json is committed but there are no answers to re-derive it from.');
    process.exit(1);
  }
  process.exit(CHECK_ONLY ? 0 : 1);
}

const regroup = SET === 'v2' ? shuffledBatches(scenarios.map(s => s.id)) : null;
const { packets, map } = pack(scenarios, answersByArm, regroup);
const problems = packets.flatMap(blindingProblems);

console.log(`Arms: ${armsPresent.join(', ')}  packets: ${packets.length}  scenarios: ${packets.reduce((n, p) => n + p.scenarios.length, 0)}`);
if (problems.length) {
  console.log(`\nFAIL: ${problems.length} blinding problem(s).`);
  for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
  process.exit(1);
}
console.log('PASS: no packet carries an arm label, and every scenario has one sheet per arm present.');

if (CHECK_ONLY) {
  if (!existsSync(MAP_PATH)) {
    console.log('FAIL: blinding-map.json is missing, so the committed packets cannot be un-blinded.');
    process.exit(1);
  }
  const onDisk = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
  if (JSON.stringify(onDisk) !== JSON.stringify(map)) {
    console.log('FAIL: blinding-map.json does not match what the answers and scenario ids derive.');
    process.exit(1);
  }
  console.log('PASS: the committed blinding map matches the derived one.');
  process.exit(0);
}

mkdirSync(PACKET_DIR, { recursive: true });
for (const p of packets) {
  writeFileSync(join(PACKET_DIR, `batch-${p.batch}.json`), JSON.stringify(p, null, 2) + '\n');
}
writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n');
console.log(`Wrote ${packets.length} packet(s) to tests/tier3/packets/ and the blinding map.`);
process.exit(0);
}
