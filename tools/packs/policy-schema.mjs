#!/usr/bin/env node
/**
 * THE VALIDATION POLICY FORMAT, v1. Explicit, versioned, machine-validated.
 *
 * WHY A FORMAT AND NOT PROSE PARSING
 * ----------------------------------
 * `protect-path` extracts one thing from English, a path, and independent review
 * still found it misreading two phrasings. A validation policy is command
 * grammars, prerequisite programs, timeouts and schemas: inferring that from free
 * text would make the least reliable component in the system responsible for what
 * a security-shaped hook blocks. A generated validator built on guessed semantics
 * is worse than no validator, because it is trusted.
 *
 * So the policy is DATA the author writes, this module is the only thing that
 * decides whether it is valid, and anything it does not understand is REFUSED
 * rather than defaulted. Refusal is the feature.
 *
 * WHAT IS DELIBERATELY NARROW, stated because the alternative is a lie
 * -------------------------------------------------------------------
 * `commandMatches` is NOT a shell parser. It matches an executable name and an
 * anchored pattern over the remaining argument string. It cannot see through a
 * pipe, a variable, a subshell, a nested interpreter, or a leading `cd`, and the
 * repo has MEASURED that the product's own deny rule cannot either. A policy that
 * needs those has to say so in its own reason text; this module will not pretend.
 *
 * `narrowSchema` is NOT JSON Schema and is never called that. It supports exactly
 * `required`, `properties` with `type` and optional `enum`, and
 * `additionalProperties`. Every other keyword is REFUSED at generation time, not
 * ignored, because ignoring a keyword silently narrows a validator the author
 * believes is enforcing it. For anything richer the policy declares an
 * `externalValidator` command, and what gets proved is that command's exit-code
 * contract and nothing more.
 *
 * usage:
 *   node tools/packs/policy-schema.mjs <file>      validate a policy, print findings
 *   node tools/packs/policy-schema.mjs --self-test
 *
 * exit: 0 valid, 1 invalid, 2 usage
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export const POLICY_SCHEMA_VERSION = 1;
export const NARROW_SCHEMA_VERSION = 1;

/**
 * The five families. `evaluator` says which runtime path the generated handler
 * takes, and two families deliberately share one: `required-check` and
 * `deployment-gate` are the same mechanism (run declared programs, all must
 * succeed) with different intent and different documentation. Saying so is more
 * honest than duplicating the evaluator to make the count look like five.
 */
export const FAMILIES = new Map([
  ['command-validation', { evaluator: 'match', needs: ['commandMatches'], optional: [] }],
  ['dangerous-operation', { evaluator: 'match', needs: ['commandMatches'], optional: [] }],
  ['required-check', { evaluator: 'programs', needs: ['commandMatches', 'checksPass'], optional: [] }],
  ['schema-validation', { evaluator: 'schema', needs: ['commandMatches', 'documentAt'], optional: ['narrowSchema', 'externalValidator'] }],
  ['deployment-gate', { evaluator: 'programs', needs: ['commandMatches', 'gates'], optional: [] }],
]);

export const PRECEDENCE = 'first-match-wins-in-declared-order';

/**
 * `allow` DOES NOT MEAN AUTO-APPROVE, and the distinction is load-bearing.
 *
 * A PreToolUse hook returning permissionDecision "allow" BYPASSES the permission
 * system for that call: a validator whose unmatched path emitted allow would
 * silently auto-approve everything the user would otherwise be asked about, which
 * is a privilege escalation dressed as a safety feature.
 *
 * So a rule with decision `allow` means "stop evaluating and express NO OPINION".
 * The generated handler emits nothing at all on that path and exits 0, and the
 * normal permission flow decides. Only `deny` produces a permissionDecision.
 * Stated here, asserted by a wiring case in every generated bundle, and repeated
 * in the generated README, because the word invites the wrong reading.
 */
export const DECISIONS = new Set(['allow', 'deny']);
export const NARROW_TYPES = new Set(['string', 'number', 'boolean']);
export const MAX_TIMEOUT_MS = 60_000;
export const MIN_TIMEOUT_MS = 100;

