/**
 * Step 3 of the split: COPY the reference files into the four new skill trees.
 *
 *   node tools/split-migrate.mjs            # verify only, writes nothing
 *   node tools/split-migrate.mjs --write    # copy, then verify every byte
 *
 * Copy, never move. Both trees coexist until the cutover commit, so every step between here and
 * there can be checked against a source that still exists. This repo lost a 177-page corpus to a
 * tool that wrote over its own inputs and regenerated the manifest that would have shown it; the
 * rule that came out of that is what this file implements.
 *
 * The manifest is the audit record: source, destination, sha256, per file. It is written BESIDE the
 * bytes it describes rather than only at the root, for the same reason.
 *
 * The new directories deliberately get NO SKILL.md here. skill-roots.mjs discovers a skill by the
 * presence of that file, so until step 7 writes them the new trees are invisible to every tool and
 * the gates stay byte-identical to the step-0 baseline. That is what makes this step safe to land
 * on its own.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MAP = JSON.parse(readFileSync(join(ROOT, 'data', 'routing', 'skill-split.json'), 'utf8'));
const SRC = join(ROOT, 'skills', 'claude-code-extension-engineering', 'references');
const WRITE = process.argv.includes('--write');

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** file -> [every skill that should receive it] */
export function plan(map) {
  const out = new Map();
  const add = (f, s) => { if (!out.has(f)) out.set(f, []); out.get(f).push(s); };
  for (const [skill, spec] of Object.entries(map.skills)) for (const f of spec.files) add(f, skill);
  for (const f of map.duplicatedIntoEverySkill.files) for (const skill of Object.keys(map.skills)) add(f, skill);
  return out;
}

const wanted = plan(MAP);
const rows = [];
let copied = 0, already = 0, mismatch = 0;

for (const [file, skills] of [...wanted].sort()) {
  const src = join(SRC, file);
  if (!existsSync(src)) { console.error(`MISSING SOURCE: ${file}`); process.exit(1); }
  const srcSha = sha(src);
  for (const skill of skills) {
    const dstDir = join(ROOT, 'skills', skill, 'references');
    const dst = join(dstDir, file);
    if (WRITE) {
      mkdirSync(dstDir, { recursive: true });
      /* Never overwrite silently: if a destination exists and differs, that is a second edit that
         would be lost, and losing it quietly is the whole failure class. */
      if (existsSync(dst) && sha(dst) !== srcSha) {
        console.error(`REFUSING: ${skill}/${file} exists and differs from the source; resolve it by hand`);
        process.exit(9);
      }
      if (!existsSync(dst)) { copyFileSync(src, dst); copied++; } else already++;
    }
    const ok = existsSync(dst) && sha(dst) === srcSha;
    if (!ok) mismatch++;
    rows.push({ file, skill, src: `skills/claude-code-extension-engineering/references/${file}`,
      dst: `skills/${skill}/references/${file}`, sha256: srcSha, verified: ok });
  }
}

console.log(`${wanted.size} source files -> ${rows.length} destinations across ${Object.keys(MAP.skills).length} skills`);
if (WRITE) console.log(`copied ${copied}, already present and identical ${already}`);
console.log(`sha256 verified: ${rows.filter((r) => r.verified).length} of ${rows.length}`);

if (mismatch) {
  console.error(`\nFAIL: ${mismatch} destination(s) missing or not byte-identical to their source`);
  for (const r of rows.filter((x) => !x.verified).slice(0, 10)) console.error(`  ${r.dst}`);
  process.exit(1);
}

if (WRITE) {
  for (const skill of Object.keys(MAP.skills)) {
    const mine = rows.filter((r) => r.skill === skill);
    const dir = join(ROOT, 'skills', skill, 'references');
    writeFileSync(join(dir, 'COPY-MANIFEST.json'), JSON.stringify({
      what: `Reference files copied into ${skill} at the split. Source tree still exists; this is a copy, not a move.`,
      sourceSkill: 'claude-code-extension-engineering',
      files: mine.length,
      entries: mine.map(({ file, src, dst, sha256 }) => ({ file, src, dst, sha256 })),
    }, null, 2) + '\n');
  }
  console.log(`manifests written beside the bytes, one per skill`);
}
console.log('\nPASS: every destination is byte-identical to its source.');
