#!/usr/bin/env node
/**
 * DESCRIPTION COPY CHECK: no tool may hold a stale copy of a skill-description clause.
 *
 * WHY THIS EXISTS
 * ---------------
 * The frontmatter description is the only text that is ALWAYS in context, so it is the one string
 * in this repo whose exact wording has been measured repeatedly. It is also capped at 1536
 * characters with 3 to spare, which means every future edit to it is a SUBSTITUTION, and a
 * substitution is exactly the edit that leaves copies elsewhere stale.
 *
 * That is not hypothetical. tools/split-skillmd.mjs held a hardcoded copy of the exclusion clause
 * ending "Name the page and stop." while the live description had moved to "Answer; name the
 * page.". SKILL.md records the stop-reading as a rule about SILENCE that LOST two blind pairwise
 * comparisons to an arm carrying no relevant library at all. The copy was therefore not merely out
 * of date, it preserved the losing instruction, and the tool that held it REBUILDS skill files
 * from that constant. Nothing caught it, because nothing was looking.
 *
 * WHAT IT CHECKS
 * --------------
 * Every string literal in tools/*.mjs that carries a MARKER phrase from the live description must
 * be a substring of that description. A marker is a phrase distinctive enough that its presence
 * means the literal is quoting the description rather than coincidentally sharing words.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not forbid copies. A copy that MATCHES is fine, and forbidding them would fail on the
 * frozen-phrase list in skill-frontmatter-gate.mjs and the claimed_by strings in
 * trigger-collision.mjs, both of which quote the description on purpose. Only DIVERGENCE fails.
 *
 *   node tools/description-copy-check.mjs              check
 *   node tools/description-copy-check.mjs --self-test  fixtures, including must-fail cases
 *   node tools/description-copy-check.mjs --prove-fail mutate a REAL tool and require a failure
 *
 * exit: 0 clean, 1 a divergent copy was found, 2 cannot check
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SKILL = join(ROOT, 'skills', 'claude-code-extension-engineering', 'SKILL.md');
const SELF = 'description-copy-check.mjs';

/**
 * Phrases that only occur because someone is quoting the description.
 *
 * Kept short and distinctive on purpose. A marker that is too generic ("Claude Code") would flag
 * every tool in the repo; one that is too specific would miss the next copy.
 */
export const MARKERS = [
  'NOT for operating Claude Code',
  'is a QUESTION, not system output',
  'Use when choosing between these mechanisms',
  'ALSO for IMPERATIVE build requests',
  'ALSO for a BARE SYMPTOM',
];

/** The live description, unescaped from its YAML scalar. */
export function liveDescription(root = ROOT) {
  const line = readFileSync(join(root, 'skills', 'claude-code-extension-engineering', 'SKILL.md'), 'utf8')
    .split('\n').find((l) => l.startsWith('description:'));
  if (!line) return null;
  try { return JSON.parse(line.slice('description:'.length).trim()); } catch { return null; }
}

/**
 * String literals in a source file, with their 1-based line numbers.
 *
 * Single and double quoted only. Template literals are not scanned: nothing in this repo builds a
 * description clause from one, and including them would need real parsing to avoid matching
 * interpolations.
 */
export function literalsOf(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
      const raw = m[1] !== undefined ? m[1] : m[2];
      if (raw && raw.length >= 20) out.push({ line: i + 1, text: raw.replace(/\\'/g, "'").replace(/\\"/g, '"') });
    }
  }
  return out;
}

/** Divergent copies: literals that quote the description but do not match it. */
export function divergences(files, description) {
  const bad = [];
  for (const { name, src } of files) {
    for (const lit of literalsOf(src)) {
      if (!MARKERS.some((mk) => lit.text.includes(mk))) continue;
      if (description.includes(lit.text)) continue;
      bad.push({ file: name, line: lit.line, text: lit.text });
    }
  }
  return bad;
}

function readTools(root = ROOT) {
  const dir = join(root, 'tools');
  return readdirSync(dir)
    .filter((n) => n.endsWith('.mjs') && n !== SELF)
    .map((n) => ({ name: `tools/${n}`, src: readFileSync(join(dir, n), 'utf8') }));
}

// ------------------------------------------------------------------ self-test

