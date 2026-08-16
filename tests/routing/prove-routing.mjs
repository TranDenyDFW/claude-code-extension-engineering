/**
 * PROVE THE ROUTING GATE CAN FAIL, mutant by mutant, each rejected by its NAMED code.
 *
 * Two artifacts can break, so both get mutated: the routing SURFACE (SKILL.md and INDEX.md
 * plus the reference files) and the FIXTURE map. A gate proven only against one of them is
 * half a proof.
 *
 * The rule that makes this worth anything is copied from tools/capability-catalog.mjs: a
 * mutant counts as rejected ONLY when the gate raises the code the mutant declares. Rejected
 * by a different rule scores WRONG GATE and counts as survived, because "it went red" is not
 * evidence the gate saw what you broke.
 */
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run-routing-tests.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SKILL = join(ROOT, 'skills', 'claude-code-extension-engineering');
const MAP = join(HERE, 'routing-map.jsonl');

const SURFACE_MUTANTS = [
  { label: 'the INDEX row sending a never-fires hook question to hooks.md is deleted', expect: 'ROUTE_UNREACHABLE',
    mutate: (d) => edit(join(d, 'references', 'INDEX.md'), (t) => t.replace(/^\| A hook is configured but never runs .*$/m, '').replace(/^\| "&lt;event&gt; hook not working.*$/m, '').replace(/^\| A Stop or SubagentStop hook runs.*$/m, '')) },
  { label: 'that row is repointed at the decoy', expect: 'ROUTE_DECOY_OUTRANKS',
    mutate: (d) => edit(join(d, 'references', 'INDEX.md'), (t) => t
      .replace(/^\| A hook is configured but never runs .*$/m, '| A hook is configured but never runs, and it is a long specific row that outranks the others | [monitors.md](monitors.md) |')
      .replace(/^\| "&lt;event&gt; hook not working.*$/m, '').replace(/^\| A Stop or SubagentStop hook runs.*$/m, '')) },
  { label: 'hooks.md is gutted, keeping its filename and title', expect: 'ROUTE_DEST_LACKS_ANSWER',
    mutate: (d) => edit(join(d, 'references', 'hooks.md'), (t) => t.split('\n').slice(0, 1).join('\n') + '\n') },
  { label: 'the disambiguation section is deleted from the decoy', expect: 'ROUTE_DECOY_UNGUARDED',
    mutate: (d) => edit(join(d, 'references', 'monitors.md'), (t) => t.replace(/## Read this first[\s\S]*?(?=\n## )/, '')) },
  { label: 'every mention of the observability page is removed from the routing surface', expect: 'OOS_NO_POINTER',
    mutate: (d) => { for (const f of ['SKILL.md']) edit(join(d, f), (t) => t.replace(/monitoring-usage/g, 'REMOVED')); edit(join(d, 'references', 'INDEX.md'), (t) => t.replace(/monitoring-usage/g, 'REMOVED')); } },
  { label: 'hooks.md is renamed while INDEX.md still links it', expect: 'ROUTE_DEST_MISSING',
    mutate: (d) => renameSync(join(d, 'references', 'hooks.md'), join(d, 'references', 'hook.md')) },
];

const FIXTURE_MUTANTS = [
  { label: 'the answer key is broadened until it also matches the decoy', expect: 'ROUTE_ANSWER_KEY_MATCHES_DECOY',
    mutate: (rows) => rows.map((r) => (r.id === 'R-hook-never-fires' ? { ...r, answer_key: 'hook' } : r)) },
  { label: 'a fixture is stripped of its decoy, so it asserts nothing', expect: 'FIXTURE_NO_DECOY',
    mutate: (rows) => rows.map((r) => (r.id === 'R-hook-never-fires' ? { ...r, decoys: [] } : r)) },
  { label: 'a fixture id is duplicated', expect: 'FIXTURE_DUP_ID',
    mutate: (rows) => [...rows, { ...rows[0] }] },
  /* The mutant that matters most: you must not be able to repair a red gate by REDEFINING
     the right answer to be the wrong file. Expected ROUTE_DEST_LACKS_ANSWER at first, and
     the gate raised ROUTE_ANSWER_KEY_MATCHES_DECOY instead. The gate is right: once the
     destination IS the decoy, the fixture can no longer tell them apart, which is a more
     precise statement of the defect than "the file lacks the answer". Expectation corrected
     to what the gate actually proves, not the other way round. */
  { label: 'GQ-55 is redefined from out-of-scope to point at the decoy itself', expect: 'ROUTE_ANSWER_KEY_MATCHES_DECOY',
    mutate: (rows) => rows.map((r) => (r.id === 'R-otel-observability'
      ? { ...r, expect: { kind: 'reference', files: ['monitors.md'] }, answer_key: 'CLAUDE_CODE_ENABLE_TELEMETRY' } : r)) },
  /* And separately, the plain case: a destination that genuinely lacks the answer. */
  { label: 'the destination is repointed at a file that does not contain the key', expect: 'ROUTE_DEST_LACKS_ANSWER',
    mutate: (rows) => rows.map((r) => (r.id === 'R-hook-never-fires'
      ? { ...r, expect: { kind: 'reference', files: ['themes.md'] }, decoys: [{ file: 'monitors.md', must_guard: false }] } : r)) },
  { label: 'a fixture is stripped of its provenance', expect: 'FIXTURE_UNSOURCED',
    mutate: (rows) => rows.map((r) => (r.id === 'R-hook-never-fires' ? { ...r, provenance: undefined } : r)) },
];

function edit(p, fn) { writeFileSync(p, fn(readFileSync(p, 'utf8'))); }

export async function proveRoutingGate() {
  const tmp = mkdtempSync(join(ROOT, 'tmp', 'route-pf-'));
  let survived = 0; let checked = 0;
  const ok = (label, got, expect) => {
    checked++;
    if (!got.length) { survived++; console.log(`  SURVIVED  ${label}  <- no code raised`); }
    else if (!got.includes(expect)) { survived++; console.log(`  WRONG GATE  ${label}  expected ${expect}, got ${[...new Set(got)].join(',')}`); }
    else console.log(`  rejected  ${label}  [${expect}]`);
  };
  try {
    const base = run();
    if (base.problems.length) {
      console.log(`CANNOT PROVE: the committed routing map already fails its own gate (${base.problems.flatMap((p) => p.codes).join(', ')}).`);
      console.log('Every mutant below would be "rejected" by that pre-existing failure, which proves nothing.');
      console.log('Fix the skill first, then re-run this.');
      return 1;
    }
    console.log(`  ok        the committed surface and fixtures pass, so a rejection below means something`);

    for (const [i, m] of SURFACE_MUTANTS.entries()) {
      const d = join(tmp, `s${i}`);
      cpSync(SKILL, d, { recursive: true });
      m.mutate(d);
      ok(m.label, run({ skillDir: d }).problems.flatMap((p) => p.codes), m.expect);
    }
    const rows = readFileSync(MAP, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    for (const [i, m] of FIXTURE_MUTANTS.entries()) {
      const p = join(tmp, `f${i}.jsonl`);
      writeFileSync(p, m.mutate(JSON.parse(JSON.stringify(rows))).map((r) => JSON.stringify(r)).join('\n') + '\n');
      ok(m.label, run({ mapPath: p }).problems.flatMap((x) => x.codes), m.expect);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  if (survived) { console.log(`\nROUTING GATE IS HOLLOW: ${survived} of ${checked} mutants were not rejected by the expected gate`); return 1; }
  console.log(`\nROUTING GATE CAN FAIL: all ${checked} mutants were rejected by the gate that names them.`);
  return 0;
}

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) process.exit(await proveRoutingGate());
