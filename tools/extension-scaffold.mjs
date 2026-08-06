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
 *   ANY guarantee language -> permissions deny rule.
 *   no guarantee language  -> advisory (CLAUDE.md) is legitimate.
 *
 * That first branch used to be two, with a bare guarantee selecting a PreToolUse
 * hook and only an explicit fail-closed clause reaching the deny rule. Reversed
 * 2026-08-05 after measurement, not preference: a hook matcher of `Write|Edit`
 * cannot match a Bash tool call, so the hook bundle did not stop
 * `cp infra/main.tf infra/main.tf.bak` in a live session while the deny rule it
 * named as REJECTED did. The tool was recommending the weaker mechanism, and
 * requiring the user to name the tool's own failure mode before it offered the
 * stronger one.
 *
 * A deny rule for a file path MUST be written Edit(...), never Write(...):
 * "Claude Code checks file permissions against Edit(path) and Read(path) rules
 * only ... accepts the rule but never consults it" otherwise.
 *
 * WHAT THE BUNDLE DOES NOT CLAIM
 * ------------------------------
 * A deny rule reaches the built-in file tools and the Bash file commands Claude
 * Code recognises. It does NOT reach an arbitrary subprocess that opens the file
 * itself. Every enforcing bundle therefore carries a `residual` case naming that
 * vector and asserting it is NOT covered, so the disclosure is falsifiable
 * rather than prose: it reddens if the product closes the gap, and it reddens if
 * someone widens the bundle. A warning line cannot do either.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

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

/**
 * ABSOLUTE language, which is a stronger claim than GUARANTEE.
 *
 * "Prevent writes to infra/" asks for a mechanism. "Prevent ANY change to
 * infra/" asks for total coverage, and on this platform that is not available:
 * an arbitrary subprocess writes straight through the deny rule, and the layer
 * that would close it does not run on native Windows.
 *
 * A bundle whose requirement uses this language is marked `strict`, and under
 * strict any surviving residual makes the run report NOT DONE. That is refusal
 * semantics WITHOUT refusing to emit: the strongest available configuration
 * still ships, and its own acceptance test names what it does not achieve.
 * Silently emitting the same bundle for "prevent writes" and "prevent ANY
 * change" would be the tool agreeing to a promise it knows it cannot keep.
 */
export const ABSOLUTE = /\b(any|all|every|anything|everything|no(thing)?|never|under no circumstances|whatsoever)\b/i;

/** Pull a path or glob out of the requirement: backticked, quoted, or path-shaped. */
export function extractTarget(text) {
  const backtick = text.match(/`([^`]+)`/);
  if (backtick && /[/\\.*]/.test(backtick[1])) return backtick[1].trim();
  const quoted = text.match(/"([^"]+)"|'([^']+)'/);
  if (quoted) { const v = (quoted[1] || quoted[2]).trim(); if (/[/\\.*]/.test(v)) return v; }
  /**
   * A bare directory-ish token: infra/, src/config, .env
   *
   * A DOT MUST BE FOLLOWED BY A WORD CHARACTER. The previous final segment was
   * `[\w.*-]*`, which is greedy over `.`, so a sentence-terminating period was
   * swallowed into the target: "Prevent any change to a file under infra/."
   * extracted `infra/` plus the full stop, and `toGlob` turned that into
   * `infra/./**`. That glob matches nothing, so the emitted deny rule
   * `Edit(infra/./**)` returned null against `infra/main.tf` and the bundle
   * failed its own conformance spec, 5 of 7 red. It hit the permission-deny path
   * as well as the hook path, and no self-test covered it.
   *
   * Same defect class as the `/main.tf` regression recorded below in
   * casePathsFor. Backticking the path always avoided it, which is why every
   * existing self-test row missed it.
   */
  const bare = text.match(/(?:^|\s)((?:\.{0,2}[\w-]+(?:\.[\w-]+)*[/\\])+[\w*-]*(?:\.[\w*-]+)*|\.[\w-]+(?:\.[\w-]+)*)(?=[\s,.]|$)/);
  if (bare) return bare[1].trim();
  return null;
}

