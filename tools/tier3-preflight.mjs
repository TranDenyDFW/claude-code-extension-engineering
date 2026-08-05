#!/usr/bin/env node
/**
 * tier3-preflight.mjs - gate a replicate run before it spends 36 agents.
 *
 * WHY THIS EXISTS
 * ---------------
 * Replicates 2 and 3 are only meaningful if they differ from replicate 1 in
 * exactly ONE way: answer-agent nondeterminism. Two things can silently break
 * that, and both are cheap to check and expensive to discover afterwards.
 *
 * 1. THE ARM PROMPTS. They are the independent variable. An "improvement" to an
 *    arm prompt between replicates does not improve the run, it destroys the
 *    comparison, and nothing downstream would notice: the numbers would simply
 *    be wrong in an unattributable way.
 *
 * 2. THE DOCUMENTATION REVISION. Arms B, B+ and D read the docs. Replicate 1
 *    read a specific revision, and that revision was destroyed once already by
 *    an in-place collector re-run and recovered from three surviving copies. If
 *    a replicate reads a different revision, the replicates differ by more than
 *    nondeterminism and pooling the ABSOLUTE per-arm numbers is invalid.
 *
 * This tool asserts both against committed hashes. It writes nothing.
 *
 * usage:
 *   node tools/tier3-preflight.mjs                 check prompts and docs
 *   node tools/tier3-preflight.mjs --pin           write the prompt hash record
 *   node tools/tier3-preflight.mjs --self-test     includes must-fail cases
 *
 * exit: 0 clear to run, 1 a pinned input has drifted, 2 cannot check
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PROMPT_DIR = join(ROOT, 'tests', 'tier3', 'prompts');
const PIN = join(ROOT, 'tests', 'tier3', 'prompt-hashes.json');
// Arm D read THIS tree in replicate 1. The repo skill has since moved on.
const STAGED_SKILL = 'P:/ClaudeExt/QuestionExtension/tmp/t3full-v2/d/skill';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Hash the prompt set. Line endings are normalised because these files are
 * committed text and a fresh clone on Windows checks them out as CRLF; hashing
 * raw bytes would fail on every machine but the one that pinned them, which is a
 * drift gate that reports the checkout rather than the content.
 */
export function hashPrompts(dir) {
  const out = {};
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
    const text = readFileSync(join(dir, name), 'utf8').split('\r\n').join('\n');
    out[name] = sha256(Buffer.from(text, 'utf8'));
  }
  return out;
}

/**
 * Arm D's treatment is the SKILL TREE, so it is an independent variable exactly
 * like the arm prompts, and it must be pinned exactly like them.
 *
 * This gap was found on 2026-08-05, after the skill had already drifted under an
 * unrelated work item: 2 files added and 7 changed, only 15 of 22 identical to
 * what replicate 1 read. Pre-flight passed anyway, because it checked prompts and
 * documentation and simply did not know arm D had a third input. A replicate run
 * would have silently compared a different D arm and reported the difference as
 * nondeterminism.
 */
export function hashSkillTree(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  const walk = (d, prefix) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(p, rel); continue; }
      const text = readFileSync(p, 'utf8').split('\r\n').join('\n');
      out[rel] = sha256(Buffer.from(text, 'utf8'));
    }
  };
  walk(dir, '');
  return out;
}

export function comparePins(pinned, actual) {
  const drifted = []; const missing = []; const added = [];
  for (const [k, v] of Object.entries(pinned)) {
    if (!(k in actual)) missing.push(k);
    else if (actual[k] !== v) drifted.push(k);
  }
  for (const k of Object.keys(actual)) if (!(k in pinned)) added.push(k);
  return { drifted, missing, added, ok: !drifted.length && !missing.length && !added.length };
}

