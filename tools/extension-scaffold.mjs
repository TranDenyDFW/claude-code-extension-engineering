#!/usr/bin/env node
/**
 * extension-scaffold: turn a requirement into an extension bundle THAT CARRIES
 * ITS OWN FALSIFIABLE ACCEPTANCE TEST.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a general generator. Anthropic's `create-plugin` already scaffolds skills,
 * agents, hooks, MCP and settings, and it is on this machine. Rebuilding that is
 * duplication. This composes with it rather than competing.
 *
 * Not a natural-language miracle. It handles ONE documented requirement family,
 * path protection ("prevent changes to X"), because that is the family the
 * full-population GitHub study found users get wrong most often. For anything
 * else it says so and refuses, rather than emitting a confident wrong answer.
 *
 * WHAT IT ADDS THAT NOTHING ELSE DOES
 * -----------------------------------
 * The deliverable is not the extension. It is the extension PLUS a
 * conformance.json that `extension-prove` can fail. No project in the surveyed
 * corpus ships an expected-outcome spec beside the artifact.
 *
 * THE SELECTION RULE, and why it is not a style preference
 * -------------------------------------------------------
 * Measured across 81,002 anthropics/claude-code issues: the dominant confusion is
 * users writing advisory prose and expecting a hard guarantee (#17908, #56383,
 * #80211, #16011), and in every one of those the permissions deny rule went
 * unconsidered. So:
 *
 *   guarantee language + fail-closed clause -> permissions deny rule.
 *       A command hook CANNOT satisfy this: a missing or crashing command hook
 *       fails OPEN by documented design.
 *   guarantee language, no fail-closed clause -> PreToolUse hook, with the deny
 *       rule surfaced as the cheaper deterministic alternative.
 *   no guarantee language -> advisory (CLAUDE.md) is legitimate.
 *
 * A deny rule for a file path MUST be written Edit(...), never Write(...):
 * "Claude Code checks file permissions against Edit(path) and Read(path) rules
 * only ... accepts the rule but never consults it" otherwise.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ analysis
export const GUARANTEE = /\b(always|never|must|shall|block|blocked|prevent|prevented|ensure|guarantee|forbid|forbidden|disallow|not permitted|may not|cannot)\b/i;
export const FAIL_CLOSED = /(even if|missing or crash|deleted or crash|crashes|still hold|still apply|cannot be bypassed|fail(s)? closed|regardless of|bypass)/i;
/**
 * Is this a request to PROTECT a path?
 *
 * Two admissible shapes, and the second is what independent review found missing
 * ("Never allow modification of X" was being refused):
 *   1. a protective verb: prevent, block, protect, forbid, ...
 *   2. a negation followed closely by a change verb: "never ... modification",
 *      "must not be overwritten", "no one may edit"
 *
 * A first attempt simply added the change verbs on their own. That was too loose:
 * it swallowed "keep changes in a separate commit" and "into a changelog", which
 * are not protection requirements at all. The negation is what carries the intent,
 * so it is required.
 */
export const PROTECT_VERB = /\b(prevent|block|protect|forbid|disallow|deny|guard|read-?only|lock(ed)? down)\b/i;
export const NEGATED_CHANGE = /\b(never|not|no|nobody|no one|none)\b[^.!?]{0,40}?\b(modif\w*|chang\w*|overwrit\w*|edit\w*|alter\w*|touch\w*|writ\w*|updat\w*)/i;
export const PROTECT = {
  test: (s) => PROTECT_VERB.test(s) || NEGATED_CHANGE.test(s),
};

