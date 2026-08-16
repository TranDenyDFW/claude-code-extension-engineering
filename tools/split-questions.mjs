/**
 * Step 6 of the split: write tests/questions.split.jsonl.
 *
 *   node tools/split-questions.mjs [--write]
 *
 * 262 rows in, 262 out. Only `source_file` changes.
 *
 * Three groups, and the middle one is a judgement the plan called "hand assignment":
 *
 *   - rows sourced from a reference file: follow that file to its skill. Mechanical.
 *   - N### rows, "which reference covers X": follow the reference their answer key NAMES, which is
 *     the file that answers them. Mechanical.
 *   - R### and X### rows: these assert that the DESCRIPTION carries a phrase. After the split there
 *     are four descriptions, and the shared clauses appear in ALL FOUR by construction, so every
 *     one of these rows is satisfied by every skill. Assigning them to one skill is arbitrary but
 *     harmless; what actually protects them is the shared-clause identity check below, which is
 *     stronger than four copies of the same question because it fails when the copies DIVERGE.
 *
 * The clauses those rows guard were measured: GQ-03 went from 0 of 9 to 5 of 5 on the bare-symptom
 * clause alone. A copy drifting in one of four skills is a measurable regression.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillDirs } from './skill-roots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MAP = JSON.parse(readFileSync(join(ROOT, 'data', 'routing', 'skill-split.json'), 'utf8'));
const SRC = join(ROOT, 'tests', 'questions.jsonl');
const DST = join(ROOT, 'tests', 'questions.split.jsonl');
const WRITE = process.argv.includes('--write');

/* Where description-level rows live. Arbitrary by admission: they hold for all four. */
const CANONICAL = 'cc-ext-delegation-and-instructions';

const owner = new Map();
for (const [skill, spec] of Object.entries(MAP.skills)) for (const f of spec.files) owner.set(f, skill);
const duplicated = new Set(MAP.duplicatedIntoEverySkill.files);

const rows = readFileSync(SRC, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const out = [];
const tally = { fromReference: 0, byAnswerKey: 0, descriptionLevel: 0 };
const problems = [];

for (const r of rows) {
  const src = String(r.source_file).replace(/\\/g, '/');
  const name = basename(src);
  const next = { ...r };

  if (name !== 'SKILL.md') {
    const skill = owner.get(name) || (duplicated.has(name) ? CANONICAL : null);
    if (!skill) { problems.push(`${r.id}: ${name} is not in the split map`); continue; }
    next.source_file = `skills/${skill}/references/${name}`;
    tally.fromReference++;
  } else {
    const named = [...String(r.answer_key || '').matchAll(/([a-z0-9-]+\.md)/g)].map((m) => m[1]);
    const target = named.find((f) => owner.has(f));
    if (target) {
      next.source_file = `skills/${owner.get(target)}/SKILL.md`;
      tally.byAnswerKey++;
    } else {
      next.source_file = `skills/${CANONICAL}/SKILL.md`;
      tally.descriptionLevel++;
    }
  }
  out.push(next);
}

/* The check that does the real work: the shared clauses must be IDENTICAL in all four
   descriptions. Four copies of a question assigned to one skill would not catch divergence; this
   does, and it is the thing the R### rows were really protecting. */
const CLAUSES = [
  'A bare noun phrase is a QUESTION, not system output to acknowledge.',
  'They presuppose it can, and often it cannot.',
  'Use when choosing between these mechanisms, writing one, or diagnosing one that will not load, fire, or behave.',
  'NOT for operating Claude Code rather than extending it',
  'Name the page and stop.',
];
const descs = {};
for (const d of skillDirs(ROOT)) {
  const n = basename(d);
  if (!n.startsWith('cc-ext-')) continue;
  const line = readFileSync(join(d, 'SKILL.md'), 'utf8').split('\n').find((l) => l.startsWith('description:'));
  descs[n] = JSON.parse(line.slice('description:'.length).trim());
}
let clauseFail = 0;
for (const c of CLAUSES) {
  const missing = Object.entries(descs).filter(([, d]) => !d.includes(c)).map(([n]) => n);
  if (missing.length) { clauseFail++; console.error(`  CLAUSE MISSING from ${missing.join(', ')}: "${c.slice(0, 60)}..."`); }
}

console.log(`in  ${rows.length} questions`);
console.log(`out ${out.length}: ${tally.fromReference} follow their reference file, ${tally.byAnswerKey} follow the reference their answer key names, ${tally.descriptionLevel} are description-level`);
console.log(`shared clauses present in all ${Object.keys(descs).length} descriptions: ${CLAUSES.length - clauseFail} of ${CLAUSES.length}`);

if (problems.length) { console.error(`\nFAIL: ${problems.length} problem(s)`); for (const p of problems.slice(0, 8)) console.error('  ' + p); process.exit(1); }
if (out.length !== rows.length) { console.error('\nFAIL: row count moved'); process.exit(1); }
if (clauseFail) { console.error('\nFAIL: a shared clause is not in every description; the copies have diverged'); process.exit(1); }

if (WRITE) { writeFileSync(DST, out.map((r) => JSON.stringify(r)).join('\n') + '\n'); console.log(`\nwrote ${DST}`); }
console.log('\nPASS: every question re-homed, row count unchanged, shared clauses identical across all four descriptions.');
