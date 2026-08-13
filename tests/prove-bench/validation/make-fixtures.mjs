#!/usr/bin/env node
/**
 * prove-bench, VALIDATION-FAILURE-MODE cohort.
 *
 * A SECOND cohort, in its own directory, writing its own results file. The
 * published 10-of-10-versus-3-of-10 experiment in ../results.json is not touched
 * by anything here, because a measurement that moves when you add work beside it
 * is not a measurement.
 *
 * EXPERIMENTAL DESIGN
 * -------------------
 * ONE validation policy. ONE generated bundle, which is the CONTROL. Eleven
 * variants in which the IMPLEMENTATION is defective and `conformance.json` is
 * BYTE-IDENTICAL to the control's. The spec is the constant and the implementation
 * is the single variable, which is what makes the comparison interpretable. That
 * invariant is asserted, not assumed: see `checkSpecIsConstant`.
 *
 * Wiring counts as implementation. Two fixtures vary `settings.json` rather than
 * the handler (a matcher naming the wrong tool, and the Windows bare-variable
 * path trap), because a validator that never fires is the most common way one of
 * these fails in production and it is not a defect you can see in the handler.
 *
 * EXPECTED FAILURES ARE HAND-DECLARED, NEVER READ BACK FROM THE TOOL.
 * `scoreDiagnosis` requires the failing case-id set to EQUAL the set the defect
 * predicts, so deriving that set by running extension-prove would make the score a
 * check that cannot fail: whatever the tool reported would be, by construction,
 * what was expected. Each `expectedFailures` below was reasoned from the defect and
 * the case list before the bench was run, and a disagreement is reported as
 * WRONG-DIAGNOSIS rather than reconciled.
 *
 * ONE FIXTURE IS DECLARED A KNOWN MISS, on purpose. `explicit-allow-decision`
 * emits `permissionDecision: "allow"` on its non-deny path, which in production
 * BYPASSES the permission system for that call and auto-approves what the user
 * would otherwise be asked about. extension-prove cannot currently see it: its
 * verdict model treats an explicit allow and an absent decision as the same thing.
 * Shipping the fixture and scoring it MISS reports that blind spot instead of
 * hiding it. It does NOT silently become a catch when the model is widened: the
 * fixture declares no expected failures, so a future run that detected the defect
 * would score WRONG-DIAGNOSIS, which is the signal to re-declare it against the new
 * case id. An earlier version of this comment claimed it "flips to a catch", which
 * was false in code and was caught by independent review evaluating scoreDiagnosis
 * directly.
 *
 * usage:
 *   node tests/prove-bench/validation/make-fixtures.mjs           write fixtures
 *   node tests/prove-bench/validation/make-fixtures.mjs --check   assert committed == generated
 *   node tests/prove-bench/validation/make-fixtures.mjs --self-test
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PRECEDENCE } from '../../../tools/packs/policy-schema.mjs';
import { analyse, buildBundle, HANDLER_POSIX } from '../../../tools/packs/validate-before-action.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, 'fixtures');
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * THE SHARED POLICY. Three families in one policy, so a defect confined to one
 * evaluator produces a DISTINCT failing set rather than the same blanket failure
 * every time. `cd /tmp && rm -rf cache` is a declared match example because a
 * compound command is the bypass this repository measured against the product's
 * own permission layer, and `echo "never run rm -rf here"` is a declared miss
 * because substring matching is how almost everyone writes this hook first.
 */