/** Pull a path or glob out of the requirement: backticked, quoted, or path-shaped. */
export function extractTarget(text) {
  const backtick = text.match(/`([^`]+)`/);
  if (backtick && /[/\\.*]/.test(backtick[1])) return backtick[1].trim();
  const quoted = text.match(/"([^"]+)"|'([^']+)'/);
  if (quoted) { const v = (quoted[1] || quoted[2]).trim(); if (/[/\\.*]/.test(v)) return v; }
  // A bare directory-ish token: infra/, src/config, .env
  const bare = text.match(/(?:^|\s)((?:\.{0,2}[\w.-]+[/\\])+[\w.*-]*|\.[\w.-]+)(?=[\s,.]|$)/);
  if (bare) return bare[1].trim();
  return null;
}

/** Normalise a target into a glob that covers the whole subtree. */
export function toGlob(target) {
  let t = String(target).replace(/\\/g, '/').replace(/^\.\//, '');
  if (t.endsWith('/**')) return t;
  if (t.endsWith('/')) return t + '**';
  if (t.includes('*')) return t;
  if (/\.[A-Za-z0-9]+$/.test(t)) return t;      // looks like a single file
  return t.replace(/\/$/, '') + '/**';
}

export function analyse(requirement) {
  const guarantee = GUARANTEE.test(requirement);
  const failClosed = FAIL_CLOSED.test(requirement);
  const protect = PROTECT.test(requirement);
  const target = extractTarget(requirement);
  const notes = [];
  let mechanism, rejected;

  if (!protect || !target) {
    return {
      supported: false, guarantee, failClosed, target,
      reason: !target
        ? 'no path or glob could be extracted from the requirement'
        : 'the requirement does not describe protecting a path, which is the only family this tool handles',
    };
  }

  if (guarantee && failClosed) {
    mechanism = 'permission-deny';
    rejected = 'A PreToolUse hook. A command hook fails OPEN when its handler is missing or crashes, so it cannot satisfy the fail-closed clause.';
    notes.push('The deny rule is harness-owned, so it holds when the handler is deleted. That is what makes it the only passing answer here.');
  } else if (guarantee) {
    mechanism = 'hook';
    rejected = 'CLAUDE.md prose. It is advisory: the model may or may not follow it, which does not satisfy guarantee language.';
    notes.push('Consider a permissions deny rule instead. It is deterministic, needs no script, and in the measured GitHub corpus users never considered it.');
  } else {
    mechanism = 'advisory';
    rejected = 'A hook or deny rule, which would be heavier than the requirement asks for.';
    notes.push('No guarantee language found, so an advisory instruction is legitimate here.');
  }

  return { supported: true, guarantee, failClosed, target, glob: toGlob(target), mechanism, rejected, notes };
}

// ------------------------------------------------------------------ emission
/**
 * Build the case paths from the target.
 *
 * A single-file target is NOT a directory. An earlier version appended
 * "/main.tf" unconditionally, so a requirement naming one file emitted cases
 * targeting `config/prod.secrets.yaml/main.tf`, which the deny rule
 * `Edit(config/prod.secrets.yaml)` cannot match. The bundle then failed its own
 * spec. Found by independent review; no check in the verify spec caught it,
 * because the tool reports NOT DONE rather than a false green.
 */
export function casePathsFor(glob) {
  const singleFile = !glob.includes('*');
  if (singleFile) {
    const dot = glob.lastIndexOf('.');
    const stem = dot > glob.lastIndexOf('/') ? glob.slice(0, dot) : glob;
    return {
      singleFile,
      inside: glob,
      nested: null,                       // a file has no subtree
      nearMiss: `${stem}.example`,        // prefix collision on the same stem
    };
  }
  const base = glob.replace(/\/?\*+$/, '');
  return { singleFile, inside: `${base}/main.tf`, nested: `${base}/nested/deep/x.tf`, nearMiss: `${base}-notes.md` };
}

export function conformanceFor(name, requirement, a) {
  const { singleFile, inside, nested, nearMiss } = casePathsFor(a.glob);
  const cases = [
    { id: 'C1', kind: 'enforce', event: 'PreToolUse',
      input: { tool_name: 'Write', tool_input: { file_path: inside, content: 'x' } },
      expect: { decision: 'deny' } },
    { id: 'C2', kind: 'near-miss', event: 'PreToolUse',
      input: { tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'x' } },
      expect: { decision: { not: 'deny' } } },
    { id: 'C3', kind: 'wiring', event: 'PreToolUse',
      input: { tool_name: 'Edit', tool_input: { file_path: inside, content: 'x' } },
      expect: { decision: 'deny' } },
    { id: 'C4', kind: 'near-miss', event: 'PreToolUse',
      input: { tool_name: 'Write', tool_input: { file_path: nearMiss, content: 'x' } },
      expect: { decision: { not: 'deny' } } },
  ];
  // Only a subtree target has a nested case to make.
  if (!singleFile) {
    cases.push({ id: 'C5', kind: 'enforce', event: 'PreToolUse',
      input: { tool_name: 'Write', tool_input: { file_path: nested, content: 'x' } },
      expect: { decision: 'deny' } });
  }
  if (a.failClosed) {
    const n = cases.length;
    cases.push(
      { id: `C${n + 1}`, kind: 'fail-posture', event: 'PreToolUse', mutate: 'delete-handler',
        input: { tool_name: 'Write', tool_input: { file_path: inside, content: 'x' } },
        expect: { decision: { not: 'allow' } } },
      { id: `C${n + 2}`, kind: 'fail-posture', event: 'PreToolUse', mutate: 'crash-handler',
        input: { tool_name: 'Write', tool_input: { file_path: inside, content: 'x' } },
        expect: { decision: { not: 'allow' } } },
    );
  }
  return { extension: name, mechanism: a.mechanism, requirement, generated_by: 'extension-scaffold', cases };
}

function handlerSource(glob) {
  const prefix = glob.replace(/\/?\*+$/, '');
  return `#!/usr/bin/env node
