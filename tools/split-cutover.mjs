/**
 * Step 9 of the split: the cutover. This is the irreversible one.
 *
 *   node tools/split-cutover.mjs            # dry run: report every action, change nothing
 *   node tools/split-cutover.mjs --write
 *
 * It does four things and refuses if any precondition is not met:
 *
 *   1. swaps the ledgers, claims.split.jsonl -> claims.jsonl and questions.split.jsonl -> questions.jsonl
 *   2. re-points every documentation path from the single skill to the skill that now owns the file
 *   3. makes tests/routing/prove-routing.mjs skill-agnostic
 *   4. DELETES skills/claude-code-extension-engineering
 *
 * Preconditions, checked before anything is written, because the delete is the last act and a
 * half-finished cutover is worse than either state:
 *
 *   - both split ledgers exist and are non-empty
 *   - all four skills exist with a SKILL.md
 *   - the split ledger's claim count equals the live ledger's, so nothing is gained or lost
 *   - every reference file in the old tree exists in exactly one new tree, byte for byte
 *
 * The old tree is deleted rather than left in place because two trees means two answers to every
 * question and a duplicate-across-scopes finding for each skill. It is recoverable from git; that
 * is what makes deleting it the right call rather than a brave one.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* REVERTED EXPERIMENT: THIS TOOL DOES NOT RUN.
 *
 * The four-skill cutover it belongs to was undone in 32adbf3, because four skills invoked the
 * library LESS than one: 22 of 36 against 26 of 36, below a floor of 26 that was frozen before
 * the run. skills/ holds a single skill again, nothing in this repo or in .github/workflows
 * calls this file, and any cc-ext-* loop inside it now iterates an EMPTY SET, so its checks
 * report success having examined nothing.
 *
 * It is kept rather than deleted because it is the apparatus of a measured negative, and
 * deleting it would make that measurement harder to reproduce. Set SPLIT_EXPERIMENT=1 to run it
 * deliberately. */
if (process.env.SPLIT_EXPERIMENT !== '1') {
  console.error('split-cutover.mjs: the four-skill split was REVERTED in 32adbf3, and nothing calls this tool.');
  console.error('  skills/ holds one skill, so any cc-ext-* loop here iterates an empty set.');
  console.error('  Set SPLIT_EXPERIMENT=1 to run it deliberately.');
  process.exit(2);
}
const MAP = JSON.parse(readFileSync(join(ROOT, 'data', 'routing', 'skill-split.json'), 'utf8'));
const OLD = join(ROOT, 'skills', 'claude-code-extension-engineering');
const WRITE = process.argv.includes('--write');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const owner = new Map();
for (const [skill, spec] of Object.entries(MAP.skills)) for (const f of spec.files) owner.set(f, skill);
const DUP_HOME = 'cc-ext-delegation-and-instructions';
for (const f of MAP.duplicatedIntoEverySkill.files) owner.set(f, DUP_HOME);

const fail = [];
const claimsSplit = join(ROOT, 'evidence', 'claims.split.jsonl');
const qSplit = join(ROOT, 'tests', 'questions.split.jsonl');
const claimsLive = join(ROOT, 'evidence', 'claims.jsonl');
const qLive = join(ROOT, 'tests', 'questions.jsonl');

for (const p of [claimsSplit, qSplit, claimsLive, qLive]) if (!existsSync(p)) fail.push(`missing ${p}`);
const count = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).length;
if (!fail.length) {
  if (count(claimsSplit) !== count(claimsLive)) fail.push(`claims: split has ${count(claimsSplit)}, live has ${count(claimsLive)}; the split must neither add nor drop`);
  if (count(qSplit) !== count(qLive)) fail.push(`questions: split has ${count(qSplit)}, live has ${count(qLive)}`);
}
for (const skill of Object.keys(MAP.skills)) if (!existsSync(join(ROOT, 'skills', skill, 'SKILL.md'))) fail.push(`${skill} has no SKILL.md`);

if (existsSync(OLD)) {
  for (const f of readdirSync(join(OLD, 'references')).filter((x) => x.endsWith('.md'))) {
    const homes = MAP.duplicatedIntoEverySkill.files.includes(f)
      ? Object.keys(MAP.skills) : [owner.get(f)];
    if (!homes[0]) { fail.push(`${f} has no home in the split map`); continue; }
    const src = sha(join(OLD, 'references', f));
    for (const h of homes) {
      const dst = join(ROOT, 'skills', h, 'references', f);
      if (!existsSync(dst)) fail.push(`${f} is missing from ${h}`);
      else if (sha(dst) !== src) fail.push(`${f} in ${h} is not byte-identical to the old tree`);
    }
  }
}

if (fail.length) {
  console.error(`REFUSING TO CUT OVER: ${fail.length} precondition(s) unmet`);
  for (const f of fail.slice(0, 12)) console.error('  ' + f);
  process.exit(1);
}
console.log('preconditions: ledgers present and equal in size, four skills present, every reference file byte-identical in its new home');

/* Documentation paths. A path naming a reference file re-points to the skill that owns it; a path
   naming the skill directory itself has no single successor, so it becomes the skills/ root and is
   reported for a human to read. */
const DOCS = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'IMPROVEMENTS.md', 'docs/RESULTS.md', 'docs/SUBMISSION.md', 'SPLIT-STATUS.md'];
let edits = 0; const ambiguous = [];
for (const rel of DOCS) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  const before = readFileSync(p, 'utf8');
  let after = before.replace(/skills\/claude-code-extension-engineering\/references\/([a-z0-9-]+\.md)/g,
    (m, f) => (owner.has(f) ? `skills/${owner.get(f)}/references/${f}` : m));
  after = after.replace(/skills\/claude-code-extension-engineering\/SKILL\.md/g, 'skills/cc-ext-*/SKILL.md');
  after = after.replace(/skills\/claude-code-extension-engineering\//g, 'skills/cc-ext-*/');
  if (after !== before) {
    edits++;
    if (/skills\/cc-ext-\*\//.test(after)) ambiguous.push(rel);
    if (WRITE) writeFileSync(p, after);
  }
}
console.log(`documentation: ${edits} file(s) re-pointed${ambiguous.length ? `; ${ambiguous.join(', ')} now contain a skills/cc-ext-*/ wildcard a human should read` : ''}`);

const PR = join(ROOT, 'tests', 'routing', 'prove-routing.mjs');
if (existsSync(PR)) {
  const before = readFileSync(PR, 'utf8');
  const after = before.replace(
    "const SKILL = join(ROOT, 'skills', 'claude-code-extension-engineering');",
    "/* Any skill: the routing surface is per skill and there are four of them now. */\nconst SKILL = join(ROOT, 'skills', readdirSync(join(ROOT, 'skills')).filter((d) => existsSync(join(ROOT, 'skills', d, 'SKILL.md'))).sort()[0]);");
  if (after !== before) { if (WRITE) writeFileSync(PR, after); console.log('prove-routing.mjs: rooted at the first skill it finds rather than a name'); }
}

if (WRITE) {
  copyFileSync(claimsSplit, claimsLive);
  copyFileSync(qSplit, qLive);
  rmSync(claimsSplit); rmSync(qSplit);
  console.log('ledgers swapped in, split copies removed');
  rmSync(OLD, { recursive: true, force: true });
  console.log(`deleted ${OLD}`);
} else {
  console.log('\nDRY RUN. Nothing written. Re-run with --write.');
}