export const POLICY = {
  policySchema: 1,
  id: 'release-guard',
  tool: 'Bash',
  matcher: 'Bash',
  precedence: PRECEDENCE,
  defaultDecision: 'allow',
  rules: [
    {
      id: 'no-rm-rf', family: 'dangerous-operation', decision: 'deny',
      reason: 'recursive force delete is blocked by release policy',
      when: { commandMatches: { exec: 'rm', anyFlag: ['-rf'] } },
      examples: {
        match: ['rm -rf build', 'cd /tmp && rm -rf cache'],
        miss: ['rm build/one.o', 'echo "never run rm -rf here"'],
      },
    },
    {
      id: 'tests-before-push', family: 'required-check', decision: 'deny',
      reason: 'the unit tests did not pass',
      when: {
        commandMatches: { exec: 'git', argsPattern: '^push.*$' },
        checksPass: [{ id: 'unit', command: ['node', '-e', 'process.exit(process.env.TESTS_GREEN === "1" ? 0 : 1)'], timeoutMs: 10000 }],
      },
      examples: { match: ['git push origin main'], miss: ['git status'] },
      gateSetup: { pass: { env: { TESTS_GREEN: '1' } }, fail: { env: { TESTS_GREEN: '0' } } },
    },
    {
      id: 'manifest-valid', family: 'schema-validation', decision: 'deny',
      reason: 'the deployment manifest is invalid',
      when: {
        commandMatches: { exec: 'deploy', argsPattern: '^apply .*$' },
        documentAt: 'deploy/manifest.json',
        narrowSchema: {
          narrowSchema: 1, required: ['env', 'replicas'], additionalProperties: false,
          properties: { env: { type: 'string', enum: ['staging', 'prod'] }, replicas: { type: 'number' } },
        },
      },
      examples: { match: ['deploy apply prod'], miss: ['deploy status'] },
    },
  ],
};

/** Every case id the shared spec emits, in order. Asserted against the real spec. */
export const CASE_IDS = [
  'no-rm-rf-blocks-1',
  'no-rm-rf-blocks-2',
  'no-rm-rf-near-miss-1',
  'no-rm-rf-near-miss-2',
  'tests-before-push-blocks-when-unmet',
  'tests-before-push-permits-when-met',
  'tests-before-push-setup-is-load-bearing',
  'tests-before-push-near-miss-1',
  'manifest-valid-blocks-invalid-document',
  'manifest-valid-permits-valid-document',
  'manifest-valid-blocks-missing-document',
  'manifest-valid-document-is-load-bearing',
  'manifest-valid-near-miss-1',
  'matcher-scopes-to-the-declared-tool',
  'crashing-handler-fails-open',
  'deleted-handler-fails-open',
  'indirection-is-not-inspected',
];

// Shorthands, so an expectedFailures list reads as the claim it is making.
const DENY_CASES = [
  'no-rm-rf-blocks-1', 'no-rm-rf-blocks-2', 'tests-before-push-blocks-when-unmet',
  'tests-before-push-setup-is-load-bearing', 'manifest-valid-blocks-invalid-document',
  'manifest-valid-blocks-missing-document', 'manifest-valid-document-is-load-bearing',
];
const FIRED_CASES = ['tests-before-push-permits-when-met', 'manifest-valid-permits-valid-document'];
const NOT_DENY_CASES = [
  'no-rm-rf-near-miss-1', 'no-rm-rf-near-miss-2', 'tests-before-push-permits-when-met',
  'tests-before-push-near-miss-1', 'manifest-valid-permits-valid-document',
  'manifest-valid-near-miss-1', 'indirection-is-not-inspected',
];

const sub = (from, to) => (s) => {
  if (!s.includes(from)) throw new Error(`fixture transform found nothing to replace: ${from.slice(0, 60)}`);
  return s.split(from).join(to);
};

const editHandler = (fn) => (files) => ({ ...files, [HANDLER_POSIX]: fn(files[HANDLER_POSIX]) });
const editSettings = (fn) => (files) => ({ ...files, 'settings.json': JSON.stringify(fn(JSON.parse(files['settings.json'])), null, 2) + '\n' });

/**
 * The cohort. `control: true` on exactly one; every other row is a defect a
 * reasonable person ships, with the case ids its defect predicts.
 */