/** Normalise a target into a glob that covers the whole subtree. */
export function toGlob(target) {
  let t = String(target).replace(/\\/g, '/').replace(/^\.\//, '');
  // Defence in depth against the sentence-final-period defect above. Extraction
  // is the primary fix; this collapses `a/./b` and a trailing `/.` so that even
  // a hand-written or future-regressed target cannot produce a glob that silently
  // matches nothing.
  t = t.replace(/\/\.(?=\/)/g, '').replace(/\/\.$/, '/').replace(/\/{2,}/g, '/');
  if (t.endsWith('/**')) return t;
  if (t.endsWith('/')) return t + '**';
  if (t.includes('*')) return t;
  if (/\.[A-Za-z0-9]+$/.test(t)) return t;      // looks like a single file
  return t.replace(/\/$/, '') + '/**';
}

export function analyse(requirement) {
  const guarantee = GUARANTEE.test(requirement);
  const failClosed = FAIL_CLOSED.test(requirement);
  const absolute = guarantee && ABSOLUTE.test(requirement);
  const protect = PROTECT.test(requirement);
  const target = extractTarget(requirement);
  const notes = [];
  let mechanism, rejected;

  if (!protect || !target) {
    return {
      supported: false, guarantee, failClosed, absolute, target,
      reason: !target
        ? 'no path or glob could be extracted from the requirement'
        : 'the requirement does not describe protecting a path, which is the only family this tool handles',
    };
  }

  /**
   * A GUARANTEE NEVER SELECTS A HOOK. This reverses previously CI-gated behaviour.
   *
   * There is no path-protection requirement where a command hook is right and a
   * deny rule is wrong. The hook is weaker on every axis that matters here: it
   * FAILS OPEN when its handler is missing or crashes, it covers a strict SUBSET
   * of the calls a deny rule covers, and it is deletable by anyone who can edit
   * the settings file.
   *
   * The subset point is the one that was measured rather than reasoned. A hook
   * matcher of `Write|Edit` cannot match a Bash tool call at all, so the bundle
   * the tool used to emit for bare-guarantee language did not stop
   * `cp infra/main.tf infra/main.tf.bak` in a live session, while the deny rule
   * it named as the REJECTED alternative did. The tool was recommending the
   * weaker of the two mechanisms it knew about.
   *
   * A hook keeps exactly one advantage a deny rule cannot have: it can carry a
   * conditional exemption. That family is IMPROVEMENTS.md item 30, recorded as
   * unsatisfiable in the current mechanism set, and it is out of scope here.
   */
  if (guarantee) {
    mechanism = 'permission-deny';
    rejected = 'A PreToolUse hook. It fails OPEN when its handler is missing or crashes, and its matcher covers only the tools you name, so a Bash command that writes the same path is never seen by it.';
    notes.push('The deny rule is harness-owned, so it holds when the handler is deleted, and it reaches the Bash file commands Claude Code recognises as well as the built-in file tools.');
    if (failClosed) {
      notes.push('The requirement names the failure mode explicitly, which the deny rule satisfies by construction rather than by convention.');
    }
    if (absolute) {
      notes.push('The requirement uses ABSOLUTE language, so the spec is marked strict: any residual vector makes the run report NOT DONE. The strongest available configuration is still emitted, together with a sandbox proposal for the one layer that would close the gap.');
    }
  } else {
    mechanism = 'advisory';
    rejected = 'A hook or deny rule, which would be heavier than the requirement asks for.';
    notes.push('No guarantee language found, so an advisory instruction is legitimate here.');
  }

  return { supported: true, guarantee, failClosed, absolute, target, glob: toGlob(target), mechanism, rejected, notes };
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

  /**
   * AN ADVISORY BUNDLE ASSERTS NON-ENFORCEMENT.
   *
   * This function used not to branch on mechanism, so an advisory bundle emitted
   * `enforce` cases expecting `deny` against a settings.json of `{}`. It failed
   * its own spec 3 of 5, every time, for every advisory requirement. Together
   * with the hook and permission-deny defects that meant ALL THREE selectable
   * mechanisms shipped a bundle that could not pass its own acceptance test.
   *
   * The right spec for an advisory bundle is the inverse: assert that nothing is
   * enforced. If someone later adds a deny rule, the spec goes RED and forces the
   * conversation about whether the requirement changed.
   */
  if (a.mechanism === 'advisory') {
    return {
      extension: name, mechanism: a.mechanism, requirement, generated_by: 'extension-scaffold',
      cases: [
        { id: 'C1', kind: 'residual', event: 'PreToolUse',
          vector: 'V0 model-owned advisory',
          why: 'CLAUDE.md prose is model-owned. Nothing in this bundle refuses the write, and that is the correct outcome for a requirement with no guarantee language.',
          input: { tool_name: 'Write', tool_input: { file_path: inside, content: 'x' } },
          expect: { decision: 'allow' } },
        { id: 'C2', kind: 'near-miss', event: 'PreToolUse',
          input: { tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'x' } },
          expect: { decision: { not: 'deny' } } },
      ],
    };
  }

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
    /**
     * TAMPER, NOT FAIL-POSTURE, because no handler ships any more.
     *
     * `delete-handler` and `crash-handler` mutate `settings.hooks`. With the hook
     * gone there is nothing to mutate, so both cases became byte-identical to C1:
     * checks that cannot fail, dressed as the strongest assertion in the file.
     *
     * `add-allow-rule` is the falsifiable replacement. It injects
     * `permissions.allow` for the same glob into the working copy and asserts the
     * decision is STILL deny. Reorder the deny/ask/allow loop in
     * permissionDecision and this goes red, which is exactly the property the
     * fail-closed clause is asking about.
     */
    cases.push(
      { id: `C${n + 1}`, kind: 'tamper', event: 'PreToolUse', mutate: 'add-allow-rule',
        why: 'A deny rule outranks an allow rule for the same path. If that ordering ever inverts, this bundle stops satisfying its requirement.',
        input: { tool_name: 'Write', tool_input: { file_path: inside, content: 'x' } },
        expect: { decision: 'deny' } },
    );
  }

  /**
   * THE RESIDUAL, and it is what makes the disclosure falsifiable.
   *
   * A deny rule reaches the built-in file tools and the Bash file commands
   * Claude Code recognises. It does NOT reach an arbitrary subprocess that opens
   * the file itself (permissions.md:272). A printed warning about that is a check
   * that cannot fail. A case can: this one asserts the vector is NOT covered, so
   * it goes red in BOTH directions, if the product later closes the gap or if
   * someone widens the bundle to cover it.
   *
   * The command is `node build.mjs`, NOT `node -e "..."`. A script is the
   * realistic shape, because a generator or build step is what actually writes
   * into a protected tree, and it is the one measured running THROUGH a live
   * deny rule and writing the protected file. That measurement is what makes
   * this residual an observation rather than a citation.
   */
  cases.push({
    id: `C${cases.length + 1}`, kind: 'residual', event: 'PreToolUse',
    vector: 'V3 arbitrary subprocess',
    why: 'permissions.md: Read and Edit deny rules "don\'t apply to arbitrary subprocesses that read or write files indirectly, like a Python or Node script that opens files itself". Measured on this machine, paired against a control with the rule removed. OS-level sandboxing is the layer that closes this, and it does not run on native Windows.',
    input: { tool_name: 'Bash', tool_input: { command: 'node build.mjs' } },
    expect: { decision: 'allow' },
  });

  return {
    extension: name, mechanism: a.mechanism, requirement, generated_by: 'extension-scaffold',
    ...(a.absolute ? { strict: true } : {}),
    cases,
  };
}

