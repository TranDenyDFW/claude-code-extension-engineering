/**
 * Check data/routing/skill-split.json against what is actually on disk.
 *
 *   node tools/split-map-check.mjs              # verify
 *   node tools/split-map-check.mjs --prove-fail # each invariant fed a known-bad map
 *
 * The map decides which of the four skills every reference file lands in. It was typed by hand from
 * a plan, and a plan is not the disk. A file assigned twice ships twice; a file assigned nowhere
 * vanishes at cutover and takes its claims with it. Neither is visible in a diff of 29 filenames.
 *
 * The invariants are the map's own, read from the file rather than restated here, so the map cannot
 * quietly stop claiming one.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* REVERTED EXPERIMENT: THIS TOOL DOES NOT RUN.
 *
 * The four-skill cutover it belongs to was undone in 32adbf3, because four skills invoked the
 * library LESS than one: 22 of 36 against 26 of 36, below a floor of 26 frozen before the run.
 * skills/ holds a single skill again and nothing in this repo or in .github/workflows calls this
 * file.
 *
 * The most misleading of the six: it exits 0 and prints PASS describing four skills and their
 * file assignments, because it validates data/routing/skill-split.json rather than the disk.
 * Those directories do not exist. A green gate describing a reverted layout is worse than a tool
 * that merely does nothing.
 *
 * It is kept as READABLE REFERENCE for how the experiment was built, not as a reproducible
 * harness. An independent reviewer pointed out that an earlier version of this comment claimed
 * the latter while the same commit edited these constants, which makes the claim false: running
 * this now would not rebuild what was measured. The reproducible apparatus is the tree at
 * 8123b95, immutably, and git is the right place for it. Set SPLIT_EXPERIMENT=1 to run this
 * deliberately, knowing it is no longer the measured configuration. */
if (process.env.SPLIT_EXPERIMENT !== '1') {
  console.error('split-map-check.mjs: the four-skill split was REVERTED in 32adbf3, and nothing calls this tool.');
  console.error('  skills/ holds one skill, so anything here about cc-ext-* describes a layout that is gone.');
  console.error('  Set SPLIT_EXPERIMENT=1 to run it deliberately.');
  process.exit(2);
}
const MAP = join(ROOT, 'data', 'routing', 'skill-split.json');
const REFS = join(ROOT, 'skills', 'claude-code-extension-engineering', 'references');

export function checkSplitMap(map, onDisk) {
  const problems = [];
  const skills = map.skills || {};
  const dup = (map.duplicatedIntoEverySkill || {}).files || [];

  const assigned = new Map();          // file -> [skills that claim it]
  for (const [skill, spec] of Object.entries(skills)) {
    for (const f of spec.files || []) {
      if (!assigned.has(f)) assigned.set(f, []);
      assigned.get(f).push(skill);
    }
  }

  for (const [f, owners] of assigned) {
    if (owners.length > 1) problems.push(`${f} is assigned to ${owners.length} skills: ${owners.join(', ')}`);
    if (dup.includes(f)) problems.push(`${f} is both assigned to ${owners.join(', ')} and duplicated into every skill`);
  }

  const claimed = new Set([...assigned.keys(), ...dup]);
  for (const f of onDisk) if (!claimed.has(f)) problems.push(`${f} is on disk and assigned nowhere; it would vanish at cutover`);
  for (const f of claimed) if (!onDisk.includes(f)) problems.push(`${f} is assigned but not on disk`);

  const words = new Map();
  for (const [skill, spec] of Object.entries(skills)) {
    for (const w of spec.ownsCollisionWords || []) {
      if (words.has(w)) problems.push(`collision word "${w}" is owned by both ${words.get(w)} and ${skill}`);
      words.set(w, skill);
    }
  }
  return problems;
}

const map = JSON.parse(readFileSync(MAP, 'utf8'));
const onDisk = existsSync(REFS) ? readdirSync(REFS).filter((f) => f.endsWith('.md')) : [];

if (process.argv.includes('--prove-fail')) {
  /* Each invariant gets a map that violates exactly it. A gate nobody has watched fail is a gate
     nobody should trust, and this one guards a migration that deletes the source tree. */
  const clone = () => JSON.parse(JSON.stringify(map));
  const cases = [];

  const a = clone();
  const first = Object.keys(a.skills)[0], second = Object.keys(a.skills)[1];
  a.skills[second].files.push(a.skills[first].files[0]);
  cases.push(['a file assigned to two skills', a]);

  const b = clone();
  b.skills[first].files.shift();
  cases.push(['a file on disk assigned nowhere', b]);

  const c = clone();
  c.skills[first].files.push('does-not-exist.md');
  cases.push(['a file assigned but absent from disk', c]);

  const d = clone();
  d.duplicatedIntoEverySkill.files.push(d.skills[first].files[0]);
  cases.push(['a file both assigned and duplicated', d]);

  const e = clone();
  const owner = Object.entries(e.skills).find(([, s]) => (s.ownsCollisionWords || []).length);
  const other = Object.keys(e.skills).find((k) => k !== owner[0]);
  e.skills[other].ownsCollisionWords = [owner[1].ownsCollisionWords[0]];
  cases.push(['a collision word owned twice', e]);

  let bad = 0;
  for (const [name, m] of cases) {
    const p = checkSplitMap(m, onDisk);
    const caught = p.length > 0;
    if (!caught) bad++;
    console.log(`${caught ? 'RED ' : 'GREEN'}  ${name}${caught ? `  -> ${p[0]}` : '  (SURVIVED: this invariant is unguarded)'}`);
  }
  console.log(`\n${cases.length} known-bad maps, ${cases.length - bad} caught, ${bad} survived`);
  process.exit(bad ? 1 : 0);
}

const problems = checkSplitMap(map, onDisk);
const total = Object.values(map.skills).reduce((n, s) => n + s.files.length, 0);
console.log(`${onDisk.length} reference files on disk`);
console.log(`${total} assigned to a single skill, ${(map.duplicatedIntoEverySkill.files || []).length} duplicated into every skill`);
for (const [skill, spec] of Object.entries(map.skills)) {
  console.log(`  ${skill.padEnd(36)} ${String(spec.files.length).padStart(2)} files  [${(spec.ownsCollisionWords || []).join(', ') || 'no collision word'}]`);
}
if (problems.length) {
  console.error(`\nFAIL: ${problems.length} problem(s)`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('\nPASS: every reference file is assigned exactly once, every assignment exists, no collision word is owned twice.');
