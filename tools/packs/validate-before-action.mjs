#!/usr/bin/env node
/**
 * PURPOSE PACK: validate-before-action
 *
 * Generates a PreToolUse validation hook plus a falsifiable conformance spec from
 * an EXPLICIT policy file. Five families: command validation, dangerous-operation
 * blocking, required checks, document schema validation, and pre-deployment gates.
 *
 * THE RUNTIME IS EMITTED FROM THE FUNCTIONS TESTED HERE, VERBATIM.
 * `handlerSource()` serialises the exported functions below with
 * `Function.prototype.toString()`, so the code this file's self-test exercises and
 * the code that ships in a bundle are the same bytes. A generator that re-types
 * its runtime into a template string is testing a copy, which is the defect class
 * this repository exists to name. Their explanatory comments live INSIDE the
 * function bodies for the same reason: a comment above the declaration is not part
 * of `toString()` and would never reach the generated file.
 *
 * WHAT THE COMMAND MATCHER IS, precisely, because overselling it would be the
 * worst possible defect in a security-shaped generator
 * ---------------------------------------------------------------------------
 * It splits on unquoted shell operators (&& || ; | & and newlines), drops leading
 * VAR=value assignments, compares the executable's last path segment, and tests
 * ANCHORED patterns against the remaining arguments. So `cd /tmp && rm -rf x` IS
 * seen, which the product's own permission layer is measured NOT to see.
 *
 * It is still not a shell. It cannot resolve `$VAR`, look inside `$(...)` or
 * backticks, follow `bash -c`, `eval` or `xargs`, or know what an alias expands
 * to. Rather than let those pass silently, a policy declaring `absolute: true`
 * DENIES any command containing one of them, with the construct named. A
 * non-absolute policy expresses no opinion and the generated bundle carries a
 * residual case asserting the gap is open, so it goes red in both directions.
 *
 * WHAT IT DOES NOT DO. A command hook fails OPEN: delete the handler, break its
 * interpreter or exceed its timeout and nothing blocks. Every generated bundle
 * proves that rather than mentioning it, and an `absolute: true` policy is marked
 * strict so the run reports NOT DONE with the residual named. The one thing this
 * pack will not do is quietly emit a `permissions.deny` rule and call the
 * requirement met: see `denyProposal()` for why that layer is unproven here.
 *
 * usage: driven by tools/extension-scaffold.mjs. Standalone:
 *   node tools/packs/validate-before-action.mjs --self-test
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, sep, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePolicy, PRECEDENCE, FAMILIES, unsafeRelPath } from './policy-schema.mjs';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export const id = 'validate-before-action';
export const summary = 'Validate a Bash command before it runs, from an explicit policy: command allowlists, dangerous-operation blocks, required checks, document schema validation, and pre-deployment gates.';
export const requires = ['--policy <file>: an explicit, versioned validation policy. Nothing is inferred from prose.'];

export const HANDLER_REL = join('.claude', 'hooks', 'validate.mjs');
export const HANDLER_POSIX = '.claude/hooks/validate.mjs';

// ------------------------------------------------------------------ runtime
// Everything from here to the END-OF-RUNTIME marker is emitted into the generated
// handler verbatim. Keep it dependency-free apart from the node builtins the
// generated file imports, and keep the comments inside the bodies.

export function tokenize(segment) {
  // Quote-aware split. Not a shell: it strips matched quotes and honours a
  // backslash escape outside quotes, and does nothing else. Anything it cannot
  // read is handled by opaqueReasons, not guessed at here.
  const out = [];
  let cur = '';
  let q = null;
  let has = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (q) {
      if (ch === q) { q = null; continue; }
      cur += ch; has = true; continue;
    }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (ch === '\\' && i + 1 < segment.length) { cur += segment[++i]; has = true; continue; }
    if (/\s/.test(ch)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += ch; has = true;
  }
  if (has) out.push(cur);
  return out;
}

export function splitSegments(command) {
  // Split on UNQUOTED shell operators so a compound command is inspected piece by
  // piece. This is the one place where the generated hook is stronger than the
  // product's permission layer, which this repository measured letting
  // `cd infra && ...` through on 2.1.224 across 400 paired sessions.
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '\\' && i + 1 < command.length) { cur += ch + command[++i]; continue; }
    if (ch === '&' || ch === '|' || ch === ';' || ch === '\n') {
      if (command[i + 1] === ch) i++;
      out.push(cur); cur = ''; continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function opaqueReasons(command) {
  // Constructs whose contents this matcher genuinely cannot read. Naming them is
  // the difference between a documented boundary and a silent hole: an
  // `absolute: true` policy denies on any of these, and every other policy ships a
  // residual case asserting they are NOT covered.
  const found = [];
  const PROBES = [
    [/\$\(/, 'a $( ) command substitution'],
    [/`/, 'a backtick command substitution'],
    [/<\(/, 'a <( ) process substitution'],
    [/\$\{?[A-Za-z_]/, 'an unexpanded shell variable'],
    [/(^|\s)eval(\s|$)/, 'an eval'],
    [/(^|[\s/])(ba|z|k)?sh\s+-[a-z]*c(\s|$)/, 'an inline shell program (sh -c)'],
    [/(^|[\s/])(pwsh|powershell)\s+-(c|Command|EncodedCommand)\b/i, 'an inline PowerShell program'],
    [/(^|[\s/])(node|python3?|perl|ruby)\s+-[a-zA-Z]*(e|c)(\s|$)/, 'an inline interpreter program'],
    [/(^|\s)xargs(\s|$)/, 'an xargs indirection'],
    [/(^|\s)source(\s|$)/, 'a sourced script'],
  ];
  for (const [re, why] of PROBES) if (re.test(command)) found.push(why);
  return found;
}

export function flagPresent(flag, args) {
  // A long flag is matched exactly. A short flag is matched by LETTER SET across
  // single-dash clusters, so `-rf`, `-fr`, `-rfv` and `-r -f` all satisfy `-rf`.
  // Exact-token-only matching would have made `rm -r -f x` walk past a rule whose
  // author believed it was covered.
  if (flag.startsWith('--') || !/^-[A-Za-z]+$/.test(flag)) return args.includes(flag);
  const letters = flag.slice(1).split('');
  let cluster = '';
  for (const a of args) if (/^-[A-Za-z]+$/.test(a)) cluster += a.slice(1);
  return letters.every((l) => cluster.includes(l));
}

export function matchesShape(cm, segment) {
  // Every constraint the policy declares must hold (AND), never any-of. A policy
  // that wanted alternatives declares two rules, which keeps the reason text and
  // the conformance case one-to-one with what fired.
  let tokens = tokenize(segment);
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens = tokens.slice(1);
  if (!tokens.length) return false;
  const exec = String(tokens[0]).split(/[\\/]/).pop();
  if (exec !== cm.exec) return false;
  const args = tokens.slice(1);
  if (cm.argsPattern && !new RegExp(cm.argsPattern).test(args.join(' '))) return false;
  if (cm.anyFlag && !cm.anyFlag.some((f) => flagPresent(f, args))) return false;
  if (cm.anyArgPattern && !cm.anyArgPattern.some((p) => args.some((a) => new RegExp(p).test(a)))) return false;
  return true;
}

export function validateNarrow(doc, schema) {
  // The narrow schema language, and NOT JSON Schema: required, properties with a
  // primitive type and an optional enum, additionalProperties. Every other keyword
  // was refused at generation time rather than ignored here, so there is no
  // silently unenforced constraint.
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return ['the document is not a JSON object'];
  const problems = [];
  for (const r of (schema.required || [])) if (!(r in doc)) problems.push(`missing required key "${r}"`);
  const props = schema.properties || {};
  for (const [k, spec] of Object.entries(props)) {
    if (!(k in doc)) continue;
    const v = doc[k];
    const got = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    if (got !== spec.type) { problems.push(`"${k}" must be ${spec.type}, got ${got}`); continue; }
    if (spec.enum && !spec.enum.includes(v)) problems.push(`"${k}" must be one of ${spec.enum.join(', ')}, got ${JSON.stringify(v)}`);
  }
  if (schema.additionalProperties === false) {
    for (const k of Object.keys(doc)) if (!(k in props)) problems.push(`unexpected key "${k}"`);
  }
  return problems;
}

export function runProgram(p, cwd, extraArgs) {
  // A program that cannot START counts as FAILED, not as skipped. A missing test
  // runner silently satisfying a required-check gate is the exact shape of "a
  // check that cannot fail", so the direction here is deliberate.
  const argv = (p.command || []).slice(1).concat(extraArgs || []);
  const r = spawnSync(p.command[0], argv, {
    cwd, encoding: 'utf8', timeout: p.timeoutMs, windowsHide: true, shell: false,
  });
  if (r.error && r.error.code === 'ENOENT') return { id: p.id, ok: false, why: `could not start (${p.command[0]} not found)` };
  if (r.signal === 'SIGTERM' || (r.error && r.error.code === 'ETIMEDOUT')) return { id: p.id, ok: false, why: `timed out after ${p.timeoutMs}ms` };
  if (r.error) return { id: p.id, ok: false, why: `could not run (${r.error.message})` };
  return { id: p.id, ok: r.status === 0, why: r.status === 0 ? 'ok' : `exit ${r.status}` };
}

export function validateDocument(when, cwd) {
  // A missing or unparseable document is INVALID, not absent. The alternative is a
  // deployment gate that stops gating the moment someone deletes the file it reads.
  const full = resolve(join(cwd, when.documentAt));
  if (full !== resolve(cwd) && !full.startsWith(resolve(cwd) + sep)) return [`the document path escapes the project root`];
  if (!existsSync(full)) return [`the document "${when.documentAt}" is missing`];
  let doc;
  try { doc = JSON.parse(readFileSync(full, 'utf8')); } catch (e) { return [`the document "${when.documentAt}" is not valid JSON (${e.message})`]; }
  if (when.externalValidator) {
    // The resolved document path is appended as the final argument, and the
    // validator's EXIT CODE is the whole contract. Nothing here reads its output,
    // so nothing here can overstate what it checked.
    const r = runProgram({ id: 'external-validator', command: when.externalValidator.command, timeoutMs: when.externalValidator.timeoutMs }, cwd, [full]);
    return r.ok ? [] : [`the external validator reported failure: ${r.why}`];
  }
  return validateNarrow(doc, when.narrowSchema);
}

export function decide(command, policy, cwd) {
  // Rules are evaluated in DECLARED ORDER and the first match wins, which is what
  // policy.precedence spells out. A gate rule whose prerequisite is SATISFIED does
  // not match, so evaluation continues past it.
  if (policy.absolute) {
    const opaque = opaqueReasons(command);
    if (opaque.length) {
      return {
        decision: 'deny', ruleId: '(absolute-opacity)',
        reason: `This policy is absolute and the command contains ${opaque.join(', ')}, which this validator cannot read. Refusing what cannot be inspected rather than allowing it.`,
      };
    }
  }
  const segments = splitSegments(command);
  for (const rule of policy.rules) {
    const cm = rule.when.commandMatches;
    if (!segments.some((s) => matchesShape(cm, s))) continue;
    if (rule.family === 'command-validation' || rule.family === 'dangerous-operation') {
      return { decision: rule.decision, ruleId: rule.id, reason: rule.reason };
    }
    if (rule.family === 'required-check' || rule.family === 'deployment-gate') {
      const programs = rule.when.checksPass || rule.when.gates;
      const failed = programs.map((p) => runProgram(p, cwd)).filter((r) => !r.ok);
      if (!failed.length) continue;
      return { decision: 'deny', ruleId: rule.id, reason: `${rule.reason} [${failed.map((f) => `${f.id}: ${f.why}`).join('; ')}]` };
    }
    if (rule.family === 'schema-validation') {
      const problems = validateDocument(rule.when, cwd);
      if (!problems.length) continue;
      return { decision: 'deny', ruleId: rule.id, reason: `${rule.reason} [${problems.join('; ')}]` };
    }
  }
  return { decision: policy.defaultDecision, ruleId: null, reason: `no rule matched; defaultDecision is ${policy.defaultDecision}` };
}
// END-OF-RUNTIME

const RUNTIME_FNS = [tokenize, splitSegments, opaqueReasons, flagPresent, matchesShape, validateNarrow, runProgram, validateDocument, decide];

// ------------------------------------------------------------------ analysis

/** The subset of a policy the generated handler actually reads. */
export function runtimePolicy(policy) {
  return {
    id: policy.id,
    tool: policy.tool,
    absolute: !!policy.absolute,
    defaultDecision: policy.defaultDecision,
    rules: policy.rules.map((r) => ({ id: r.id, family: r.family, decision: r.decision, reason: r.reason, when: r.when })),
  };
}