function selfTest() {
  let fails = 0; let ran = 0;
  const ok = (label, cond, detail) => { ran++; if (!cond) fails++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${cond ? '' : `  (${detail || ''})`}`); };
  const DESC = 'Building a thing. NOT for operating Claude Code rather than extending it: telemetry. Answer; name the page.';

  ok('a matching copy passes',
    divergences([{ name: 't.mjs', src: `const X = 'NOT for operating Claude Code rather than extending it: telemetry. Answer; name the page.';` }], DESC).length === 0);

  ok('MUST FAIL on a diverged copy',
    divergences([{ name: 't.mjs', src: `const X = 'NOT for operating Claude Code rather than extending it: telemetry. Name the page and stop.';` }], DESC).length === 1);

  ok('a literal with no marker is ignored, however long',
    divergences([{ name: 't.mjs', src: `const X = 'some unrelated sentence that is quite long indeed and mentions nothing';` }], DESC).length === 0);

  ok('short literals are ignored',
    literalsOf(`const X = 'tiny';`).length === 0);

  ok('double-quoted literals are scanned too',
    divergences([{ name: 't.mjs', src: `const X = "NOT for operating Claude Code rather than extending it: nope.";` }], DESC).length === 1);

  ok('the reported line number is the literal\'s own line',
    divergences([{ name: 't.mjs', src: `\n\nconst X = 'NOT for operating Claude Code rather than extending it: nope.';` }], DESC)[0].line === 3);

  ok('an escaped quote inside a literal does not truncate it',
    literalsOf(`const X = 'it\\'s a fairly long literal with an escape';`).length === 1);

  console.log(`\nSELF-TEST ${fails ? 'FAIL' : 'PASS'} (${ran - fails}/${ran} checks)`);
  return fails ? 1 : 0;
}

// ------------------------------------------------------------------ prove-fail

/**
 * Wire the gate to the REAL tools directory and require it to reject a real mutant.
 *
 * The self-test proves the judgement on fixtures. This proves the gate as it is actually wired,
 * which is a different claim: a gate can be correct in the abstract and still read the wrong
 * directory, or filter out the very file that matters.
 */
function proveFail() {
  const desc = liveDescription();
  if (!desc) { console.error('cannot read the live description'); return 2; }

  const target = join(ROOT, 'tools', 'split-skillmd.mjs');
  const original = readFileSync(target, 'utf8');
  let bad = 0;

  const mutants = [
    { label: 'the historical drift, restored', from: 'install and login. Answer; name the page.', to: 'install and login. Name the page and stop.' },
    { label: 'a single word changed inside a quoted clause', from: 'NOT for operating Claude Code rather than extending it', to: 'NOT for operating Claude Code rather than extend it' },
  ];

  try {
    for (const m of mutants) {
      if (!original.includes(m.from)) { console.log(`  SKIPPED  ${m.label} (anchor absent)`); bad++; continue; }
      writeFileSync(target, original.replace(m.from, m.to));
      const found = divergences(readTools(), desc);
      const caught = found.some((d) => d.file.endsWith('split-skillmd.mjs'));
      console.log(`  ${caught ? 'rejected' : 'SURVIVED'}  ${m.label}`);
      if (!caught) bad++;
      writeFileSync(target, original);
    }
  } finally {
    writeFileSync(target, original);
  }

  const restored = readFileSync(target, 'utf8') === original;
  console.log(`  tree restored: ${restored}`);
  if (!restored) bad++;

  const clean = divergences(readTools(), desc).length === 0;
  console.log(`  gate clean again after restore: ${clean}`);
  if (!clean) bad++;

  console.log(bad ? '\nDESCRIPTION COPY GATE IS HOLLOW: a mutant survived' : '\nDESCRIPTION COPY GATE CAN FAIL: every mutant was rejected.');
  return bad ? 1 : 0;
}

// ------------------------------------------------------------------ main

if (IS_MAIN) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  if (argv.includes('--prove-fail')) process.exit(proveFail());

  const desc = liveDescription();
  if (!desc) { console.error('CANNOT CHECK: no parseable description in ' + SKILL); process.exit(2); }

  const bad = divergences(readTools(), desc);
  if (bad.length) {
    for (const d of bad) {
      console.error(`DESCRIPTION_COPY_DIVERGED  ${d.file}:${d.line}`);
      console.error(`  copy: ${d.text}`);
    }
    console.error(`\nDESCRIPTION COPY FAIL: ${bad.length} literal(s) quote the description but do not match it.`);
    console.error('The description is capped and every edit to it is a substitution, so a copy that');
    console.error('is not derived WILL go stale. Update the copy, or better, derive it.');
    process.exit(1);
  }
  console.log(`DESCRIPTION COPY OK: every description-quoting literal in tools/ matches SKILL.md (${desc.length} chars).`);
}
