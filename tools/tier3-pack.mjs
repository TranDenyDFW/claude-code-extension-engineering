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
const ANSWER_DIR = join(ROOT, 'tests', 'tier3', 'answers');
const PACKET_DIR = join(ROOT, 'tests', 'tier3', 'packets');
const MAP_PATH = join(ROOT, 'tests', 'tier3', 'blinding-map.json');

/** The seven GRADED fields. `rejection_reason` is key-only, never graded. */
export const GRADED_FIELDS = KEY_FIELDS.filter(f => f !== 'rejection_reason');

/** Arm ids as they appear in answer filenames. Never in a packet. */
export const ARMS = ['b', 'bplus', 'd'];

const PERMUTATIONS = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

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
 * Blinding is only real if the packet cannot betray the mapping. Two ways it
 * could: an arm label left in a field name or value, or an `arm` key surviving
 * on a sheet. Both are checked against the serialized packet, so a future edit
 * that reintroduces either fails here rather than silently at grading time.
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
  for (const s of packet.scenarios) {
    if (s.sheets.length !== ARMS.length) {
      problems.push(`${s.id}: ${s.sheets.length} sheet(s), expected ${ARMS.length}`);
    }
    for (const sheet of s.sheets) {
      const extra = Object.keys(sheet).filter(k => k !== 'sheet' && !GRADED_FIELDS.includes(k) && k !== 'citations');
      if (extra.length) problems.push(`${s.id} sheet ${sheet.sheet}: unexpected field(s) ${extra.join(', ')}`);
    }
  }
  return [...new Set(problems)];
}

export function pack(scenarios, answersByArm) {
  const byBatch = new Map();
  const map = {};

  for (const [arm, sheets] of Object.entries(answersByArm)) {
    if (!ARMS.includes(arm)) throw new Error(`unknown arm: ${arm}`);
    for (const a of sheets) {
      if (!byBatch.has(a.batch)) byBatch.set(a.batch, new Map());
      const b = byBatch.get(a.batch);
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
        const sheet = { sheet: i + 1 };
        for (const f of GRADED_FIELDS) sheet[f] = src[f] ?? '';
        if (src.citations) sheet.citations = src.citations;
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
  const answers = {
    b: [mk('S001', 'B'), mk('S002', 'B')],
    bplus: [mk('S001', 'BP'), mk('S002', 'BP')],
    d: [mk('S001', 'D'), mk('S002', 'D')],
  };

  let bad = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
    if (!ok) bad++;
  };

  const { packets, map } = pack(scenarios, answers);
  check('packs one packet per batch', packets.length === 1, `${packets.length} packet(s)`);
  check('every scenario gets one sheet per arm', packets[0].scenarios.every(s => s.sheets.length === 3));
  check('clean packet has no blinding problems', blindingProblems(packets[0]).length === 0, blindingProblems(packets[0])[0] || '');

  const roundTrip = packets[0].scenarios.every(s =>
    s.sheets.every(sheet => {
      const arm = map[s.id][String(sheet.sheet)];
      const tag = { b: 'B', bplus: 'BP', d: 'D' }[arm];
      return sheet.primary === `${tag}-primary`;
    }));
  check('the blinding map un-blinds every sheet back to its arm', roundTrip);

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
const scenarios = loadScenarios();
const answersByArm = loadAnswers();
const armsPresent = Object.keys(answersByArm).sort();

if (!armsPresent.length) {
  console.log('No answer sheets in tests/tier3/answers/ yet. Nothing to pack.');
  process.exit(CHECK_ONLY ? 0 : 1);
}

const { packets, map } = pack(scenarios, answersByArm);
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