/**
 * A tiny document derived from a narrow schema, plus one that must fail it.
 * DERIVED, then VERIFIED against the same `validateNarrow` the handler runs: if
 * the pair does not come out clean-and-dirty, generation refuses rather than
 * emitting a schema case that proves nothing.
 */
export function deriveDocuments(schema) {
  const valid = {};
  for (const [k, spec] of Object.entries(schema.properties || {})) {
    if (spec.enum) valid[k] = spec.enum[0];
    else if (spec.type === 'string') valid[k] = 'x';
    else if (spec.type === 'number') valid[k] = 1;
    else valid[k] = true;
  }
  for (const r of (schema.required || [])) if (!(r in valid)) valid[r] = 'x';
  let invalid;
  const req = (schema.required || [])[0];
  if (req) { invalid = { ...valid }; delete invalid[req]; }
  else {
    const enumKey = Object.entries(schema.properties || {}).find(([, s]) => s.enum);
    const typeKey = Object.entries(schema.properties || {}).find(([, s]) => s.type === 'number' || s.type === 'boolean');
    if (enumKey) invalid = { ...valid, [enumKey[0]]: '__not_in_enum__' };
    else if (typeKey) invalid = { ...valid, [typeKey[0]]: 'not-the-right-type' };
    else if (schema.additionalProperties === false) invalid = { ...valid, __unexpected__: 'x' };
    else invalid = null;
  }
  return { valid, invalid };
}

export class PolicyRefusal extends Error {
  constructor(msg, detail = []) { super(msg); this.detail = detail; this.exitCode = 2; }
}

export function applies(input) {
  const p = input && input.policy;
  if (!p) {
    return {
      applies: false,
      why: 'no --policy was supplied. This pack generates a validator from an explicit, versioned policy and '
        + 'never infers command grammars, prerequisite programs or timeouts from prose.',
    };
  }
  return { applies: true, why: `an explicit validation policy (${(p && p.id) || 'unnamed'})` };
}

/**
 * Validate the policy structurally, then SEMANTICALLY against the same matcher the
 * handler will run. The semantic pass is the one that catches the mistake an
 * author actually makes: a pattern that does not match the command they wrote it
 * for. Every failure here is a refusal, never a note.
 */
