#!/usr/bin/env node
/**
 * extension-prove: behavioural conformance for a Claude Code extension bundle.
 *
 * WHY THIS EXISTS
 * ---------------
 * The shipped tester, plugin-dev/skills/hook-development/scripts/test-hook.sh,
 * ends with:
 *
 *     if [ $exit_code -eq 0 ] || [ $exit_code -eq 2 ]; then
 *       echo "Test completed successfully"
 *       exit 0
 *
 * Exit 0 is allow. Exit 2 is deny. Both print success, and the script accepts no
 * expected outcome at all (usage is `<hook-script> <test-input.json>`). So a hook
 * written to block a destructive write, that allows it, passes. Measured on this
 * machine 2026-08-04: a handler whose guard never fires scored
 * "Hook approved/succeeded" and exit 0.
 *
 * That same script never reads hooks.json (the strings `hooks.json` and `matcher`
 * do not appear in it). It pipes stdin straight into the handler, so the matcher
 * is never evaluated: a hook with matcher "Edit" whose handler blocks "Write"
 * passes every shipped validator and never fires in production.
 *
 * This tool asserts an EXPECTED OUTCOME and evaluates the wiring.
 *
 * SCOPE, deliberately narrow, and the earlier wording of this paragraph was
 * WRONG in both directions
 * -----------------------------------------------------------------------
 * It said "hooks only". That undersold the tool, which has always evaluated
 * permission rules as a separate harness-owned layer, and it also let the tool
 * be pointed at a skill or an MCP server, where it produced a WRONG DIAGNOSIS
 * rather than a refusal: every case red with a hooks.md citation, which reads as
 * "your skill does not enforce" when nothing about the skill was ever tested.
 *
 * What is actually supported is enumerated in MECHANISM_ADAPTERS and enforced at
 * runtime: three enforcement mechanisms (command hooks, permission deny rules,
 * advisory) plus an explicit REFUSAL, exit 3, for the model-owned mechanisms
 * whose invocation is a routing outcome rather than a tool call.
 *
 * Within that scope, only mechanics stated verbatim in the references with a
 * citation per case kind, EXCEPT the Bash boundary, which the docs give by
 * example and never enumerate: that one is measured
 * (tools/bash-recognition.mjs) and anything unmeasured is UNDETERMINED, which
 * fails every expectation rather than defaulting to allow.
 *
 * Read-only with respect to the bundle: every case runs against a temp copy, and
 * the source tree is hashed before and after as defence in depth.
 *
 * PRECISELY WHAT IS GATED, because an audit found the earlier wording claimed
 * more than the self-test asserted: `hashTree` is gated (content change, revert,
 * and an added empty file are all detected). The before/after COMPARISON is not,
 * and cannot easily be, because every case already runs on a copy, so nothing
 * inside a normal run can make the source differ. Replacing the second hash with
 * the first would therefore not turn any gate red. Treat `mutatedSource` as a
 * belt-and-braces report, not a verified guarantee.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, cpSync, rmSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { join, resolve, dirname, relative, basename, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { shapeVerdict, RECOGNIZED_WRITE_SHAPES } from './bash-recognition.mjs';

// The IS_MAIN guard is not optional here. tier3-pack.mjs records that without it,
// one tool's --self-test silently ran a different file's self-test to completion
// and both reported PASS.
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export const CITE = {
  enforce: 'hooks.md: "prefer exit 0 with a JSON decision over exit code 2. Both block on a blocking event"',
  'near-miss': 'hooks.md failure modes: "Overly broad matcher, so it fires everywhere and gets disabled out of annoyance."',
  wiring: 'hooks.md: "Matcher: exact string, list (A|B), or regex (unanchored)" and "Tool events match tool_name."',
  'fail-posture': 'hooks.md: "jq is absent on many Windows installs, so the handler exits non-zero, fails open, and silently blocks nothing while looking installed."',
  /**
   * `residual` and `tamper` had NO entry, so every one of those cases reported
   * `citation: undefined`. The citation floor exists because an uncited complaint
   * is an opinion, and these two kinds carry the strongest claims in a spec: what
   * is NOT covered, and what survives tampering.
   */
  residual: 'permissions.md: Read and Edit deny rules "don\'t apply to arbitrary subprocesses that read or write files indirectly". A residual case asserts a named vector is NOT covered, so it goes red in both directions: if the product closes the gap, or if the bundle widens to cover it.',
  tamper: 'permissions.md: "Rules are evaluated in order: deny, then ask, then allow. The first match in that order determines the outcome, and rule specificity doesn\'t change the order." A tamper case asserts the decision survives a hostile edit to the bundle.',
};

/**
 * `residual` and `tamper` were added 2026-08-05, both because a check that could
 * not fail was found where a strong assertion was being claimed.
 *
 * `residual` asserts a named vector is NOT covered. It is how a coverage
 * disclosure becomes falsifiable: a printed warning goes stale in silence, a
 * case goes red in BOTH directions, if the product later closes the gap or if
 * someone widens the bundle to cover it. Carries `vector` and `why`.
 *
 * `tamper` replaces `fail-posture` for a bundle that ships no handler. Both
 * handler mutations iterate `settings.hooks`; with no hook present they mutate
 * nothing, so the case became byte-identical to the plain enforce case above it
 * while presenting as the strongest assertion in the file.
 */
export const CASE_KINDS = new Set(['enforce', 'near-miss', 'wiring', 'fail-posture', 'residual', 'tamper']);
export const MUTATIONS = new Set(['delete-handler', 'crash-handler', 'add-allow-rule', 'ignore-setup', 'none']);

/**
 * PER-CASE SETUP: `{ files: { "rel/path": "contents" }, env: { K: "v" } }`.
 *
 * Added 2026-08-07 because a whole class of handler was unprovable without it. A
 * handler that runs a prerequisite check, or validates a document on disk, decides
 * from state that is NOT in the tool payload, and nothing here could stage that
 * state: `applyMutation` only rewrites handler scripts that `settings.hooks`
 * already names. So a required-check hook could only ever be tested in whatever
 * state the bundle happened to ship in, which is one arm of a two-arm assertion.
 *
 * Files are written into the per-case TEMP COPY, never the bundle, so a case
 * cannot leave residue and two cases cannot see each other's state. Keys are
 * refused if they escape that copy: a conformance.json is an INPUT, and a spec
 * that writes to `../../.ssh/authorized_keys` must not be executed merely because
 * it parses.
 *
 * `ignore-setup` is the mutation that keeps the feature honest. A staged file the
 * handler never reads would make its case pass for the wrong reason, so a
 * setup-bearing case is paired with one that drops the setup and MUST go the other
 * way. Same paired-arm discipline the rest of this tool uses, applied to its own
 * newest surface.
 */
export function checkSetup(setup) {
  if (setup === undefined || setup === null) return [];
  if (typeof setup !== 'object' || Array.isArray(setup)) return ['`setup` must be an object with optional `files` and `env`'];
  const bad = [];
  for (const k of Object.keys(setup)) {
    if (k !== 'files' && k !== 'env') {
      bad.push(`unsupported setup key "${k}"; only files and env exist, and an ignored key is a case staging state it believes it staged`);
    }
  }
  for (const field of ['files', 'env']) {
    const v = setup[field];
    if (v === undefined) continue;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) { bad.push(`setup.${field} must be an object`); continue; }
    for (const [key, val] of Object.entries(v)) {
      if (typeof val !== 'string') bad.push(`setup.${field}["${key}"] must be a string`);
      if (field === 'env') {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) bad.push(`setup.env key "${key}" is not a valid environment variable name`);
        continue;
      }
      if (!key) { bad.push('setup.files has an empty path key'); continue; }
      if (/^([A-Za-z]:[\\/]|[\\/])/.test(key)) bad.push(`setup.files["${key}"] is an ABSOLUTE path; setup writes into the per-case temp copy only`);
      else if (key.split(/[\\/]/).includes('..')) bad.push(`setup.files["${key}"] contains "..", which would escape the per-case temp copy`);
      if (/\0/.test(key)) bad.push(`setup.files["${key}"] contains a NUL byte`);
    }
  }
  return bad;
}

/**
 * Stage a case's setup into its temp copy. Returns the env overlay for the
 * handler spawn. `ignore-setup` drops the whole thing, which is what makes the
 * paired negative arm possible.
 */