// Generated by extension-scaffold. Denies Write/Edit under ${glob}.
// ESM: this file is .mjs, so require is not in scope.
import { readFileSync } from 'node:fs';
const raw = readFileSync(0, 'utf8');
let ev; try { ev = JSON.parse(raw); } catch { process.exit(2); }
const p = ((ev.tool_input && ev.tool_input.file_path) || '').replace(/\\\\/g, '/');
if (p === ${JSON.stringify(prefix)} || p.startsWith(${JSON.stringify(prefix + '/')})) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: ${JSON.stringify(prefix + ' is protected')}
    }
  }));
}
process.exit(0);
`;
}

export function emit(dir, name, requirement, a) {
  mkdirSync(dir, { recursive: true });
  const settings = {};
  if (a.mechanism === 'permission-deny') {
    // Edit(...) NOT Write(...): a Write path rule is accepted but never consulted.
    settings.permissions = { deny: [`Edit(${a.glob})`] };
  }
  if (a.mechanism === 'hook' || a.mechanism === 'permission-deny') {
    writeFileSync(join(dir, 'guard.mjs'), handlerSource(a.glob));
    settings.hooks = { PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node "guard.mjs"' }] }] };
  }
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  const conf = conformanceFor(name, requirement, a);
  writeFileSync(join(dir, 'conformance.json'), JSON.stringify(conf, null, 2) + '\n');
  writeFileSync(join(dir, 'README.md'), [
    `# ${name}`, '',
    '## Requirement', '', requirement, '',
    '## Mechanism chosen', '', `**${a.mechanism}**`, '',
    `Nearest rejected alternative: ${a.rejected}`, '',
    ...a.notes.map((n) => `- ${n}`), '',
    '## Proving it', '',
    'This bundle ships its own acceptance test. Run:', '',
    '```', `node tools/extension-prove.mjs --bundle ${dir}`, '```', '',
    `${conf.cases.length} cases: ` +
    `${conf.cases.filter((c) => c.kind === 'enforce').length} enforce, ` +
    `${conf.cases.filter((c) => c.kind === 'near-miss').length} near-miss, ` +
    `${conf.cases.filter((c) => c.kind === 'wiring').length} wiring, ` +
    `${conf.cases.filter((c) => c.kind === 'fail-posture').length} fail-posture.`, '',
  ].join('\n'));
  return conf;
}

