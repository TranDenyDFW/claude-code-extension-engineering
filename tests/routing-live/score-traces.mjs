#!/usr/bin/env node
/**
 * SCORE A LIVE ROUTING TRACE, mechanically. No grader model.
 *
 * Routing is a file path and a tool name, not a judgment, so a string comparison settles it.
 * Pushing this through a model grader would add three calls per question to measure
 * something deterministic and would make the result LESS falsifiable, not more.
 *
 * Five observable predicates per question:
 *   SKILL_WON         a Skill call naming claude-code-extension-engineering
 *   DEST_OPENED       a Read whose basename is one of the expected reference files
 *   DECOY_ONLY        a decoy file was read and no expected file was
 *   POINTER_EMITTED   the answer names the official page SLUG (strict, reported)
 *   TOPIC_ADDRESSED   the answer names the slug OR a verified topic marker (the criterion)
 *   WORKSPACE_AUDITED the session's OWN settings files were inspected
 *
 * THE FIFTH ONE EXISTS BECAUSE FOUR WERE NOT ENOUGH, AND THAT WAS MEASURED.
 * With only the first four, this scorer PASSED `denied|GQ-06|A`, a trace that scored 1 of 6.
 * In that run routing worked perfectly: the skill won retrieval and opened both hooks.md and
 * hook-events.md. It then inspected the arena's own settings.json anyway and answered "No
 * Stop hook is actually configured anywhere" to a general question that carried no artifact.
 *
 * So "routing is a file path and a tool name" is true of the retrieval half and false of the
 * outcome. Auditing the workspace on a BARE SYMPTOM is the specific anti-pattern SKILL.md's
 * repair section now forbids, it is mechanically detectable, and a fixture may demand its
 * absence. What this scorer still cannot see is whether a correctly-routed answer used what
 * it read; that is answer quality and belongs to the points rubric, not here.
 *
 * THE KNOWN-BAD INPUT IS REAL, NOT SYNTHETIC.
 * tests/routing/regressions/ holds the three traces from the 2026-08-13 LT run that scored
 * 0 or 1 of 6. `--prove-can-fail` scores them and requires FAIL on each. A synthetic decoy
 * would be weaker: these are what the defect actually looked like, including
 * `Skill | update-config` as the first tool call of GQ-06.
 *
 *   node tests/routing-live/score-traces.mjs --self-test
 *   node tests/routing-live/score-traces.mjs --prove-can-fail
 *   node tests/routing-live/score-traces.mjs --trace <f.json> --fixture <id>
 *
 * exit: 0 pass, 1 fail, 2 cannot run
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const REGRESSIONS = join(ROOT, 'tests', 'routing', 'regressions');

export const SKILL_NAME = 'claude-code-extension-engineering';

/** Basename of any file path appearing in a tool input, however the path is spelled. */
export function pathsIn(input) {
  const s = String(input || '');
  const out = new Set();
  for (const m of s.matchAll(/[\w./\\-]+\.md\b/g)) out.add(basename(m[0].replace(/\\/g, '/')));
  return out;
}