export function analyse(input) {
  const policy = input && input.policy;
  if (!policy) return { supported: false, reason: 'no policy supplied' };
  const v = validatePolicy(policy);
  if (!v.ok) throw new PolicyRefusal(`the policy is not valid, so nothing was generated`, v.errors);

  const errs = [];
  const notes = [];

  policy.rules.forEach((r, i) => {
    const at = `rules[${i}] ("${r.id}")`;
    const ex = r.examples;
    if (!ex || typeof ex !== 'object' || !Array.isArray(ex.match) || !Array.isArray(ex.miss)
      || !ex.match.length || !ex.miss.length || ![...ex.match, ...ex.miss].every((s) => typeof s === 'string' && s.trim())) {
      errs.push(`${at}.examples: required, as { match: ["..."], miss: ["..."] } with at least one of each. `
        + 'Without a declared example the generated conformance case would have to be invented from the pattern, '
        + 'and a case invented from the thing it is testing cannot fail.');
      return;
    }
    for (const cmd of ex.match) {
      if (!splitSegments(cmd).some((s) => matchesShape(r.when.commandMatches, s))) {
        errs.push(`${at}: declared MATCH example ${JSON.stringify(cmd)} does not actually match this rule. `
          + 'The pattern and the author disagree, and shipping would generate an enforce case for a rule that never fires.');
      }
    }
    for (const cmd of ex.miss) {
      if (splitSegments(cmd).some((s) => matchesShape(r.when.commandMatches, s))) {
        errs.push(`${at}: declared MISS example ${JSON.stringify(cmd)} DOES match this rule, so the near-miss case would assert the opposite of the truth.`);
      }
      // A near-miss whose expected outcome depends on a program result is not
      // statically knowable, so it is refused rather than guessed.
      for (const other of policy.rules) {
        if (other === r) continue;
        if (FAMILIES.get(other.family).evaluator === 'match') continue;
        if (splitSegments(cmd).some((s) => matchesShape(other.when.commandMatches, s))) {
          errs.push(`${at}: MISS example ${JSON.stringify(cmd)} matches gate rule "${other.id}", whose decision depends on a program result. `
            + 'Its expected verdict is therefore not statically knowable; choose an example no gate rule matches.');
        }
      }
    }
    if (r.family === 'schema-validation') {
      const declared = r.documentExamples;
      if (r.when.externalValidator && !declared) {
        errs.push(`${at}: an externalValidator rule must declare documentExamples { valid, invalid }. `
          + 'Nothing here knows what that command accepts, and a schema case with no known-bad document proves nothing.');
      } else if (!declared) {
        const d = deriveDocuments(r.when.narrowSchema);
        if (d.invalid === null) {
          errs.push(`${at}: this narrowSchema constrains nothing that a document could violate (no required keys, no enum, `
            + 'no non-string type, additionalProperties not false), so no failing document exists and the enforce case would be vacuous.');
        } else {
          const okProblems = validateNarrow(d.valid, r.when.narrowSchema);
          const badProblems = validateNarrow(d.invalid, r.when.narrowSchema);
          if (okProblems.length) errs.push(`${at}: the derived VALID document does not pass its own schema (${okProblems.join('; ')}). Declare documentExamples explicitly.`);
          if (!badProblems.length) errs.push(`${at}: the derived INVALID document PASSES its own schema, so the enforce case could not fail. Declare documentExamples explicitly.`);
        }
      } else if (r.when.narrowSchema) {
        const okProblems = validateNarrow(declared.valid, r.when.narrowSchema);
        const badProblems = validateNarrow(declared.invalid, r.when.narrowSchema);
        if (okProblems.length) errs.push(`${at}: the declared VALID document does not pass this rule's schema (${okProblems.join('; ')}).`);
        if (!badProblems.length) errs.push(`${at}: the declared INVALID document PASSES this rule's schema, so the enforce case could not fail.`);
      }
      const bad = unsafeRelPath(r.when.documentAt);
      if (bad) errs.push(`${at}.when.documentAt: ${bad}`);
    }
    if (r.gateSetup !== undefined) {
      const g = r.gateSetup;
      if (!g || typeof g !== 'object' || !g.pass || !g.fail) {
        errs.push(`${at}.gateSetup: must be { pass: <setup>, fail: <setup> } when present. It is what lets the PASSING arm of a gate be proved at all.`);
      }
    }
  });

  if (errs.length) throw new PolicyRefusal('the policy is structurally valid but does not describe what it claims', errs);

  const gateRules = policy.rules.filter((r) => FAMILIES.get(r.family).evaluator !== 'match');
  const unpaired = gateRules.filter((r) => !r.gateSetup && r.family !== 'schema-validation');
  for (const r of unpaired) {
    notes.push(`rule "${r.id}" declares no gateSetup, so only its FAILING arm is proved. The bundle cannot show that a satisfied prerequisite lets the command through.`);
  }
  if (!policy.absolute) {
    notes.push('the policy is not absolute, so a command hiding behind $( ), eval, sh -c or an unexpanded variable is NOT inspected. A residual case asserts that gap rather than a README sentence.');
  } else {
    notes.push('the policy is absolute, so any command containing a construct this matcher cannot read is DENIED, and the spec is strict: a surviving residual reports NOT DONE.');
  }

  return {
    supported: true,
    policy,
    mechanism: 'hook',
    strict: !!policy.absolute,
    families: [...new Set(policy.rules.map((r) => r.family))].sort(),
    notes,
    denyCandidates: policy.rules.filter((r) => r.decision === 'deny' && FAMILIES.get(r.family).evaluator === 'match'),
  };
}

// ------------------------------------------------------------------ emission

export function handlerSource(policy) {
  const rt = runtimePolicy(policy);
  return `#!/usr/bin/env node
/**
 * GENERATED by extension-scaffold, pack validate-before-action, from policy "${rt.id}".
 * Edit the POLICY below and this file stops matching its own conformance spec:
 * regenerate instead.
 *
 * Contract: reads one PreToolUse payload on stdin. Emits a permissionDecision
 * ONLY to deny. On every other path it writes nothing and exits 0, which leaves
 * the normal permission flow in charge.
 *
 * A "deny" here is not the last line of defence. Delete this file, break node, or
 * exceed the hook timeout and NOTHING blocks: a command hook fails open. That is
 * proved by the fail-posture and residual cases in conformance.json, not asserted
 * in a comment.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const POLICY = ${JSON.stringify(rt, null, 2)};

${RUNTIME_FNS.map((f) => f.toString()).join('\n\n')}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => {
  let payload = null;
  try { payload = JSON.parse(buf); } catch { payload = null; }
  // A payload this handler cannot parse is not an excuse to block every tool call
  // in the session, so it expresses no opinion. That is a FAIL-OPEN path and the
  // bundle's residual case says so.
  if (!payload || typeof payload !== 'object') process.exit(0);
  if (payload.tool_name !== POLICY.tool) process.exit(0);
  const command = payload.tool_input && payload.tool_input.command;
  if (typeof command !== 'string' || !command.trim()) process.exit(0);

  let out;
  try {
    out = decide(command, POLICY, process.env.CLAUDE_PROJECT_DIR || process.cwd());
  } catch (e) {
    // Fail CLOSED on this handler's own bug. Every reachable failure above is
    // handled explicitly, so arriving here means the validator is broken, and a
    // broken validator must not read as approval.
    out = { decision: 'deny', ruleId: '(internal-error)', reason: 'the validator failed while evaluating this command: ' + (e && e.message) };
  }
  if (out.decision !== 'deny') process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: (out.ruleId ? '[' + out.ruleId + '] ' : '') + out.reason,
    },
  }));
  process.exit(0);
});
`;
}

export function settingsFor(policy) {
  return {
    hooks: {
      PreToolUse: [{
        matcher: policy.matcher,
        hooks: [{
          type: 'command',
          // The ${CLAUDE_PROJECT_DIR} form, not the bare $CLAUDE_PROJECT_DIR:
          // hooks.md records that the bare form "parses as an undefined variable
          // and resolves to $null" on Windows, which is a hook that silently never
          // runs.
          command: `node "\${CLAUDE_PROJECT_DIR}/${HANDLER_POSIX}"`,
          timeout: 30,
        }],
      }],
    },
  };
}

/**
 * THE ESCALATION THAT IS NOT TAKEN, and why it is a file rather than a setting.
 *
 * A static command shape looks like it should also be expressible as a
 * `permissions.deny` rule, which would survive this handler being deleted. The
 * approved plan said to escalate when expressible. It is not expressible HERE, and
 * finding that out is the reason this file exists rather than a deny rule:
 *
 *   permissions.md gives the SPELLING for a Bash command rule ("Use `Bash(rm *)`
 *   ... instead") and never states what the pattern is matched against. Nothing in
 *   this repository has measured it. extension-prove therefore evaluates such a
 *   rule as UNDETERMINED, which fails every expectation including a negative one,
 *   so a tamper case built on it could not pass.
 *
 * Emitting the rule anyway would ship an unproven second layer that reads as a
 * guarantee, which is the exact failure this project was built to name. So the
 * candidate rules are written to a NON-LOADABLE proposal file, with the one option
 * that IS provable named alongside its cost, and the requirement is reported NOT
 * DONE for an absolute policy instead of quietly satisfied.
 */
