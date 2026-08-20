#!/usr/bin/env node
/**
 * DESCRIPTION COPY CHECK: no tool may hold a stale copy of a skill-description clause.
 *
 * WHY THIS EXISTS
 * ---------------
 * The frontmatter description is the only text ALWAYS in context, so its exact wording has been
 * measured repeatedly. It is also capped at 1536 characters with 3 to spare, so every future edit
 * to it is a SUBSTITUTION, and a substitution is exactly the edit that leaves copies stale.
 *
 * Not hypothetical. tools/split-skillmd.mjs held a hardcoded copy of the exclusion clause ending
 * "Name the page and stop." while the live description had moved to "Answer; name the page.".
 * SKILL.md records the stop-reading as a rule about SILENCE that LOST two blind pairwise
 * comparisons to an arm carrying no relevant library at all. The copy preserved the losing
 * instruction, and the tool holding it REBUILDS skill files from that constant.
 *
 * TWO SIGNALS, AND A THIRD THAT WAS TRIED AND REMOVED
 * ---------------------------------------------------
 *   1. PROBES   every SENTENCE of the live description contributes its first PROBE_LEN characters
 *               as a probe. A literal containing a probe is quoting that clause and must be a
 *               substring of the description. Probes are DERIVED, never listed, so they cannot
 *               fall behind an edit. An earlier version used five hand-written markers and an
 *               independent reviewer defeated it twice: once with a literal carrying no marker,
 *               and again with a diverged copy of the "ALSO capability and scope" clause, which no
 *               marker covered. Three of the description's clauses were unguarded.
 *   2. PREFIX   a literal beginning with the same 15 characters as a description sentence, while
 *               not being a substring of it. Probes are prefixes, so a mutation INSIDE the probe
 *               evades them; this is the signal that sees it. Measured at zero false positives
 *               across the tools directory at every prefix length from 10 to 25.
 *   3. RETIRED  text KNOWN to have been removed from the description fails outright. This catches
 *               short superseded clauses: "Name the page and stop." is 23 characters, below any
 *               workable probe length, so PROBES alone cannot see it.
 *
 * A third signal, NEAR MISS (flag any literal sharing a 25-character run with the description),
 * was implemented and REMOVED after measuring it: 16 findings, 14 false. split-skillmd.mjs holds
 * the four-way PARTITION of the description and shares long runs BY CONSTRUCTION, so similarity
 * cannot be right about that file even in principle. It could have been scoped by exempting that
 * file, but that exempts the place where copies are densest, which is worse than no signal.
 *
 * PROBE_LEN was measured, not chosen: at 20 the probes flag a legitimate partition literal in
 * split-skillmd.mjs; at 25 they flag nothing false across the whole tools directory while still
 * catching the reviewer's mutant.
 *
 * A REMAINING LIMIT, stated rather than discovered later: the scanner is line-based, so a
 * template literal SPANNING lines is only seen line by line and a clause split across a newline
 * is not reconstructed. Every clause in the tree today sits on one line. The same line-based
 * design means an unclosed block comment opened inside a template literal can desynchronise the
 * comment state; that is reported as an unscannable file when it persists to end of file, and is
 * silently healed if a later line closes it. Exposure measured at zero across 51 tracked files.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not forbid copies: a copy that MATCHES is fine, and forbidding them would fail on the
 * frozen phrases in skill-frontmatter-gate.mjs and the claimed_by strings in
 * trigger-collision.mjs, which quote the description on purpose. It also does not require every
 * declared clause constant to appear in the description: split-skillmd.mjs's SIBLINGS clause
 * ("name the sibling skill") exists only in a four-skill world and has no single-skill
 * counterpart, so such a rule would fail on correct-by-design text. Only DIVERGENCE fails.
 *
 *   node tools/description-copy-check.mjs              check
 *   node tools/description-copy-check.mjs --self-test  fixtures, including must-fail cases
 *   node tools/description-copy-check.mjs --prove-fail mutate REAL tools and require failures
 *   node tools/description-copy-check.mjs --audit      list every literal and how it is covered
 *
 * exit: 0 clean, 1 a divergent copy or an unscannable file, 2 cannot check
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
 * Measured, not chosen. Sweeping the real tree: a false positive on split-skillmd.mjs's partition
 * literal at 15 through 23, clean from 24 upward, and at 38 and above a known mutant survives. The
 * usable plateau is 24 to 37; 25 sits one character above the floor. The floor is an artefact of
 * "incl." manufacturing a sentence boundary, so a future wording change can move it.
 */