const TOP_KEYS = new Set(['policySchema', 'id', 'tool', 'matcher', 'precedence', 'defaultDecision', 'rules', 'absolute', 'description']);
/**
 * `examples`, `gateSetup` and `documentExamples` are declared here so an unknown
 * key is still refused, but their CONTENTS are checked by the pack, not here: the
 * check that matters is "does this example actually match this rule", and that
 * needs the same command matcher the generated handler runs. Validating them
 * structurally in two places and semantically in neither is how a policy passes
 * validation while describing something else.
 */
const RULE_KEYS = new Set(['id', 'family', 'decision', 'reason', 'when', 'examples', 'gateSetup', 'documentExamples']);
const MATCH_KEYS = new Set(['exec', 'argsPattern', 'anyFlag', 'anyArgPattern']);
const PROGRAM_KEYS = new Set(['id', 'command', 'timeoutMs']);
const NARROW_KEYS = new Set(['narrowSchema', 'required', 'properties', 'additionalProperties']);
const PROP_KEYS = new Set(['type', 'enum']);
const EXTERNAL_KEYS = new Set(['command', 'timeoutMs']);

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

/** Unknown keys are refused everywhere, because an ignored key is a silent narrowing. */
function unknownKeys(obj, allowed, where, out) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) out.push(`${where}: unknown key "${k}". Allowed: ${[...allowed].sort().join(', ')}.`);
  }
}

/**
 * A path a generated handler will READ must not escape the project. Refused at
 * generation, so the traversal never reaches a running validator.
 */
export function unsafeRelPath(p) {
  const s = String(p);
  if (!s) return 'is empty';
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(s)) return 'is absolute; the handler resolves paths against the project root';
  if (s.split(/[\\/]/).includes('..')) return 'contains a ".." segment, which would escape the project root';
  if (/\0/.test(s)) return 'contains a NUL byte';
  return null;
}

function checkRegex(src, where, out) {
  if (!isStr(src)) { out.push(`${where}: must be a non-empty string`); return; }
  if (!src.startsWith('^') || !src.endsWith('$')) {
    out.push(`${where}: must be ANCHORED with ^ and $. An unanchored pattern matches a substring, `
      + 'which is how a validator ends up allowing "npm run test; rm -rf /".');
  }
  try { new RegExp(src); } catch (e) { out.push(`${where}: is not a valid regular expression (${e.message})`); }
}