export function denyProposal(policy, candidates) {
  return JSON.stringify({
    _what: 'A PROPOSAL, deliberately not loadable. Rename to settings.json fragments only after measuring the behaviour described below.',
    _why_not_adopted: [
      'permissions.md gives the spelling for a Bash command rule ("Use Bash(rm *) ... instead") and never states',
      'what the pattern is matched against: the whole command, the first word, or each segment of a compound',
      'command. Nothing in this repository has measured it, and this repository has measured that a leading `cd`',
      'hid part of a command from the permission layer on Claude Code 2.1.224 across 400 paired sessions.',
      'extension-prove therefore reports such a rule as UNDETERMINED rather than as a deny, so a bundle shipping',
      'it would be claiming a layer it cannot prove.',
    ],
    _the_one_provable_alternative: [
      'A bare tool-name rule, permissions.deny: ["Bash"], IS documented as matching at the tool level everywhere',
      '("Claude Code doesn\'t warn about a tool-name rule with no path ... it matches that rule at the tool level',
      'everywhere") and extension-prove evaluates it as a real deny. It also blocks EVERY Bash command, not the',
      'ones this policy names, so it is a different requirement and is not emitted for you.',
    ],
    _how_to_adopt_honestly: [
      'Measure a Bash(<shape>) deny rule with paired arms the way tools/bash-recognition-run.mjs does,',
      'then add the measured shapes to the table and regenerate. Do not adopt on the strength of the spelling.',
    ],
    candidateRules: candidates.map((r) => ({
      fromRule: r.id,
      candidate: `Bash(${r.when.commandMatches.exec} *)`,
      note: 'broader than the rule it came from: the exec name alone, with none of the argument constraints.',
    })),
    permissions: { deny: candidates.map((r) => `Bash(${r.when.commandMatches.exec} *)`) },
  }, null, 2) + '\n';
}

// ------------------------------------------------------------------ conformance

const B = (command) => ({ tool_name: 'Bash', tool_input: { command } });

/**
 * Expected decision for a near-miss example, computed from the policy's OWN
 * precedence rather than assumed to be allow. `analyse` has already refused any
 * miss example a gate rule matches, so this is decidable statically.
 */
export function staticDecisionFor(policy, command) {
  if (policy.absolute && opaqueReasons(command).length) return 'deny';
  const segs = splitSegments(command);
  for (const r of policy.rules) {
    if (FAMILIES.get(r.family).evaluator !== 'match') continue;
    if (segs.some((s) => matchesShape(r.when.commandMatches, s))) return r.decision;
  }
  return policy.defaultDecision;
}

/**
 * WHY NO CASE HERE CARRIES KIND `wiring`, stated because its absence reads as an
 * omission and is not.
 *
 * `--prove-fail` requires every enforce, wiring and fail-posture case to go RED
 * against an empty bundle AND against an inert one whose handler fires and does
 * nothing. For a hook, the only observable separating "my handler ran and decided"
 * from "some handler ran and did nothing" is a DENY: the verdict records how many
 * handlers fired, never which one. So a case asserting the hook PERMITS something
 * cannot satisfy that contract, and every wiring fact worth having here (the
 * matcher admits the tool, the handler resolves at the path settings names, the
 * emitted runtime loads) is already carried by the enforce cases, which do go red
 * against both controls.
 *
 * Labelling those cases `wiring` inflated the evidence: they were counted in the
 * headline and in the gate's "all green" while asserting nothing an empty
 * directory does not also satisfy. Independent review found it by running this
 * repository's own hollowness detector against the generated bundles, which
 * nothing in CI had ever done. `runGate` now does.
 */
export function conformanceFor(name, policy, a) {
  const cases = [];
  const setupOf = (s) => (s && (s.files || s.env) ? { setup: s } : {});

  for (const r of policy.rules) {
    const ev = FAMILIES.get(r.family).evaluator;
    const match0 = r.examples.match[0];

    if (ev === 'match') {
      r.examples.match.slice(0, 2).forEach((cmd, n) => {
        cases.push(r.decision === 'deny'
          ? { id: `${r.id}-blocks-${n + 1}`, kind: 'enforce', input: B(cmd), expect: { decision: 'deny', fired: { min: 1 } } }
          : { id: `${r.id}-permits-${n + 1}`, kind: 'near-miss', input: B(cmd), expect: { decision: { not: 'deny' }, fired: { min: 1 } } });
      });
    }

    if (ev === 'programs') {
      cases.push({
        id: `${r.id}-blocks-when-unmet`, kind: 'enforce', input: B(match0),
        ...setupOf(r.gateSetup && r.gateSetup.fail), expect: { decision: 'deny', fired: { min: 1 } },
      });
      if (r.gateSetup) {
        cases.push({
          id: `${r.id}-permits-when-met`, kind: 'near-miss', input: B(match0),
          ...setupOf(r.gateSetup.pass), expect: { decision: { not: 'deny' }, fired: { min: 1 } },
        });
        // The paired arm. Without it, a gateSetup the handler never reads would
        // make the case above pass for the wrong reason.
        cases.push({
          id: `${r.id}-setup-is-load-bearing`, kind: 'enforce', input: B(match0),
          ...setupOf(r.gateSetup.pass), mutate: 'ignore-setup', expect: { decision: 'deny' },
        });
      }
    }

    if (ev === 'schema') {
      const docs = r.documentExamples || deriveDocuments(r.when.narrowSchema);
      const at = r.when.documentAt;
      cases.push({
        id: `${r.id}-blocks-invalid-document`, kind: 'enforce', input: B(match0),
        setup: { files: { [at]: JSON.stringify(docs.invalid, null, 2) } }, expect: { decision: 'deny', fired: { min: 1 } },
      });
      cases.push({
        id: `${r.id}-permits-valid-document`, kind: 'near-miss', input: B(match0),
        setup: { files: { [at]: JSON.stringify(docs.valid, null, 2) } }, expect: { decision: { not: 'deny' }, fired: { min: 1 } },
      });
      cases.push({
        id: `${r.id}-blocks-missing-document`, kind: 'enforce', input: B(match0), expect: { decision: 'deny' },
      });
      cases.push({
        id: `${r.id}-document-is-load-bearing`, kind: 'enforce', input: B(match0),
        setup: { files: { [at]: JSON.stringify(docs.valid, null, 2) } }, mutate: 'ignore-setup', expect: { decision: 'deny' },
      });
    }

    /**
     * A near-miss case for EVERY family, not only the match families. "deploy
     * status must not be blocked by the manifest rule" is exactly the annoyance
     * failure mode hooks.md names, and it is the arm that catches a pattern widened
     * one character too far. `analyse` has already refused any miss example whose
     * verdict would depend on a program result, so the expectation below is
     * statically decidable.
     */
    r.examples.miss.slice(0, 2).forEach((cmd, n) => {
      const want = staticDecisionFor(policy, cmd);
      cases.push({
        id: `${r.id}-near-miss-${n + 1}`, kind: 'near-miss', input: B(cmd),
        expect: want === 'deny' ? { decision: 'deny' } : { decision: { not: 'deny' } },
      });
    });
  }

  /**
   * KIND `near-miss`, NOT `wiring`, and the difference is a contract rather than a
   * label.
   *
   * `--prove-fail` runs every enforce, wiring and fail-posture case against an
   * EMPTY and an INERT bundle and requires each to go RED, because a case that
   * passes with nothing installed asserts nothing about the extension. This case
   * asserts `fired: 0` for a tool the matcher does not name, and zero handlers
   * firing is exactly what an empty settings.json produces, so as a `wiring` case
   * it walked past the detector. Independent review 2026-08-07 ran
   * `--prove-fail --bundles` over the six generated bundles and found 27 survivors
   * across three case shapes, this being one.
   *
   * The assertion is worth keeping: it is what catches a matcher pointed at the
   * wrong tool. What was wrong is the kind. `near-miss` and `residual` are
   * excluded from the detector precisely because a claim that something is NOT
   * blocked cannot go red on a tree where nothing is installed.
   */
  cases.push({
    id: 'matcher-scopes-to-the-declared-tool', kind: 'near-miss',
    input: { tool_name: 'Write', tool_input: { file_path: 'src/app.ts' } },
    expect: { fired: 0 },
  });

  const firstDeny = policy.rules.find((r) => r.decision === 'deny') || policy.rules[0];
  const denyCmd = firstDeny.examples.match[0];

  /**
   * KIND `residual`, NOT `fail-posture`, for the same reason and a sharper one.
   *
   * In this repository `fail-posture` means the protection HOLDS despite the
   * mutation: protect-path's deny rule is harness-owned, so it still denies with
   * the handler deleted and its case expects a DENY, which goes red against a
   * control. A command hook makes the opposite claim, and "the decision is not
   * deny once the handler crashes" is equally true of an empty directory.
   *
   * That is not a labelling problem to work around, it IS the finding: a hook has
   * no fail-posture to assert. It has a residual, a named vector confirmed not
   * covered, and under a strict spec a surviving residual is what makes the run
   * report NOT DONE rather than claiming a guarantee it cannot keep.
   */
  cases.push({
    id: 'crashing-handler-fails-open', kind: 'residual', input: B(denyCmd), mutate: 'crash-handler',
    vector: 'the handler crashes, times out, or its interpreter is missing',
    why: 'a command hook exiting non-zero is a non-blocking error and the tool call proceeds. Nothing in a hook '
      + 'bundle survives its own handler failing, which is why an absolute policy here is reported NOT DONE.',
    expect: { decision: { not: 'deny' } },
  });
  cases.push({
    id: 'deleted-handler-fails-open', kind: 'residual', input: B(denyCmd), mutate: 'delete-handler',
    vector: 'the handler file is deleted, renamed, or never installed',
    why: 'a command hook is not a harness-owned layer. Nothing in the bundle survives its own handler being removed, '
      + 'and this repository could not prove a permissions.deny escalation for a Bash command shape (see permissions-deny.json.proposal).',
    expect: { decision: { not: 'deny' } },
  });

  /**
   * The indirection probe, and whether it is a GAP depends on the policy.
   *
   * Written as an unconditional residual, this asserted the wrong thing for an
   * allowlist: a policy with `defaultDecision: deny` blocks `sh -c "..."` along
   * with everything else it does not recognise, so claiming the vector was open
   * was false. Caught by running the generated bundle through the prover rather
   * than by the generator's own self-test, which had agreed with itself.
   *
   * So the outcome is COMPUTED from the policy's own precedence, and each of the
   * three ways it can land gets its own case id and reason.
   */
  const opaqueProbe = `sh -c "${denyCmd}"`;
  const opaqueOutcome = staticDecisionFor(policy, opaqueProbe);
  if (policy.absolute) {
    cases.push({
      id: 'absolute-policy-refuses-what-it-cannot-read', kind: 'enforce', input: B(opaqueProbe),
      expect: { decision: 'deny', fired: { min: 1 } },
    });
  } else if (opaqueOutcome === 'deny') {
    cases.push({
      id: 'indirection-falls-to-the-default-deny', kind: 'enforce', input: B(opaqueProbe),
      expect: { decision: 'deny', fired: { min: 1 } },
    });
  } else {
    cases.push({
      id: 'indirection-is-not-inspected', kind: 'residual', input: B(opaqueProbe),
      vector: 'a command wrapped in sh -c, eval, $( ), backticks, xargs or an unexpanded variable',
      why: 'the matcher reads shell operators, not shell semantics, and this policy allows by default. Set '
        + '`absolute: true` to DENY what cannot be read, or `defaultDecision: deny` to allowlist. This case goes red in '
        + 'both directions, so closing the gap is as visible as widening it.',
      expect: { decision: { not: 'deny' } },
    });
  }

  return {
    extension: name,
    mechanism: 'hook',
    strict: !!policy.absolute,
    policy: policy.id,
    cases,
  };
}