export function applySetup(dir, setup, mutation) {
  if (mutation === 'ignore-setup') return { env: {}, wrote: [], ignored: true };
  if (!setup) return { env: {}, wrote: [], ignored: false };
  const bad = checkSetup(setup);
  if (bad.length) throw new Error(`invalid \`setup\`: ${bad.join('; ')}`);
  const wrote = [];
  for (const [rel, content] of Object.entries(setup.files || {})) {
    const dest = join(dir, rel);
    // Belt and braces: the key was already refused above, and the RESOLVED path is
    // checked again, because the check that matters is the one on the value the
    // write actually uses.
    if (!resolve(dest).startsWith(resolve(dir) + sep)) throw new Error(`invalid \`setup\`: files["${rel}"] resolves outside the case copy`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    wrote.push(rel);
  }
  return { env: { ...(setup.env || {}) }, wrote, ignored: false };
}

// Events on which exit 2 blocks. From references/hook-events.md; kept small and
// explicit rather than inferred, so an unlisted event is a hard error not a guess.
export const BLOCKING_ON_EXIT2 = new Set([
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'PreCompact',
]);

/**
 * Documented matcher semantics, quoted in references/hooks.md:
 *   "Alphanumerics/_/-/space/comma/pipe -> exact or list; anything else -> regex"
 * plus the two documented wildcards.
 */
export function matcherMatches(matcher, toolName) {
  if (matcher === undefined || matcher === null) return true;   // no matcher = every occurrence
  if (matcher === '*' || matcher === '') return true;           // documented wildcards
  if (/^[A-Za-z0-9_\-, |]+$/.test(matcher)) {
    const alts = matcher.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
    return alts.some((a) => a === toolName);
  }
  try { return new RegExp(matcher).test(toolName); } catch { return false; }
}

/**
 * Permission-rule evaluation.
 *
 * Two documented facts drive this, both from the official permissions page:
 *
 *  1. "Rules are evaluated in order: deny, then ask, then allow. The first match
 *     in that order determines the outcome."
 *  2. "Claude Code checks file permissions against Edit(path) and Read(path)
 *     rules only. If you write a path rule for Write, NotebookEdit, Glob, or the
 *     legacy MultiEdit tool instead, Claude Code accepts the rule but never
 *     consults it." (v2.1.210+)
 *
 * Fact 2 is the silent failure this tool exists to surface: a deny rule written
 * the obvious way, Write(infra/**), is inert. We evaluate it as inert AND emit a
 * note, rather than quietly treating it as working.
 */
export const PATH_RULE_CONSULTED = new Set(['Edit', 'Read']);
export const PATH_RULE_IGNORED = new Set(['Write', 'NotebookEdit', 'Glob', 'MultiEdit']);
// An Edit rule covers every file-editing tool.
export const EDIT_COVERS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/\\\\]*';
    } else if (ch === '?') re += '[^/\\\\]';
    else if ('.+^${}()|[]\\'.includes(ch)) re += '\\' + ch;
    else if (ch === '/') re += '[/\\\\]';
    else re += ch;
  }
  return new RegExp('^' + re + '$');
}

export function parseRule(rule) {
  const m = String(rule).match(/^([^(]+)\((.*)\)$/);
  if (!m) return { tool: String(rule).trim(), pattern: null };
  return { tool: m[1].trim(), pattern: m[2].trim() };
}

/**
 * Tools a `Read(path)` rule is documented as covering only on a BEST-EFFORT
 * basis. permissions.md calls the search-tool coverage a "best-effort attempt",
 * which is not a guarantee, so the simulator refuses to turn it into one in
 * either direction.
 */
export const READ_BEST_EFFORT = new Set(['Grep', 'Glob']);

function ruleApplies(rule, toolName, toolInput, projectDir) {
  const { tool, pattern } = parseRule(rule);

  /**
   * The Bash boundary, which used to be answered `allow` by omission.
   *
   * `Bash` is not in EDIT_COVERS, so an `Edit(infra/**)` rule used to fall
   * straight through to "does not apply" and the verdict defaulted to allow.
   * That is a WRONG answer, not a missing one: the paired live calibration shows
   * the rule does stop several Bash shapes. So an uncalibrated shape is now
   * UNDETERMINED, which fails every expectation, and only a shape with a
   * measured verdict behind it is answered at all.
   */
  if (toolName === 'Bash' && pattern !== null && PATH_RULE_CONSULTED.has(tool)) {
    const command = String((toolInput && toolInput.command) || '');
    const v = shapeVerdict(command);
    if (v.state === 'undetermined') {
      return { applies: false, undetermined: true, note: `permission rule "${rule}" against a Bash command is UNDETERMINED: ${v.why}. permissions.md gives the recognised file commands by EXAMPLE and never enumerates them, so this cannot be read out of the docs; it has to be measured (tools/bash-recognition.mjs).` };
    }
    if (v.state === 'residual') {
      return { applies: false, note: `permission rule "${rule}" does NOT reach the Bash shape "${v.classification.shape}": measured ALLOWED in the paired calibration (n=${v.row.n}, ${v.row.cli}, ${v.row.platform}).` };
    }
    const pat = pattern.replace(/^\.\//, '');
    const re = globToRegex(pat);
    const hit = (v.classification.targets || []).some((t) => re.test(String(t).replace(/\\/g, '/')));
    return { applies: hit, note: hit ? null : `permission rule "${rule}" reaches the Bash shape "${v.classification.shape}" but none of its targets (${(v.classification.targets || []).join(', ') || 'none'}) match the pattern.` };
  }

  /**
   * A Read rule against a search tool. permissions.md describes the coverage as
   * a best-effort attempt, and a best-effort attempt is not something to model
   * as either a deny or an allow.
   */
  if (tool === 'Read' && READ_BEST_EFFORT.has(toolName) && pattern !== null) {
    return { applies: false, undetermined: true, note: `permission rule "${rule}" against ${toolName} is UNDETERMINED: permissions.md calls search-tool coverage a "best-effort attempt", which is not a guarantee and must not be simulated as one.` };
  }

  /**
   * A `Bash(<command pattern>)` RULE, which used to be answered by omission.
   *
   * Reproduced 2026-08-07: `permissionDecision({deny:['Bash(rm *)']}, 'Bash',
   * {command:'rm -rf /'})` returned decision null with ZERO notes, and the caller
   * reads null as "no rule matched", so the whole layer reported allow. Silently,
   * for the spelling permissions.md explicitly RECOMMENDS. That is the same defect
   * the Bash-boundary branch above exists to prevent, in the neighbouring case:
   * `Bash` is not in PATH_RULE_CONSULTED, so a Bash rule with a pattern fell
   * through every branch to `applies:false`.
   *
   * What the documentation gives is the SPELLING ("Use `Bash(rm *)` instead"), not
   * the matching semantics. Whether the pattern is tested against the whole
   * command string, the first word, or each segment of a compound command is
   * nowhere stated, and this repo has MEASURED that a leading `cd` hides part of a
   * command from the permission layer on 2.1.224. So the rule might deny, and
   * modelling it either way manufactures a result. UNDETERMINED, which fails every
   * expectation including a negative one, and demands a measurement.
   *
   * The `command:` field form is different: the docs state flatly that it is
   * ignored with a startup warning, so that one is a known-inert rule with a note,
   * not an unknown.
   */
  if (tool === 'Bash' && pattern !== null && toolName === 'Bash') {
    if (/^[A-Za-z_]+:/.test(pattern)) {
      return { applies: false, note: `permission rule "${rule}" matches on a tool's primary content field, which permissions.md states Claude Code IGNORES with a startup warning: "A rule like Bash(command:rm *) would be bypassable by a compound command, so Claude Code ignores it and emits a startup warning. Use Bash(rm *) ... instead."` };
    }
    return { applies: false, undetermined: true, note: `permission rule "${rule}" is UNDETERMINED: permissions.md gives the SPELLING for a Bash command rule ("Use Bash(rm *) ... instead") and never states what the pattern is matched against, so whether it reaches "${String((toolInput && toolInput.command) || '')}" cannot be read out of the documentation. Nothing in this repo has measured it. An unmeasured rule is not an inert rule, and reporting it as inert would claim a bypass nobody observed.` };
  }

  const toolMatches = tool === '*' || tool === toolName
    || (tool.includes('*') && globToRegex(tool).test(toolName))
    || (tool === 'Edit' && EDIT_COVERS.has(toolName));
  if (!toolMatches) return { applies: false };
  if (pattern === null) return { applies: true };                 // bare tool name: matches everywhere
  if (PATH_RULE_IGNORED.has(tool)) {
    return { applies: false, note: `permission rule "${rule}" is accepted but NEVER CONSULTED: only Edit(path) and Read(path) rules are checked for file permissions. Use Edit(${pattern}) instead.` };
  }
  if (!PATH_RULE_CONSULTED.has(tool)) return { applies: false };
  // A rule is written project-relative, Edit(infra/**), while the tool_input the
  // handler sees is absolute. Relativise before matching or the rule never fires.
  const raw = String((toolInput && toolInput.file_path) || '');
  const p = projectDir ? toProjectRelative(projectDir, raw) : raw.replace(/\\/g, '/');
  const pat = pattern.replace(/^\.\//, '');
  return { applies: globToRegex(pat).test(p) };
}

/**
 * The two path shapes, which are NOT the same and must not be conflated.
 *
 * Measured live 2026-08-04 (tests/tier4/fidelity.json, 8 of 8 classes):
 *   HOOKS receive an ABSOLUTE path with native separators.
 *   PERMISSION RULES are written project-relative, `Edit(infra/**)`, and are
 *   matched against the path relative to the project root.
 * So the harness absolutises for the handler and relativises for the rule.
 */
export function toProjectAbsolute(projectDir, filePath) {
  const p = String(filePath);
  if (/^([A-Za-z]:[\\/]|\/)/.test(p)) return p;                 // already absolute
  return join(projectDir, p.split('/').join(sep));
}

export function toProjectRelative(projectDir, filePath) {
  const p = String(filePath).replace(/\\/g, '/');
  const root = String(projectDir).replace(/\\/g, '/').replace(/\/$/, '');
  return p.startsWith(root + '/') ? p.slice(root.length + 1) : p;
}

export function permissionDecision(settings, toolName, toolInput, projectDir) {
  const perms = (settings && settings.permissions) || {};
  const notes = [];
  const unknown = [];
  for (const level of ['deny', 'ask', 'allow']) {
    for (const rule of (perms[level] || [])) {
      const r = ruleApplies(rule, toolName, toolInput, projectDir);
      if (r.note) notes.push(r.note);
      if (r.undetermined) unknown.push(r.note);
      if (r.applies) return { decision: level === 'allow' ? 'allow' : level, rule, notes };
    }
  }
  /**
   * A rule that MIGHT have applied and could not be evaluated outranks "no rule
   * matched". Reporting null here, which the caller reads as allow, is how the
   * simulator would claim a bypass it never observed.
   */
  if (unknown.length) return { decision: UNDETERMINED, rule: null, notes, undeterminedWhy: unknown };
  return { decision: null, rule: null, notes };
}

export function resolveHandlers(settings, event, toolName, toolInput) {
  const groups = (settings && settings.hooks && settings.hooks[event]) || [];
  const out = [];
  for (const g of groups) {
    if (!matcherMatches(g.matcher, toolName)) continue;
    for (const h of (g.hooks || [])) {
      // The `if` filter is a SECOND gate after the matcher. Measured G4/G5.
      if (!ifFilterAdmits(h.if, toolName, toolInput)) continue;
      out.push({ ...h, matcher: g.matcher });
    }
  }
  return out;
}

function hashTree(dir) {
  const h = createHash('sha256');
  const walk = (d, base) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = statSync(p);
      const rel = relative(base, p).replace(/\\/g, '/');
      if (st.isDirectory()) { h.update('D:' + rel); walk(p, base); }
      else { h.update('F:' + rel); h.update(readFileSync(p)); }
    }
  };
  walk(dir, dir);
  return h.digest('hex');
}

/**
 * Does a handler's `if` permission-rule filter admit this call?
 *
 * MEASURED LIVE 2026-08-04 (tests/tier4/fidelity-round2.json, G4 and G5, 2 passes
 * each): a handler carrying `if: "Bash(git *)"` fired for `git status` and did
 * NOT fire for `echo HELLO`. Before this, the field was ignored entirely, so a
 * filtered handler fired on every call and produced a false deny.
 */
export function ifFilterAdmits(rule, toolName, toolInput) {
  if (!rule) return true;
  const { tool, pattern } = parseRule(rule);
  if (tool !== '*' && tool !== toolName) return false;
  if (pattern === null) return true;
  const subject = String(
    (toolInput && (toolInput.command ?? toolInput.file_path)) || '',
  );
  return globToRegex(pattern).test(subject);
}

/**
 * Resolve a handler command to the interpreter, the script INSIDE the bundle copy,
 * and any extra arguments. One function, used by both the runner and the mutation
 * engine, because they disagreeing about where the handler lives is how a
 * fail-posture case ends up mutating nothing.
 *
 * TWO THINGS IT FIXES, both latent until a bundle actually shipped a hook.
 *
 * 1. `${CLAUDE_PROJECT_DIR}` was never expanded. hooks.md lists it as a settings
 *    PATH PLACEHOLDER ("path placeholders ${CLAUDE_PROJECT_DIR} / ${CLAUDE_PLUGIN_ROOT}"),
 *    so it is the correct production spelling; unexpanded it is an ENOENT and the
 *    handler silently fails open. A bundle wired the documented way would have
 *    failed its own conformance for a reason that had nothing to do with its logic.
 *
 * 2. The mutation engine resolved handlers as `basename(script)` against the
 *    bundle root, so a handler at `.claude/hooks/validate.mjs` was never found and
 *    `delete-handler` deleted NOTHING. The case would then run against an intact
 *    bundle and pass while claiming to prove fail-open behaviour: the same defect
 *    already found once in this function's neighbour.
 *
 * The BARE `$CLAUDE_PROJECT_DIR` form is deliberately NOT expanded. hooks.md:
 * "bare $CLAUDE_PROJECT_DIR parses as an undefined variable and resolves to $null"
 * under PowerShell. Expanding it here would make a bundle pass that is broken on
 * Windows, so it stays literal, fails to resolve, and gets a note naming the doc.
 */
export function parseHandlerCommand(cmd, dir) {
  const notes = [];
  const raw = String(cmd || '');
  if (/(^|[^${])\$CLAUDE_(PROJECT_DIR|PLUGIN_ROOT)\b/.test(raw)) {
    notes.push('handler command uses the BARE $CLAUDE_PROJECT_DIR form. hooks.md: "bare $CLAUDE_PROJECT_DIR parses as an undefined variable and resolves to $null" on Windows; use ${CLAUDE_PROJECT_DIR}.');
  }
  const expanded = raw.replace(/\$\{(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT)\}/g, () => dir);
  const m = expanded.match(/^(\S+)\s+"([^"]+)"\s*(.*)$/) || expanded.match(/^(\S+)\s+(\S+)\s*(.*)$/);
  const interpreter = m ? m[1] : expanded;
  const script = m ? m[2] : null;
  const extraArgs = m && m[3] ? m[3].split(/\s+/).filter(Boolean) : [];
  let abs = null;
  if (script) {
    const cand = resolve(isAbsolute(script) ? script : join(dir, script));
    // A handler outside the case copy is left unresolved rather than rewritten:
    // that is a real wiring defect and must surface as one.
    if (cand === resolve(dir) || cand.startsWith(resolve(dir) + sep)) abs = cand;
    else notes.push(`handler script "${script}" resolves OUTSIDE the bundle, so nothing in the bundle controls what runs`);
  }
  return { interpreter, script, extraArgs, abs, notes };
}

function runHandler(handler, payload, cwd, setupEnv = {}) {
  // MEASURED LIVE (G6): an http handler whose endpoint is unreachable FAILS OPEN.
  // The simulator supports only type=command, so rather than silently treating an
  // http handler as absent it reports the documented fail-open explicitly.
  if (handler.type === 'http' || handler.url) {
    return { exit: null, stdout: '', stderr: '', httpUnsupported: true };
  }
  const cmd = String(handler.command || '');
  if (!cmd) return { exit: null, stdout: '', stderr: '', error: 'handler has no command' };
  // Split a quoted interpreter-plus-path command form, the shape hooks.md calls
  // the "proven wiring recipe": node "C:\path\x.mjs".
  const p = parseHandlerCommand(cmd, cwd);
  const file = p.interpreter;
  const args = p.script === null ? [] : [p.abs || p.script, ...p.extraArgs];
  // The case's `setup.env` goes LAST so a case can override an inherited value,
  // which is the point of staging it, but CLAUDE_PROJECT_DIR stays ours: letting a
  // case repoint the project root would let it escape its own temp copy.
  const env = { ...process.env, ...setupEnv, CLAUDE_PROJECT_DIR: cwd };
  const r = spawnSync(file, args, {
    cwd, env, input: JSON.stringify(payload), encoding: 'utf8',
    timeout: Number(handler.timeout) > 0 ? Number(handler.timeout) * 1000 : 30_000,
    windowsHide: true, shell: false,
  });
  if (r.error && r.error.code === 'ENOENT') {
    // Not found is the documented fail-open case, and it is a real verdict, not a
    // harness failure. Record it as such.
    return { exit: null, stdout: '', stderr: String(r.error.message), notFound: true, wiring: p.notes };
  }
  // MEASURED LIVE (G1, 2 passes): a handler that exceeds its timeout FAILS OPEN.
  // The marker proved it ran; the write proceeded anyway. Report it as a timeout
  // rather than letting a late decision on stdout count.
  const timedOut = r.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT';
  if (timedOut) return { exit: null, stdout: '', stderr: String(r.stderr || ''), timedOut: true, wiring: p.notes };
  return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '', timedOut: false, wiring: p.notes };
}

