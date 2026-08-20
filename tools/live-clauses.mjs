#!/usr/bin/env node
/**
 * live-clauses.mjs - read the shared description clauses from the LIVE skill, never from a copy.
 *
 * WHY THIS EXISTS
 * ---------------
 * tools/split-skillmd.mjs held a hardcoded copy of the exclusion clause ending "Name the page and
 * stop." while the live description had moved to "Answer; name the page.". SKILL.md records the
 * stop-reading as a rule about SILENCE that LOST two blind pairwise comparisons to an arm carrying
 * no relevant library at all, so the copy was not merely stale, it preserved the losing
 * instruction, in a tool that REBUILDS skill descriptions from that constant.
 *
 * A detector for such copies was written and then defeated by an independent reviewer four times,
 * once per design: hand-written markers, markers plus a retired-phrase list, sentence probes, and
 * probes plus template-literal scanning. Each fix closed one hole and left another. The copies are
 * the problem, so the copies go. tools/description-copy-check.mjs remains as a backstop for
 * anything that reintroduces one.
 *
 * Exports throw rather than returning a default. A silent fallback here would recreate the exact
 * failure this file exists to remove: a tool proceeding with text that is not the description.
 */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..');

/** The live frontmatter description, unescaped from its YAML scalar. */
export function liveDescription(root = REPO) {
  const p = join(root, 'skills', 'claude-code-extension-engineering', 'SKILL.md');
  const line = readFileSync(p, 'utf8').split('\n').find((l) => l.startsWith('description:'));
  if (!line) throw new Error(`no description line in ${p}`);
  return JSON.parse(line.slice('description:'.length).trim());
}

/** The exclusion clause: from "NOT for operating" to the end of the description. */
export function exclusions(root = REPO) {
  const d = liveDescription(root);
  const i = d.indexOf('NOT for operating');
  if (i < 0) throw new Error('the live description no longer carries a NOT-for clause');
  return d.slice(i);
}

/** One sentence of the description, located by a distinctive fragment. */
export function sentenceContaining(fragment, root = REPO) {
  const d = liveDescription(root);
  const parts = d.split(/(?<=\.)\s+/).map((s) => s.trim());
  const hit = parts.find((s) => s.includes(fragment));
  if (!hit) throw new Error(`no description sentence contains ${JSON.stringify(fragment)}`);
  return hit;
}