function checkPrograms(list, where, out) {
  if (!Array.isArray(list) || list.length === 0) { out.push(`${where}: must be a non-empty array`); return; }
  const seen = new Set();
  list.forEach((p, i) => {
    const at = `${where}[${i}]`;
    if (!isPlain(p)) { out.push(`${at}: must be an object`); return; }
    unknownKeys(p, PROGRAM_KEYS, at, out);
    if (!isStr(p.id)) out.push(`${at}.id: must be a non-empty string`);
    else if (seen.has(p.id)) out.push(`${at}.id: duplicate id "${p.id}" within ${where}`);
    else seen.add(p.id);
    if (!Array.isArray(p.command) || p.command.length === 0 || !p.command.every(isStr)) {
      out.push(`${at}.command: must be a non-empty ARGV array of strings. A single string would need a shell, `
        + 'and the handler never uses one.');
    }
    if (p.timeoutMs === undefined) out.push(`${at}.timeoutMs: required. An unbounded check is a hook that hangs, and a hung hook fails OPEN.`);
    else if (typeof p.timeoutMs !== 'number' || !Number.isFinite(p.timeoutMs)) out.push(`${at}.timeoutMs: must be a number`);
    else if (p.timeoutMs < MIN_TIMEOUT_MS || p.timeoutMs > MAX_TIMEOUT_MS) {
      out.push(`${at}.timeoutMs: must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
    }
  });
}

/** The narrow schema language. Every unsupported keyword is a REFUSAL. */
export function checkNarrowSchema(s, where, out) {
  if (!isPlain(s)) { out.push(`${where}: must be an object`); return; }
  unknownKeys(s, NARROW_KEYS, where, out);
  if (s.narrowSchema !== NARROW_SCHEMA_VERSION) {
    out.push(`${where}.narrowSchema: must be ${NARROW_SCHEMA_VERSION}. This is NOT JSON Schema and is `
      + 'deliberately not called that; declare the version so a future widening is explicit.');
  }
  if (s.required !== undefined && (!Array.isArray(s.required) || !s.required.every(isStr))) {
    out.push(`${where}.required: must be an array of non-empty strings`);
  }
  if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean') {
    out.push(`${where}.additionalProperties: must be a boolean`);
  }
  if (s.properties !== undefined) {
    if (!isPlain(s.properties)) { out.push(`${where}.properties: must be an object`); return; }
    for (const [k, v] of Object.entries(s.properties)) {
      const at = `${where}.properties.${k}`;
      if (!isPlain(v)) { out.push(`${at}: must be an object`); continue; }
      unknownKeys(v, PROP_KEYS, at, out);
      if (!NARROW_TYPES.has(v.type)) {
        out.push(`${at}.type: must be one of ${[...NARROW_TYPES].join(', ')}. Anything else (object, array, `
          + '"integer", $ref, oneOf, pattern, format) is OUTSIDE this language and is refused rather than '
          + 'ignored. Use externalValidator for a real schema engine.');
      }
      if (v.enum !== undefined) {
        if (!Array.isArray(v.enum) || v.enum.length === 0) out.push(`${at}.enum: must be a non-empty array`);
        else if (!v.enum.every((x) => typeof x === v.type)) out.push(`${at}.enum: every member must match type "${v.type}"`);
      }
    }
  }
  if (s.required && s.properties) {
    for (const r of s.required) {
      if (!(r in s.properties)) out.push(`${where}: "${r}" is required but has no entry in properties, so its type is unconstrained`);
    }
  }
}

function checkWhen(rule, i, out) {
  const at = `rules[${i}].when`;
  const fam = FAMILIES.get(rule.family);
  if (!isPlain(rule.when)) { out.push(`${at}: must be an object`); return; }
  if (!fam) return;

  const allowed = new Set([...fam.needs, ...fam.optional]);
  unknownKeys(rule.when, allowed, at, out);
  for (const need of fam.needs) {
    if (rule.when[need] === undefined) out.push(`${at}.${need}: required for family "${rule.family}"`);
  }

  if (rule.when.commandMatches !== undefined) {
    const cm = rule.when.commandMatches;
    const cat = `${at}.commandMatches`;
    if (!isPlain(cm)) out.push(`${cat}: must be an object`);
    else {
      unknownKeys(cm, MATCH_KEYS, cat, out);
      if (!isStr(cm.exec)) out.push(`${cat}.exec: required, the executable name as written (no path, no shell)`);
      else if (/[\\/\s]/.test(cm.exec)) out.push(`${cat}.exec: must be a bare name with no path separator or whitespace`);
      if (cm.argsPattern !== undefined) checkRegex(cm.argsPattern, `${cat}.argsPattern`, out);
      for (const k of ['anyFlag', 'anyArgPattern']) {
        if (cm[k] === undefined) continue;
        if (!Array.isArray(cm[k]) || cm[k].length === 0) { out.push(`${cat}.${k}: must be a non-empty array`); continue; }
        if (k === 'anyFlag' && !cm[k].every(isStr)) out.push(`${cat}.anyFlag: must be strings`);
        if (k === 'anyArgPattern') cm[k].forEach((p, j) => checkRegex(p, `${cat}.anyArgPattern[${j}]`, out));
      }
      if (cm.argsPattern === undefined && cm.anyFlag === undefined && cm.anyArgPattern === undefined) {
        out.push(`${cat}: needs at least one of argsPattern, anyFlag, anyArgPattern. An exec name alone would `
          + 'match every invocation of that program, which is a tool-level rule and belongs in permissions, not here.');
      }
    }
  }

  if (rule.when.checksPass !== undefined) checkPrograms(rule.when.checksPass, `${at}.checksPass`, out);
  if (rule.when.gates !== undefined) {
    checkPrograms(rule.when.gates, `${at}.gates`, out);
    if (Array.isArray(rule.when.gates) && rule.when.gates.length < 2) {
      out.push(`${at}.gates: a deployment gate with one program is a required-check; declare family `
        + '"required-check" instead so the intent and the documentation match.');
    }
  }

  if (rule.family === 'schema-validation') {
    const bad = unsafeRelPath(rule.when.documentAt);
    if (bad) out.push(`${at}.documentAt: ${bad}`);
    const hasNarrow = rule.when.narrowSchema !== undefined;
    const hasExternal = rule.when.externalValidator !== undefined;
    if (!hasNarrow && !hasExternal) out.push(`${at}: needs either narrowSchema or externalValidator`);
    if (hasNarrow && hasExternal) {
      out.push(`${at}: declares BOTH narrowSchema and externalValidator. Which one decides would be an `
        + 'implicit precedence, so this is refused rather than resolved.');
    }
    if (hasNarrow) checkNarrowSchema(rule.when.narrowSchema, `${at}.narrowSchema`, out);
    if (hasExternal) {
      const ev = rule.when.externalValidator;
      const eat = `${at}.externalValidator`;
      if (!isPlain(ev)) out.push(`${eat}: must be an object`);
      else {
        unknownKeys(ev, EXTERNAL_KEYS, eat, out);
        checkPrograms([{ id: 'external', command: ev.command, timeoutMs: ev.timeoutMs }], eat, out);
      }
    }
  }
}

/**
 * Validate a policy. Returns `{ ok, errors[], policy }`. Never throws on bad
 * input, so a caller can report every problem at once instead of the first.
 */
export function validatePolicy(policy) {
  const out = [];
  if (!isPlain(policy)) return { ok: false, errors: ['policy: must be a JSON object'], policy: null };
  unknownKeys(policy, TOP_KEYS, 'policy', out);

  if (policy.policySchema !== POLICY_SCHEMA_VERSION) {
    out.push(`policy.policySchema: must be ${POLICY_SCHEMA_VERSION}. The version is required so a future `
      + 'format change is a refusal rather than a misreading.');
  }
  if (!isStr(policy.id)) out.push('policy.id: required, a non-empty string');
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(policy.id)) out.push('policy.id: must be lowercase-kebab-case');
  if (policy.tool !== 'Bash') {
    out.push('policy.tool: must be "Bash". That is the only tool whose primary input this format can '
      + 'inspect (tool_input.command); widening it needs a new when-shape, not a looser check.');
  }
  if (!isStr(policy.matcher)) out.push('policy.matcher: required, the PreToolUse matcher string');
  if (policy.precedence !== PRECEDENCE) {
    out.push(`policy.precedence: must be the literal "${PRECEDENCE}". It is spelled out rather than `
      + 'defaulted because rule order decides what a validator blocks, and an implicit order is an '
      + 'invisible decision.');
  }
  if (!DECISIONS.has(policy.defaultDecision)) {
    out.push('policy.defaultDecision: required, "allow" or "deny". What happens when NO rule matches is '
      + 'the single most consequential line in a policy and is never inferred.');
  }
  if (policy.absolute !== undefined && typeof policy.absolute !== 'boolean') out.push('policy.absolute: must be a boolean');
  if (policy.description !== undefined && !isStr(policy.description)) out.push('policy.description: must be a non-empty string');

  if (!Array.isArray(policy.rules) || policy.rules.length === 0) {
    out.push('policy.rules: must be a non-empty array. An empty rule set generates a validator that '
      + 'decides nothing, which is worse than no validator because it looks installed.');
    return { ok: out.length === 0, errors: out, policy: out.length ? null : policy };
  }

  const ids = new Set();
  const seenWhen = new Map();
  policy.rules.forEach((r, i) => {
    const at = `rules[${i}]`;
    if (!isPlain(r)) { out.push(`${at}: must be an object`); return; }
    unknownKeys(r, RULE_KEYS, at, out);
    if (!isStr(r.id)) out.push(`${at}.id: required, a non-empty string`);
    else if (ids.has(r.id)) {
      out.push(`${at}.id: duplicate rule id "${r.id}". Ids appear in denial reasons and in conformance case `
        + 'names, so a duplicate makes a failure untraceable.');
    } else ids.add(r.id);
    if (!FAMILIES.has(r.family)) {
      out.push(`${at}.family: must be one of ${[...FAMILIES.keys()].join(', ')}. An unknown family is refused `
        + 'rather than treated as a generic match, because the family selects the evaluator.');
    }
    if (!DECISIONS.has(r.decision)) out.push(`${at}.decision: must be "allow" or "deny"`);
    /**
     * For the three families whose predicate IS a failure (the checks did not
     * pass, the gates are red, the document is invalid), `allow` would read as
     * "permit the action BECAUSE the check failed", the opposite of the rule's
     * own meaning. Refused rather than accepted as odd-but-legal.
     */
    else if (r.decision === 'allow' && FAMILIES.get(r.family) && FAMILIES.get(r.family).evaluator !== 'match') {
      out.push(`${at}.decision: family "${r.family}" fires when its prerequisite FAILS, so "allow" would mean `
        + '"permit the action because the check failed". Only "deny" is meaningful here.');
    }
    if (!isStr(r.reason)) {
      out.push(`${at}.reason: required. It is what the generated handler returns to the model, and a denial `
        + 'with no reason is indistinguishable from a crash.');
    }
    checkWhen(r, i, out);

    /**
     * CONTRADICTION AND REDUNDANCY, refused rather than resolved.
     *
     * Two rules with an identical predicate and different decisions have no
     * correct answer: first-match-wins would pick one, and picking silently is
     * exactly what the precedence field exists to prevent. Identical predicate
     * with the SAME decision is dead code, which is also refused, because a
     * second rule that can never fire is a rule the author believes is working.
     */
    const key = JSON.stringify(r.when);
    if (seenWhen.has(key)) {
      const prev = seenWhen.get(key);
      out.push(prev.decision === r.decision
        ? `${at}: predicate is identical to rules[${prev.i}] ("${prev.id}") with the same decision, so this rule can never fire. Remove it or change its predicate.`
        : `${at}: CONTRADICTS rules[${prev.i}] ("${prev.id}"): identical predicate, decision "${prev.decision}" versus "${r.decision}". `
          + 'Refused rather than resolved by order, because a contradictory policy has no right answer and picking one silently is the defect.');
    } else seenWhen.set(key, { i, id: r.id, decision: r.decision });
  });

  /**
   * A POLICY THAT CAN NEVER DENY IS A VALIDATOR THAT CANNOT FAIL.
   *
   * This is the same defect this repository keeps finding in its own gates, one
   * layer up: every rule `allow` plus `defaultDecision: allow` generates a hook
   * that runs, reports, installs cleanly and blocks nothing on any input. It
   * would pass its own conformance spec, because there would be no enforce case
   * to fail. Refused at generation.
   */
  if (Array.isArray(policy.rules) && policy.rules.length
    && policy.defaultDecision === 'allow'
    && policy.rules.every((r) => r && r.decision === 'allow')) {
    out.push('policy: no rule and no default can produce a deny, so this generates a validator that cannot '
      + 'block anything on any input. That is a check that cannot fail. Either give a rule decision "deny" '
      + 'or set defaultDecision to "deny" and list the permitted shapes as allow rules.');
  }

  return { ok: out.length === 0, errors: out, policy: out.length ? null : policy };
}

/** Load and validate in one step. Returns the same shape plus `source`. */
export function loadPolicy(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { return { ok: false, errors: [`policy file: ${e.message}`], policy: null, source: file }; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return { ok: false, errors: [`policy file is not valid JSON: ${e.message}`], policy: null, source: file }; }
  return { ...validatePolicy(parsed), source: file };
}

// ------------------------------------------------------------------ self-test
export function VALID_EXAMPLE() {
  return {
    policySchema: 1,
    id: 'example',
    tool: 'Bash',
    matcher: 'Bash',
    precedence: PRECEDENCE,
    defaultDecision: 'allow',
    rules: [{
      id: 'R1', family: 'dangerous-operation', decision: 'deny', reason: 'recursive force delete',
      when: { commandMatches: { exec: 'rm', anyFlag: ['-rf', '-fr'] } },
    }],
  };
}

function selfTest() {
  let fails = 0;
  const check = (n, ok, got) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : `  (${got})`}`); if (!ok) fails++; };
  const bad = (mut, name, needle) => {
    const p = VALID_EXAMPLE(); mut(p);
    const r = validatePolicy(p);
    const hit = !r.ok && (!needle || r.errors.some((e) => e.includes(needle)));
    check(`MUST REFUSE: ${name}`, hit, r.ok ? 'accepted' : r.errors.join(' | ').slice(0, 130));
  };

  console.log('the happy path, so the refusals below mean something:');
  check('a minimal valid policy validates', validatePolicy(VALID_EXAMPLE()).ok, validatePolicy(VALID_EXAMPLE()).errors.join(' | '));
  check('...and round-trips through JSON unchanged',
    JSON.stringify(validatePolicy(JSON.parse(JSON.stringify(VALID_EXAMPLE()))).policy) === JSON.stringify(VALID_EXAMPLE()));
  check('all five families are declared', FAMILIES.size === 5, [...FAMILIES.keys()].join(','));
  check('two families deliberately SHARE the programs evaluator, and it is not hidden',
    FAMILIES.get('required-check').evaluator === 'programs' && FAMILIES.get('deployment-gate').evaluator === 'programs');

  console.log('version, shape and unknown keys:');
  bad((p) => { p.policySchema = 2; }, 'a future policySchema', 'must be 1');
  bad((p) => { delete p.policySchema; }, 'a missing policySchema');
  bad((p) => { p.extra = 1; }, 'an unknown top-level key', 'unknown key "extra"');
  bad((p) => { p.rules[0].extra = 1; }, 'an unknown rule key', 'unknown key "extra"');
  bad((p) => { p.rules[0].when.commandMatches.extra = 1; }, 'an unknown commandMatches key', 'unknown key "extra"');
  bad((p) => { p.id = 'Not Kebab'; }, 'a non-kebab id', 'kebab');
  bad((p) => { p.tool = 'Write'; }, 'a tool this format cannot inspect', 'must be "Bash"');
  bad((p) => { p.precedence = 'last-match-wins'; }, 'an invented precedence', 'literal');
  bad((p) => { delete p.precedence; }, 'a missing precedence');
  bad((p) => { delete p.defaultDecision; }, 'a missing defaultDecision', 'never inferred');
  bad((p) => { p.defaultDecision = 'maybe'; }, 'a nonsense defaultDecision');
  bad((p) => { p.rules = []; }, 'an empty rule set', 'decides nothing');
  bad((p) => { p.rules = 'R1'; }, 'rules that are not an array');
  bad((p) => { p.absolute = 'yes'; }, 'a non-boolean absolute');
  check('MUST REFUSE: a non-object policy', !validatePolicy(null).ok && !validatePolicy([]).ok && !validatePolicy('x').ok);

  console.log('rules:');
  bad((p) => { delete p.rules[0].reason; }, 'a rule with no reason', 'indistinguishable from a crash');
  bad((p) => { p.rules[0].decision = 'block'; }, 'a decision that is not allow or deny');
  bad((p) => { p.rules[0].family = 'invented'; }, 'an unknown family', 'selects the evaluator');
  bad((p) => { p.rules.push({ ...p.rules[0] }); }, 'a duplicate rule id', 'duplicate rule id');
  bad((p) => { p.rules.push({ id: 'R2', family: 'dangerous-operation', decision: 'allow', reason: 'x', when: JSON.parse(JSON.stringify(p.rules[0].when)) }); },
    'two rules with the SAME predicate and DIFFERENT decisions', 'CONTRADICTS');
  bad((p) => { p.rules.push({ id: 'R2', family: 'dangerous-operation', decision: 'deny', reason: 'x', when: JSON.parse(JSON.stringify(p.rules[0].when)) }); },
    'a rule that can never fire because an earlier one has the same predicate', 'never fire');
  bad((p) => { p.rules[0].decision = 'allow'; }, 'a policy where NOTHING can ever deny', 'cannot fail');
  {
    const p = VALID_EXAMPLE();
    p.defaultDecision = 'deny';
    p.rules[0] = { id: 'R1', family: 'command-validation', decision: 'allow', reason: 'approved shape', when: { commandMatches: { exec: 'npm', argsPattern: '^run (test|build)$' } } };
    check('an allowlist policy (allow the approved shape, deny by default) IS accepted', validatePolicy(p).ok, validatePolicy(p).errors.join(' | '));
  }
  {
    const p = VALID_EXAMPLE();
    p.rules[0] = { id: 'R1', family: 'required-check', decision: 'allow', reason: 'x', when: { commandMatches: { exec: 'git', argsPattern: '^push$' }, checksPass: [{ id: 't', command: ['npm', 'test'], timeoutMs: 5000 }] } };
    const r = validatePolicy(p);
    check('MUST REFUSE: decision "allow" on a family that fires when its prerequisite FAILS',
      !r.ok && r.errors.some((e) => /because the check failed/.test(e)), r.errors.join(' | '));
  }

  console.log('commandMatches, which is NOT a shell parser:');
  bad((p) => { delete p.rules[0].when.commandMatches.anyFlag; }, 'an exec name with no further constraint', 'belongs in permissions');
  bad((p) => { p.rules[0].when.commandMatches.exec = '/usr/bin/rm'; }, 'an exec with a path separator', 'bare name');
  bad((p) => { p.rules[0].when.commandMatches.exec = 'rm -rf'; }, 'an exec with whitespace');
  bad((p) => { p.rules[0].when.commandMatches.argsPattern = 'run test'; }, 'an UNANCHORED pattern', 'ANCHORED');
  bad((p) => { p.rules[0].when.commandMatches.argsPattern = '^([a$'; }, 'an invalid regular expression', 'not a valid regular expression');
  bad((p) => { p.rules[0].when.commandMatches.anyFlag = []; }, 'an empty anyFlag array');
  check('an anchored pattern is accepted',
    (() => { const p = VALID_EXAMPLE(); p.rules[0].when.commandMatches = { exec: 'npm', argsPattern: '^run (test|build)$' }; return validatePolicy(p).ok; })());

  console.log('required-check and deployment-gate programs:');
  const withChecks = (checks) => { const p = VALID_EXAMPLE(); p.rules[0] = { id: 'R1', family: 'required-check', decision: 'deny', reason: 'checks failed', when: { commandMatches: { exec: 'git', argsPattern: '^push$' }, checksPass: checks } }; return p; };
  check('a well formed check list is accepted', validatePolicy(withChecks([{ id: 'tests', command: ['npm', 'test'], timeoutMs: 5000 }])).ok);
  check('MUST REFUSE: a check command given as a STRING, which would need a shell',
    !validatePolicy(withChecks([{ id: 't', command: 'npm test', timeoutMs: 5000 }])).ok);
  check('MUST REFUSE: a check with no timeout, because a hung hook fails OPEN',
    !validatePolicy(withChecks([{ id: 't', command: ['npm', 'test'] }])).ok);
  check('MUST REFUSE: a timeout above the ceiling',
    !validatePolicy(withChecks([{ id: 't', command: ['npm'], timeoutMs: MAX_TIMEOUT_MS + 1 }])).ok);
  check('MUST REFUSE: a timeout below the floor',
    !validatePolicy(withChecks([{ id: 't', command: ['npm'], timeoutMs: 1 }])).ok);
  check('MUST REFUSE: duplicate check ids within one rule',
    !validatePolicy(withChecks([{ id: 't', command: ['a'], timeoutMs: 500 }, { id: 't', command: ['b'], timeoutMs: 500 }])).ok);
  check('MUST REFUSE: an empty check list', !validatePolicy(withChecks([])).ok);
  {
    const p = VALID_EXAMPLE();
    p.rules[0] = { id: 'R1', family: 'deployment-gate', decision: 'deny', reason: 'gates red', when: { commandMatches: { exec: 'deploy', argsPattern: '^prod$' }, gates: [{ id: 'a', command: ['x'], timeoutMs: 500 }] } };
    check('MUST REFUSE: a deployment gate with only ONE program, which is a required-check', !validatePolicy(p).ok);
    p.rules[0].when.gates.push({ id: 'b', command: ['y'], timeoutMs: 500 });
    check('...and two gates are accepted', validatePolicy(p).ok, validatePolicy(p).errors.join(' | '));
  }

  console.log('narrowSchema, which is NOT JSON Schema:');
  const withSchema = (schema, documentAt = 'deploy.json') => { const p = VALID_EXAMPLE(); p.rules[0] = { id: 'R1', family: 'schema-validation', decision: 'deny', reason: 'invalid', when: { commandMatches: { exec: 'deploy', argsPattern: '^apply$' }, documentAt, narrowSchema: schema } }; return p; };
  const OKS = { narrowSchema: 1, required: ['env'], additionalProperties: false, properties: { env: { type: 'string', enum: ['dev', 'prod'] }, replicas: { type: 'number' } } };
  check('a narrow schema inside the language is accepted', validatePolicy(withSchema(OKS)).ok, validatePolicy(withSchema(OKS)).errors.join(' | '));
  for (const [name, s] of [
    ['$ref', { narrowSchema: 1, properties: { a: { type: 'string' } }, $ref: '#/x' }],
    ['oneOf', { narrowSchema: 1, oneOf: [] }],
    ['pattern on a property', { narrowSchema: 1, properties: { a: { type: 'string', pattern: '^x$' } } }],
    ['format', { narrowSchema: 1, properties: { a: { type: 'string', format: 'email' } } }],
    ['type: integer', { narrowSchema: 1, properties: { a: { type: 'integer' } } }],
    ['type: object', { narrowSchema: 1, properties: { a: { type: 'object' } } }],
    ['type: array', { narrowSchema: 1, properties: { a: { type: 'array' } } }],
    ['a missing narrowSchema version', { properties: { a: { type: 'string' } } }],
    ['an enum whose members mismatch the type', { narrowSchema: 1, properties: { a: { type: 'number', enum: ['x'] } } }],
    ['required naming an unconstrained key', { narrowSchema: 1, required: ['ghost'], properties: { a: { type: 'string' } } }],
  ]) check(`MUST REFUSE: ${name} is OUTSIDE the language, not ignored`, !validatePolicy(withSchema(s)).ok, name);

  console.log('path traversal in a path the handler will READ:');
  for (const p of ['../../etc/passwd', '/etc/passwd', 'C:\\Windows\\win.ini', 'a/../../b', '']) {
    check(`MUST REFUSE: documentAt ${JSON.stringify(p)}`, !validatePolicy(withSchema(OKS, p)).ok);
  }
  check('a plain relative path is fine', validatePolicy(withSchema(OKS, 'config/deploy.json')).ok);
  check('unsafeRelPath names the reason rather than just failing',
    /escape the project root/.test(unsafeRelPath('../x')) && /absolute/.test(unsafeRelPath('/x')));

  console.log('narrowSchema versus externalValidator:');
  {
    const p = withSchema(OKS);
    p.rules[0].when.externalValidator = { command: ['ajv', 'validate'], timeoutMs: 5000 };
    check('MUST REFUSE: declaring BOTH, because which one decides would be implicit', !validatePolicy(p).ok);
    delete p.rules[0].when.narrowSchema;
    check('...and externalValidator alone is accepted', validatePolicy(p).ok, validatePolicy(p).errors.join(' | '));
    delete p.rules[0].when.externalValidator;
    check('MUST REFUSE: declaring NEITHER', !validatePolicy(p).ok);
  }

  console.log('loadPolicy:');
  check('a missing file is an error, not a throw', !loadPolicy('tmp/definitely-absent.json').ok);
  check('malformed JSON is an error, not a throw',
    !loadPolicy('tools/packs/policy-schema.mjs').ok && loadPolicy('tools/packs/policy-schema.mjs').errors.some((e) => /not valid JSON/.test(e)));

  console.log(fails ? `\nSELF-TEST FAIL (${fails})` : '\nSELF-TEST PASS');
  return fails ? 1 : 0;
}

if (IS_MAIN) {
  const a = process.argv.slice(2);
  if (a.includes('--self-test')) process.exit(selfTest());
  if (!a[0]) { console.error('usage: node tools/packs/policy-schema.mjs <policy.json>'); process.exit(2); }
  const r = loadPolicy(resolve(a[0]));
  if (r.ok) { console.log(`PASS policy "${r.policy.id}" is valid: ${r.policy.rules.length} rule(s), defaultDecision ${r.policy.defaultDecision}`); process.exit(0); }
  console.log(`REFUSED ${a[0]}`);
  for (const e of r.errors) console.log(`  ${e}`);
  console.log(`\n${r.errors.length} problem(s). Nothing was generated: an incomplete policy is refused rather than guessed at.`);
  process.exit(1);
}