/**
 * Turn raw handler results into the structured verdict everything is scored
 * against. Scoring NEVER reads raw text: a handler that prints "BLOCKED" with
 * exit 0 and no hookSpecificOutput is an allow, and must score MISS.
 */
export function verdictOf(event, handlers, results) {
  let decision = 'allow';
  let fired = 0;
  const notes = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    // Wiring problems are reported whatever the outcome, because the worst version
    // of this is a handler that fails open for a reason the report never mentions.
    for (const n of (r.wiring || [])) notes.push(n);
    if (r.notFound) { notes.push(`handler missing: ${handlers[i].command}`); continue; }
    if (r.timedOut) { notes.push(`handler exceeded its timeout and FAILED OPEN (measured live, fidelity G1)`); continue; }
    if (r.httpUnsupported) { notes.push(`http handler not simulated; an unreachable http gate FAILS OPEN (measured live, fidelity G6)`); continue; }
    fired++;
    let json = null;
    const t = (r.stdout || '').trim();
    if (t.startsWith('{')) { try { json = JSON.parse(t); } catch { json = null; } }
    const hso = json && json.hookSpecificOutput;
    const pd = hso && hso.permissionDecision;
    if (pd === 'deny') { decision = 'deny'; continue; }
    if (pd === 'ask' && decision !== 'deny') { decision = 'ask'; continue; }
    if (r.exit === 2 && BLOCKING_ON_EXIT2.has(event)) { decision = 'deny'; continue; }
    if (r.exit !== 0 && r.exit !== null) notes.push(`handler exit ${r.exit} is a non-blocking error on ${event} (fails open)`);
  }
  return { decision, fired, notes, raw: results };
}

/**
 * `undetermined` fails EVERY expectation, and this is the single most important
 * line in the Bash widening.
 *
 * The obvious implementation lets an uncalibrated shape fall through as `allow`,
 * which quietly SATISFIES a `near-miss` case written `{not: 'deny'}`. That turns
 * the whole widening into checks that cannot fail: the more shapes the simulator
 * does not understand, the greener the run. So an undetermined verdict is not a
 * value that can be compared against an expectation at all. It fails a
 * `{decision: 'deny'}`, and it fails a `{not: 'deny'}` too, because "we did not
 * measure this" is not evidence of either.
 */