export const COHORT = [
  {
    name: 'correct-validator', control: true,
    defect: 'none: the bundle extension-scaffold generates from the shared policy, unmodified',
    citation: 'CONTROL. Both tools must report it clean. Without a control the bench is a check that cannot fail.',
    expectedFailures: [],
    transform: (files) => files,
  },
  {
    name: 'no-op-validator',
    defect: 'the handler parses the payload and always exits 0 without deciding: installed, inert, and invisible in any log',
    citation: 'hooks.md: exit 0 with no hookSpecificOutput is an ALLOW. The most common shape of a guard that looks installed and blocks nothing.',
    expectedFailures: DENY_CASES,
    transform: editHandler(sub('  if (out.decision !== \'deny\') process.exit(0);', '  process.exit(0);\n  if (out.decision !== \'deny\') process.exit(0);')),
  },
  {
    name: 'stdout-theatre',
    defect: 'the handler prints a BLOCKED banner as plain text and exits 0, so it reads as working in a terminal and allows everything',
    citation: 'hooks.md: a decision must be structured JSON on stdout. Printed text is not a decision, and scoring never reads raw text for exactly this reason.',
    expectedFailures: DENY_CASES,
    transform: editHandler(sub(
      '  process.stdout.write(JSON.stringify({',
      '  process.stdout.write("BLOCKED: " + out.reason + "\\n");\n  process.exit(0);\n  process.stdout.write(JSON.stringify({')),
  },
  {
    name: 'blocks-everything',
    defect: 'the handler denies every Bash command, which is the failure mode that gets a hook deleted rather than fixed',
    citation: 'hooks.md failure modes: "Overly broad matcher, so it fires everywhere and gets disabled out of annoyance."',
    expectedFailures: NOT_DENY_CASES,
    transform: editHandler(sub(
      '    out = decide(command, POLICY, process.env.CLAUDE_PROJECT_DIR || process.cwd());',
      '    out = { decision: \'deny\', ruleId: \'everything\', reason: \'blocked\' };')),
  },
  {
    name: 'matcher-wrong-tool',
    defect: 'the PreToolUse matcher names Write while the policy is about Bash commands, so the validator never sees a single command it was written for',
    citation: 'hooks.md: "Tool events match tool_name." The shipped tester pipes stdin straight into the handler and never reads the matcher, so this passes every validator that exists.',
    // Nothing fires on Bash, so every deny case and both fired-at-least-once
    // cases fail; and the Write case, which asserts the hook does NOT fire for
    // another tool, now fires.
    expectedFailures: [...DENY_CASES, ...FIRED_CASES, 'matcher-scopes-to-the-declared-tool'],
    transform: editSettings((s) => { s.hooks.PreToolUse[0].matcher = 'Write'; return s; }),
  },
  {
    name: 'handler-path-bare-variable',
    defect: 'the hook command uses a bare $CLAUDE_PROJECT_DIR instead of the braced form, so on Windows the path resolves to nothing and the handler never runs',
    citation: 'hooks.md: "bare $CLAUDE_PROJECT_DIR parses as an undefined variable and resolves to $null". A path trap that leaves a correct handler sitting unused on disk.',
    /**
     * THE ONE PREDICTION THAT WAS WRONG, kept as a note because correcting it
     * quietly would be the circularity this cohort is designed against.
     *
     * Declared: the seven deny cases PLUS the two that assert `fired: {min: 1}`,
     * on the reasoning that a handler which cannot be found does not fire. The
     * bench reported WRONG-DIAGNOSIS, and the evidence says the tool is right and
     * the prediction was wrong: the interpreter EXISTS, only the script does not,
     * so node starts, fails to load the module and exits 1. The verdict records
     * `fired: 1` with the note "handler exit 1 is a non-blocking error on
     * PreToolUse (fails open)".
     *
     * Worth knowing on its own: `fired` counts a handler PROCESS that ran, not a
     * handler SCRIPT that ran, so `fired: {min: 1}` cannot detect a missing
     * handler. The exit-code note and the deny cases are what carry it.
     */
    expectedFailures: DENY_CASES,
    transform: editSettings((s) => {
      s.hooks.PreToolUse[0].hooks[0].command = s.hooks.PreToolUse[0].hooks[0].command.replace('${CLAUDE_PROJECT_DIR}', '$CLAUDE_PROJECT_DIR');
      return s;
    }),
  },
  {
    name: 'substring-match',
    defect: 'the dangerous-operation rule tests command.includes("rm -rf") instead of parsing, so any command MENTIONING the string is blocked',
    citation: 'permissions.md rejects the same shape at the product level: a content-field rule "would be bypassable by a compound command, so Claude Code ignores it". Substring matching over-blocks and under-blocks at once.',
    // The two blocks- cases still pass because the substring is present in both.
    // What breaks is the safe command that merely mentions it, and the residual
    // that asserts sh -c is NOT inspected.
    expectedFailures: ['no-rm-rf-near-miss-2', 'indirection-is-not-inspected'],
    transform: editHandler(sub(
      '    if (!segments.some((s) => matchesShape(cm, s))) continue;',
      "    if (rule.id === 'no-rm-rf') { if (!command.includes('rm -rf')) continue; }\n    else if (!segments.some((s) => matchesShape(cm, s))) continue;")),
  },
  {
    name: 'first-segment-only',
    defect: 'the handler inspects only the command up to the first shell operator, so `cd /tmp && rm -rf cache` walks straight through',
    citation: 'This is the exact bypass this repository MEASURED against the product on 2.1.224: `cd infra && touch fresh.tf` wrote the file ten times out of ten while the same write without the cd was denied.',
    expectedFailures: ['no-rm-rf-blocks-2'],
    transform: editHandler(sub('  const segments = splitSegments(command);', '  const segments = splitSegments(command).slice(0, 1);')),
  },
  {
    name: 'ignores-check-exit-code',
    defect: 'the required check is spawned and its exit code is discarded, so the gate runs, costs time, and gates nothing',
    citation: 'The defect class this whole project exists to name: a check that cannot fail. The check executes, so it looks alive in any log.',
    expectedFailures: ['tests-before-push-blocks-when-unmet', 'tests-before-push-setup-is-load-bearing'],
    transform: editHandler(sub(
      '      const failed = programs.map((p) => runProgram(p, cwd)).filter((r) => !r.ok);',
      '      const failed = programs.map((p) => runProgram(p, cwd)).filter(() => false);')),
  },
  {
    name: 'document-read-not-validated',
    defect: 'the schema rule reads the document and returns no problems whatever it contains, including when the file is absent',
    citation: 'Same class as ignores-check-exit-code, one evaluator over. The read succeeds, so strace, logs and a code review all show a validator doing work.',
    expectedFailures: ['manifest-valid-blocks-invalid-document', 'manifest-valid-blocks-missing-document', 'manifest-valid-document-is-load-bearing'],
    transform: editHandler(sub('function validateDocument(when, cwd) {', 'function validateDocument(when, cwd) {\n  return [];')),
  },
  {
    name: 'only-first-rule-consulted',
    defect: 'the rule loop returns after the first rule regardless of whether it matched, so rules 2 and 3 are dead configuration',
    citation: 'permissions.md: "Rules are evaluated in order ... The first match in that order determines the outcome." First-match is not first-rule, and the difference is silent.',
    expectedFailures: [
      'tests-before-push-blocks-when-unmet', 'tests-before-push-setup-is-load-bearing',
      'manifest-valid-blocks-invalid-document', 'manifest-valid-blocks-missing-document',
      'manifest-valid-document-is-load-bearing',
    ],
    transform: editHandler(sub(
      '  for (const rule of policy.rules) {',
      '  for (const rule of policy.rules.slice(0, 1)) {')),
  },
  {
    name: 'explicit-allow-decision',
    knownMiss: 'extension-prove models an explicit permissionDecision "allow" and an absent decision as the same verdict, so no case in the shared spec can see this. Reported as a MISS rather than hidden. It does not become a catch by itself if the model is widened: expectedFailures is empty, so a run that detected it would score WRONG-DIAGNOSIS, and that is the signal to re-declare this fixture against the new case id.',
    defect: 'the handler emits permissionDecision "allow" on its non-deny path, which in production BYPASSES the permission system and auto-approves calls the user would otherwise be asked about',
    citation: 'hooks.md: an "allow" decision from a PreToolUse hook skips the permission system for that call. A validator written this way silently converts every unmatched command into an approved one.',
    expectedFailures: [],
    transform: editHandler(sub(
      '  if (out.decision !== \'deny\') process.exit(0);',
      `  if (out.decision !== 'deny') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: out.reason } }));
    process.exit(0);
  }`)),
  },
];

