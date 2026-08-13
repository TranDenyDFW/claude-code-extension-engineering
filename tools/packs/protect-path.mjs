#!/usr/bin/env node
/**
 * PURPOSE PACK: protect-path
 *
 * THE REFERENCE PACK. Everything below was MOVED verbatim out of
 * tools/extension-scaffold.mjs when the creator became pack-based, and moving it
 * is the whole point: this family has absorbed five shipped defects, four gates
 * that could not fail, and two independent review rounds, so it is the
 * behavioural baseline the pack interface has to preserve rather than a design to
 * revisit.
 *
 * Parity is proven, not asserted. tools/scaffold-parity.mjs holds the byte output
 * of all seven frozen probes captured BEFORE this move, and its --check compares
 * per file. If anything here changed behaviour, that gate goes red.
 *
 * ONE THING THAT IS NOT HERE, deliberately. A command hook is not a selectable
 * mechanism for path protection. It fails OPEN when its handler is deleted or
 * crashes, its Write|Edit matcher cannot see a Bash write at all, and the bundle
 * it used to emit did not stop `cp infra/main.tf infra/main.tf.bak` in a live
 * session while the deny rule it named as REJECTED did. IMPROVEMENTS item 31.
 * Requirements with no guarantee language get advisory; requirements with it get
 * the deny rule.
 */
import { readFileSync } from 'node:fs';

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
      'allowUnsandboxedCommands:false is Strict sandbox mode and is REQUIRED here, not optional. The escape hatch is ON by default: when a command fails under the sandbox, Claude may retry it with dangerouslyDisableSandbox, and that retry goes through the normal permission flow rather than being refused. A requirement that says "cannot be bypassed" is not satisfied while it is available. The cost is that a command which genuinely cannot run sandboxed must then be listed in excludedCommands, which runs it OUTSIDE the sandbox, so that list is the new boundary and belongs under the same review as this file.',
    ],
    _scope: 'Intended for managed-settings (administrator policy), not for this bundle. Copy the sandbox object into the managed settings file if and only if the checks above pass.',
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      /**
       * Added 2026-08-06 after independent review found the proposal incomplete.
       * Without this key the proposed remediation does not actually remove the
       * bypass it is being proposed to remove: sandboxing.md records that the
       * unsandboxed-retry escape hatch is ON by default, and that setting this to
       * false is what disables it. Emitting the other three keys and omitting this
       * one proposes a sandbox a command can still step outside of, which is the
       * shape of defect this whole tool exists to name.
       */
      allowUnsandboxedCommands: false,
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

export function extractTargetLegacy(text) {
  const backtick = text.match(/`([^`]+)`/);
  if (backtick && /[/\\.*]/.test(backtick[1])) return backtick[1].trim();
  const quoted = text.match(/"([^"]+)"|'([^']+)'/);
  if (quoted) { const v = (quoted[1] || quoted[2]).trim(); if (/[/\\.*]/.test(v)) return v; }
  const m = text.match(/(?:^|\s)((?:\.{0,2}[\w-]+(?:\.[\w-]+)*[/\\])+[\w.*-]*|\.[\w-]+(?:\.[\w-]+)*)(?=[\s,.]|$)/);
  return m ? m[1].trim() : null;
}

/** The pre-fix glob builder: no /./ collapse, so the swallowed period survives. */
export function toGlobLegacy(target) {
  let t = String(target).replace(/\\/g, '/').trim();
  if (t.endsWith('/**')) return t;
  if (t.endsWith('/')) return t + '**';
  if (t.includes('*')) return t;
  if (/\.[A-Za-z0-9]+$/.test(t)) return t;
  return t.replace(/\/$/, '') + '/**';
}

// ------------------------------------------------------------------ pack interface

/**
 * Does this pack handle the input?
 *
 * Routing is deterministic and never a classifier vote. This pack applies when a
 * requirement describes protecting a path AND a path can be extracted from it,
 * which is exactly the condition `analyse` already uses to decide supported.
 * A requirement carrying a validation POLICY is never this pack's, because a
 * policy is the other pack's required input and nothing here reads one.
 */
export function applies(input) {
  if (input && input.policy) return { applies: false, why: 'a validation policy was supplied, which this pack does not read' };
  const a = analyse(String((input && input.requirement) || ''));
  return a.supported
    ? { applies: true, why: `a path-protection requirement targeting ${a.target}` }
    : { applies: false, why: a.reason };
}

export const id = 'protect-path';
export const summary = 'Protect a path from change. Emits a permissions deny rule for a guarantee, advisory prose without one, plus a conformance spec that names what it does NOT cover.';
export const requires = [];

// The seven frozen probes. Byte-compared against pre-refactor goldens by
// tools/scaffold-parity.mjs, and case-map-compared by the scaffold's own --gate.
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
   * P4 is the discriminator for `strict`, and the reason the absolute detector is
   * separate from the guarantee detector. Same mechanism, same deny rule, same
   * shape as P2, but "block writes ... so people do not edit it casually" is a
   * bounded ask. No sandbox proposal, and the run is DONE. If ABSOLUTE ever
   * widens to match "not", this probe goes red.
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
    mechanism: null, kinds: null, expectUnsupported: true },
];

/** What analyse() is called with for a gate probe. This pack reads prose; the other reads a policy. */
export function gateInput(probe) { return probe.requirement; }

export const GATE_FILES = ['README.md', 'conformance.json', 'settings.json'];
// A strict bundle carries one extra file, and it is deliberately NON-LOADABLE.
export const GATE_FILES_STRICT = [...GATE_FILES, 'sandbox-managed-settings.json.proposal'].sort();

export function filesFor(probe) { return probe.strict ? GATE_FILES_STRICT : GATE_FILES; }

/**
 * Extra per-probe assertions the generic gate cannot know. Every key the sandbox
 * proposal needs to actually close the vector, asserted by name:
 * allowUnsandboxedCommands was MISSING until independent review found it, and a
 * preamble check could not catch that because the preamble was intact while the
 * config under it was incomplete.
 */
export function checkProbe(probe, files, conf, a) {
  const bad = [];
  // Mechanism and deny rule are this pack's frozen expectations, not the gate's.
  // They moved here when the gate became pack-generic: a gate that knew about
  // deny rules could only ever gate one pack.
  if (a && a.mechanism !== probe.mechanism) bad.push(`mechanism ${a.mechanism}, frozen ${probe.mechanism}`);
  const deny = (JSON.parse(files['settings.json']).permissions || {}).deny || null;
  if (JSON.stringify(deny) !== JSON.stringify(probe.deny)) bad.push(`deny ${JSON.stringify(deny)}, frozen ${JSON.stringify(probe.deny)}`);
  if (!probe.strict) return bad;
  const prop = files['sandbox-managed-settings.json.proposal'];
  if (!/"_what"/.test(prop) || /^\s*\{\s*"sandbox"/.test(prop)) return [...bad, 'the sandbox proposal lost its non-adoption preamble'];
  const sb = (JSON.parse(prop).sandbox) || {};
  const REQUIRED = { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false };
  return [...bad, ...Object.entries(REQUIRED).filter(([k, v]) => sb[k] !== v)
    .map(([k, v]) => `sandbox proposal: ${k} should be ${v}, got ${JSON.stringify(sb[k])}`)];
}
