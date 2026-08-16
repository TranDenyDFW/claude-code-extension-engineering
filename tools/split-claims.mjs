/**
 * Step 4 of the split: write evidence/claims.split.jsonl.
 *
 *   node tools/split-claims.mjs            # report only
 *   node tools/split-claims.mjs --write    # write the split ledger
 *
 * ONLY the `file` field changes, plus the six ids stemmed from SKILL.md, which becomes four files.
 * Everything else is carried through byte for byte, and the tool asserts that rather than trusting
 * it: 563 records in, 563 out, 557 ids untouched, every non-file field identical.
 *
 * This exists because rekey-claims.mjs pairs claims by an exact `c.file` string. After a directory
 * change every claim reports vanished and every line reports new, and `--write` then writes
 * `[...unchanged, ...moved]`, which is an EMPTY FILE. That would destroy 563 hand-made
 * attributions. Producing the re-pathed ledger mechanically, and diffing it field by field, is the
 * alternative to running that tool across a move it was never designed for.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MAP = JSON.parse(readFileSync(join(ROOT, 'data', 'routing', 'skill-split.json'), 'utf8'));
const SRC = join(ROOT, 'evidence', 'claims.jsonl');
const DST = join(ROOT, 'evidence', 'claims.split.jsonl');
const WRITE = process.argv.includes('--write');

/** reference filename -> owning skill (duplicated files resolve to null: they carry no claims) */
export function ownerOf(map) {
  const own = new Map();
  for (const [skill, spec] of Object.entries(map.skills)) for (const f of spec.files) own.set(f, skill);
  for (const f of map.duplicatedIntoEverySkill.files) own.set(f, null);
  return own;
}

export function repath(rows, map) {
  const own = ownerOf(map);
  const out = [];
  const problems = [];
  let idsChanged = 0;

  for (const r of rows) {
    const file = String(r.file).replace(/\\/g, '/');
    const name = basename(file);
    const next = { ...r };

    if (name === 'SKILL.md') {
      const skill = (map.skillMdClaims || {})[r.id];
      if (!skill) { problems.push(`${r.id} comes from SKILL.md and has no assignment in skillMdClaims`); continue; }
      const stem = map.skills[skill].claimStem;
      next.file = `skills/${skill}/SKILL.md`;
      next.id = r.id.replace(/^CLM-SKILL-/, `CLM-${stem}-SKILL-`);
      if (next.id !== r.id) idsChanged++;
    } else {
      const skill = own.get(name);
      if (skill === undefined) { problems.push(`${r.id}: ${name} is not in the split map at all`); continue; }
      if (skill === null) { problems.push(`${r.id}: ${name} is a duplicated file and was supposed to carry ZERO claims`); continue; }
      next.file = `skills/${skill}/references/${name}`;
    }
    out.push(next);
  }
  return { out, problems, idsChanged };
}

const rows = readFileSync(SRC, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const { out, problems, idsChanged } = repath(rows, MAP);

/* Field-by-field, because "I only changed one field" is exactly the kind of claim that is easy to
   believe and cheap to check. */
let fieldDrift = 0;
for (let i = 0; i < Math.min(rows.length, out.length); i++) {
  for (const k of Object.keys(rows[i])) {
    if (k === 'file') continue;
    if (k === 'id' && basename(String(rows[i].file)) === 'SKILL.md') continue;
    if (JSON.stringify(rows[i][k]) !== JSON.stringify(out[i][k])) {
      fieldDrift++;
      if (fieldDrift <= 3) console.error(`  drift: ${rows[i].id} field ${k}`);
    }
  }
}

const bySkill = {};
for (const r of out) { const s = r.file.split('/')[1]; bySkill[s] = (bySkill[s] || 0) + 1; }

console.log(`in  ${rows.length} claims`);
console.log(`out ${out.length} claims, ${idsChanged} ids re-stemmed, ${out.length - idsChanged} unchanged`);
for (const [s, n] of Object.entries(bySkill).sort()) console.log(`  ${s.padEnd(36)} ${String(n).padStart(3)}`);
console.log(`non-file field drift: ${fieldDrift}`);

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 10)) console.error('  ' + p);
  process.exit(1);
}
if (out.length !== rows.length || fieldDrift) {
  console.error('\nFAIL: a record count or a non-file field moved; this transform changes ONLY file and the six SKILL ids');
  process.exit(1);
}
const ids = new Set(out.map((r) => r.id));
if (ids.size !== out.length) { console.error('\nFAIL: duplicate claim ids after re-stemming'); process.exit(1); }

if (WRITE) {
  writeFileSync(DST, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\nwrote ${DST}`);
}
console.log('\nPASS: every claim re-pathed, nothing else touched, ids still unique.');