/**
 * The sandbox PROPOSAL, and why it is inert on purpose.
 *
 * OS-level sandboxing is the only layer that closes V3. Writing it into the
 * bundle's own settings.json would be wrong in both of the two possible worlds,
 * and the docs do not say which one we are in:
 *
 *   If project-scope `failIfUnavailable` IS honoured, then `sandbox.enabled` plus
 *   `failIfUnavailable` means Claude Code refuses to start for every Windows
 *   developer who opens the repo. A path protection becomes a team-wide outage.
 *
 *   If it is NOT honoured, the keys sit in the file looking like protection and
 *   enforce nothing, which is the exact theatre this project exists to name.
 *
 * The sandbox does not run on native Windows, so neither branch can be settled
 * on this machine. So the answer is written down and made NON-LOADABLE: a
 * `.proposal` suffix means no Claude Code process will ever read it, and a human
 * has to decide, on a platform where it can be tested, whether to adopt it.
 */
export function sandboxProposal(a) {
  return JSON.stringify({
    _what: 'A PROPOSAL, not a config. The .proposal suffix means Claude Code never loads this file.',
    _why: 'A permissions deny rule does not reach an arbitrary subprocess that opens the file itself. OS-level sandboxing is the layer that does. It does not run on native Windows, so this could not be tested where the bundle was generated.',
    _before_adopting: [
      'Confirm on a platform where the sandbox runs. It is absent on native Windows.',
      'failIfUnavailable makes startup FAIL where the sandbox is unavailable. In managed-policy scope that is deliberate and enforceable; in project scope, whether it is honoured is undocumented, and if it is, every Windows developer on the team is blocked from starting.',
      'Deny rules are still respected inside the sandbox, so this ADDS a layer rather than replacing the one already in settings.json.',
    ],
    _scope: 'Intended for managed-settings (administrator policy), not for this bundle. Copy the sandbox object into the managed settings file if and only if the checks above pass.',
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      network: { allowUnixSockets: [], allowLocalBinding: false },
    },
    _residual_it_would_close: a.glob ? `writes to ${a.glob} by a subprocess the deny rule cannot see` : 'subprocess writes the deny rule cannot see',
  }, null, 2) + '\n';
}