export const PROBE_LEN = 25;

/**
 * A sentence shorter than this contributes no probe.
 *
 * Admitting short sentences fixed a real hole, "Answer; name the page." at 22 characters had none,
 * but it removed the floor entirely. A reviewer's positive control showed a hypothetical one-word
 * sentence such as "The." would generate a probe matching 41 literals. 12 keeps every real clause
 * (the shortest is 21) while refusing anything that short.
 */
export const MIN_PROBE = 12;

/**
 * Shared-prefix length for the PREFIX signal.
 *
 * Probes are prefixes, so a mutation INSIDE the probe evades them: "ALSO capability and REACH: "
 * does not contain the probe "ALSO capability and scop" and so reads as unrelated. A literal that
 * begins with the same K characters as a description sentence, yet is not a substring of the
 * description, is a diverged copy of that sentence's opening.
 *
 * Measured across the real tools directory: ZERO false positives at every K from 10 to 25, and the
 * mutant is caught at K up to 20. 15 sits inside the clean range with margin on both sides.
 */
export const PREFIX_LEN = 15;

/**
 * Text KNOWN to have been in the description and since removed.
 *
 * A retired phrase in a live literal is always a defect: either a stale copy, or someone
 * reintroducing wording changed for a measured reason. Adding to this list is PART of editing the
 * description, not a tidy-up afterwards.
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
 * One probe per sentence of the description: its opening PROBE_LEN characters.
 *
 * EVERY sentence contributes, including short ones. The first version filtered out sentences
 * below PROBE_LEN + 5, and exactly one description sentence sits under that line: "Answer; name
 * the page." at 22 characters. That clause is the one this gate was built for, and it had no
 * probe at all, so changing it to "Answer; name the page first." passed. An independent reviewer
 * found it by mutation. The trailing period is stripped so a short sentence contributes its own
 * text rather than being dropped.
 */
/** The description's sentences, trimmed and stripped of the trailing period. */
export function sentencesOf(description) {
  return description.split(/(?<=\.)\s+/)
    .map((x) => x.trim().replace(/\.$/, ''))
    .filter((x) => x.length >= MIN_PROBE);
}

export function probesOf(description, len = PROBE_LEN) {
  return description.split(/(?<=\.)\s+/)
    .map((x) => x.trim().replace(/\.$/, ''))
    .filter((x) => x.length >= MIN_PROBE)
    .map((x) => x.slice(0, len));
}

/**
 * String literals in a source file, plus whether the scan ended inside a block comment.
 *
 * Comment lines are skipped, because the comment explaining this gate quotes the retired phrase in
 * order to explain it, and a comment-blind scanner flags its own documentation. The block-state
 * machine is line-based and therefore foolable: a template-literal line beginning with an unclosed
 * block-comment opener would switch scanning off for the rest of the file. Rather than pretend
 * that cannot happen, the desync is REPORTED as a failure. An independent reviewer found this and
 * measured the exposure at 0 of 51 tracked files, so it is latent, and a latent bypass that
 * announces itself is acceptable where a silent one is not.
 */
export function literalsOf(src) {
  const out = [];
  const lines = src.split('\n');
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; continue; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; continue; }
    if (t.startsWith('//') || t.startsWith('*')) continue;
    for (const m of line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
      const raw = m[1] !== undefined ? m[1] : m[2];
      if (raw && raw.length >= 20) out.push({ line: i + 1, text: raw.replace(/\\'/g, "'").replace(/\\"/g, '"') });
    }
    /* TEMPLATE literals, by their STATIC SEGMENTS between placeholders.
       Four of the description's clause openers live in template literals in split-skillmd.mjs,
       the file this gate names as the original offender, and scanning only quoted strings left
       them unreachable: a reviewer inserted the RETIRED phrase into one and the gate exited 0.
       Each segment between placeholders is plain text and is checked exactly like any literal.
       Segments are NOT trimmed, because a clause opener legitimately ends in a space and that
       space is part of the description. */
    for (const m of line.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
      for (const seg of m[1].split(/\$\{[^}]*\}/)) {
        if (seg.length >= 20) out.push({ line: i + 1, text: seg });
      }
    }
  }
  return { literals: out, blockDesync: inBlock };
}

