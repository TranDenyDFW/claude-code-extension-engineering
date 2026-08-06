#!/usr/bin/env node
/**
 * Consolidate the n=10 fidelity sweep into one record.
 *
 * The sweep ran in four batches because three HARNESS bugs were found and fixed
 * mid-flight. Only results produced by the FIXED observer are admitted; a class
 * measured by a known-broken instrument is not evidence even when the number it
 * produced happens to be right. Provenance is recorded per class so a reader can
 * see which batch each number came from.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const OUT = join(REPO, 'tests', 'tier4', 'fidelity-n10-final.json');

/**
 * Which log is AUTHORITATIVE for which class, and why.
 * tmp/n10.log is the first sweep: valid for round 2 only, because the two
 * observer bugs (marker filename, hardcoded target) affected round 1 alone.
 */
const SOURCES = [
  ['tmp/n10-fix.log', ['stdout-json-deny', 'exit2-deny', 'matcher-wildcard'], 'batch 2, after the marker-filename fix'],
  ['tmp/n10-f8.log', ['near-miss'], 'batch 3, after the per-case-target fix'],
  ['tmp/n10-rest.log', ['matcher-scoping', 'fail-open-on-crash', 'permission-deny-edit', 'permission-deny-write-inert'], 'batch 4, re-measured because their original pass came from a broken observer'],
  ['tmp/n10.log', ['timeout-fails-open', 'timeout-within-budget', 'settings-scope-merge', 'if-filter-matches', 'if-filter-excludes', 'http-handler-unreachable', 'user-prompt-submit-exit2'], 'batch 1, round 2 only, unaffected by both observer bugs'],
];

const ROW = /^(\S[\w-]*)\s+([12])\s+(models|unmodelled)\s+(\d+)\/(\d+)\s+(yes|NO)/;

const rows = [];
for (const [file, classes, provenance] of SOURCES) {
  const p = join(REPO, file);
  if (!existsSync(p)) { console.error(`missing ${file}`); process.exit(1); }
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(ROW);
    if (!m || !classes.includes(m[1])) continue;
    rows.push({
      class: m[1], round: Number(m[2]), simulator: m[3],
      agreed: Number(m[4]), passes: Number(m[5]), deterministic: m[6] === 'yes',
      provenance, source_log: file,
    });
  }
}

const expected = SOURCES.flatMap(([, c]) => c);
const got = rows.map((r) => r.class);
const missing = expected.filter((c) => !got.includes(c));
const dupes = got.filter((c, i) => got.indexOf(c) !== i);
if (missing.length || dupes.length) {
  console.error(`FAIL missing=${missing.join(',') || 'none'} duplicates=${dupes.join(',') || 'none'}`);
  process.exit(1);
}

const modelled = rows.filter((r) => r.simulator === 'models');
const unmodelled = rows.filter((r) => r.simulator === 'unmodelled');
const out = {
  generated: new Date().toISOString(),
  cli_version: '2.1.219 (Claude Code)',
  passes_per_class: 10,
  classes: rows.length,
  total_sessions_counted: rows.length * 10,
  modelled: { classes: modelled.length, fully_agreeing: modelled.filter((r) => r.agreed === r.passes).length },
  unmodelled: { classes: unmodelled.length, consistent: unmodelled.filter((r) => r.agreed === r.passes).length },
  nondeterministic: rows.filter((r) => !r.deterministic).map((r) => r.class),
  note: 'Only results from the FIXED observer are admitted. Three harness bugs were found and fixed during the sweep; see tests/results-prove-bench.md.',
  rows: rows.sort((a, b) => a.round - b.round || a.class.localeCompare(b.class)),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2));

console.log(`${'class'.padEnd(29)} rnd sim         n=10   det`);
for (const r of out.rows) {
  console.log(`${r.class.padEnd(29)} ${r.round}   ${r.simulator.padEnd(11)} ${r.agreed}/${r.passes}  ${r.deterministic ? 'yes' : 'NO'}`);
}
console.log(`\nmodelled classes fully agreeing : ${out.modelled.fully_agreeing}/${out.modelled.classes}`);
console.log(`unmodelled measured consistently: ${out.unmodelled.consistent}/${out.unmodelled.classes}`);
console.log(`nondeterministic classes        : ${out.nondeterministic.length ? out.nondeterministic.join(', ') : 'none'}`);
console.log(`\nwrote ${OUT}`);