export function readmeFor(name, policy, a, conf) {
  const L = [];
  L.push(`# ${name}`);
  L.push('');
  L.push(`Blocks Bash commands that violate policy \`${policy.id}\`, before they run.`);
  L.push('');
  L.push('## Install');
  L.push('');
  L.push('```bash');
  L.push('cp -r .claude "$YOUR_PROJECT/"');
  L.push('```');
  L.push('');
  L.push('Then merge `settings.json` into `$YOUR_PROJECT/.claude/settings.json` and restart Claude Code.');
  L.push('');
  L.push('## Verify');
  L.push('');
  L.push('```bash');
  L.push('node tools/extension-prove.mjs <this-directory>');
  L.push('```');
  L.push('');
  L.push(`${conf.cases.length} behavioural cases. They assert what this hook DOES, including what it does not do.`);
  L.push('');
  L.push('## What it blocks');
  L.push('');
  L.push('| rule | family | decision | when |');
  L.push('|---|---|---|---|');
  for (const r of policy.rules) {
    const cm = r.when.commandMatches;
    const cond = [cm.exec, cm.argsPattern && `args \`${cm.argsPattern}\``, cm.anyFlag && `flags ${cm.anyFlag.join('/')}`, cm.anyArgPattern && 'arg pattern']
      .filter(Boolean).join(', ');
    L.push(`| \`${r.id}\` | ${r.family} | ${r.decision} | ${cond} |`);
  }
  L.push('');
  L.push(`Rules are evaluated in declared order, first match wins. Nothing matched: **${policy.defaultDecision}**.`);
  L.push('');
  L.push('## What it does NOT do');
  L.push('');
  L.push('- **`allow` is not auto-approve.** A rule that decides `allow` makes this hook emit nothing, so your normal');
  L.push('  permission prompts still happen. Only `deny` produces a decision.');
  L.push('- **A command hook fails open.** Delete the handler, break node, or exceed the hook timeout and nothing blocks.');
  L.push('  `deleted-handler-fails-open` proves it.');
  L.push('- **The matcher is not a shell.** It splits on `&&`, `||`, `;`, `|` and `&`, so `cd x && rm -rf y` IS seen.');
  L.push('  It cannot resolve `$VAR`, read inside `$( )` or backticks, or follow `sh -c`, `eval` or `xargs`.');
  L.push(policy.absolute
    ? '  This policy is `absolute`, so a command containing any of those is DENIED rather than ignored.'
    : '  This policy is not `absolute`, so those are NOT inspected. `indirection-is-not-inspected` asserts that gap.');
  if (policy.rules.some((r) => r.when.narrowSchema)) {
    L.push('- **The schema language is not JSON Schema** and is not called that. It supports `required`, `properties`');
    L.push('  with a primitive `type` and optional `enum`, and `additionalProperties`. Any other keyword was refused at');
    L.push('  generation time rather than ignored, so nothing here is silently unenforced.');
  }
  if (policy.rules.some((r) => r.when.externalValidator)) {
    L.push('- **An external validator is bounded by its exit code.** Nothing reads its output, so this bundle proves the');
    L.push('  gating around that exit code and makes no claim about what the validator itself checks.');
  }
  for (const n of a.notes) L.push(`- ${n}`);
  L.push('');
  if (a.strict) {
    L.push('## This bundle reports NOT DONE, deliberately');
    L.push('');
    L.push('The policy declares `absolute: true`, so the spec is strict. A strict spec with a surviving residual case is');
    L.push('reported NOT DONE even when every case passes: the residual passing means the gap is confirmed OPEN, and');
    L.push('"prevent this always" is not met by a layer that disappears with its own file. See');
    L.push('`permissions-deny.json.proposal` for the escalation that was considered and why it was not taken.');
    L.push('');
  }
  return L.join('\n');
}

export function buildBundle(name, input, a) {
  const policy = a.policy;
  const conf = conformanceFor(name, policy, a);
  const files = {
    'README.md': readmeFor(name, policy, a, conf),
    'conformance.json': JSON.stringify(conf, null, 2) + '\n',
    'settings.json': JSON.stringify(settingsFor(policy), null, 2) + '\n',
    [HANDLER_POSIX]: handlerSource(policy),
  };
  if (a.denyCandidates.length) files['permissions-deny.json.proposal'] = denyProposal(policy, a.denyCandidates);
  return { files, conf };
}

// ------------------------------------------------------------------ gate probes

const RM = (extra = {}) => ({
  policySchema: 1, id: 'block-recursive-delete', tool: 'Bash', matcher: 'Bash',
  precedence: PRECEDENCE, defaultDecision: 'allow',
  rules: [{
    id: 'no-rm-rf', family: 'dangerous-operation', decision: 'deny',
    reason: 'recursive force delete is blocked by policy',
    when: { commandMatches: { exec: 'rm', anyFlag: ['-rf'] } },
    examples: { match: ['rm -rf build', 'cd /tmp && rm -r -f cache'], miss: ['rm build/one.o', 'ls -la'] },
  }],
  ...extra,
});

