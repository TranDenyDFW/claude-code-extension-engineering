#!/usr/bin/env node
/**
 * DESCRIPTION COPY CHECK: no tool may hold a stale copy of a skill-description clause.
 *
 * WHY THIS EXISTS
 * ---------------
 * The frontmatter description is the only text ALWAYS in context, so its exact wording has been
 * measured repeatedly. It is also capped at 1536 characters with 3 to spare, which means every
 * future edit to it is a SUBSTITUTION, and a substitution is exactly the edit that leaves copies
 * elsewhere stale.
 *
 * Not hypothetical. tools/split-skillmd.mjs held a hardcoded copy of the exclusion clause ending
 * "Name the page and stop." while the live description had moved to "Answer; name the page.".
 * SKILL.md records the stop-reading as a rule about SILENCE that LOST two blind pairwise
 * comparisons to an arm carrying no relevant library at all. The copy preserved the losing
 * instruction, and the tool holding it REBUILDS skill files from that constant.
 *
 * TWO SIGNALS, AND ONE THAT WAS TRIED AND REMOVED
 * -----------------------------------------------
 * The first version used MARKERS alone and an independent reviewer broke it in one try:
 * reverting tools/split-questions.mjs back to 'Name the page and stop.' was NOT caught, because
 * that literal carries no marker phrase. So a second signal was needed:
 *
 *   1. MARKERS   a literal containing a distinctive phrase from the CURRENT description must be
 *                a substring of it.
 *   2. RETIRED   a literal containing text KNOWN to have been removed from the description fails
 *                outright. This is what catches short superseded clauses, which share too few
 *                characters with the live text for any similarity test to see.
 *
 * A third signal, NEAR MISS (flag any literal sharing a 25-character run with the description),
 * was implemented and then REMOVED after measuring it against the real tree: 16 findings, 14 of
 * them false. tools/split-skillmd.mjs holds the four-way PARTITION of the description and shares
 * long runs by construction, and tools/trigger-collision.mjs holds other skills' descriptions on
 * purpose. The signal cannot separate a stale copy from legitimate derivative text, and raising
 * the threshold until the false positives stopped would have raised it past the real defects too.
 *
 * RETIRED therefore carries the weight, which means it is only as good as its list. That is a
 * real limitation, stated rather than hidden: adding a phrase to RETIRED is part of editing the
 * description, not an optional tidy-up afterwards.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not forbid copies. A copy that MATCHES is fine, and forbidding them would fail on the
 * frozen-phrase list in skill-frontmatter-gate.mjs and the claimed_by strings in
 * trigger-collision.mjs, both of which quote the description on purpose. Only DIVERGENCE fails.
 *
 *   node tools/description-copy-check.mjs              check
 *   node tools/description-copy-check.mjs --self-test  fixtures, including must-fail cases
 *   node tools/description-copy-check.mjs --prove-fail mutate REAL tools and require failures
 *   node tools/description-copy-check.mjs --audit      list every literal and how it is covered
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

/** Phrases that only occur because someone is quoting the CURRENT description. */
export const MARKERS = [
  'NOT for operating Claude Code',
  'is a QUESTION, not system output',
  'Use when choosing between these mechanisms',
  'ALSO for IMPERATIVE build requests',
  'ALSO for a BARE SYMPTOM',
  'Answer; name the page',
];

/**
 * Text KNOWN to have been in the description and since removed.
 *
 * A retired phrase in a live literal is always a defect: it is either a stale copy, or someone
 * reintroducing wording that was changed for a measured reason. Each entry carries why it went.
 */
export const RETIRED = [
  {
    text: 'Name the page and stop',
    why: 'Superseded by "Answer; name the page." SKILL.md records the stop-reading as a rule about SILENCE that lost two blind pairwise comparisons to an arm carrying no relevant library at all.',
  },
];

/** The live description, unescaped from its YAML scalar. */
export function liveDescription(root = ROOT) {
  const line = readFileSync(join(root, 'skills', 'claude-code-extension-engineering', 'SKILL.md'), 'utf8')
    .split('\n').find((l) => l.startsWith('description:'));
  if (!line) return null;
  try { return JSON.parse(line.slice('description:'.length).trim()); } catch { return null; }
}