/** Why a literal is considered to be quoting the description, or null. */
export function quotingReason(text, description, probes, sentences = sentencesOf(description)) {
  for (const r of RETIRED) if (text.includes(r.text)) return { kind: 'retired', detail: r.why };
  const p = probes.find((x) => text.includes(x));
  if (p) return { kind: 'probe', detail: p };
  /* Same opening as a description sentence, but not a substring: the clause was edited INSIDE the
     probe, where a prefix probe cannot see it. */
  const pre = sentences.find((x) => x.length >= PREFIX_LEN && text.length >= PREFIX_LEN && x.slice(0, PREFIX_LEN) === text.slice(0, PREFIX_LEN));
  if (pre) return { kind: 'prefix', detail: pre.slice(0, PREFIX_LEN) };
  return null;
}

/** Literals that quote the description but do not match it, plus unscannable files. */
export function divergences(files, description) {
  const probes = probesOf(description);
  const sentences = sentencesOf(description);
  const bad = [];
  for (const { name, src } of files) {
    const { literals, blockDesync } = literalsOf(src);
    if (blockDesync) {
      bad.push({ file: name, line: 0, text: '(whole file)', kind: 'unscannable', detail: 'the scan ended inside an unterminated block comment, so literals after it were never examined' });
    }
    for (const lit of literals) {
      const reason = quotingReason(lit.text, description, probes, sentences);
      if (!reason) continue;
      /* A retired phrase fails even when the literal is otherwise a substring: the live
         description cannot contain retired text, so a match would mean the description regressed. */
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

function audit() {
  const desc = liveDescription();
  if (!desc) { console.error('cannot read the live description'); return 2; }
  const probes = probesOf(desc);
  console.log(`${probes.length} probes derived from the description, ${PROBE_LEN} chars each\n`);
  let n = 0;
  for (const { name, src } of readTools()) {
    for (const lit of literalsOf(src).literals) {
      const reason = quotingReason(lit.text, desc, probes, sentencesOf(desc));
      if (!reason) continue;
      n++;
      const ok = reason.kind !== 'retired' && desc.includes(lit.text);
      console.log(`  ${ok ? 'match  ' : 'DIVERGE'}  ${reason.kind.padEnd(8)} ${name}:${lit.line}`);
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
  const DESC = 'Building a thing for people who need it. NOT for operating Claude Code rather than extending it: telemetry and billing. Answer; name the page.';
  const D = (src) => divergences([{ name: 't.mjs', src }], DESC);

  ok('a matching copy passes',
    D(`const X = 'NOT for operating Claude Code rather than extending it: telemetry and billing.';`).length === 0);

  ok('MUST FAIL on a diverged copy of a sentence',
    D(`const X = 'NOT for operating Claude Code rather than extending it: nope.';`).length === 1);

  ok('MUST FAIL on a diverged copy of a DIFFERENT sentence, with no hand-written marker',
    D(`const X = 'Building a thing for people who do not need it at all.';`).length === 1,
    'the class the marker-only version could not cover');

  ok('MUST FAIL on a RETIRED phrase carrying no probe at all',
    D(`const CLAUSES = ['Name the page and stop.'];`).length === 1);

  ok('the retired case is reported as kind=retired',
    D(`const X = 'Name the page and stop.';`)[0].kind === 'retired');

  ok('a retired phrase inside a COMMENT is not flagged',
    D('/* explains "Name the page and stop." on purpose */\nconst X = 1;').length === 0);

  ok('a block comment spanning lines is skipped entirely',
    D('/*\n  Name the page and stop.\n*/\nconst X = 2;').length === 0);

  ok('MUST FAIL when the scan ends inside an unterminated block comment',
    D('const T = 1;\n/* never closed\nconst X = 3;').some((d) => d.kind === 'unscannable'),
    'a silent bypass would be worse than a noisy one');

  ok('a literal sharing nothing with the description is ignored, however long',
    D(`const X = 'some unrelated sentence that is quite long indeed and mentions nothing';`).length === 0);

  ok('short literals are ignored', literalsOf(`const X = 'tiny';`).literals.length === 0);

  ok('double-quoted literals are scanned too',
    D(`const X = "NOT for operating Claude Code rather than extending it: nope.";`).length === 1);

  ok('the reported line number is the literal\'s own line',
    D(`\n\nconst X = 'NOT for operating Claude Code rather than extending it: nope.';`)[0].line === 3);

  ok('an escaped quote inside a literal does not truncate it',
    literalsOf(`const X = 'it\\'s a fairly long literal with an escape';`).literals.length === 1);

  ok('probes are derived per sentence and never exceed PROBE_LEN',
    probesOf(DESC).length >= 2 && probesOf(DESC).every((p) => p.length > 0 && p.length <= PROBE_LEN));

  ok('MUST cover a sentence SHORTER than PROBE_LEN but at or above MIN_PROBE',
    probesOf('Answer; name it now. A much longer sentence that easily clears the probe length.').includes('Answer; name it now'),
    'the reviewer mutant survived because the 22-char clause produced no probe');

  ok('MUST scan the static segments of a TEMPLATE literal',
    D('const x = [`NOT for operating Claude Code rather than EXTENDING it: ${X}.`];').length === 1,
    'four clause openers live in template literals in the file this gate is named after');

  ok('MUST catch a RETIRED phrase inside a template literal',
    D('const x = [`prefix ${Y} Name the page and stop.`];').length === 1,
    'RETIRED is the catch-all and reached nothing inside a template literal');

  ok('a template literal whose segments all match is clean',
    D('const x = [`NOT for operating Claude Code rather than extending it: ${X}`];').length === 0);

  ok('a sentence below MIN_PROBE contributes no probe',
    probesOf('The. A much longer sentence that clears the probe length easily.').every((p) => p.length >= MIN_PROBE),
    'no floor meant a one-word sentence would match almost everything');

  ok('MUST FAIL on a clause edited INSIDE the probe prefix',
    D('const x = [`NOT for operating Claude Code rather than STRETCHING it: ${X}`];').length === 1,
    'a prefix probe cannot see a mutation that falls inside itself');

  console.log(`\nSELF-TEST ${fails ? 'FAIL' : 'PASS'} (${ran - fails}/${ran} checks)`);
  return fails ? 1 : 0;
}

// ------------------------------------------------------------------ prove-fail

/**
 * Wire the gate to the REAL tools directory and require it to reject real mutants.
 *
 * Mutants 3 and 4 are the two an independent reviewer used to defeat earlier versions, so a
 * regression to either design fails here rather than in the next review.
 */
function proveFail() {
  const desc = liveDescription();
  if (!desc) { console.error('cannot read the live description'); return 2; }

  const mutants = [
    { file: 'split-skillmd.mjs', label: 'the historical drift, restored', from: 'install and login. Answer; name the page.', to: 'install and login. Name the page and stop.' },
    { file: 'split-skillmd.mjs', label: 'one word changed inside a quoted clause', from: 'NOT for operating Claude Code rather than extending it', to: 'NOT for operating Claude Code rather than extend it' },
    { file: 'split-questions.mjs', label: 'a RETIRED clause with no probe (reviewer mutant 1)', from: "'Answer; name the page.',", to: "'Name the page and stop.'," },
    { file: 'split-questions.mjs', label: 'a diverged clause no hand-written marker covered (reviewer mutant 2)', from: "'They presuppose it can, and often it cannot.',", to: "'They presuppose it can, and often it will not.'," },
    /* Reviewer mutant 3. The clause this gate exists for is 22 characters, and an earlier
       probesOf dropped every sentence below PROBE_LEN + 5, so it had no probe and this mutant
       passed. A regression to that filtering fails here. */
    { file: 'split-questions.mjs', label: 'the 22-char clause this gate is FOR (reviewer mutant 3)', from: "'Answer; name the page.',", to: "'Answer; name the page first.'," },
    /* Reviewer mutants 4 and 5, both inside TEMPLATE literals in split-skillmd.mjs. literalsOf
       scanned only quoted strings, so four clause openers in the file this gate is named after
       were unreachable, and inserting the RETIRED phrase into one of them passed at exit 0.
       The second is a mutation INSIDE the probe prefix, which a prefix probe cannot see and
       which the PREFIX signal exists to catch. */
    { file: 'split-skillmd.mjs', label: 'a RETIRED phrase inside a template literal (reviewer mutant 4)', from: '${QUESTION_CLAUSE}', to: '${QUESTION_CLAUSE} Name the page and stop.' },
    { file: 'split-skillmd.mjs', label: 'a clause edited INSIDE the probe prefix (reviewer mutant 5)', from: 'ALSO capability and scope:', to: 'ALSO capability and REACH:' },
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
    console.error(`\nDESCRIPTION COPY FAIL: ${bad.length} problem(s).`);
    console.error('The description is capped and every edit to it is a substitution, so a copy that');
    console.error('is not derived WILL go stale. Update the copy, or better, derive it.');
    process.exit(1);
  }
  console.log(`DESCRIPTION COPY OK: every description-quoting literal in tools/ matches SKILL.md (${desc.length} chars).`);
  console.log(`  signals: ${probesOf(desc).length} probes derived from the description's sentences, plus ${RETIRED.length} retired phrase(s).`);
}