export function predicates(steps, expect) {
  const tools = (steps || []).filter((s) => s.kind === 'tool');
  const says = (steps || []).filter((s) => s.kind === 'say');

  const skillCalls = tools.filter((t) => t.name === 'Skill' && !t.refused);
  const skillWon = skillCalls.some((t) => String(t.input || '').includes(SKILL_NAME));
  const otherSkill = skillCalls.find((t) => !String(t.input || '').includes(SKILL_NAME));

  const opened = new Set();
  for (const t of tools) {
    if (t.refused) continue;
    if (!['Read', 'Grep', 'Glob'].includes(t.name)) continue;
    for (const p of pathsIn(t.input)) opened.add(p);
  }
  const wanted = new Set(expect.files || []);
  const decoys = new Set(expect.decoys || []);
  const destOpened = [...wanted].some((f) => opened.has(f));
  const decoyOpened = [...decoys].some((f) => opened.has(f));

  const finalText = says.length ? String(says[says.length - 1].text || '') : '';
  const allText = says.map((s) => String(s.text || '')).join('\n');
  const slug = expect.official ? String(expect.official).replace(/\.md$/, '') : null;
  /* The pointer counts wherever the model said it, not only in the last message: a model
     that names the page early and then elaborates has still routed correctly. */
  const pointerEmitted = slug ? new RegExp(slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(allText) : false;

  /* TOPIC_ADDRESSED, and why the strict slug test was the wrong criterion.
     The first live run scored 16 of 20 out-of-scope sessions FAIL for "did not name
     <slug>". Reading the answers showed they were CORRECT: the permission question got
     "That's a permission mode question (not permission rules)... Shift+Tab... acceptEdits",
     which is the redirect working, in the library's own words. It simply never typed the
     URL slug. Demanding the slug measured a formatting habit, not the routing outcome.
     Markers are verified present on the page they stand for (tmp/verify-topic-markers.mjs),
     and are deliberately NOT the ledger's subject_terms, which were chosen to be ABSENT
     from the library and are therefore useless as evidence about an answer.
     Both are reported. The strict number is not hidden by the relaxed one. */
  const markers = expect.topic_markers || [];
  const markerHit = markers.filter((m) => new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(allText));

  /* Inspecting the SESSION'S OWN configuration, as opposed to the skill's reference files.
     Both live under a .claude directory, so the discriminator is the path segment after it:
     `settings.json` / `settings.local.json` / `.claude.json` are the workspace's config,
     while `skills/` and `references/` are the library. Any tool may do it, including Bash,
     which is how it actually happened. */
  /* `settings[\w*.-]*\.json` rather than a literal, because the real traces hunt with globs
     (`find "$HOME/.claude" -name "settings*.json"`) as often as they read a fixed path, and
     a literal-only pattern caught the fixed reads while missing the search that preceded
     them. */
  const CONFIG_RE = /settings[\w*.-]*\.json|[/\\]\.claude\.json/i;
  const auditedBy = tools.filter((t) => {
    if (t.refused) return false;
    /* A Skill INVOCATION is not a file read. GQ-42 was flagged because the model passed
       arguments mentioning settings.json to the Skill tool while its answer was the exact
       behaviour SKILL.md asks for: "Answering from the contract first; say the word and
       I'll open your actual settings files." Only tools that actually touch the filesystem
       can audit a workspace. */
    if (!['Read', 'Bash', 'Grep', 'Glob', 'Edit', 'Write'].includes(t.name)) return false;
    const s = String(t.input || '').replace(/\\/g, '/');
    if (/\/(skills|references)\//i.test(s) && !CONFIG_RE.test(s)) return false;
    return CONFIG_RE.test(s);
  });

  return {
    SKILL_WON: skillWon,
    COMPETING_SKILL: otherSkill ? String(otherSkill.input || '').split(':')[0].trim() : null,
    DEST_OPENED: destOpened,
    DECOY_ONLY: decoyOpened && !destOpened,
    POINTER_EMITTED: pointerEmitted,
    TOPIC_ADDRESSED: pointerEmitted || markerHit.length > 0,
    markerHit,
    WORKSPACE_AUDITED: auditedBy.length > 0,
    auditedBy: auditedBy.map((t) => t.name),
    opened: [...opened],
    finalTextLength: finalText.length,
  };
}

/**
 * PASS rules, per expectation kind.
 *   reference     the skill must win AND an expected file must be opened
 *   out-of-scope  the official page must be named; opening a decoy INSTEAD is a fail
 */
export function score(steps, expect) {
  const p = predicates(steps, expect);
  const reasons = [];
  if (expect.kind === 'decline') {
    /* Questions where NOT invoking is correct: off-topic or undocumented by design. These
       measure the primary risk of this whole change directly. Naming a topic in order to
       decline it enlarges the trigger surface, and if the boundary table made the skill fire
       on "how claude code is better than cursor", that regression shows up HERE as a fail
       rather than as a silently smaller invocation count nobody notices. */
    if (p.SKILL_WON) reasons.push('the skill was invoked on a question it should decline, which is the over-trigger regression');
  } else if (expect.kind === 'out-of-scope') {
    /* Reading the decoy only matters when the topic was NOT addressed. On GQ-55 the model
       opened monitors.md, hit its "Read this first", and answered about OpenTelemetry on all
       three passes: reading the decoy is HOW the disambiguation delivers, so failing it
       there would penalise the fix for working. The decoy is diagnostic of a wrong outcome,
       never a wrong outcome by itself.

       NESTED, not `else if`. Written first as `else if`, which binds to the NEGATIVE
       condition above and so fired the decoy failure exactly when the topic HAD been
       addressed: the precise inverse of the comment beside it. It survived a green
       self-test and a green prove-can-fail, and was caught only by scoring real sessions
       whose answers had been read by hand. A test suite that never exercises a branch
       cannot tell you the branch is backwards. */
    if (!p.TOPIC_ADDRESSED) {
      reasons.push(`did not address ${expect.official}: named neither the page nor any of its topic markers`);
      if (p.DECOY_ONLY) reasons.push(`and read a decoy (${(expect.decoys || []).join(', ')}) instead`);
    }
  } else {
    if (!p.SKILL_WON) reasons.push(p.COMPETING_SKILL ? `a different skill won retrieval: ${p.COMPETING_SKILL}` : 'the skill was never invoked');
    /* Assert the destination ONLY where the fixture names one. Most questions have no
       single provably-correct reference file, and a fixture with an empty `files` list that
       silently failed every row would measure nothing while looking rigorous. Where INDEX.md
       does name the file unambiguously, the fixture says so and this fires. */
    if ((expect.files || []).length && !p.DEST_OPENED) reasons.push(`none of ${expect.files.join(', ')} was opened`);
    if ((expect.decoys || []).length && p.DECOY_ONLY) reasons.push('only a decoy was opened');
  }
  /* A question that carried no artifact must not be answered by auditing this session's
     config. Opt-in per fixture, because when the user DOES attach an artifact, reading it
     is the correct move and this predicate would be exactly backwards. */
  if (expect.bare_symptom && p.WORKSPACE_AUDITED) {
    reasons.push(`audited this session's own settings via ${[...new Set(p.auditedBy)].join(', ')} on a question that attached no artifact`);
  }
  return { pass: reasons.length === 0, reasons, predicates: p };
}

// --------------------------------------------------------------------- self-test

function selfTest() {
  let fails = 0; let ran = 0;
  const ok = (n, c, d) => { ran++; if (!c) fails++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : `  (${d || ''})`}`); };
  const T = (...s) => s;
  const tool = (name, input, refused = false) => ({ kind: 'tool', name, input, refused });
  const say = (text) => ({ kind: 'say', text });

  const refExpect = { kind: 'reference', files: ['hooks.md'], decoys: ['monitors.md'] };
  ok('a clean reference route passes',
    score(T(tool('Skill', `${SKILL_NAME}: x`), tool('Read', 'C:/a/references/hooks.md'), say('here')), refExpect).pass);
  ok('MUST FAIL when a competing skill won retrieval, and NAME it',
    (() => { const r = score(T(tool('Skill', 'update-config: x'), say('no hook found')), refExpect); return !r.pass && /update-config/.test(r.reasons.join(' ')); })());
  ok('MUST FAIL when the skill won but never opened the destination',
    !score(T(tool('Skill', `${SKILL_NAME}: x`), say('answer')), refExpect).pass);
  ok('MUST FAIL when only a decoy was opened',
    (() => { const r = score(T(tool('Skill', `${SKILL_NAME}: x`), tool('Read', '/x/monitors.md'), say('a')), refExpect); return !r.pass && r.predicates.DECOY_ONLY; })());
  ok('MUST NOT count a REFUSED read as an open',
    !score(T(tool('Skill', `${SKILL_NAME}: x`), tool('Read', '/x/hooks.md', true), say('a')), refExpect).pass);

  const oosExpect = { kind: 'out-of-scope', official: 'monitoring-usage', decoys: ['monitors.md'] };
  ok('naming the official page passes an out-of-scope row',
    score(T(say('that is monitoring-usage, see the docs')), oosExpect).pass);
  ok('MUST FAIL an out-of-scope row that never names the page',
    !score(T(say('use the Monitor tool')), oosExpect).pass);
  ok('the pointer counts wherever it was said, not only in the last message',
    score(T(say('this is monitoring-usage'), say('and here is more detail')), oosExpect).pass);
  ok('MUST FAIL an out-of-scope row that reads the decoy and names nothing',
    !score(T(tool('Read', '/x/monitors.md'), say('the Monitor tool streams stdout')), oosExpect).pass);

  /* The exact case that caught a logic inversion in this file. Reading the decoy AND
     addressing the topic is the disambiguation working: the model opens monitors.md, hits
     its "Read this first", and answers about OpenTelemetry. An `else if` bound to the
     negative condition failed precisely this shape, and every other test still passed. */
  const oosMarked = { kind: 'out-of-scope', official: 'monitoring-usage', decoys: ['monitors.md'], topic_markers: ['OpenTelemetry'] };
  ok('MUST PASS when the decoy was read AND the topic was addressed, which is the fix working',
    score(T(tool('Read', '/x/references/monitors.md'), say('you want OpenTelemetry export, not the Monitor tool')), oosMarked).pass);
  ok('MUST FAIL when the decoy was read and the topic was NOT addressed',
    !score(T(tool('Read', '/x/references/monitors.md'), say('a monitor streams stdout into the session')), oosMarked).pass);
  ok('a topic marker alone satisfies the criterion without the slug',
    score(T(say('set CLAUDE_CODE_ENABLE_TELEMETRY and export via OpenTelemetry')), oosMarked).pass);

  /* The decline kind, which measures the over-trigger risk directly. */
  const dec = { kind: 'decline' };
  ok('a declined question passes when the skill stays out of it',
    score(T(say('that is a comparison question, not extension engineering')), dec).pass);
  ok('MUST FAIL a declined question the skill invoked itself on',
    (() => { const r = score(T(tool('Skill', `${SKILL_NAME}: x`), say('a')), dec); return !r.pass && /over-trigger/.test(r.reasons.join(' ')); })());
  ok('a declined question is not failed merely for reading nothing',
    score(T(say('I cannot confirm that from the documentation')), dec).pass);

  ok('path extraction finds a basename inside a compound shell string',
    pathsIn('cat "C:/bench/arena/.claude/skills/x/references/hooks.md" | head').has('hooks.md'));

  /* The fifth predicate, and its false-positive guard. Reading the library is the whole
     point; reading THIS session's config on a question with no artifact is the anti-pattern. */
  const bare = { kind: 'reference', files: ['hooks.md'], decoys: ['monitors.md'], bare_symptom: true };
  const routedThenAudited = T(tool('Skill', `${SKILL_NAME}: x`), tool('Read', '/a/references/hooks.md'),
    tool('Read', 'C:/bench/arena/arm-a/.claude/settings.json'), say('no Stop hook is configured anywhere'));
  ok('MUST FAIL a bare symptom answered by auditing this session, even when routing was PERFECT',
    (() => { const r = score(routedThenAudited, bare); return !r.pass && r.predicates.SKILL_WON && r.predicates.DEST_OPENED; })(),
    'this is the denied|GQ-06|A case that four predicates passed');
  ok('MUST NOT flag reading the skill\'s own reference files as a workspace audit',
    !score(T(tool('Skill', `${SKILL_NAME}: x`), tool('Read', '/x/.claude/skills/ccx/references/hooks.md'), say('a')), bare).predicates.WORKSPACE_AUDITED);
  ok('MUST NOT flag a workspace read when the fixture did NOT declare a bare symptom, because then it is correct behaviour',
    score(routedThenAudited, { kind: 'reference', files: ['hooks.md'], decoys: [] }).pass);
  ok('a Bash find over settings.json counts, since that is how it actually happened',
    predicates(T(tool('Bash', 'find "$HOME/.claude" -name "settings*.json"')), bare).WORKSPACE_AUDITED);
  console.log(`\n${fails ? `SELF-TEST FAIL: ${fails}` : 'SELF-TEST PASS'} (${ran} checks)`);
  return fails ? 1 : 0;
}

// ---------------------------------------------------------------- prove-can-fail

/** The frozen real failures, with the expectation each one violated. */
export const REGRESSION_CASES = [
  { file: 'GQ-55-denied.trace.json', expect: { kind: 'out-of-scope', official: 'monitoring-usage', decoys: ['monitors.md'] },
    why: 'answered from the monitor mechanism, never named the observability page' },
  { file: 'GQ-06-open.trace.json', expect: { kind: 'reference', files: ['hooks.md', 'hook-events.md'], decoys: ['monitors.md'], bare_symptom: true },
    why: 'update-config won retrieval, then the workspace settings were audited' },
  { file: 'GQ-06-denied.trace.json', expect: { kind: 'reference', files: ['hooks.md', 'hook-events.md'], decoys: ['monitors.md'], bare_symptom: true },
    why: 'routing SUCCEEDED here: the skill won and opened both files, then audited the workspace anyway and reported nothing configured' },
];

function proveCanFail() {
  if (!existsSync(REGRESSIONS)) { console.log(`CANNOT PROVE: no frozen traces at ${REGRESSIONS}`); return 2; }
  const man = JSON.parse(readFileSync(join(REGRESSIONS, 'MANIFEST.json'), 'utf8'));
  let bad = 0;
  for (const c of REGRESSION_CASES) {
    const p = join(REGRESSIONS, c.file);
    if (!existsSync(p)) { console.log(`  MISSING   ${c.file}`); bad++; continue; }
    const body = readFileSync(p, 'utf8');
    /* The trace is the evidence, so verify it is the evidence: a hash mismatch means the
       known-bad input was edited, and a prover fed a doctored failure proves nothing. */
    const sha = createHash('sha256').update(body).digest('hex');
    const rec = (man.traces || []).find((t) => t.file === c.file);
    if (!rec || rec.sha256 !== sha) { console.log(`  TAMPERED  ${c.file}  hash does not match MANIFEST`); bad++; continue; }
    const r = score(JSON.parse(body), c.expect);
    if (r.pass) { console.log(`  SURVIVED  ${c.file}  <- the scorer PASSED a trace that scored 0 or 1 of 6`); bad++; }
    else console.log(`  failed as required  ${c.file}  [${r.reasons.join('; ')}]`);
  }
  if (bad) { console.log(`\nSCORER IS HOLLOW: ${bad} of ${REGRESSION_CASES.length} known failures were not caught`); return 1; }
  console.log(`\nSCORER CAN FAIL: all ${REGRESSION_CASES.length} real recorded failures were scored FAIL, for the reason each actually exhibited.`);
  return 0;
}

// ------------------------------------------------------------------------- main

if (IS_MAIN) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  if (argv.includes('--prove-can-fail')) process.exit(proveCanFail());
  const ti = argv.indexOf('--trace');
  if (ti < 0) { console.error('usage: --self-test | --prove-can-fail | --trace <f.json> --expect <json>'); process.exit(2); }
  const ei = argv.indexOf('--expect');
  const expect = ei >= 0 ? JSON.parse(argv[ei + 1]) : { kind: 'reference', files: [], decoys: [] };
  const r = score(JSON.parse(readFileSync(argv[ti + 1], 'utf8')), expect);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.pass ? 0 : 1);
}