/**
 * String literals in a source file, with 1-based line numbers.
 *
 * Single and double quoted only. Template literals are not scanned: nothing here builds a
 * description clause from one, and including them would need real parsing to avoid matching
 * interpolations.
 */
export function literalsOf(src) {
  const out = [];
  const lines = src.split('\n');
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    /* Comment lines are skipped. The comment explaining THIS gate quotes the retired phrase in
       order to explain it, and a scanner with no comment awareness flags its own documentation.
       Only whole-line comments are handled: a literal sharing a line with a trailing // comment
       is still scanned, which is the safe direction to be wrong in. */
    if (inBlock) { if (trimmed.includes('*/')) inBlock = false; continue; }
    if (trimmed.startsWith('/*')) { if (!trimmed.includes('*/')) inBlock = true; continue; }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    for (const m of line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
      const raw = m[1] !== undefined ? m[1] : m[2];
      if (raw && raw.length >= 20) out.push({ line: i + 1, text: raw.replace(/\\'/g, "'").replace(/\\"/g, '"') });
    }
  }
  return out;
}

/** Why a literal is considered to be quoting the description, or null if it is not. */
export function quotingReason(text, description) {
  for (const r of RETIRED) if (text.includes(r.text)) return { kind: 'retired', detail: r.why };
  const mk = MARKERS.find((m) => text.includes(m));
  if (mk) return { kind: 'marker', detail: mk };
  return null;
}