export function generateAll() {
  const a = analyse({ policy: POLICY });
  const base = buildBundle('release-guard', { policy: POLICY }, a);
  const out = new Map();
  for (const f of COHORT) {
    const files = f.transform(base.files);
    const manifest = {
      name: f.name,
      control: !!f.control,
      defect: f.defect,
      citation: f.citation,
      expectedFailures: f.expectedFailures,
      ...(f.knownMiss ? { knownMiss: f.knownMiss } : {}),
    };
    out.set(f.name, { ...files, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' });
  }
  return out;
}

/**
 * THE EXPERIMENTAL INVARIANT, asserted rather than trusted. If a transform ever
 * touches conformance.json, the fixtures stop answering the same question and the
 * comparison silently becomes meaningless. Two variables, one number.
 */
export function checkSpecIsConstant(all) {
  const bad = [];
  const ref = all.get('correct-validator')['conformance.json'];
  for (const [name, files] of all) {
    if (files['conformance.json'] !== ref) bad.push(`${name}: conformance.json differs from the control's`);
  }
  return bad;
}

const norm = (s) => String(s).split('\r\n').join('\n');
const sha = (s) => createHash('sha256').update(norm(s), 'utf8').digest('hex');

function write(all) {
  rmSync(FIXTURES, { recursive: true, force: true });
  for (const [name, files] of all) {
    for (const [rel, content] of Object.entries(files)) {
      const dest = join(FIXTURES, name, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
  }
  console.log(`wrote ${all.size} fixture(s) to ${relative(process.cwd(), FIXTURES)}`);
}

function walk(dir, base = dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(relative(base, p).split('\\').join('/'));
  }
  return acc;
}

function check(all) {
  let bad = 0;
  for (const [name, files] of all) {
    const dir = join(FIXTURES, name);
    if (!existsSync(dir)) { console.log(`  MISSING ${name}`); bad++; continue; }
    const onDisk = walk(dir).sort();
    const expected = Object.keys(files).sort();
    if (onDisk.join(',') !== expected.join(',')) { console.log(`  ${name}: file list ${onDisk.join(',')}, generated ${expected.join(',')}`); bad++; continue; }
    for (const rel of expected) {
      if (sha(readFileSync(join(dir, rel), 'utf8')) !== sha(files[rel])) { console.log(`  ${name}/${rel}: DIFFERS from the generator`); bad++; }
    }
  }
  const extra = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((n) => !all.has(n)) : [];
  for (const n of extra) { console.log(`  ${n}: on disk but not in the cohort`); bad++; }
  for (const line of checkSpecIsConstant(all)) { console.log(`  ${line}`); bad++; }
  console.log(bad ? `\nDRIFT: ${bad} problem(s).` : `\nPASS committed fixtures match the generator, and all ${all.size} share one conformance.json.`);
  return bad ? 1 : 0;
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  let fails = 0;
  const ok = (n, c, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : `  (${d})`}`); if (!c) fails++; };

  const all = generateAll();
  ok('the cohort is one control plus eleven defects', all.size === 12 && COHORT.filter((f) => f.control).length === 1, `${all.size} fixtures`);
  ok('every fixture has a distinct name', new Set(COHORT.map((f) => f.name)).size === COHORT.length);
  ok('every defective fixture cites something', COHORT.filter((f) => !f.control).every((f) => f.citation && f.citation.length > 40));

  const controlName = COHORT.filter((f) => f.control).map((f) => f.name);
  ok('exactly one fixture is declared the control, found BY FLAG not by index', controlName.length === 1, controlName.join(','));
  ok('...and it is the one checkSpecIsConstant uses as its reference', controlName[0] === 'correct-validator');
  const conf = JSON.parse(all.get(controlName[0])['conformance.json']);
  ok('the spec case ids are the frozen list', conf.cases.map((c) => c.id).join(',') === CASE_IDS.join(','), conf.cases.map((c) => c.id).join(','));
  ok('the spec is byte-identical across all twelve fixtures', checkSpecIsConstant(all).length === 0, checkSpecIsConstant(all).join('; '));

  /**
   * Every declared expected-failure id must EXIST in the spec. A typo would make
   * the fixture permanently unachievable and score WRONG-DIAGNOSIS forever, which
   * looks like a tool defect and is not one.
   */
  const known = new Set(CASE_IDS);
  for (const f of COHORT) {
    const unknown = f.expectedFailures.filter((id) => !known.has(id));
    ok(`${f.name}: every expected id exists in the spec`, unknown.length === 0, unknown.join(','));
  }
  ok('the control expects nothing to fail', COHORT.find((f) => f.control).expectedFailures.length === 0);
  const knownMisses = COHORT.filter((f) => f.knownMiss);
  ok('exactly one fixture is declared a known miss', knownMisses.length === 1);
  /**
   * `.every()` on this filter passes VACUOUSLY when the filter is empty, which
   * independent review flagged: it was pinned only by the row above happening to
   * assert a count of one. The set is now measured first, so an empty set is a
   * failure rather than a silent pass.
   */
  const silentZeroExpect = COHORT.filter((f) => !f.control && f.expectedFailures.length === 0);
  ok('at least one non-control fixture expects nothing to fail, so the row below has something to check',
    silentZeroExpect.length > 0, 'nothing to check');
  ok('...and every one of those is a DECLARED known miss, never an accident',
    silentZeroExpect.length > 0 && silentZeroExpect.every((f) => f.knownMiss),
    silentZeroExpect.filter((f) => !f.knownMiss).map((f) => f.name).join(','));

  /**
   * Every transform must CHANGE something. A transform that silently matched
   * nothing would ship a fixture identical to the control, and it would score
   * MISS while looking like a tool failure. `sub` throws on a missing anchor,
   * which is asserted here rather than assumed.
   */
  const ctrl = all.get('correct-validator');
  for (const f of COHORT.slice(1)) {
    const files = all.get(f.name);
    const changed = Object.keys(files).filter((k) => k !== 'manifest.json' && files[k] !== ctrl[k]);
    ok(`${f.name}: the transform actually changed the bundle`, changed.length > 0, 'identical to the control');
    ok(`${f.name}: ...and left conformance.json alone`, !changed.includes('conformance.json'));
  }
  let threw = false;
  try { sub('this anchor does not exist anywhere', 'x')('abc'); } catch { threw = true; }
  ok('MUST THROW: a transform whose anchor is missing', threw);

  /**
   * THE SPEC-CONSTANT INVARIANT, SHOWN ABLE TO FAIL. Independent review pointed out
   * that both rows asserting it are true by construction while every transform is
   * built from editHandler or editSettings, so they assert nothing about today's
   * cohort. They are regression guards, and a regression guard nobody has watched
   * fail is not yet a guard. Fed a cohort whose transform edits the spec, the
   * checker must complain.
   */
  {
    const doctored = new Map(all);
    const victim = COHORT.find((f) => !f.control).name;
    const files = { ...doctored.get(victim) };
    files['conformance.json'] = files['conformance.json'].replace('"cases"', '"casesX"');
    doctored.set(victim, files);
    const seen = checkSpecIsConstant(doctored);
    ok('MUST SEE: a transform that edits conformance.json breaks the invariant',
      seen.some((l) => l.startsWith(victim)), seen.join(' | ') || 'reported nothing');
    ok('...and the untouched cohort still reports clean', checkSpecIsConstant(all).length === 0);
  }

  console.log(fails ? `\nSELF-TEST FAIL (${fails})` : '\nSELF-TEST PASS');
  return fails ? 1 : 0;
}

if (IS_MAIN) {
  const a = process.argv.slice(2);
  if (a.includes('--self-test')) process.exit(selfTest());
  const all = generateAll();
  const bad = checkSpecIsConstant(all);
  if (bad.length) { for (const l of bad) console.error(`  ${l}`); process.exit(1); }
  process.exit(a.includes('--check') ? check(all) : (write(all), 0));
}