export const UNDETERMINED = 'undetermined';

function matchExpect(expect, verdict) {
  const fails = [];
  /**
   * A CASE WITH NO EXPECTATION IS NOT A PASSING CASE.
   *
   * `Object.entries(undefined || {})` is empty, so an `expect`-less case
   * produced no failures and reported ok. A conformance.json of ten such cases
   * printed "10 case(s): 10 passed, 0 failed" while asserting nothing whatever.
   * Reproduced 2026-08-07 before this fix: two cases, no expect, exit 0.
   *
   * That is the defect class this whole tool exists to name, sitting in the
   * function that decides whether anything was proved. An absent expectation is
   * now a FAILURE, because a spec that forgot its assertion is a defect in the
   * spec and silence is the worst possible way to report it.
   */
  if (!expect || typeof expect !== 'object' || Array.isArray(expect) || Object.keys(expect).length === 0) {
    return ['case declares no `expect`, so it asserts nothing; an assertion-free case is a defect in the spec, not a pass'];
  }
  for (const [k, want] of Object.entries(expect)) {
    if (k === 'decision') {
      const got = verdict.decision;
      if (got === UNDETERMINED) {
        fails.push(`decision is UNDETERMINED (${(verdict.undeterminedWhy || []).join('; ') || 'uncalibrated shape'}); an unmeasured shape satisfies no expectation, including a negative one`);
        continue;
      }
      if (want && typeof want === 'object' && 'not' in want) {
        if (got === want.not) fails.push(`decision was "${got}", expected NOT "${want.not}"`);
      } else if (got !== want) fails.push(`decision was "${got}", expected "${want}"`);
    } else if (k === 'fired') {
      const got = verdict.fired;
      if (want && typeof want === 'object' && 'min' in want) {
        if (got < want.min) fails.push(`${got} handler(s) fired, expected at least ${want.min}`);
      } else if (got !== want) fails.push(`${got} handler(s) fired, expected ${want}`);
    } else fails.push(`unsupported expect key "${k}"`);
  }
  return fails;
}

/**
 * Mutate a bundle copy for a fail-posture case.
 *
 * THIS FUNCTION HAD NO GATE COVERAGE and an adversarial audit found it: replacing
 * the body with `return` left all five gates green while
 * `hook-only-no-deny-rule` flipped from "5 passed, 2 failed" to "7 passed, 0
 * failed". Cause: --prove-fail filtered to enforce and wiring cases only, so the
 * fail-posture kind, which carries the project's central claim that a command
 * hook fails open, was never exercised by any gate. `mutationSelfTest` below now
 * asserts it actually mutates, and --prove-fail no longer excludes fail-posture.
 */
export function applyMutation(dir, settings, mutation) {
  if (!mutation || mutation === 'none') return;
  /**
   * AN UNRECOGNISED MUTATION IS A TYPO, NOT A NO-OP.
   *
   * `MUTATIONS` was exported and never consulted, so `mutate: 'delete-handlers'`
   * fell through every branch and mutated nothing. The fail-posture case then ran
   * against an INTACT bundle, the handler denied as normal, and the case passed:
   * the single strongest assertion in a spec, reporting success because its
   * plural was wrong. Reproduced 2026-08-07 before this fix, with the correct
   * spelling failing (exit 1) and the typo passing (exit 0) on the same bundle.
   *
   * Throwing is deliberate. Returning a soft failure would let a spec keep
   * running with an unknown intent; the caller cannot know what was meant.
   */
  if (!MUTATIONS.has(mutation)) {
    throw new Error(`unknown mutation "${mutation}"; expected one of ${[...MUTATIONS].join(', ')}. `
      + 'An unrecognised mutation used to silently do nothing, which made the case pass against an unmutated bundle.');
  }

  /**
   * ignore-setup does nothing HERE, and that is stated rather than left as a
   * fallthrough. Its entire effect is in `applySetup`, which the case loop calls
   * immediately after this function; a reader who found it missing from every
   * branch below would reasonably conclude it was the silent-no-op defect fixed
   * above. The self-test asserts both halves: that this call leaves the handlers
   * intact, and that applySetup really drops the staged state.
   */
  if (mutation === 'ignore-setup') return;

  /**
   * add-allow-rule: the tamper mutation for a bundle with no handler to break.
   *
   * Injects `permissions.allow` for every path already denied, then the case
   * asserts the decision is STILL deny. That is falsifiable in a way the handler
   * mutations are not on a deny-only bundle: reorder the deny/ask/allow loop in
   * permissionDecision and this goes red. It mutates the settings object the
   * caller passes, which IS the working copy, so the change is real rather than
   * notional.
   */
  if (mutation === 'add-allow-rule') {
    const denied = ((settings.permissions || {}).deny || []).slice();
    if (denied.length) {
      settings.permissions = settings.permissions || {};
      settings.permissions.allow = [...(settings.permissions.allow || []), ...denied];
      writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
    }
    return;
  }

  const targets = [];
  for (const groups of Object.values(settings.hooks || {}))
    for (const g of groups) for (const h of (g.hooks || [])) targets.push(h.command);
  for (const cmd of targets) {
    /**
     * Resolved through the SAME parser the runner uses. The previous version took
     * `basename(script)` against the bundle root, so a handler wired the
     * documented way, `${CLAUDE_PROJECT_DIR}/.claude/hooks/x.mjs`, was never found
     * and both handler mutations silently did nothing: the fail-posture case then
     * ran against an intact bundle and passed. Latent only because no bundle had
     * shipped a hook yet.
     */
    const p = parseHandlerCommand(cmd, dir).abs;
    if (!p || !existsSync(p)) continue;
    if (mutation === 'delete-handler') rmSync(p, { force: true });
    if (mutation === 'crash-handler') {
      writeFileSync(p, '#!/usr/bin/env node\nprocess.exit(1);\n');
      try { chmodSync(p, 0o755); } catch { /* windows */ }
    }
  }
}

/**
 * Which mechanisms this tool can actually reason about.
 *
 * Renaming the tool to `hook-prove` would have been false the day it shipped:
 * `permissionDecision` and `ruleApplies` are a non-hook layer with a dozen rows
 * behind them, and the deny rule is the mechanism the scaffold now selects. But
 * the old "Hooks only" docstring was equally false in the other direction.
 *
 * Prose alone cannot fix this, because the failure is at RUNTIME. Point the
 * prover at a skill bundle today and it either throws an uncaught ENOENT on a
 * missing settings.json, or fails every case with a hooks.md citation. A wrong
 * diagnosis is worse than a refusal: the user believes their skill was tested.
 *
 * So refusal is a first-class outcome with its own exit code, 3, distinct from
 * 1 (cases failed) and 2 (usage).
 */
export const MECHANISM_ADAPTERS = new Map([
  ['hook', { supported: true, why: 'handler execution, matcher and if-filter evaluation, exit-code and stdout-JSON verdicts' }],
  ['permission-deny', { supported: true, why: 'deny/ask/allow ordering, the Edit-vs-Write consulted-rule asymmetry, and the calibrated Bash boundary' }],
  ['advisory', { supported: true, why: 'asserts NON-enforcement: residual and near-miss cases only, no handler to run' }],
  // The prove-bench fixtures declare this: a bundle that may carry either layer,
  // which is the whole point of the bench (six of the eleven get the mechanism
  // wrong, and the bench measures whether that is caught).
  ['hook-or-permission-rule', { supported: true, why: 'either enforcement layer or both; the bench fixtures use this to leave the mechanism open and let the cases decide' }],
  ['skill', { supported: false, why: 'a skill is model-owned. Whether it fires is a routing outcome, which needs a live session and a trigger corpus, not a simulated tool call. tests/tier1 is the gate for that.' }],
  ['subagent', { supported: false, why: 'same as skill: invocation is model-owned. There is no tool call to simulate.' }],
  ['mcp', { supported: false, why: 'requires a live server. Nothing here starts one, and a simulated response would grade our own stub.' }],
  ['output-style', { supported: false, why: 'no observable this tool can read: the effect is on generated prose.' }],
  ['statusline', { supported: false, why: 'the effect is terminal rendering, not a tool decision.' }],
]);

export function adapterFor(mechanism) {
  const m = String(mechanism || '').trim();
  if (!m) return { supported: false, why: 'the bundle declares no mechanism, so there is nothing to select an adapter by.', mechanism: '(none)' };
  const a = MECHANISM_ADAPTERS.get(m);
  if (a) return { ...a, mechanism: m };
  return { supported: false, why: `unknown mechanism. Supported: ${[...MECHANISM_ADAPTERS].filter(([, v]) => v.supported).map(([k]) => k).join(', ')}.`, mechanism: m };
}

export class UnsupportedMechanism extends Error {
  constructor(a) { super(`extension-prove cannot prove mechanism "${a.mechanism}": ${a.why}`); this.adapter = a; this.exitCode = 3; }
}

