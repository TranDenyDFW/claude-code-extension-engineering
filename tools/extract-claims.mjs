#!/usr/bin/env node
/**
 * Mechanical extraction of evidence-tagged claims from the reference files.
 *
 * Emits one JSON line per tagged claim to stdout (or to the file given as
 * argv[2] with --out). Extraction only: no source attribution, no judgment.
 * Attribution happens in a separate pass and lands in evidence/claims.jsonl.
 *
 *   node tools/extract-claims.mjs                 print to stdout
 *   node tools/extract-claims.mjs --out FILE      write to FILE
 *
 * A claim id is CLM-<file-stem>-<line>, stable as long as the line does not
 * move. tools/verify-evidence.mjs re-runs this extraction and diffs it against
 * evidence/claims.jsonl, so a moved or edited claim line is a detected drift,
 * not a silent one.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { skillDirs } from './skill-roots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
/* Every skill, discovered by content. Hardcoding one directory means that after the split this
   would extract a quarter of the claims and report the count with total confidence. While the tree
   holds one skill the result is identical, which is what makes this change safe to land first. */

const TAG_RE = /\[(OFFICIAL|ENGINEERING|COMMUNITY|ANTHROPIC|EXPERIMENTAL|LEGACY|DEPRECATED|ENGINEERING BEST PRACTICE|ANTHROPIC RECOMMENDATION|COMMUNITY PRACTICE)\]|\[v(\d+\.\d+\.\d+)\]/g;

export function extract() {
  const files = [];
  for (const skillDir of skillDirs(ROOT)) {
    const refDir = join(skillDir, 'references');
    if (existsSync(refDir)) {
      for (const f of readdirSync(refDir).filter((x) => x.endsWith('.md')).sort()) files.push(join(refDir, f));
    }
    files.push(join(skillDir, 'SKILL.md'));
  }

  const claims = [];
  for (const abs of files) {
    const rel = abs.substring(ROOT.length + 1).replace(/\\/g, '/');
    const stem = basename(abs, '.md');
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const tags = [];
      const versions = [];
      let m;
      TAG_RE.lastIndex = 0;
      while ((m = TAG_RE.exec(line)) !== null) {
        if (m[1]) tags.push(m[1]);
        if (m[2]) versions.push(m[2]);
      }
      if (tags.length === 0 && versions.length === 0) return;
      claims.push({
        id: `CLM-${stem}-${String(i + 1).padStart(3, '0')}`,
        file: rel,
        line: i + 1,
        text: line.trim().replace(/^[-|*\d.\s]+/, '').slice(0, 400),
        tags: [...new Set(tags)],
        versions: [...new Set(versions)],
      });
    });
  }
  return claims;
}

// CLI entry only; as a module (verify-evidence.mjs imports extract) stay silent.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, '\\');
if (isMain) {
  const claims = extract();
  const out = claims.map(c => JSON.stringify(c)).join('\n') + '\n';
  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    writeFileSync(process.argv[outIdx + 1], out, 'utf8');
    console.error(`extracted ${claims.length} tagged claims`);
  } else {
    process.stdout.write(out);
    console.error(`extracted ${claims.length} tagged claims`);
  }
}