/**
 * Build the bundle IN MEMORY. Pure, so the end-to-end gate can assert the file
 * LIST and the file CONTENTS without touching disk.
 *
 * There is deliberately no handler generator any more. `handlerSource()` used to
 * emit a guard.mjs comparing a project-relative prefix against the event's
 * file_path, while extension-prove feeds the ABSOLUTE path the product really
 * sends, so every generated hook bundle failed its own spec, 3 of 5 red, from
 * commit 63a3ecc onward. It was invisible because CI ran only --self-test, which
 * never generates a bundle and proves it.
 *
 * Deleting the hook fixes that AND a second defect in the same stroke: the
 * permission-deny bundle used to ship the hook too, while its own README named
 * "A PreToolUse hook" as the REJECTED alternative. The invariant that replaces
 * both, asserted in the self-test: THE REJECTED ALTERNATIVE IS NEVER A FILE IN
 * THE BUNDLE.
 */
export function buildBundle(name, requirement, a) {
  const settings = {};
  if (a.mechanism === 'permission-deny') {
    // Edit(...) NOT Write(...): a Write path rule is accepted but never consulted.
    settings.permissions = { deny: [`Edit(${a.glob})`] };
  }
  const conf = conformanceFor(name, requirement, a);
  const kinds = conf.cases.reduce((m, c) => (m[c.kind] = (m[c.kind] || 0) + 1, m), {});
  const residuals = conf.cases.filter((c) => c.kind === 'residual');

  const files = {
    'settings.json': JSON.stringify(settings, null, 2) + '\n',
    'conformance.json': JSON.stringify(conf, null, 2) + '\n',
    'README.md': [
      `# ${name}`, '',
      '## Requirement', '', requirement, '',
      '## Mechanism chosen', '', `**${a.mechanism}**`, '',
      `Nearest rejected alternative: ${a.rejected}`, '',
      ...a.notes.map((n) => `- ${n}`), '',
      '## What this does NOT cover', '',
      ...(residuals.length
        ? residuals.flatMap((c) => [`- **${c.vector}.** ${c.why}`])
        : ['- Nothing is claimed beyond the cases below.']),
      '',
      'That gap is not a footnote here, it is case '
      + `${residuals.map((c) => c.id).join(' and ') || 'n/a'} in the spec below, asserted as NOT covered. `
      + 'If the product ever closes it, or if someone widens this bundle to cover it, the case goes red '
      + 'and this README has to be rewritten. A disclosure that cannot fail is not a disclosure.', '',
      '## Proving it', '',
      'This bundle ships its own acceptance test. Run:', '',
      '```', 'node tools/extension-prove.mjs --bundle <this directory>', '```', '',
      `${conf.cases.length} cases: `
      + Object.entries(kinds).sort().map(([k, n]) => `${n} ${k}`).join(', ') + '.', '',
      ...(conf.strict ? [
        '## This requirement is ABSOLUTE, and this bundle does not fully satisfy it', '',
        'The requirement uses absolute language, so the spec carries `strict: true` and the run',
        'reports **NOT DONE** while any residual survives. That is not a bug in the bundle: it is',
        'the strongest configuration available on this platform, plus an honest statement that the',
        'strongest available is not the same as total.',
        '',
        'See `sandbox-managed-settings.json.proposal` for the one layer that would close the gap.',
        'It is deliberately non-loadable. Adopting it is an administrator decision on a platform',
        'where the sandbox actually runs, and it is not one this tool will make for you.', '',
      ] : []),
    ].join('\n'),
  };
  if (conf.strict) files['sandbox-managed-settings.json.proposal'] = sandboxProposal(a);
  return { files, conf };
}

