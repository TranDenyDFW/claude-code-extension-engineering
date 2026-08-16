/**
 * Where the skills are, for every tool that reads them.
 *
 * Five tools each hardcoded `skills/claude-code-extension-engineering`. Splitting one skill into
 * four means every one of them would otherwise read a fraction of the tree and report a confident
 * number about it, which is the failure this repo already has a name for: a check that cannot fail
 * because it never looked. `extension-doctor.mjs` did exactly that on this project once, printing
 * "All documented silent-failure conditions absent" while scanning zero skills.
 *
 * Discovery is by CONTENT, not by name: a directory under skills/ holding a SKILL.md is a skill.
 * A list of names would have to be edited in lockstep with the split, and a stale entry there fails
 * silently in the same direction as the bug this replaces.
 *
 * While the tree still holds one skill this returns one directory, so every tool's output is
 * byte-identical to before. That is the point of doing it first: the generalisation is provably
 * inert until the tree changes under it.
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute paths of every skill directory, sorted, so callers are deterministic. */
export function skillDirs(root = REPO_ROOT) {
  const base = join(root, 'skills');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((n) => join(base, n))
    .filter((d) => { try { return statSync(d).isDirectory() && existsSync(join(d, 'SKILL.md')); } catch { return false; } })
    .sort();
}

/** Every skill's references directory that actually exists. */
export function referenceDirs(root = REPO_ROOT) {
  return skillDirs(root).map((d) => join(d, 'references')).filter((d) => existsSync(d));
}

/** The skill name a path belongs to, or null. Used to strip `skills/<name>/` prefixes. */
export function skillNameOf(relPath) {
  const m = String(relPath).replace(/\\/g, '/').match(/(?:^|\/)skills\/([^/]+)\//);
  return m ? m[1] : null;
}

/** Strip a leading `skills/<any-skill>/` so a claim's `file` can be compared across the split. */
export function stripSkillPrefix(relPath) {
  return String(relPath).replace(/\\/g, '/').replace(/^skills\/[^/]+\//, '');
}

/** Names only, for messages. */
export function skillNames(root = REPO_ROOT) {
  return skillDirs(root).map((d) => basename(d));
}