export const GATE_PROBES = [
  {
    id: 'V1', summary: 'dangerous-operation, the smallest useful policy',
    policy: RM(), strict: false,
    kinds: 'enforce,enforce,near-miss,near-miss,near-miss,residual,residual,residual',
  },
  {
    id: 'V2', summary: 'the same policy declared absolute: strict, and indirection becomes a deny',
    policy: RM({ absolute: true }), strict: true,
    kinds: 'enforce,enforce,near-miss,near-miss,near-miss,residual,residual,enforce', strictResiduals: 2,
  },
  {
    id: 'V3', summary: 'command-validation as an allowlist: approved shape permitted, everything else denied by default',
    strict: false,
    policy: {
      /**
       * A matcher that is NOT the bare tool name, so checkProbe's matcher
       * comparison has something to catch. Every probe declaring 'Bash' made that
       * assertion tautological, and independent review 2026-08-07 proved it by
       * hardcoding 'Bash' in settingsFor and discarding the policy field: the pack
       * self-test, --gate, the family-break harness and the fixture drift check all
       * stayed green. Write is still absent from the alternation, so
       * matcher-scopes-to-the-declared-tool still holds.
       */
      policySchema: 1, id: 'npm-allowlist', tool: 'Bash', matcher: 'Bash|BashOutput',
      precedence: PRECEDENCE, defaultDecision: 'deny',
      rules: [{
        id: 'approved-npm', family: 'command-validation', decision: 'allow',
        reason: 'only npm run test and npm run build are approved',
        when: { commandMatches: { exec: 'npm', argsPattern: '^run (test|build)$' } },
        examples: { match: ['npm run test', 'npm run build'], miss: ['npm run deploy', 'npm publish'] },
      }],
    },
    kinds: 'near-miss,near-miss,near-miss,near-miss,near-miss,residual,residual,enforce',
  },
  {
    id: 'V4', summary: 'required-check with both arms staged, so the passing arm is proved too',
    strict: false,
    policy: {
      policySchema: 1, id: 'tests-before-push', tool: 'Bash', matcher: 'Bash',
      precedence: PRECEDENCE, defaultDecision: 'allow',
      rules: [{
        id: 'tests-must-pass', family: 'required-check', decision: 'deny',
        reason: 'the required checks did not pass',
        when: {
          commandMatches: { exec: 'git', argsPattern: '^push.*$' },
          checksPass: [{ id: 'unit', command: ['node', '-e', 'process.exit(process.env.TESTS_GREEN === "1" ? 0 : 1)'], timeoutMs: 10000 }],
        },
        examples: { match: ['git push origin main'], miss: ['git status', 'git commit -m x'] },
        gateSetup: { pass: { env: { TESTS_GREEN: '1' } }, fail: { env: { TESTS_GREEN: '0' } } },
      }],
    },
    kinds: 'enforce,near-miss,enforce,near-miss,near-miss,near-miss,residual,residual,residual',
  },
  {
    id: 'V5', summary: 'schema-validation over a document, with derived valid and invalid pair',
    strict: false,
    policy: {
      policySchema: 1, id: 'deploy-manifest', tool: 'Bash', matcher: 'Bash',
      precedence: PRECEDENCE, defaultDecision: 'allow',
      rules: [{
        id: 'manifest-must-be-valid', family: 'schema-validation', decision: 'deny',
        reason: 'the deployment manifest is invalid',
        when: {
          commandMatches: { exec: 'deploy', argsPattern: '^apply .*$' },
          documentAt: 'deploy/manifest.json',
          narrowSchema: {
            narrowSchema: 1, required: ['env', 'replicas'], additionalProperties: false,
            properties: { env: { type: 'string', enum: ['staging', 'prod'] }, replicas: { type: 'number' } },
          },
        },
        examples: { match: ['deploy apply prod'], miss: ['deploy status', 'kubectl apply -f x'] },
      }],
    },
    kinds: 'enforce,near-miss,enforce,enforce,near-miss,near-miss,near-miss,residual,residual,residual',
  },
  {
    id: 'V6', summary: 'deployment-gate with two programs, plus a second rule so precedence is exercised',
    strict: false,
    policy: {
      policySchema: 1, id: 'prod-deploy-gate', tool: 'Bash', matcher: 'Bash',
      precedence: PRECEDENCE, defaultDecision: 'allow',
      rules: [
        {
          id: 'no-force-push', family: 'dangerous-operation', decision: 'deny',
          reason: 'force push to a shared branch is blocked',
          when: { commandMatches: { exec: 'git', anyFlag: ['--force'] } },
          examples: { match: ['git push --force origin main'], miss: ['git push origin main'] },
        },
        {
          id: 'prod-gates', family: 'deployment-gate', decision: 'deny',
          reason: 'the pre-deployment gates are not green',
          when: {
            commandMatches: { exec: 'deploy', argsPattern: '^prod$' },
            gates: [
              { id: 'tests', command: ['node', '-e', 'process.exit(process.env.GATE_TESTS === "1" ? 0 : 1)'], timeoutMs: 10000 },
              { id: 'signoff', command: ['node', '-e', 'process.exit(process.env.GATE_SIGNOFF === "1" ? 0 : 1)'], timeoutMs: 10000 },
            ],
          },
          examples: { match: ['deploy prod'], miss: ['deploy staging'] },
          gateSetup: {
            pass: { env: { GATE_TESTS: '1', GATE_SIGNOFF: '1' } },
            fail: { env: { GATE_TESTS: '1', GATE_SIGNOFF: '0' } },
          },
        },
      ],
    },
    kinds: 'enforce,near-miss,enforce,near-miss,enforce,near-miss,near-miss,residual,residual,residual',
  },
];

export const GATE_FILES = ['README.md', 'conformance.json', 'settings.json', HANDLER_POSIX];
export const GATE_FILES_WITH_PROPOSAL = [...GATE_FILES, 'permissions-deny.json.proposal'].sort();

/** What analyse() is called with for a gate probe. This pack reads a policy; protect-path reads prose. */
export function gateInput(probe) { return { policy: probe.policy }; }

export function filesFor(probe) {
  const a = analyse({ policy: probe.policy });
  return a.denyCandidates.length ? GATE_FILES_WITH_PROPOSAL : [...GATE_FILES].sort();
}

/**
 * Per-probe assertions the generic gate cannot know: that the emitted handler
 * really carries the runtime, that it is wired with the placeholder form rather
 * than the Windows-broken bare form, and that a proposal file is never mistakable
 * for a settings file.
 */