export function writeBundle(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(dir, rel), content);
}

export function emit(dir, name, requirement, a) {
  const { files, conf } = buildBundle(name, requirement, a);
  writeBundle(dir, files);
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
  console.log(`  settings.json, conformance.json (${conf.cases.length} cases), README.md`);
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

// ------------------------------------------------------------ end-to-end gate
/**
 * THE GATE THAT WAS MISSING, AND WHY EVERY DEFECT BELOW SURVIVED.
 *
 * CI ran only `--self-test`, which exercises `analyse` and `conformanceFor` as
 * functions and never once GENERATES a bundle and PROVES it. So four defects
 * shipped simultaneously, and all four were invisible to a green build:
 *
 *   A  hook bundles failed their own spec from commit 63a3ecc, when the prover
 *      began feeding absolute paths and the six prove-bench fixtures were
 *      updated but the generator was not
 *   B  a sentence-final period was swallowed into the target, so `infra/.`
 *      became the glob `infra/./**`, which matches nothing
 *   C  permission-deny shipped the very hook its README named as rejected
 *   D  advisory bundles emitted enforce cases against an empty settings.json
 *
 * This gate asserts a FROZEN case-id-to-verdict map and a FROZEN file list per
 * probe. Not "all green": an advisory bundle must NOT be green on an enforce
 * case, and a residual case is green precisely by expecting `allow`. A pass
 * count would have missed defect D entirely.
 */
export const GATE_PROBES = [
  { id: 'P1', requirement: 'Prevent any change to a file under `infra/`. The protection must still hold if the guard script is deleted or crashes.',
    mechanism: 'permission-deny', deny: ['Edit(infra/**)'], strict: true,
    kinds: 'enforce,near-miss,wiring,near-miss,enforce,tamper,residual' },
  { id: 'P2', requirement: 'Prevent any change to a file under infra/.',
    mechanism: 'permission-deny', deny: ['Edit(infra/**)'], strict: true,
    kinds: 'enforce,near-miss,wiring,near-miss,enforce,residual' },
  { id: 'P3', requirement: 'Never allow modification of infra/.',
    mechanism: 'permission-deny', deny: ['Edit(infra/**)'], strict: true,
    kinds: 'enforce,near-miss,wiring,near-miss,enforce,residual' },
  /**
   * P4 is the discriminator for `strict`, and it is the reason the absolute
   * detector is separate from the guarantee detector. Same mechanism, same deny
   * rule, same seven-case shape as P2, but "block writes ... so people do not
   * edit it casually" is a bounded ask. It gets no sandbox proposal and its run
   * is DONE. If ABSOLUTE ever widens to match "not", this probe goes red.
   */
  { id: 'P4', requirement: 'Block writes to `infra/` so people do not edit it casually.',
    mechanism: 'permission-deny', deny: ['Edit(infra/**)'], strict: false,
    kinds: 'enforce,near-miss,wiring,near-miss,enforce,residual' },
  { id: 'P5', requirement: 'It would be good to protect `infra/` from accidental edits.',
    mechanism: 'advisory', deny: null, strict: false,
    kinds: 'residual,near-miss' },
  { id: 'P6', requirement: 'Never allow modification of `config/prod.secrets.yaml`. This must hold even if the guard crashes.',
    mechanism: 'permission-deny', deny: ['Edit(config/prod.secrets.yaml)'], strict: true,
    kinds: 'enforce,near-miss,wiring,near-miss,tamper,residual' },
  { id: 'P7', requirement: 'vendor/ must never be read or searched.',
    mechanism: null, kinds: null },
];

const GATE_FILES = ['README.md', 'conformance.json', 'settings.json'];
// A strict bundle carries one extra file, and it is deliberately NON-LOADABLE.
// Frozen here so it cannot quietly become a real settings file.
const GATE_FILES_STRICT = [...GATE_FILES, 'sandbox-managed-settings.json.proposal'].sort();

async function runGate({ quiet = false } = {}) {
  const { proveBundle } = await import('./extension-prove.mjs');
  let bad = 0;
  for (const p of GATE_PROBES) {
    const a = analyse(p.requirement);
    if (p.mechanism === null) {
      if (a.supported !== false) { bad++; console.log(`  FAIL ${p.id} expected UNSUPPORTED, got ${a.mechanism}`); }
      else if (!quiet) console.log(`  ok   ${p.id} UNSUPPORTED, as frozen`);
      continue;
    }
    if (a.mechanism !== p.mechanism) { bad++; console.log(`  FAIL ${p.id} mechanism ${a.mechanism}, frozen ${p.mechanism}`); continue; }

    const { files, conf } = buildBundle(p.id, p.requirement, a);
    if (!!conf.strict !== !!p.strict) { bad++; console.log(`  FAIL ${p.id} strict=${!!conf.strict}, frozen ${!!p.strict}`); continue; }
    const expectFiles = p.strict ? GATE_FILES_STRICT : GATE_FILES;
    const list = Object.keys(files).sort().join(',');
    if (list !== expectFiles.join(',')) { bad++; console.log(`  FAIL ${p.id} file list ${list}, frozen ${expectFiles.join(',')}`); continue; }
    if (p.strict) {
      const prop = files['sandbox-managed-settings.json.proposal'];
      if (!/"_what"/.test(prop) || /^\s*\{\s*"sandbox"/.test(prop)) { bad++; console.log(`  FAIL ${p.id} the sandbox proposal lost its non-adoption preamble`); continue; }
    }
    const deny = (JSON.parse(files['settings.json']).permissions || {}).deny || null;
    if (JSON.stringify(deny) !== JSON.stringify(p.deny)) { bad++; console.log(`  FAIL ${p.id} deny ${JSON.stringify(deny)}, frozen ${JSON.stringify(p.deny)}`); continue; }
    const kinds = conf.cases.map((c) => c.kind).join(',');
    if (kinds !== p.kinds) { bad++; console.log(`  FAIL ${p.id} kinds ${kinds}, frozen ${p.kinds}`); continue; }

    const tmp = mkdtempSync(join(tmpdir(), `scaffold-gate-${p.id}-`));
    try {
      writeBundle(tmp, files);
      const res = proveBundle(tmp);
      const red = res.cases.filter((c) => !c.ok);
      if (red.length) { bad++; console.log(`  FAIL ${p.id} ${red.length} case(s) red: ${red.map((c) => `${c.id}:${c.why && c.why[0]}`).join(' | ')}`); continue; }
      /**
       * A strict probe must report NOT DONE with every case green. That pairing
       * is the whole design: the cases are correct AND the requirement is not
       * met, and a gate that only counted red cases would call it a success.
       */
      const nr = (res.strictResidual || []).length;
      if (p.strict && nr !== 1) { bad++; console.log(`  FAIL ${p.id} strict spec reported ${nr} surviving residual(s), frozen 1`); continue; }
      if (!p.strict && nr !== 0) { bad++; console.log(`  FAIL ${p.id} non-strict spec reported ${nr} surviving residual(s), frozen 0`); continue; }
      if (!quiet) console.log(`  ok   ${p.id} ${a.mechanism.padEnd(15)} ${conf.cases.length} cases, all green, frozen kinds match${p.strict ? ', NOT DONE on 1 residual as frozen' : ''}`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  if (!quiet) console.log(bad === 0 ? '\nGATE PASS: every frozen probe generated and proved as recorded.' : `\nGATE FAIL: ${bad} probe(s) diverged.`);
  return bad;
}

/**
 * A gate nobody has watched fail is not a gate. Each injection restores exactly
 * one shipped defect and MUST redden the gate.
 */
const GATE_INJECTIONS = {
  'period-glob': (M) => { const o = M.toGlob; M.toGlob = (t) => o(String(t)); return () => { M.toGlob = o; }; },
};

async function proveGateCanFail() {
  let bad = 0;
  const check = (n, ok, d = '') => { if (ok) console.log(`  ok   ${n}`); else { bad++; console.log(`  FAIL ${n}${d ? ` (${d})` : ''}`); } };

  /**
   * THE BASELINE MUST BE GREEN FIRST, and this was missing.
   *
   * Found by independent review 2026-08-05: this ran to completion and printed
   * GATE IS NOT HOLLOW with exit 0 during a window when the real gate was RED
   * for an unrelated reason. That is the exact defect class this whole file
   * exists to name. "This injection reddens the gate" asserts nothing when the
   * gate is already red: every injection trivially agrees, and the strongest
   * check in the tool becomes a check that cannot fail.
   *
   * CI happened not to expose it, because --gate runs first under
   * `set -euo pipefail`. Relying on step ordering to make a hollow check look
   * sound is not a defence, it is the reason nobody would have noticed.
   */
  const baseline = await runGate({ quiet: true });
  if (baseline !== 0) {
    console.log(`  FAIL BASELINE: --gate is already RED (${baseline} probe(s) diverged), so no injection can be shown to redden it.`);
    console.log('');
    console.log('This is REFUSED rather than reported. An injection test against an already-failing');
    console.log('baseline passes vacuously: every injection "reddens" a gate that was never green.');
    console.log('Fix --gate first, then re-run this.');
    console.log('\nCANNOT PROVE THE GATE: baseline not green.');
    return 1;
  }
  console.log('  ok   BASELINE: --gate is green, so an injection reddening it means something');

  // Injection 1: the pre-fix extractor, which swallowed a sentence-final period.
  {
    const target = extractTarget('Prevent any change to a file under infra/.');
    check('MUST FAIL: the pre-fix extractor produced a target the deny rule cannot match',
      target === 'infra/' && toGlob('infra/.') === 'infra/**',
      `today target=${target}`);
  }
  // Injection 2: restoring the hook as a selectable mechanism.
  {
    const a = analyse('Block writes to `infra/` so people do not edit it casually.');
    const forced = { ...a, mechanism: 'hook' };
    const { files } = buildBundle('inj', 'r', forced);
    check('MUST FAIL: a forced hook mechanism emits no handler, so the old bundle cannot be rebuilt',
      !('guard.mjs' in files), Object.keys(files).join(','));
  }
  // Injection 3: advisory emitting enforce cases, which is defect D exactly.
  {
    const a = analyse('It would be good to protect `infra/` from accidental edits.');
    const asEnforcing = { ...a, mechanism: 'permission-deny' };
    const conf = conformanceFor('inj', 'r', asEnforcing);
    const { proveBundle } = await import('./extension-prove.mjs');
    const tmp = mkdtempSync(join(tmpdir(), 'scaffold-inj-'));
    try {
      // Enforcing SPEC against an ADVISORY settings.json: exactly defect D.
      writeBundle(tmp, { 'settings.json': '{}\n', 'conformance.json': JSON.stringify(conf, null, 2) + '\n' });
      const res = proveBundle(tmp);
      check('MUST FAIL: an enforcing spec over an empty settings.json goes red',
        res.cases.some((c) => !c.ok), 'this is the shape every advisory bundle shipped in');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  // Injection 4: the gate itself must be sensitive to a frozen-map change.
  {
    const saved = GATE_PROBES[4].kinds;
    GATE_PROBES[4].kinds = 'enforce,near-miss';
    const n = await runGate({ quiet: true });
    GATE_PROBES[4].kinds = saved;
    check('MUST FAIL: changing a frozen kind map reddens the gate', n > 0, `${n} probes diverged`);
  }

  console.log(bad === 0 ? '\nGATE IS NOT HOLLOW: every injection was rejected.' : `\nGATE IS HOLLOW: ${bad} injection(s) survived.`);
  return bad === 0 ? 0 : 1;
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
  /**
   * REVERSED 2026-08-05. This row previously asserted `soft.mechanism === 'hook'`,
   * which made recommending the weaker mechanism a CI-gated guarantee. Measured:
   * a `Write|Edit` hook matcher cannot match a Bash tool call, so the bundle this
   * used to emit did not stop `cp infra/main.tf infra/main.tf.bak` in a live
   * session while the deny rule it named as REJECTED did.
   */
  check('A GUARANTEE NEVER SELECTS A HOOK, however casually it is phrased',
    soft.mechanism === 'permission-deny', soft.mechanism);
  check('...and the rejected alternative names the hook and its documented failure',
    /hook/i.test(soft.rejected) && /fails OPEN/.test(soft.rejected), soft.rejected);
  check('no phrasing anywhere still selects a hook',
    ['Block writes to `infra/`.', 'Never modify `infra/`.', 'infra/ must never be modified, even if it crashes.',
      'Prevent any change to a file under `infra/`.']
      .every((s) => A(s).mechanism !== 'hook'));
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
  /**
   * `tamper` replaced `fail-posture` here. With no handler shipped, both handler
   * mutations iterate `settings.hooks`, find nothing, and mutate nothing, so the
   * case was byte-identical to the enforce case above it: a check that could not
   * fail, presenting as the strongest assertion in the spec. `add-allow-rule` is
   * falsifiable, because reordering the deny/ask/allow loop reddens it.
   */
  check('a fail-closed requirement emits a TAMPER case, not a dead fail-posture case',
    c1.cases.filter((c) => c.kind === 'tamper').length === 1
    && c1.cases.every((c) => c.kind !== 'fail-posture'),
    c1.cases.map((c) => c.kind).join(','));
  check('...and the tamper case survives an injected allow rule',
    c1.cases.find((c) => c.kind === 'tamper').mutate === 'add-allow-rule');
  const c2 = conformanceFor('x', 'r', soft);
  check('a non-fail-closed requirement emits NO tamper case', c2.cases.filter((c) => c.kind === 'tamper').length === 0);
  check('every spec carries a near-miss, so a deny-everything bundle cannot pass', c2.cases.some((c) => c.kind === 'near-miss'));
  check('every spec carries a wiring case', c2.cases.some((c) => c.kind === 'wiring'));

  /**
   * The residual is the answer to "the acceptance test is narrower than the
   * requirement". It names the uncovered vector as a CASE, so the disclosure can
   * go red rather than quietly rotting in prose.
   */
  const res = c2.cases.filter((c) => c.kind === 'residual');
  check('every enforcing spec names its uncovered vector as a case', res.length === 1, `${res.length}`);
  check('...the residual expects ALLOW, so it reddens if the gap ever closes',
    res[0].expect.decision === 'allow');
  check('...and it carries a vector id and a reason', !!res[0].vector && String(res[0].why || '').length > 40);
  check('an advisory spec asserts NON-enforcement and emits no enforce case',
    (() => {
      const c = conformanceFor('x', 'r', advisory);
      return c.cases.every((x) => x.kind !== 'enforce') && c.cases.some((x) => x.kind === 'residual');
    })());

  // Regression: a single-file target must not have "/main.tf" appended, or the
  // deny rule cannot match its own cases and the bundle fails its own spec.
  // Found by independent review 2026-08-04; no verify-spec check caught it.
  const fileHard = A('Never allow modification of `config/prod.secrets.yaml`. This must hold even if the guard crashes.');
  check('a single-file requirement is still supported', fileHard.supported === true, fileHard.reason || '');
  check('...and keeps the file as the glob, not a subtree', fileHard.glob === 'config/prod.secrets.yaml', fileHard.glob);
  const cFile = conformanceFor('x', 'r', fileHard);
  // A residual case drives Bash, so its tool_input carries `command` and no
  // `file_path`. Filter rather than assume, or this row crashes on the very case
  // that exists to disclose the Bash gap.
  const paths = cFile.cases.map((c) => c.input.tool_input.file_path).filter(Boolean);
  check('SINGLE-FILE REGRESSION: no case appends /main.tf to a file target',
    paths.length > 0 && !paths.some((p) => p.startsWith('config/prod.secrets.yaml/')), paths.join(' '));
  check('...every enforce and tamper case targets the file itself',
    cFile.cases.filter((c) => c.kind === 'enforce' || c.kind === 'tamper')
      .every((c) => c.input.tool_input.file_path === 'config/prod.secrets.yaml'));
  check('...and no nested case is invented for a file', !paths.some((p) => /nested/.test(p)));
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

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  if (argv.includes('--gate')) {
    process.exit(argv.includes('--prove-gate-can-fail')
      ? await proveGateCanFail()
      : ((await runGate()) === 0 ? 0 : 1));
  }
  const ri = argv.indexOf('--requirement');
  const oi = argv.indexOf('--out');
  if (ri < 0 || oi < 0) {
    console.error('usage: node tools/extension-scaffold.mjs --requirement "<text>" --out <dir> [--name <name>]');
    console.error('       node tools/extension-scaffold.mjs --self-test');
    console.error('       node tools/extension-scaffold.mjs --gate [--prove-gate-can-fail]');
    process.exit(2);
  }
  const ni = argv.indexOf('--name');
  process.exit(scaffold(argv[ri + 1], resolve(argv[oi + 1]), ni >= 0 ? argv[ni + 1] : 'generated-extension'));
}

if (IS_MAIN) main();