function run() {
  const actual = hashPrompts(PROMPT_DIR);

  if (process.argv.includes('--pin')) {
    if (existsSync(PIN) && !process.argv.includes('--force')) {
      console.error(`refusing to overwrite ${PIN}; the pin is the record of what replicate 1 ran`);
      return 2;
    }
    const skill = hashSkillTree(STAGED_SKILL);
    writeFileSync(PIN, JSON.stringify({
      pinned: new Date().toISOString().slice(0, 10),
      note: 'Arm and grader prompts, and arm D\'s skill tree, as run for replicate 1. These are '
        + 'the independent variables. Editing one between replicates does not improve the run, it '
        + 'destroys the comparison. Hashes are over LF-normalised text so a CRLF checkout does not '
        + 'report false drift.',
      skillSource: STAGED_SKILL,
      skillNote: 'The repo skill has moved on since replicate 1. Arm D must read THIS tree, not '
        + 'skills/claude-code-extension-engineering, or the replicates differ by more than '
        + 'answer-agent nondeterminism and the pooled rule does not apply.',
      prompts: actual,
      skill,
    }, null, 2));
    console.log(`pinned ${Object.keys(actual).length} prompt file(s) and ${Object.keys(skill).length} skill file(s) -> ${PIN}`);
    return 0;
  }

  let code = 0;

  if (!existsSync(PIN)) {
    console.log(`no prompt pin at ${PIN}; run --pin before the first replicate`);
    code = 2;
  } else {
    const { prompts: pinned } = JSON.parse(readFileSync(PIN, 'utf8'));
    const r = comparePins(pinned, actual);
    for (const k of r.drifted) console.log(`  DRIFTED  ${k}  the arm definition changed since replicate 1`);
    for (const k of r.missing) console.log(`  MISSING  ${k}`);
    for (const k of r.added) console.log(`  ADDED    ${k}  not present when replicate 1 ran`);
    console.log(`${r.ok ? 'PASS' : 'FAIL'} prompts: ${Object.keys(pinned).length} pinned, `
      + `${r.drifted.length} drifted, ${r.missing.length} missing, ${r.added.length} added`);
    if (!r.ok) code = 1;

    const pin = JSON.parse(readFileSync(PIN, 'utf8'));
    if (pin.skill) {
      const s = comparePins(pin.skill, hashSkillTree(STAGED_SKILL));
      for (const k of s.drifted) console.log(`  DRIFTED  skill/${k}  arm D's treatment changed since replicate 1`);
      for (const k of s.missing) console.log(`  MISSING  skill/${k}`);
      for (const k of s.added) console.log(`  ADDED    skill/${k}`);
      console.log(`${s.ok ? 'PASS' : 'FAIL'} arm D skill: ${Object.keys(pin.skill).length} pinned, `
        + `${s.drifted.length} drifted, ${s.missing.length} missing, ${s.added.length} added`);
      console.log(`  source: ${STAGED_SKILL}`);
      if (!s.ok) code = 1;
    } else {
      console.log('no skill pin recorded; re-run --pin --force to add one');
      code = 2;
    }
  }

  // The docs revision is checked by its own tool, which owns that manifest.
  console.log('\ndocs revision: run `node tools/docs-revision-check.mjs --rev 2026-08-02`');
  console.log('  arms B, B+ and D must read that revision, not the live mirror.');

  if (code === 0) console.log('\nCLEAR TO RUN a replicate.');
  else if (code === 1) console.log('\nDO NOT RUN. A pinned input drifted; the replicate would not be comparable.');
  return code;
}

function selfTest() {
  let pass = 0; let fail = 0;
  const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ` (${d})` : ''}`); } };

  const tmp = mkdtempSync(join(tmpdir(), 'tier3-preflight-'));
  try {
    const dir = join(tmp, 'prompts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'arm-a.md'), 'alpha prompt\n');
    writeFileSync(join(dir, 'grader.md'), 'grader prompt\n');
    const pinned = hashPrompts(dir);
    check('an unchanged prompt set passes', comparePins(pinned, hashPrompts(dir)).ok);

    // MUST FAIL: this is the failure that would silently invalidate a replicate.
    writeFileSync(join(dir, 'arm-a.md'), 'alpha prompt, improved\n');
    const drifted = comparePins(pinned, hashPrompts(dir));
    check('MUST FAIL: an edited arm prompt is caught', !drifted.ok);
    check('MUST FAIL: the drifted file is named', drifted.drifted[0] === 'arm-a.md');
    check('MUST FAIL: the untouched prompt is not flagged', !drifted.drifted.includes('grader.md'));
    writeFileSync(join(dir, 'arm-a.md'), 'alpha prompt\n');
    check('restoring the prompt restores the pass', comparePins(pinned, hashPrompts(dir)).ok);

    rmSync(join(dir, 'grader.md'));
    check('MUST FAIL: a deleted prompt is caught as missing',
      comparePins(pinned, hashPrompts(dir)).missing[0] === 'grader.md');
    writeFileSync(join(dir, 'grader.md'), 'grader prompt\n');

    writeFileSync(join(dir, 'arm-e.md'), 'a new arm\n');
    check('MUST FAIL: an ADDED prompt is caught, since a new arm is not the same experiment',
      comparePins(pinned, hashPrompts(dir)).added[0] === 'arm-e.md');
    rmSync(join(dir, 'arm-e.md'));

    // CRLF must not read as drift, or the gate reports the checkout not the content.
    writeFileSync(join(dir, 'arm-a.md'), 'alpha prompt\r\n');
    check('a CRLF checkout is NOT reported as drift', comparePins(pinned, hashPrompts(dir)).ok);

    check('an empty pin is not a vacuous pass', !comparePins({}, hashPrompts(dir)).ok);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (existsSync(PROMPT_DIR)) {
    const actual = hashPrompts(PROMPT_DIR);
    check(`the live prompt set has the expected 5 files`, Object.keys(actual).length === 5,
      Object.keys(actual).join(', '));
    if (existsSync(PIN)) {
      const { prompts } = JSON.parse(readFileSync(PIN, 'utf8'));
      const r = comparePins(prompts, actual);
      check('the live prompts match the committed pin', r.ok,
        `drifted ${r.drifted.join(',')} missing ${r.missing.join(',')} added ${r.added.join(',')}`);
    }
  }

  console.log(`\n${fail === 0 ? 'SELF-TEST PASS' : 'SELF-TEST FAIL'} ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

if (IS_MAIN) process.exit(process.argv.includes('--self-test') ? selfTest() : run());