export function proveBundle(bundleDir, { onlyKinds = null } = {}) {
  const confPath = join(bundleDir, 'conformance.json');
  if (!existsSync(confPath)) throw new Error(`no conformance.json in ${bundleDir}`);
  const conf = JSON.parse(readFileSync(confPath, 'utf8'));
  const adapter = adapterFor(conf.mechanism);
  if (!adapter.supported) throw new UnsupportedMechanism(adapter);
  if (!existsSync(join(bundleDir, 'settings.json'))) {
    throw new UnsupportedMechanism({ mechanism: adapter.mechanism, why: 'the bundle has no settings.json, so there is no wiring to evaluate. That used to be an uncaught ENOENT halfway through the first case.' });
  }
  const before = hashTree(bundleDir);
  const out = [];

  for (const c of (conf.cases || [])) {
    if (onlyKinds && !onlyKinds.has(c.kind)) continue;
    if (!CASE_KINDS.has(c.kind)) { out.push({ id: c.id, kind: c.kind, ok: false, why: [`unknown case kind "${c.kind}"`] }); continue; }
    const tmp = mkdtempSync(join(tmpdir(), 'xprove-'));
    try {
      cpSync(bundleDir, tmp, { recursive: true });
      const settings = JSON.parse(readFileSync(join(tmp, 'settings.json'), 'utf8'));
      // A bad mutation fails THIS CASE with a named reason rather than aborting
      // the run, so a spec with one typo still reports on its other cases.
      let staged;
      try {
        applyMutation(tmp, settings, c.mutate);
        // Setup is staged AFTER the mutation, because `ignore-setup` is a mutation
        // whose whole effect is on this step.
        staged = applySetup(tmp, c.setup, c.mutate);
      } catch (e) {
        out.push({ id: c.id, kind: c.kind, ok: false, why: [String(e.message)], verdict: { decision: null, fired: 0, notes: [] }, citation: CITE[c.kind] });
        continue;
      }
      const event = c.event || 'PreToolUse';
      const toolName = (c.input && c.input.tool_name) || '';
      const handlers = resolveHandlers(settings, event, toolName, (c.input || {}).tool_input);
      // Feed the path shape the PRODUCT actually sends. Measured live on
      // 2026-08-04 (tests/tier4/fidelity.json): a hook receives an ABSOLUTE path
      // with native separators, e.g. P:\proj\infra\main.tf, not the relative
      // POSIX form the cases are written in. Feeding the relative form made this
      // bench's own control handler pass while it would NOT have fired in
      // production, which is exactly the defect class this tool exists to catch.
      const payload = {
        session_id: 'extension-prove', transcript_path: join(tmp, 't.jsonl'), cwd: tmp,
        hook_event_name: event, ...(c.input || {}),
      };
      if (payload.tool_input && payload.tool_input.file_path) {
        payload.tool_input = { ...payload.tool_input, file_path: toProjectAbsolute(tmp, payload.tool_input.file_path) };
      }
      const results = handlers.map((h) => runHandler(h, payload, tmp, staged.env));
      const verdict = verdictOf(event, handlers, results);
      if (staged.ignored) verdict.notes.push('`setup` was DROPPED by the ignore-setup mutation, so the handler saw no staged state');
      else if (staged.wrote.length) verdict.notes.push(`staged ${staged.wrote.length} setup file(s): ${staged.wrote.join(', ')}`);
      // Permission rules are a separate, harness-owned layer. A deny rule holds
      // even when the hook is deleted or crashing, which is exactly why a
      // requirement with a guarantee clause needs one.
      const perm = permissionDecision(settings, toolName, payload.tool_input, tmp);
      verdict.notes.push(...perm.notes);
      if (perm.decision === 'deny' || perm.decision === 'ask') {
        verdict.decision = perm.decision;
        verdict.notes.push(`permission rule "${perm.rule}" decided ${perm.decision} (harness-owned, independent of the hook)`);
      } else if (perm.decision === UNDETERMINED) {
        // Only when no hook already decided. A handler that denied is a real,
        // observed deny and does not become unknown because a rule could not be
        // evaluated; but a hook that allowed says nothing about the rule layer.
        if (verdict.decision === 'allow') {
          verdict.decision = UNDETERMINED;
          verdict.undeterminedWhy = perm.undeterminedWhy;
        }
      }
      const why = matchExpect(c.expect, verdict);
      out.push({
        id: c.id, kind: c.kind, ok: why.length === 0, why,
        verdict: { decision: verdict.decision, fired: verdict.fired, notes: verdict.notes },
        citation: CITE[c.kind],
      });
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  const after = hashTree(bundleDir);
  /**
   * `strict` is how an ABSOLUTE requirement stops being quietly satisfied.
   *
   * Every case here can pass and the requirement still not be met: a residual
   * case passing means "this vector is confirmed NOT covered", which is exactly
   * what "prevent ANY change" rules out. So a strict spec with a surviving
   * residual is NOT DONE, reported separately from a failing case so the two are
   * never confused. The bundle is still emitted, and it is still the strongest
   * configuration available; what is refused is the claim.
   */
  const strictResidual = conf.strict
    ? out.filter((c) => c.kind === 'residual' && c.ok).map((c) => ({ id: c.id, vector: (conf.cases.find((x) => x.id === c.id) || {}).vector || '(unnamed vector)' }))
    : [];
  return {
    extension: conf.extension, mechanism: conf.mechanism, cases: out,
    mutatedSource: before !== after, strict: !!conf.strict, strictResidual,
  };
}

// --------------------------------------------------------------------- reporting
export function reportCode(res) {
  if (res.cases.some((c) => !c.ok) || res.mutatedSource) return 1;
  return (res.strictResidual || []).length ? 1 : 0;
}

function report(res, json) {
  if (json) { console.log(JSON.stringify(res, null, 2)); return reportCode(res); }
  console.log(`extension-prove  ${res.extension || '(unnamed)'}  mechanism=${res.mechanism || '?'}`);
  console.log('');
  for (const c of res.cases) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  [${c.kind}] ${c.id}`);
    if (!c.ok) {
      for (const w of c.why) console.log(`        ${w}`);
      if (c.citation) console.log(`        why: ${c.citation}`);
    }
    if (c.verdict && c.verdict.notes && c.verdict.notes.length)
      for (const n of c.verdict.notes) console.log(`        note: ${n}`);
  }
  const failed = res.cases.filter((c) => !c.ok).length;
  if (res.mutatedSource) console.log('\nFAIL  the bundle mutated its own source tree during the run');
  console.log(`\n${res.cases.length} case(s): ${res.cases.length - failed} passed, ${failed} failed.`);
  if ((res.strictResidual || []).length) {
    console.log('');
    console.log('NOT DONE: the requirement is ABSOLUTE and a residual vector survives.');
    for (const r of res.strictResidual) console.log(`  ${r.id}  ${r.vector}  is confirmed NOT covered`);
    console.log('');
    console.log('Every case above passed. That is the point: a passing residual case is a MEASURED');
    console.log('statement that the vector is open, and an absolute requirement rules it out. The');
    console.log('bundle is still the strongest configuration available here; what is refused is the');
    console.log('claim that it is total. Narrow the requirement, or close the vector at a layer this');
    console.log('bundle cannot reach.');
  }
  return reportCode(res);
}

// -------------------------------------------------------------------- self-test
function selfTest() {
  let failures = 0;
  const check = (name, cond, detail = '') => {
    if (cond) { console.log(`  ok   ${name}`); }
    else { console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); failures++; }
  };
  console.log('matcher semantics (references/hooks.md):');
  check('exact name matches', matcherMatches('Write', 'Write'));
  check('exact name rejects other tool', !matcherMatches('Write', 'Edit'));
  check('list form A|B matches both', matcherMatches('Write|Edit', 'Edit') && matcherMatches('Write|Edit', 'Write'));
  check('list form rejects a non-member', !matcherMatches('Write|Edit', 'Bash'));
  check('"*" is a wildcard', matcherMatches('*', 'Anything'));
  check('empty string is a wildcard', matcherMatches('', 'Anything'));
  check('absent matcher fires on everything', matcherMatches(undefined, 'Anything'));
  check('non-alphanumeric is treated as regex', matcherMatches('^mcp__.*', 'mcp__github__search'));
  check('regex does not match unrelated tool', !matcherMatches('^mcp__.*', 'Write'));
  check('invalid regex does not throw and does not match', !matcherMatches('[unclosed', 'Write'));

  console.log('verdict interpretation:');
  const v = (event, results, handlers) => verdictOf(event, handlers || results.map(() => ({ command: 'x' })), results);
  check('exit 2 on PreToolUse is deny', v('PreToolUse', [{ exit: 2, stdout: '', stderr: '' }]).decision === 'deny');
  check('exit 2 on a non-blocking event is NOT deny', v('SessionStart', [{ exit: 2, stdout: '', stderr: '' }]).decision !== 'deny');
  check('exit 0 is allow', v('PreToolUse', [{ exit: 0, stdout: '', stderr: '' }]).decision === 'allow');
  check('permissionDecision deny is deny', v('PreToolUse', [{ exit: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny' } }) }]).decision === 'deny');
  check('permissionDecision ask is ask', v('PreToolUse', [{ exit: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask' } }) }]).decision === 'ask');
  // The boilerplate-immunity rule, transplanted structurally from lint-bench.
  check('BOILERPLATE IMMUNITY: printing "BLOCKED" with exit 0 is still an allow',
    v('PreToolUse', [{ exit: 0, stdout: 'BLOCKED: not permitted\ndenied\n', stderr: 'deny' }]).decision === 'allow');
  check('a missing handler does not count as fired', v('PreToolUse', [{ notFound: true }]).fired === 0);
  check('a missing handler leaves the decision as allow (fails open)', v('PreToolUse', [{ notFound: true }]).decision === 'allow');
  check('non-zero non-2 exit is a non-blocking error', v('PreToolUse', [{ exit: 1, stdout: '', stderr: '' }]).decision === 'allow');

  // The mutation engine is what makes every fail-posture case mean anything.
  // Assert it actually mutates, so it cannot be reduced to a no-op silently.
  console.log('mutation engine (fail-posture depends entirely on this):');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'xprove-mut-'));
    try {
      const settings = { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node "h.mjs"' }] }] } };
      const hp = join(tmp, 'h.mjs');
      const original = 'process.exit(0);\n';

      writeFileSync(hp, original);
      applyMutation(tmp, settings, 'delete-handler');
      check('delete-handler actually removes the handler file', !existsSync(hp));

      writeFileSync(hp, original);
      applyMutation(tmp, settings, 'crash-handler');
      const after = existsSync(hp) ? readFileSync(hp, 'utf8') : '';
      check('crash-handler rewrites the handler', after !== original && after.length > 0);
      const r = spawnSync(process.execPath, [hp], { encoding: 'utf8', windowsHide: true });
      check('...and the rewritten handler exits non-zero', r.status !== 0, `status ${r.status}`);

      writeFileSync(hp, original);
      applyMutation(tmp, settings, 'none');
      check('mutation "none" leaves the handler untouched', readFileSync(hp, 'utf8') === original);
      applyMutation(tmp, settings, undefined);
      check('an absent mutation leaves the handler untouched', readFileSync(hp, 'utf8') === original);

      /**
       * THE SUBDIRECTORY ROW. `basename()` resolution found nothing here, so both
       * handler mutations did nothing and a fail-posture case would have passed
       * against an intact bundle. Latent until a bundle shipped a hook, which the
       * validate-before-action pack now does.
       */
      const nested = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/validate.mjs"' }] }] } };
      mkdirSync(join(tmp, '.claude', 'hooks'), { recursive: true });
      const np = join(tmp, '.claude', 'hooks', 'validate.mjs');
      writeFileSync(np, original);
      check('the documented ${CLAUDE_PROJECT_DIR} wiring resolves INSIDE the bundle copy',
        parseHandlerCommand(nested.hooks.PreToolUse[0].hooks[0].command, tmp).abs === resolve(np));
      applyMutation(tmp, nested, 'delete-handler');
      check('...and delete-handler reaches a handler in a SUBDIRECTORY', !existsSync(np));
      writeFileSync(np, original);
      applyMutation(tmp, nested, 'crash-handler');
      check('...and so does crash-handler', readFileSync(np, 'utf8') !== original);

      check('the BARE $CLAUDE_PROJECT_DIR form is NOT expanded, because it is $null on Windows',
        parseHandlerCommand('node "$CLAUDE_PROJECT_DIR/x.mjs"', tmp).abs === null
        || !parseHandlerCommand('node "$CLAUDE_PROJECT_DIR/x.mjs"', tmp).script.startsWith(tmp));
      check('...and it is reported with the doc line rather than silently failing open',
        parseHandlerCommand('node "$CLAUDE_PROJECT_DIR/x.mjs"', tmp).notes.some((n) => /resolves to \$null/.test(n)));
      check('a handler pointing OUTSIDE the bundle is refused and reported',
        parseHandlerCommand('node "../../evil.mjs"', tmp).abs === null
        && parseHandlerCommand('node "../../evil.mjs"', tmp).notes.some((n) => /OUTSIDE the bundle/.test(n)));
      check('a plain relative handler still resolves at the bundle root, as before',
        parseHandlerCommand('node "h.mjs"', tmp).abs === resolve(join(tmp, 'h.mjs')));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  /**
   * PER-CASE SETUP, the newest surface in this tool, so it gets the full
   * treatment: shape refusals, traversal refusals, and an END-TO-END pair proving
   * the staged state is load-bearing rather than decorative.
   */
  console.log('per-case setup (staged state for handlers that read more than the payload):');
  check('an absent setup is not an error', checkSetup(undefined).length === 0 && checkSetup(null).length === 0);
  check('a well formed setup validates', checkSetup({ files: { 'a/b.json': '{}' }, env: { GATE: 'green' } }).length === 0);
  for (const [name, s, needle] of [
    ['a non-object setup', 'files', null],
    ['an array setup', [], null],
    ['an unknown setup key', { flies: {} }, 'unsupported setup key'],
    ['files that is not an object', { files: [] }, 'must be an object'],
    ['env that is not an object', { env: 'GATE=green' }, 'must be an object'],
    ['a non-string file content', { files: { 'a.json': 1 } }, 'must be a string'],
    ['a non-string env value', { env: { GATE: 1 } }, 'must be a string'],
    ['an invalid env var name', { env: { 'not-a-name': 'x' } }, 'not a valid environment variable name'],
    ['an empty path key', { files: { '': 'x' } }, 'empty path key'],
    ['a RELATIVE escape', { files: { '../evil': 'x' } }, 'escape'],
    ['a nested relative escape', { files: { 'a/../../evil': 'x' } }, 'escape'],
    ['a POSIX absolute path', { files: { '/etc/passwd': 'x' } }, 'ABSOLUTE'],
    ['a Windows absolute path', { files: { 'C:\\Windows\\win.ini': 'x' } }, 'ABSOLUTE'],
    ['a UNC-ish rooted path', { files: { '\\\\server\\share\\x': 'x' } }, 'ABSOLUTE'],
  ]) {
    const errs = checkSetup(s);
    check(`MUST REFUSE: ${name}`, errs.length > 0 && (!needle || errs.some((e) => e.includes(needle))), errs.join(' | ') || 'accepted');
  }
  {
    const tmp = mkdtempSync(join(tmpdir(), 'xprove-setup-'));
    try {
      const r = applySetup(tmp, { files: { 'deep/dir/doc.json': '{"env":"prod"}' }, env: { GATE: 'green' } });
      check('applySetup writes the file, creating parent directories', existsSync(join(tmp, 'deep/dir/doc.json')));
      check('...with the exact contents', readFileSync(join(tmp, 'deep/dir/doc.json'), 'utf8') === '{"env":"prod"}');
      check('...and returns the env overlay', r.env.GATE === 'green' && r.wrote.length === 1);
      let threw = null;
      try { applySetup(tmp, { files: { '../escaped': 'x' } }); } catch (e) { threw = e; }
      check('MUST REFUSE at write time too, not only at check time', threw !== null && /escape/.test(threw.message));
      check('...and nothing was written outside the copy', !existsSync(join(tmp, '..', 'escaped')));
      const ig = applySetup(tmp, { files: { 'dropped.txt': 'x' } }, 'ignore-setup');
      check('ignore-setup writes NOTHING and reports itself', ig.ignored === true && ig.wrote.length === 0 && !existsSync(join(tmp, 'dropped.txt')));
      // ignore-setup must not be quietly doing something else in applyMutation.
      const settings = { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node "h.mjs"' }] }] } };
      writeFileSync(join(tmp, 'h.mjs'), 'process.exit(0);\n');
      applyMutation(tmp, settings, 'ignore-setup');
      check('ignore-setup leaves the handler intact, so its only effect is the staging', readFileSync(join(tmp, 'h.mjs'), 'utf8') === 'process.exit(0);\n');
      check('...and it is a RECOGNISED mutation, not a typo that throws', MUTATIONS.has('ignore-setup'));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  /**
   * The row that makes the feature non-vacuous. One bundle, one handler that
   * denies only when its prerequisite is UNMET, proved twice: with the setup
   * staged it allows, and with `ignore-setup` the same case with the same
   * expectation goes RED. A staged file the handler never read would pass both.
   */
  {
    const tmp = mkdtempSync(join(tmpdir(), 'xprove-setupe2e-'));
    try {
      writeFileSync(join(tmp, 'g.mjs'), [
        "import { existsSync } from 'node:fs';",
        "let s = ''; process.stdin.on('data', (d) => { s += d; }).on('end', () => {",
        "  const ok = existsSync('READY') && process.env.GATE === 'green';",
        '  if (!ok) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: \'PreToolUse\', permissionDecision: \'deny\', permissionDecisionReason: \'prerequisite unmet\' } }));',
        '  process.exit(0);',
        '});',
      ].join('\n'));
      writeFileSync(join(tmp, 'settings.json'), JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "g.mjs"' }] }] },
      }, null, 2));
      const CASE = (id, extra) => ({
        id, kind: 'enforce', input: { tool_name: 'Bash', tool_input: { command: 'deploy prod' } }, ...extra,
      });
      const write = (cases) => writeFileSync(join(tmp, 'conformance.json'), JSON.stringify({ mechanism: 'hook', cases }, null, 2));

      write([
        CASE('checks-pass', { setup: { files: { READY: 'yes' }, env: { GATE: 'green' } }, expect: { decision: { not: 'deny' } } }),
        CASE('checks-fail', { expect: { decision: 'deny' } }),
      ]);
      const good = proveBundle(tmp);
      check('a staged prerequisite makes the handler allow', good.cases.find((r) => r.id === 'checks-pass').ok,
        (good.cases.find((r) => r.id === 'checks-pass').why || []).join('; '));
      check('...and its absence makes the same handler deny', good.cases.find((r) => r.id === 'checks-fail').ok);

      write([CASE('setup-is-load-bearing', { mutate: 'ignore-setup', setup: { files: { READY: 'yes' }, env: { GATE: 'green' } }, expect: { decision: { not: 'deny' } } })]);
      const dropped = proveBundle(tmp);
      check('MUST GO RED: the same case with ignore-setup, proving the setup was read',
        dropped.cases[0].ok === false, 'passed with the setup dropped, so nothing read it');
      check('...and the report says the setup was dropped',
        dropped.cases[0].verdict.notes.some((n) => /DROPPED/.test(n)));

      write([CASE('malformed', { setup: { files: { '../evil': 'x' } }, expect: { decision: 'deny' } })]);
      const mal = proveBundle(tmp);
      check('a malformed setup fails ITS case by name rather than aborting the run',
        mal.cases[0].ok === false && mal.cases[0].why.some((w) => /invalid `setup`/.test(w)), (mal.cases[0].why || []).join('; '));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  // The docstring promises the bundle is hashed before and after so a mutating
  // run is reported. An audit found that promise asserted by nothing: replacing
  // `const after = hashTree(dir)` with `const after = before` forces
  // mutatedSource:false forever and every gate stays green.
  console.log('read-only detection (the docstring promises this):');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'xprove-ro-'));
    try {
      writeFileSync(join(tmp, 'a.txt'), 'one');
      const h1 = hashTree(tmp);
      check('hashing the same tree twice is stable', hashTree(tmp) === h1);
      writeFileSync(join(tmp, 'a.txt'), 'two');
      check('a CONTENT change is detected', hashTree(tmp) !== h1);
      writeFileSync(join(tmp, 'a.txt'), 'one');
      check('...and reverting restores the hash', hashTree(tmp) === h1);
      writeFileSync(join(tmp, 'b.txt'), '');
      check('an ADDED file is detected even when empty', hashTree(tmp) !== h1);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  // Behaviours MEASURED live in round 2 and implemented from those measurements.
  console.log('live-measured behaviours (tests/tier4/fidelity-round2.json):');
  check('G4: an `if` filter admits a matching call', ifFilterAdmits('Bash(git *)', 'Bash', { command: 'git status' }));
  check('G5: an `if` filter EXCLUDES a non-matching call', !ifFilterAdmits('Bash(git *)', 'Bash', { command: 'echo HELLO' }));
  check('an `if` filter naming another tool never admits', !ifFilterAdmits('Bash(git *)', 'Write', { file_path: 'x' }));
  check('no `if` filter admits everything', ifFilterAdmits(undefined, 'Write', { file_path: 'x' }));
  check('a bare-tool `if` filter admits any call to that tool', ifFilterAdmits('Bash', 'Bash', { command: 'anything' }));
  check('the `if` filter is a SECOND gate: matcher passes but filter excludes',
    resolveHandlers({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x', if: 'Bash(git *)' }] }] } },
      'PreToolUse', 'Bash', { command: 'echo hi' }).length === 0);
  check('...and admits when both pass',
    resolveHandlers({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x', if: 'Bash(git *)' }] }] } },
      'PreToolUse', 'Bash', { command: 'git log' }).length === 1);
  check('G1: a timed-out handler does NOT count as fired and leaves the decision allow',
    verdictOf('PreToolUse', [{ command: 'x' }], [{ timedOut: true }]).decision === 'allow');
  check('...and says so in the notes rather than silently',
    verdictOf('PreToolUse', [{ command: 'x' }], [{ timedOut: true }]).notes.some((n) => /timeout/i.test(n)));
  check('G6: an http handler is reported as unsimulated and fails OPEN',
    verdictOf('PreToolUse', [{ type: 'http' }], [{ httpUnsupported: true }]).decision === 'allow');
  check('...and is NOT silently treated as absent',
    verdictOf('PreToolUse', [{ type: 'http' }], [{ httpUnsupported: true }]).notes.some((n) => /http/i.test(n)));

  console.log('permission rules (official permissions page):');
  const S = (deny) => ({ permissions: { deny } });
  check('Edit(path) deny matches an Edit to that path',
    permissionDecision(S(['Edit(infra/**)']), 'Edit', { file_path: 'infra/main.tf' }).decision === 'deny');
  check('Edit(path) deny ALSO covers Write, since Edit rules cover all file-editing tools',
    permissionDecision(S(['Edit(infra/**)']), 'Write', { file_path: 'infra/main.tf' }).decision === 'deny');
  check('Edit(path) deny does not match a path outside the glob',
    permissionDecision(S(['Edit(infra/**)']), 'Write', { file_path: 'src/app.ts' }).decision === null);
  check('SILENT FAILURE: Write(path) deny is accepted but never consulted',
    permissionDecision(S(['Write(infra/**)']), 'Write', { file_path: 'infra/main.tf' }).decision === null);
  check('...and that inert rule is reported, not swallowed',
    permissionDecision(S(['Write(infra/**)']), 'Write', { file_path: 'infra/main.tf' }).notes.some((n) => /NEVER CONSULTED/.test(n)));
  check('bare tool name matches everywhere',
    permissionDecision(S(['Bash']), 'Bash', {}).decision === 'deny');
  /**
   * A `Bash(<pattern>)` rule, the fourth answer-by-omission found in this file.
   * Reproduced before the fix: decision null, ZERO notes, for the spelling the
   * documentation recommends.
   */
  for (const r of ['Bash(rm *)', 'Bash(rm -rf *)', 'Bash(git push *)']) {
    const got = permissionDecision(S([r]), 'Bash', { command: 'rm -rf /' });
    check(`a ${r} rule is UNDETERMINED, never silently inert`, got.decision === UNDETERMINED, JSON.stringify(got.decision));
    check('...and says why, naming what the docs do and do not state', got.notes.some((n) => /never states what the pattern is matched against/.test(n)));
  }
  check('...and the bare-tool form is still a real, documented deny',
    permissionDecision(S(['Bash']), 'Bash', { command: 'rm -rf /' }).decision === 'deny');
  {
    const got = permissionDecision(S(['Bash(command:rm *)']), 'Bash', { command: 'rm -rf /' });
    check('the content-field form is KNOWN inert, not unknown, because the docs say so outright', got.decision === null);
    check('...and is reported with the quote rather than swallowed', got.notes.some((n) => /emits a startup warning/.test(n)));
  }
  check('an UNDETERMINED rule fails a not-deny expectation too, which is the whole point',
    matcherMatches('Bash', 'Bash') && (() => {
      const v = { decision: UNDETERMINED, fired: 1, notes: [], undeterminedWhy: ['unmeasured'] };
      return matchExpect({ decision: { not: 'deny' } }, v).length > 0 && matchExpect({ decision: 'deny' }, v).length > 0;
    })());
  check('deny wins over allow regardless of order',
    permissionDecision({ permissions: { allow: ['Edit(infra/**)'], deny: ['Edit(infra/**)'] } }, 'Edit', { file_path: 'infra/x' }).decision === 'deny');
  check('glob ** spans directory separators', globToRegex('infra/**').test('infra/a/b/c.tf'));
  check('glob * does not span a separator', !globToRegex('infra/*').test('infra/a/b.tf'));

  /**
   * The Bash boundary. Before this, `Edit(infra/**)` against a Bash command
   * returned null, the caller read that as allow, and the tool asserted a bypass
   * it had never observed for every shape at once.
   */
  console.log('the Bash boundary (tools/bash-recognition.mjs, paired live calibration):');
  const B = (command) => permissionDecision(S(['Edit(infra/**)']), 'Bash', { command });
  check('an UNRECOGNISED command shape is undetermined, NOT allowed',
    B('git status').decision === UNDETERMINED, JSON.stringify(B('git status').decision));
  check('...and says why, naming that the docs enumerate nothing',
    (B('git status').undeterminedWhy || []).some((n) => /never enumerates/.test(n)));
  check('a target that cannot be resolved statically is undetermined, not allowed',
    B("T=infra/main.tf; printf 'x' >> $T").decision === UNDETERMINED);
  check('a Read rule against Grep is undetermined, because the docs say best-effort',
    permissionDecision(S(['Read(secrets/**)']), 'Grep', { pattern: 'x' }).decision === UNDETERMINED);
  check('a rule that plainly does not apply is still null, not undetermined',
    permissionDecision(S(['Edit(infra/**)']), 'Read', { file_path: 'src/a.ts' }).decision === null);
  if (RECOGNIZED_WRITE_SHAPES.size) {
    check('a CALIBRATED denied shape decides deny',
      !RECOGNIZED_WRITE_SHAPES.get('append-redirect') || B("printf 'x' >> infra/main.tf").decision === 'deny');
    check('a CALIBRATED residual shape decides null, and cites the measurement',
      !RECOGNIZED_WRITE_SHAPES.get('opaque-subprocess') || B('node writer.mjs').decision === null);
  } else {
    console.log('  ..   no calibration file yet, so every Bash shape is undetermined by construction');
  }

  /**
   * THE ROW THAT KEEPS THE WIDENING HONEST.
   *
   * If undetermined satisfied a `{not: 'deny'}` expectation, then every shape
   * the simulator does not understand would make a near-miss case GREENER. The
   * more ignorant the tool, the better the score. It has to fail both ways.
   */
  console.log('undetermined fails EVERY expectation, in both directions:');
  const U = { decision: UNDETERMINED, fired: 0, undeterminedWhy: ['uncalibrated'] };
  check('undetermined fails a positive expectation', matchExpect({ decision: 'deny' }, U).length === 1);
  check('undetermined ALSO fails a negative expectation', matchExpect({ decision: { not: 'deny' } }, U).length === 1);
  check('undetermined fails an allow expectation, which a residual case uses',
    matchExpect({ decision: 'allow' }, U).length === 1);
  check('...and the failure names it as unmeasured rather than as a wrong value',
    /UNDETERMINED/.test(matchExpect({ decision: { not: 'deny' } }, U)[0]));

  /**
   * Refusal, which has to be a distinct OUTCOME rather than a red run. Pointed
   * at a skill, this tool used to throw ENOENT or fail every case citing
   * hooks.md, and a wrong diagnosis is worse than no answer.
   */
  console.log('mechanism adapters (refusal is exit 3, not exit 1):');
  check('the three enforcement mechanisms are supported',
    ['hook', 'permission-deny', 'advisory'].every((m) => adapterFor(m).supported));
  check('a skill is REFUSED, because invocation is model-owned', !adapterFor('skill').supported);
  check('...and the refusal says why, naming routing rather than a test failure',
    /model-owned/.test(adapterFor('skill').why));
  check('mcp and subagent are refused too', !adapterFor('mcp').supported && !adapterFor('subagent').supported);
  check('an unknown mechanism is refused, never assumed to be a hook', !adapterFor('nonsense').supported);
  check('a bundle declaring NO mechanism is refused rather than defaulted', !adapterFor('').supported);
  check('the refusal carries exit code 3, distinct from 1 (cases failed) and 2 (usage)',
    new UnsupportedMechanism(adapterFor('skill')).exitCode === 3);
  {
    const tmp = mkdtempSync(join(tmpdir(), 'xprove-adapter-'));
    try {
      writeFileSync(join(tmp, 'conformance.json'), JSON.stringify({ extension: 'x', mechanism: 'skill', cases: [] }));
      let thrown = null;
      try { proveBundle(tmp); } catch (e) { thrown = e; }
      check('proveBundle THROWS the refusal rather than scoring the bundle', thrown instanceof UnsupportedMechanism);
      writeFileSync(join(tmp, 'conformance.json'), JSON.stringify({ extension: 'x', mechanism: 'hook', cases: [] }));
      let thrown2 = null;
      try { proveBundle(tmp); } catch (e) { thrown2 = e; }
      check('...and a supported mechanism with NO settings.json refuses too, instead of an uncaught ENOENT',
        thrown2 instanceof UnsupportedMechanism && /settings\.json/.test(thrown2.message));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  /**
   * REGRESSION ROWS for two defects reproduced on 2026-08-07, both of the
   * "assertion does not depend on the code under test" class, both found while
   * reading the prover to build a second generator on top of it.
   */
  console.log('an assertion-free case is a DEFECT, not a pass:');
  const V = { decision: 'deny', fired: 1 };
  check('a case with NO expect fails, naming the missing assertion',
    matchExpect(undefined, V).length === 1 && /asserts nothing/.test(matchExpect(undefined, V)[0]));
  check('...and an EMPTY expect object fails too, which is the same defect written out',
    matchExpect({}, V).length === 1);
  check('...and a non-object expect fails rather than being coerced',
    matchExpect('deny', V).length === 1 && matchExpect(['deny'], V).length === 1);
  check('...while a real expectation still evaluates normally', matchExpect({ decision: 'deny' }, V).length === 0);

  console.log('an unrecognised mutation is a TYPO, not a no-op:');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'xprove-mut-'));
    try {
      let threw = null;
      try { applyMutation(tmp, {}, 'delete-handlers'); } catch (e) { threw = e; }
      check('a misspelled mutation THROWS instead of silently doing nothing', !!threw);
      check('...and the message names the accepted set', threw && /delete-handler/.test(threw.message) && /unknown mutation/.test(threw.message));
      let ok = true;
      try { applyMutation(tmp, {}, 'none'); applyMutation(tmp, {}, undefined); } catch { ok = false; }
      check('...while "none" and undefined stay no-ops, because they are the documented way to say so', ok);
      for (const m of MUTATIONS) {
        let bad = null;
        try { applyMutation(tmp, { permissions: { deny: [] }, hooks: {} }, m); } catch (e) { bad = e; }
        check(`...and the declared mutation "${m}" is accepted`, !bad, bad && bad.message);
      }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  check('every case kind has a citation, residual and tamper included',
    [...CASE_KINDS].every((k) => typeof CITE[k] === 'string' && CITE[k].length > 20),
    [...CASE_KINDS].filter((k) => !CITE[k]).join(', '));

  console.log('expect matching:');
  check('decision equality', matchExpect({ decision: 'deny' }, { decision: 'deny', fired: 1 }).length === 0);
  check('decision equality fails when wrong', matchExpect({ decision: 'deny' }, { decision: 'allow', fired: 1 }).length === 1);
  check('decision not-form', matchExpect({ decision: { not: 'deny' } }, { decision: 'allow', fired: 1 }).length === 0);
  check('decision not-form fails when violated', matchExpect({ decision: { not: 'deny' } }, { decision: 'deny', fired: 1 }).length === 1);
  check('fired min', matchExpect({ fired: { min: 1 } }, { decision: 'allow', fired: 1 }).length === 0);
  check('fired min fails at zero', matchExpect({ fired: { min: 1 } }, { decision: 'allow', fired: 0 }).length === 1);
  check('unsupported expect key is a failure, never a silent pass', matchExpect({ bogus: 1 }, { decision: 'allow', fired: 0 }).length === 1);

  console.log(`\n${failures === 0 ? 'SELF-TEST PASS' : `SELF-TEST FAIL (${failures})`}`);
  return failures === 0 ? 0 : 1;
}

// ------------------------------------------------------------------ prove-fail
/**
 * The prover must be able to fail. Every `enforce` case in every bundle is run
 * against two controls:
 *   empty  - nothing installed at all
 *   inert  - valid settings, handler present and executable, always exit 0
 * An enforce case that still PASSES against either is asserting nothing about the
 * extension. Mirrors run-tests.mjs's SUITE IS HOLLOW.
 */
function proveFail(bundleDirs) {
  const survivors = [];
  let checked = 0;
  for (const dir of bundleDirs) {
    const conf = JSON.parse(readFileSync(join(dir, 'conformance.json'), 'utf8'));
    // fail-posture is INCLUDED. Excluding it left the mutation engine ungated.
    const enforce = (conf.cases || []).filter((c) => c.kind === 'enforce' || c.kind === 'wiring' || c.kind === 'fail-posture');
    if (!enforce.length) continue;
    for (const control of ['empty', 'inert']) {
      const tmp = mkdtempSync(join(tmpdir(), `xprove-${control}-`));
      try {
        const settings = control === 'empty'
          ? { hooks: {} }
          : { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `node "${join(tmp, 'inert.mjs')}"` }] }] } };
        if (control === 'inert') writeFileSync(join(tmp, 'inert.mjs'), 'process.exit(0);\n');
        writeFileSync(join(tmp, 'settings.json'), JSON.stringify(settings, null, 2));
        writeFileSync(join(tmp, 'conformance.json'), JSON.stringify({ ...conf, cases: enforce }, null, 2));
        const res = proveBundle(tmp);
        for (const c of res.cases) {
          checked++;
          if (c.ok) survivors.push(`${basename(dir)} :: ${c.id} (${c.kind}) still PASSED against control "${control}"`);
        }
      } finally { rmSync(tmp, { recursive: true, force: true }); }
    }
  }
  console.log(`prove-fail: ${checked} enforce/wiring/fail-posture case-runs against empty and inert controls`);
  if (checked === 0) {
    // A gate that passes on zero cases is the defect it exists to catch.
    console.log('\nPROVER IS HOLLOW');
    console.log('  no cases were checked at all, so nothing was asserted');
    return 1;
  }
  if (survivors.length) {
    console.log('\nPROVER IS HOLLOW');
    for (const s of survivors) console.log(`  ${s}`);
    return 1;
  }
  console.log('PASS: every enforce/wiring case goes red without a working extension.');
  return 0;
}