/** Literals that quote the description but do not match it. */
export function divergences(files, description) {
  const bad = [];
  for (const { name, src } of files) {
    for (const lit of literalsOf(src)) {
      const reason = quotingReason(lit.text, description);
      if (!reason) continue;
      /* A retired phrase fails even if the literal is otherwise a substring, because the live
         description cannot contain retired text and a match would mean the description regressed. */
      if (reason.kind !== 'retired' && description.includes(lit.text)) continue;
      bad.push({ file: name, line: lit.line, text: lit.text, kind: reason.kind, detail: reason.detail });
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

// ------------------------------------------------------------------ audit

/** Every literal that quotes the description, and which signal covers it. */
function audit() {
  const desc = liveDescription();
  if (!desc) { console.error('cannot read the live description'); return 2; }
  let n = 0;
  for (const { name, src } of readTools()) {
    for (const lit of literalsOf(src)) {
      const reason = quotingReason(lit.text, desc);
      if (!reason) continue;
      n++;
      const ok = reason.kind !== 'retired' && desc.includes(lit.text);
      console.log(`  ${ok ? 'match  ' : 'DIVERGE'}  ${reason.kind.padEnd(9)} ${name}:${lit.line}`);
      console.log(`             ${lit.text.slice(0, 96)}`);
    }
  }
  console.log(`\n${n} description-quoting literal(s) found and covered.`);
  return 0;
}

// ------------------------------------------------------------------ self-test

function selfTest() {
  let fails = 0; let ran = 0;
  const ok = (label, cond, detail) => { ran++; if (!cond) fails++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${cond ? '' : `  (${detail || ''})`}`); };
  const DESC = 'Building a thing. NOT for operating Claude Code rather than extending it: telemetry. Answer; name the page.';

  ok('a matching copy passes',
    divergences([{ name: 't.mjs', src: `const X = 'NOT for operating Claude Code rather than extending it: telemetry. Answer; name the page.';` }], DESC).length === 0);

  ok('MUST FAIL on a diverged copy carrying a marker',
    divergences([{ name: 't.mjs', src: `const X = 'NOT for operating Claude Code rather than extending it: nope.';` }], DESC).length === 1);

  /* The case an independent reviewer used to break the first version of this gate. */
  ok('MUST FAIL on a RETIRED phrase with no marker and no long shared run',
    divergences([{ name: 't.mjs', src: `const CLAUSES = ['Name the page and stop.'];` }], DESC).length === 1,
    'this is the reviewer mutant the marker-only version missed');

  ok('the retired case is reported as kind=retired',
    divergences([{ name: 't.mjs', src: `const X = 'Name the page and stop.';` }], DESC)[0].kind === 'retired');

  ok('a retired phrase inside a COMMENT is not flagged',
    divergences([{ name: 't.mjs', src: '/* explains "Name the page and stop." on purpose */\nconst X = 1;' }], DESC).length === 0,
    'the gate must not flag its own documentation');

  ok('a literal sharing nothing with the description is ignored, however long',
    divergences([{ name: 't.mjs', src: `const X = 'some unrelated sentence that is quite long indeed and mentions nothing at all';` }], DESC).length === 0);

  ok('short literals are ignored',
    literalsOf(`const X = 'tiny';`).length === 0);

  ok('double-quoted literals are scanned too',
    divergences([{ name: 't.mjs', src: `const X = "NOT for operating Claude Code rather than extending it: nope.";` }], DESC).length === 1);

  ok('the reported line number is the literal\'s own line',
    divergences([{ name: 't.mjs', src: `\n\nconst X = 'NOT for operating Claude Code rather than extending it: nope.';` }], DESC)[0].line === 3);

  ok('an escaped quote inside a literal does not truncate it',
    literalsOf(`const X = 'it\\'s a fairly long literal with an escape';`).length === 1);

  ok('a block comment spanning lines is skipped entirely',
    divergences([{ name: 't.mjs', src: '/*\n  Name the page and stop.\n*/\nconst X = 2;' }], DESC).length === 0);

  console.log(`\nSELF-TEST ${fails ? 'FAIL' : 'PASS'} (${ran - fails}/${ran} checks)`);
  return fails ? 1 : 0;
}

// ------------------------------------------------------------------ prove-fail

/**
 * Wire the gate to the REAL tools directory and require it to reject real mutants.
 *
 * The self-test proves the judgement on fixtures. This proves the gate AS WIRED, which is a
 * different claim: a gate can be correct in the abstract and still read the wrong directory or
 * filter out the file that matters. Mutant 3 is the one an independent reviewer used to break
 * the marker-only version, so a regression to that design fails here.
 */
function proveFail() {
  const desc = liveDescription();
  if (!desc) { console.error('cannot read the live description'); return 2; }

  const mutants = [
    { file: 'split-skillmd.mjs', label: 'the historical drift, restored', from: 'install and login. Answer; name the page.', to: 'install and login. Name the page and stop.' },
    { file: 'split-skillmd.mjs', label: 'one word changed inside a quoted clause', from: 'NOT for operating Claude Code rather than extending it', to: 'NOT for operating Claude Code rather than extend it' },
    { file: 'split-questions.mjs', label: 'a RETIRED clause with no marker (the reviewer mutant)', from: "'Answer; name the page.',", to: "'Name the page and stop.'," },
  ];

  let bad = 0;
  const originals = new Map();
  try {
    for (const m of mutants) {
      const p = join(ROOT, 'tools', m.file);
      if (!originals.has(p)) originals.set(p, readFileSync(p, 'utf8'));
      const original = originals.get(p);
      if (!original.includes(m.from)) { console.log(`  SKIPPED   ${m.label} (anchor absent in ${m.file})`); bad++; continue; }
      writeFileSync(p, original.replace(m.from, m.to));
      const caught = divergences(readTools(), desc).some((d) => d.file.endsWith(m.file));
      console.log(`  ${caught ? 'rejected' : 'SURVIVED'}  ${m.label}`);
      if (!caught) bad++;
      writeFileSync(p, original);
    }
  } finally {
    for (const [p, s] of originals) writeFileSync(p, s);
  }

  let restored = true;
  for (const [p, s] of originals) if (readFileSync(p, 'utf8') !== s) restored = false;
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
  if (argv.includes('--audit')) process.exit(audit());

  const desc = liveDescription();
  if (!desc) { console.error('CANNOT CHECK: no parseable description in ' + SKILL); process.exit(2); }

  const bad = divergences(readTools(), desc);
  if (bad.length) {
    for (const d of bad) {
      console.error(`DESCRIPTION_COPY_DIVERGED  ${d.file}:${d.line}  [${d.kind}]`);
      console.error(`  copy: ${d.text}`);
      console.error(`  why : ${d.detail}`);
    }
    console.error(`\nDESCRIPTION COPY FAIL: ${bad.length} literal(s) quote the description but do not match it.`);
    console.error('The description is capped and every edit to it is a substitution, so a copy that');
    console.error('is not derived WILL go stale. Update the copy, or better, derive it.');
    process.exit(1);
  }
  console.log(`DESCRIPTION COPY OK: every description-quoting literal in tools/ matches SKILL.md (${desc.length} chars).`);
  console.log('  signals: marker phrases from the live description, and retired phrases.');
}