export function checkProbe(probe, files) {
  const bad = [];
  const h = files[HANDLER_POSIX];
  if (!h) return [`the bundle has no ${HANDLER_POSIX}`];
  for (const f of ['function decide(', 'function matchesShape(', 'function splitSegments(']) {
    if (!h.includes(f)) bad.push(`the generated handler is missing ${f}), so the runtime was not emitted`);
  }
  /**
   * settings.json is asserted POSITIVELY, by value.
   *
   * The previous version's only settings assertion was negative: complain IF the
   * bare placeholder is present AND the braced one is not. A settings.json with no
   * hook, no placeholder, or entirely different content produced no complaint at
   * all, which is how an experiment that overwrote the whole file with the deny
   * proposal walked straight past this function. Independent review 2026-08-07.
   * protect-path's checkProbe already compared its deny array by value; this one
   * now does the same for the wiring it is responsible for.
   */
  let s = null;
  try { s = JSON.parse(files['settings.json']); } catch (e) { bad.push(`settings.json is not valid JSON (${e.message})`); }
  if (s) {
    const groups = (s.hooks && s.hooks.PreToolUse) || [];
    const handlers = groups.flatMap((g) => g.hooks || []);
    if (groups.length !== 1) bad.push(`settings.json declares ${groups.length} PreToolUse group(s), expected exactly 1`);
    if (handlers.length !== 1) bad.push(`settings.json declares ${handlers.length} handler(s), expected exactly 1`);
    if (groups[0] && groups[0].matcher !== probe.policy.matcher) bad.push(`matcher is ${JSON.stringify(groups[0].matcher)}, the policy declares ${JSON.stringify(probe.policy.matcher)}`);
    const cmd = String((handlers[0] || {}).command || '');
    if (cmd !== `node "\${CLAUDE_PROJECT_DIR}/${HANDLER_POSIX}"`) bad.push(`hook command is ${JSON.stringify(cmd)}, expected the braced-placeholder wiring for ${HANDLER_POSIX}`);
    if (!(Number((handlers[0] || {}).timeout) > 0)) bad.push('the handler declares no positive timeout, so a hung hook has no bound');
    /**
     * No bundle from this pack may ship a permissions rule. The escalation is
     * deliberately unadopted, and emitting one would claim a layer this repository
     * has measured nothing about.
     */
    if (s.permissions) bad.push('settings.json carries a permissions block; this pack must not claim a layer it cannot prove');
  }

  if (files['permissions-deny.json.proposal']) {
    const p = files['permissions-deny.json.proposal'];
    if (!/"_what"/.test(p) || !/"_why_not_adopted"/.test(p)) bad.push('the deny proposal lost its non-adoption preamble');
    if (!/UNDETERMINED/.test(p)) bad.push('the deny proposal no longer says why the rule is unproven');
    let parsed = null;
    try { parsed = JSON.parse(p); } catch (e) { bad.push(`the deny proposal is not valid JSON (${e.message})`); }
    if (parsed && Object.keys(parsed)[0] !== '_what') bad.push('the deny proposal no longer OPENS with its preamble, so a reader meets the rules before the reason not to adopt them');
  }
  const conf = JSON.parse(files['conformance.json']);
  if (!!probe.strict !== !!conf.strict) bad.push(`conformance strict is ${conf.strict}, expected ${probe.strict}`);
  return bad;
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  let fails = 0;
  const check = (n, ok, got) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `  (${got})`}`); if (!ok) fails++; };

  console.log('the command matcher, and exactly where it stops:');
  const RMSHAPE = { exec: 'rm', anyFlag: ['-rf'] };
  const hits = (cmd, cm = RMSHAPE) => splitSegments(cmd).some((s) => matchesShape(cm, s));
  for (const cmd of ['rm -rf build', 'rm -fr build', 'rm -rfv build', 'rm -r -f build', '  rm   -rf   build  ',
    'cd /tmp && rm -rf build', 'echo hi; rm -rf build', 'false || rm -rf build', 'ls | rm -rf build',
    'FOO=1 rm -rf build', '/usr/bin/rm -rf build', './rm -rf build']) {
    check(`MATCHES: ${cmd}`, hits(cmd));
  }
  for (const cmd of ['rm build', 'rm -r build', 'rm -f build', 'ls -rf build', 'rmdir -rf build',
    'echo "rm -rf build"', "echo 'rm -rf build'", 'grep rm -rf']) {
    check(`does NOT match: ${cmd}`, !hits(cmd));
  }
  check('a quoted command is TEXT, not a command, which is the point of quote-aware splitting',
    !hits('echo "cd x && rm -rf y"'));
  check('an anchored argsPattern rejects a longer command',
    !hits('npm run test extra', { exec: 'npm', argsPattern: '^run (test|build)$' }));
  check('...and accepts the exact shape', hits('npm run test', { exec: 'npm', argsPattern: '^run (test|build)$' }));
  check('a long flag is matched exactly, not by letters', hits('git push --force', { exec: 'git', anyFlag: ['--force'] })
    && !hits('git push -f', { exec: 'git', anyFlag: ['--force'] }));
  check('anyArgPattern tests individual arguments', hits('kubectl delete ns/prod', { exec: 'kubectl', anyArgPattern: ['^ns/prod$'] }));

  console.log('opacity, which is named rather than silently passed:');
  for (const [cmd, needle] of [['echo $(whoami)', 'substitution'], ['echo `whoami`', 'backtick'], ['rm -rf $TARGET', 'variable'],
    ['eval "rm -rf x"', 'eval'], ['sh -c "rm -rf x"', 'sh -c'], ['bash -c "rm -rf x"', 'sh -c'],
    ['node -e "require(\'fs\')"', 'interpreter'], ['find . | xargs rm', 'xargs'], ['powershell -Command "x"', 'PowerShell']]) {
    check(`opaque: ${cmd}`, opaqueReasons(cmd).some((r) => r.includes(needle)), opaqueReasons(cmd).join(', ') || 'none');
  }
  check('a plain command is NOT flagged opaque', opaqueReasons('rm -rf build').length === 0);
  check('a compound command is not opaque, because the splitter reads it', opaqueReasons('cd x && rm -rf y').length === 0);

  console.log('the narrow schema evaluator:');
  const S = { narrowSchema: 1, required: ['env'], additionalProperties: false, properties: { env: { type: 'string', enum: ['dev', 'prod'] }, replicas: { type: 'number' } } };
  check('a valid document has no problems', validateNarrow({ env: 'prod', replicas: 2 }, S).length === 0);
  check('a missing required key is a problem', validateNarrow({ replicas: 2 }, S).some((p) => /missing required key/.test(p)));
  check('a wrong type is a problem', validateNarrow({ env: 'prod', replicas: 'two' }, S).some((p) => /must be number/.test(p)));
  check('an out-of-enum value is a problem', validateNarrow({ env: 'qa' }, S).some((p) => /must be one of/.test(p)));
  check('an unexpected key is a problem when additionalProperties is false', validateNarrow({ env: 'prod', x: 1 }, S).some((p) => /unexpected key/.test(p)));
  check('a non-object document is a problem', validateNarrow([1], S).length > 0 && validateNarrow(null, S).length > 0);
  check('null is not silently a valid string', validateNarrow({ env: null }, S).some((p) => /got null/.test(p)));

  console.log('derived documents must actually be a passing and a failing pair:');
  {
    const d = deriveDocuments(S);
    check('the derived VALID document passes', validateNarrow(d.valid, S).length === 0, JSON.stringify(d.valid));
    check('the derived INVALID document fails', validateNarrow(d.invalid, S).length > 0, JSON.stringify(d.invalid));
    const noReq = { narrowSchema: 1, properties: { a: { type: 'string' } } };
    check('a schema nothing can violate yields no invalid document, rather than a fake one', deriveDocuments(noReq).invalid === null);
  }

  console.log('routing:');
  check('no policy means this pack does not apply', applies({ requirement: 'block rm -rf' }).applies === false);
  check('...and says what is missing', /no --policy was supplied/.test(applies({}).why));
  check('a policy means it does apply', applies({ policy: RM() }).applies === true);

  console.log('semantic refusal, the part a structural validator cannot do:');
  const refuse = (mut, name, needle) => {
    const p = RM(); mut(p);
    let threw = null;
    try { analyse({ policy: p }); } catch (e) { threw = e; }
    const hit = threw instanceof PolicyRefusal && (!needle || threw.detail.some((d) => d.includes(needle)));
    check(`MUST REFUSE: ${name}`, hit, threw ? threw.detail.join(' | ').slice(0, 120) : 'accepted');
  };
  check('the reference policy analyses cleanly', analyse({ policy: RM() }).supported);
  refuse((p) => { delete p.rules[0].examples; }, 'a rule with no declared examples', 'cannot fail');
  refuse((p) => { p.rules[0].examples.match = []; }, 'an empty match list');
  refuse((p) => { p.rules[0].examples.miss = []; }, 'an empty miss list');
  refuse((p) => { p.rules[0].examples.match = ['rm build']; }, 'a MATCH example the rule does not match', 'does not actually match');
  refuse((p) => { p.rules[0].examples.miss = ['rm -rf build']; }, 'a MISS example the rule DOES match', 'opposite of the truth');
  refuse((p) => { p.rules[0].when.commandMatches.anyFlag = ['-zz']; }, 'a rule whose own examples stop matching after a pattern edit', 'does not actually match');
  {
    const p = RM();
    p.rules.push({
      id: 'gate', family: 'required-check', decision: 'deny', reason: 'x',
      when: { commandMatches: { exec: 'ls', argsPattern: '^-la$' }, checksPass: [{ id: 'c', command: ['node', '-e', 'process.exit(0)'], timeoutMs: 1000 }] },
      examples: { match: ['ls -la'], miss: ['ls'] },
    });
    let threw = null;
    try { analyse({ policy: p }); } catch (e) { threw = e; }
    check('MUST REFUSE: a near-miss example that a GATE rule matches, whose verdict is not statically knowable',
      threw instanceof PolicyRefusal && threw.detail.some((d) => /not statically knowable/.test(d)),
      threw ? threw.detail.join(' | ').slice(0, 120) : 'accepted');
  }
  {
    const p = JSON.parse(JSON.stringify(GATE_PROBES[4].policy));
    p.rules[0].when.narrowSchema = { narrowSchema: 1, properties: { a: { type: 'string' } } };
    let threw = null;
    try { analyse({ policy: p }); } catch (e) { threw = e; }
    check('MUST REFUSE: a schema rule with no document that could fail it', threw instanceof PolicyRefusal
      && threw.detail.some((d) => /vacuous/.test(d)), threw ? threw.detail.join(' | ').slice(0, 130) : 'accepted');
  }
  {
    const p = JSON.parse(JSON.stringify(GATE_PROBES[4].policy));
    delete p.rules[0].when.narrowSchema;
    p.rules[0].when.externalValidator = { command: ['node', '-e', 'process.exit(0)'], timeoutMs: 5000 };
    let threw = null;
    try { analyse({ policy: p }); } catch (e) { threw = e; }
    check('MUST REFUSE: an externalValidator rule with no declared documentExamples', threw instanceof PolicyRefusal
      && threw.detail.some((d) => /documentExamples/.test(d)));
    p.rules[0].documentExamples = { valid: { env: 'prod' }, invalid: {} };
    check('...and it analyses once they are declared', analyse({ policy: p }).supported);
  }
  {
    const p = RM();
    p.rules[0].when.commandMatches = { exec: 'rm', argsPattern: '^-rf .*$' };
    p.rules[0].examples = { match: ['rm -rf build'], miss: ['rm build'] };
    check('a rule can be edited freely as long as its OWN examples still hold', analyse({ policy: p }).supported);
  }

  console.log('the generated handler carries the tested runtime, not a retyped copy:');
  {
    const a = analyse({ policy: RM() });
    const src = handlerSource(a.policy);
    check('every runtime function is present by name', RUNTIME_FNS.every((f) => src.includes(`function ${f.name}(`)),
      RUNTIME_FNS.filter((f) => !src.includes(`function ${f.name}(`)).map((f) => f.name).join(','));
    check('...and byte-identical to the function this file just tested', src.includes(matchesShape.toString()));
    check('the handler embeds only what the runtime reads, not the examples', !src.includes('examples') && src.includes('"defaultDecision"'));
    check('the wiring uses ${CLAUDE_PROJECT_DIR}, never the bare form',
      /\$\{CLAUDE_PROJECT_DIR\}/.test(JSON.stringify(settingsFor(a.policy))));
    /**
     * settingsFor must be a FUNCTION of the policy. Hardcoding 'Bash' passed every
     * gate in this repository, because every probe happened to declare exactly that,
     * which independent review 2026-08-07 proved by doing it.
     */
    check('the emitted matcher follows the policy rather than a hardcoded name',
      settingsFor({ ...a.policy, matcher: 'Bash|BashOutput' }).hooks.PreToolUse[0].matcher === 'Bash|BashOutput'
      && settingsFor({ ...a.policy, matcher: 'Bash' }).hooks.PreToolUse[0].matcher === 'Bash');
    check('the handler never emits an allow decision, only a deny', !/permissionDecision: 'allow'/.test(src) && !/"allow"/.test(src.split('const POLICY')[1].split('let buf')[0].replace(/defaultDecision[^,]*/, '')));
  }

  console.log('conformance generation:');
  for (const probe of GATE_PROBES) {
    const a = analyse({ policy: probe.policy });
    const { files, conf } = buildBundle(`probe-${probe.id}`, { policy: probe.policy }, a);
    const kinds = conf.cases.map((c) => c.kind).join(',');
    check(`${probe.id} case kinds are frozen: ${probe.summary}`, kinds === probe.kinds, kinds);
    check(`${probe.id} every case declares an expectation`, conf.cases.every((c) => c.expect && Object.keys(c.expect).length));
    check(`${probe.id} every case id is unique`, new Set(conf.cases.map((c) => c.id)).size === conf.cases.length);
    check(`${probe.id} strict follows absolute`, !!conf.strict === !!probe.strict);
    check(`${probe.id} files are frozen`, JSON.stringify(Object.keys(files).sort()) === JSON.stringify(filesFor(probe)), Object.keys(files).sort().join(','));
    check(`${probe.id} per-probe checks pass`, checkProbe(probe, files).length === 0, checkProbe(probe, files).join('; '));
    check(`${probe.id} every residual names its vector`, conf.cases.filter((c) => c.kind === 'residual').every((c) => c.vector && c.why));
  }
  /**
   * The indirection probe lands three different ways, and getting this wrong was a
   * real defect: an allowlist policy DOES block `sh -c "..."` via its default
   * deny, so calling that vector open was false. The generator's own self-test
   * agreed with itself; running the bundle through the prover did not.
   */
  {
    const idsOf = (p) => conformanceFor('x', p, analyse({ policy: p })).cases.map((c) => c.id);
    check('an absolute policy DENIES indirection and says so',
      idsOf(GATE_PROBES[1].policy).includes('absolute-policy-refuses-what-it-cannot-read'));
    check('a deny-by-default allowlist blocks it too, and is not reported as a gap',
      idsOf(GATE_PROBES[2].policy).includes('indirection-falls-to-the-default-deny')
      && !idsOf(GATE_PROBES[2].policy).includes('indirection-is-not-inspected'));
    check('an allow-by-default policy with no absolute flag reports the REAL gap',
      idsOf(GATE_PROBES[0].policy).includes('indirection-is-not-inspected'));
    check('exactly one of the three is ever emitted', GATE_PROBES.every((p) =>
      idsOf(p.policy).filter((i) => /^(absolute-policy-refuses|indirection-)/.test(i)).length === 1));
  }

  console.log('the deny proposal, which is a proposal and not a setting:');
  {
    const a = analyse({ policy: RM() });
    const { files } = buildBundle('x', { policy: RM() }, a);
    const p = files['permissions-deny.json.proposal'];
    check('it exists for a static-shape deny rule', !!p);
    /**
     * THIS ROW USED TO BE UNFALSIFIABLE, and it was guarding the property its own
     * name promises. It read:
     *
     *   !Object.keys(files).includes('permissions.json')
     *     && !/^settings\.json$/.test('permissions-deny.json.proposal')
     *
     * The second conjunct tests a STRING LITERAL, which no code in this repository
     * can change. The first looks for a key `buildBundle` never emits. Independent
     * review 2026-08-07 reproduced it by making buildBundle write the proposal
     * INTO settings.json: the whole self-test still exited 0 with this row green.
     *
     * The real property is that the proposal is a SEPARATE, non-loadable file and
     * that settings.json is still the wiring. Asserted against the actual bytes.
     */
    check('the proposal is a separate file and settings.json is still the wiring',
      files['permissions-deny.json.proposal'] !== files['settings.json']
      && !/_why_not_adopted/.test(files['settings.json'])
      && /"hooks"/.test(files['settings.json']));
    check('...and its filename cannot be loaded as settings by anything',
      Object.keys(files).filter((k) => /(^|\/)settings\.json$/.test(k)).join(',') === 'settings.json');
    check('...and settings.json carries NO permissions block, adopted or otherwise',
      !('permissions' in JSON.parse(files['settings.json'])));
    check('it opens with the non-adoption preamble, not with "permissions"', /^\{\s*\n\s*"_what"/.test(p));
    check('it says the rule is UNDETERMINED here rather than implying it works', /UNDETERMINED/.test(p));
    check('it names the one provable alternative and its cost', /_the_one_provable_alternative/.test(p) && /blocks EVERY Bash command/.test(p));
    const noStatic = analyse({ policy: GATE_PROBES[3].policy });
    check('a policy with no static-shape deny rule gets NO proposal', noStatic.denyCandidates.length === 0);
  }

  console.log('decide(), end to end, against the policies above:');
  check('a matching dangerous operation is denied', decide('rm -rf build', runtimePolicy(RM()), process.cwd()).decision === 'deny');
  check('a non-matching command falls through to defaultDecision', decide('ls -la', runtimePolicy(RM()), process.cwd()).decision === 'allow');
  check('an allowlist denies by default', decide('npm publish', runtimePolicy(GATE_PROBES[2].policy), process.cwd()).decision === 'deny');
  check('...and permits the approved shape', decide('npm run test', runtimePolicy(GATE_PROBES[2].policy), process.cwd()).decision === 'allow');
  check('an absolute policy denies indirection', decide('sh -c "ls"', runtimePolicy(RM({ absolute: true })), process.cwd()).decision === 'deny');
  check('...and a non-absolute one does not', decide('sh -c "ls"', runtimePolicy(RM()), process.cwd()).decision === 'allow');
  check('the deny reason names the rule that fired', decide('rm -rf build', runtimePolicy(RM()), process.cwd()).ruleId === 'no-rm-rf');

  console.log(fails ? `\nSELF-TEST FAIL (${fails})` : '\nSELF-TEST PASS');
  return fails ? 1 : 0;
}

if (IS_MAIN) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  console.log(`${id}: ${summary}`);
  console.log(`requires: ${requires.join('; ')}`);
  console.log(`gate probes: ${GATE_PROBES.map((p) => p.id).join(', ')}`);
  process.exit(0);
}