// ------------------------------------------------------------------------ main
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  if (argv.includes('--prove-fail')) {
    const i = argv.indexOf('--bundles');
    const root = i >= 0 ? argv[i + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'prove-bench', 'fixtures');
    if (!existsSync(root)) { console.error(`no fixtures at ${root}`); process.exit(1); }
    const dirs = readdirSync(root).map((n) => join(root, n)).filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'conformance.json')));
    if (!dirs.length) { console.error(`no bundles with conformance.json under ${root}`); process.exit(1); }
    process.exit(proveFail(dirs));
  }
  const bi = argv.indexOf('--bundle');
  if (bi < 0) {
    console.error('usage: node tools/extension-prove.mjs --bundle <dir> [--json]');
    console.error('       node tools/extension-prove.mjs --self-test');
    console.error('       node tools/extension-prove.mjs --prove-fail [--bundles <dir>]');
    console.error('');
    console.error('exit 0 all cases passed  |  1 a case failed  |  2 usage  |  3 mechanism not supported');
    process.exit(2);
  }
  let res;
  try {
    res = proveBundle(resolve(argv[bi + 1]));
  } catch (e) {
    // A refusal is a RESULT, and it must not look like a failed test run. The
    // dangerous outcome is not the crash, it is the plausible wrong report: a
    // skill bundle scored red against hooks.md citations reads as "your skill
    // does not enforce", which it was never going to.
    if (e instanceof UnsupportedMechanism) {
      console.error(`REFUSED  ${e.message}`);
      console.error('');
      console.error('This is not a failing test run. Nothing about the bundle was asserted.');
      const sup = [...MECHANISM_ADAPTERS].filter(([, v]) => v.supported);
      for (const [k, v] of sup) console.error(`  supported: ${k.padEnd(16)} ${v.why}`);
      process.exit(3);
    }
    throw e;
  }
  process.exit(report(res, argv.includes('--json')));
}

if (IS_MAIN) main();
