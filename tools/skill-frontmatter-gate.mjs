#!/usr/bin/env node
/**
 * The skill's OWN frontmatter, checked against the cap the skill documents.
 *
 * This exists because the description sat 573 characters past the ~1536 cap for the life of
 * the skill and nothing caught it. `extension-doctor.mjs` HAS the check, and CI runs that
 * doctor, but only as `--self-test`: its skill roots were `~/.claude/skills` and
 * `<project>/.claude/skills`, and this repo develops its skill at `skills/<name>/`, so the
 * doctor inspected zero skills here and still printed "All documented silent-failure
 * conditions absent". A reassuring sentence over an empty scan is the failure this
 * repository is about, one level up.
 *
 * The cost was not theoretical. The truncated tail held the ENTIRE "NOT for operating Claude
 * Code" exclusion list, so the exclusions never reached the model, and the subjects of four
 * reference files were named nowhere in the surviving text.
 *
 *   node tools/skill-frontmatter-gate.mjs              check
 *   node tools/skill-frontmatter-gate.mjs --prove-fail feed it known-bad input, require RED
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referenceDirs, skillDirs, stripSkillPrefix } from './skill-roots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const DESC_CAP = 1536;
/* Every skill's SKILL.md. After the split there are four descriptions competing for four
   budgets, and a gate that checks one of them passes while three are over cap. */
const SKILLS = skillDirs(ROOT).map((d) => join(d, 'SKILL.md'));
const SKILL = SKILLS[0] || join(ROOT, 'skills', 'claude-code-extension-engineering', 'SKILL.md');

/** Pull description and when_to_use out of the frontmatter block. */
export function frontmatterLengths(text) {
  const parts = text.split(/^---\s*$/m);
  if (parts.length < 3) throw new Error('no frontmatter block');
  const fm = parts[1];
  const grab = (k) => {
    const m = fm.match(new RegExp(`^${k}:\\s*"([\\s\\S]*?)"\\s*$`, 'm'))
      || fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'));
    if (!m) return '';
    return m[1].replace(/\\"/g, '"');
  };
  const description = grab('description');
  const when = grab('when_to_use');
  return { description: description.length, when_to_use: when.length, combined: description.length + when.length };
}

/** Every reference file's subject should be reachable from the description. */
export function subjectsMissing(descLower, terms) {
  return terms.filter((t) => !descLower.includes(t));
}

/* The subjects that have a whole reference file behind them. A file nobody can be routed to
   is content that cannot be reached, which is exactly what the benchmark measured. */
const REQUIRED_SUBJECTS = ['session', 'memory', 'status line', 'sandbox', 'permission', 'mcp', 'plugin', 'hook', 'subagent', 'agent sdk', 'environment variable', 'notification'];

/* Phrases that exist because a MEASURED failure needed them, so losing one to a future trim
   would silently reopen a defect that cost four benchmark runs to find. "notification" is in
   the subject list above for routing; this asserts the two clauses that fix the classification
   failure, where the model read a bare query as system output and answered nothing. */
const REQUIRED_PHRASES = [
  ['stop hook notification', 'the query that scored 0 across four runs and twelve passes without ever invoking'],
  ['is a QUESTION', 'the clause contradicting the belief that a bare noun phrase is system output'],
];

function check(text, label) {
  const problems = [];
  const len = frontmatterLengths(text);
  if (len.combined > DESC_CAP) {
    problems.push(`${label}: description plus when_to_use is ${len.combined} chars, past the ${DESC_CAP} cap; the tail is silently truncated out of triggering`);
  }
  const fm = text.split(/^---\s*$/m)[1];
  const missing = subjectsMissing(fm.toLowerCase(), REQUIRED_SUBJECTS);
  if (missing.length) problems.push(`${label}: the description never names ${missing.join(', ')}, so nothing routes those questions here`);
  for (const [phrase, why] of REQUIRED_PHRASES) {
    if (!fm.includes(phrase)) problems.push(`${label}: the description lost "${phrase}", which is ${why}`);
  }
  return problems;
}

if (process.argv.includes('--prove-fail')) {
  const good = readFileSync(SKILL, 'utf8');
  let bad = 0;
  const must = (name, ok) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) bad++; };

  must('the real skill passes, so a rejection below means something', check(good, 'real').length === 0);

  const padded = good.replace(/^(description:\s*")/m, `$1${'x'.repeat(DESC_CAP)} `);
  must('MUST FAIL: a description padded past the cap', check(padded, 'mutant').some((p) => /past the/.test(p)));

  /* Strip a subject that appears EXACTLY ONCE. The first version removed the session clause,
     but "how do I delete sessions" in the bare-symptom list still carried the term, so the
     mutant was a no-op and the harness said so rather than passing. */
  const dropped = good.replace(/\\"stop hook notification\\", /g, '');
  if (dropped === good) throw new Error('phrase mutant is a no-op: the anchor did not match');
  must('MUST FAIL: a measured-failure phrase trimmed out of the description', check(dropped, 'mutant').some((p) => /lost "stop hook notification"/.test(p)));

  const stripped = good.replace(/status lines, /g, '');
  if (stripped === good) throw new Error('subject mutant is a no-op: the anchor did not match');
  must('MUST FAIL: a reference subject dropped from the description', check(stripped, 'mutant').some((p) => /never names/.test(p)));

  console.log(bad ? `\nGATE CANNOT FAIL: ${bad} problem(s).` : '\nGATE CAN FAIL: every known-bad frontmatter was rejected.');
  process.exit(bad ? 1 : 0);
}

const problems = check(readFileSync(SKILL, 'utf8'), 'SKILL.md');
const len = frontmatterLengths(readFileSync(SKILL, 'utf8'));
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\nSKILL FRONTMATTER GATE FAILED: ${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`SKILL FRONTMATTER OK: ${len.combined} of ${DESC_CAP} chars used, ${DESC_CAP - len.combined} spare, all ${REQUIRED_SUBJECTS.length} reference subjects named.`);