// ------------------------------------------------------------------- verify
function runTool(script, args) {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: 'utf8', windowsHide: true, timeout: 180_000 });
  return { exit: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function scaffold(requirement, outDir, name) {
  const a = analyse(requirement);
  console.log(`extension-scaffold`);
  console.log(`  requirement : ${requirement}`);
  console.log('');
  if (!a.supported) {
    console.log(`UNSUPPORTED: ${a.reason}`);
    console.log('');
    console.log('This tool handles one requirement family: protecting a path from change.');
    console.log('It refuses rather than emitting a confident wrong answer. Use');
    console.log('`create-plugin` from plugin-dev to scaffold, then hand the result to');
    console.log('`extension-prove` with a conformance.json you write.');
    return 2;
  }
  console.log(`  guarantee language : ${a.guarantee ? 'YES' : 'no'}`);
  console.log(`  fail-closed clause : ${a.failClosed ? 'YES' : 'no'}`);
  console.log(`  target             : ${a.target}  ->  ${a.glob}`);
  console.log(`  mechanism          : ${a.mechanism}`);
  console.log(`  rejected           : ${a.rejected}`);
  for (const n of a.notes) console.log(`  note               : ${n}`);
  console.log('');

  const conf = emit(outDir, name, requirement, a);
  console.log(`wrote ${outDir}`);
  console.log(`  settings.json, conformance.json (${conf.cases.length} cases), README.md${a.mechanism !== 'advisory' ? ', guard.mjs' : ''}`);
  console.log('');

  const prove = runTool('extension-prove.mjs', ['--bundle', outDir]);
  console.log(prove.out.trim());
  console.log('');
  if (prove.exit !== 0) {
    console.log('NOT DONE: the generated bundle does not satisfy its own conformance spec.');
    return 1;
  }
  console.log('DONE: the generated bundle satisfies its own conformance spec.');
  return 0;
}

// ---------------------------------------------------------------- self-test
function selfTest() {
  let f = 0;
  const check = (n, c, d = '') => { if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n}${d ? ' :: ' + d : ''}`); f++; } };

  console.log('requirement analysis:');
  const A = (s) => analyse(s);
  const hard = A('Prevent any change to a file under `infra/`. The protection must still hold if the guard script is deleted or crashes.');
  check('guarantee + fail-closed selects the permission deny rule', hard.mechanism === 'permission-deny', hard.mechanism);
  check('...and rejects the hook FOR THE DOCUMENTED REASON', /fails OPEN/.test(hard.rejected));
  const soft = A('Block writes to `infra/` so people do not edit it casually.');
  check('guarantee without a fail-closed clause selects a hook', soft.mechanism === 'hook', soft.mechanism);
  check('...and still surfaces the deny rule users never consider', soft.notes.some((n) => /deny rule/i.test(n)));
  const advisory = A('It would be good to protect `infra/` from accidental edits.');
  check('a protection ask with no guarantee language leaves advisory legitimate',
    advisory.mechanism === 'advisory', advisory.mechanism || advisory.reason);
  const notprotection = A('Prefer to keep changes to `infra/` in a separate commit.');
  check('a non-protection ask about a path is REFUSED, not force-fitted',
    notprotection.supported === false, 'this is not a protection requirement at all');
  const nopath = A('Everything must always be safe and correct.');
  check('a requirement with no extractable path is REFUSED, not guessed', nopath.supported === false);
  const notprotect = A('Summarise `docs/**` into a changelog every session.');
  check('a non-protection requirement is REFUSED', notprotect.supported === false);

  console.log('target extraction and globbing:');
  check('backticked path', extractTarget('protect `infra/` please') === 'infra/');
  check('quoted path', extractTarget('protect "config/secrets" now') === 'config/secrets');
  check('bare directory token', extractTarget('nothing may change infra/prod files') === 'infra/prod');
  check('dotfile', extractTarget('never touch .env again') === '.env');
  check('directory becomes a subtree glob', toGlob('infra/') === 'infra/**');
  check('bare directory becomes a subtree glob', toGlob('infra') === 'infra/**');
  check('an existing glob is left alone', toGlob('infra/**') === 'infra/**');
  check('a single file is not turned into a subtree', toGlob('.env') === '.env');

  console.log('emitted spec:');
  const c1 = conformanceFor('x', 'r', hard);
  check('fail-closed requirement emits fail-posture cases', c1.cases.filter((c) => c.kind === 'fail-posture').length === 2);
  const c2 = conformanceFor('x', 'r', soft);
  check('non-fail-closed requirement emits NO fail-posture cases', c2.cases.filter((c) => c.kind === 'fail-posture').length === 0,
    'emitting them would make a correct hook fail its own spec');
  check('every spec carries a near-miss, so a deny-everything bundle cannot pass', c2.cases.some((c) => c.kind === 'near-miss'));
  check('every spec carries a wiring case', c2.cases.some((c) => c.kind === 'wiring'));

  // Regression: a single-file target must not have "/main.tf" appended, or the
  // deny rule cannot match its own cases and the bundle fails its own spec.
  // Found by independent review 2026-08-04; no verify-spec check caught it.
  const fileHard = A('Never allow modification of `config/prod.secrets.yaml`. This must hold even if the guard crashes.');
  check('a single-file requirement is still supported', fileHard.supported === true, fileHard.reason || '');
  check('...and keeps the file as the glob, not a subtree', fileHard.glob === 'config/prod.secrets.yaml', fileHard.glob);
  const cFile = conformanceFor('x', 'r', fileHard);
  const paths = cFile.cases.map((c) => c.input.tool_input.file_path);
  check('SINGLE-FILE REGRESSION: no case appends /main.tf to a file target',
    !paths.some((p) => p.startsWith('config/prod.secrets.yaml/')), paths.join(' '));
  check('...every enforce and fail-posture case targets the file itself',
    cFile.cases.filter((c) => c.kind === 'enforce' || c.kind === 'fail-posture')
      .every((c) => c.input.tool_input.file_path === 'config/prod.secrets.yaml'));
  check('...and no nested case is invented for a file', !cFile.cases.some((c) => /nested/.test(c.input.tool_input.file_path)));
  check('...case ids stay contiguous when the nested case is dropped',
    cFile.cases.map((c) => c.id).join(',') === 'C1,C2,C3,C4,C5,C6', cFile.cases.map((c) => c.id).join(','));

  console.log('vocabulary:');
  check('"Never allow modification of X" is recognised as protection',
    A('Never allow modification of `infra/`.').supported === true);
  check('"must not be overwritten" is recognised',
    A('The file `.env` must not be overwritten.').supported === true);

  console.log(`\n${f === 0 ? 'SELF-TEST PASS' : `SELF-TEST FAIL (${f})`}`);
  return f === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  const ri = argv.indexOf('--requirement');
  const oi = argv.indexOf('--out');
  if (ri < 0 || oi < 0) {
    console.error('usage: node tools/extension-scaffold.mjs --requirement "<text>" --out <dir> [--name <name>]');
    console.error('       node tools/extension-scaffold.mjs --self-test');
    process.exit(2);
  }
  const ni = argv.indexOf('--name');
  process.exit(scaffold(argv[ri + 1], resolve(argv[oi + 1]), ni >= 0 ? argv[ni + 1] : 'generated-extension'));
}

if (IS_MAIN) main();
