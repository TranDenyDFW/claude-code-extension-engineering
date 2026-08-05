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
 * SCOPE, deliberately narrow
 * --------------------------
 * Hooks only, and only mechanics stated verbatim in references/hooks.md with a
 * citation per case kind. Anything ambiguous is deferred rather than guessed,
 * because a prover that encodes our guesses grades our own reading rather than
 * the product.
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
import { readFileSync, writeFileSync, existsSync, mkdtempSync, cpSync, rmSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { join, resolve, dirname, relative, basename, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// The IS_MAIN guard is not optional here. tier3-pack.mjs records that without it,
// one tool's --self-test silently ran a different file's self-test to completion
// and both reported PASS.
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export const CITE = {
  enforce: 'hooks.md: "prefer exit 0 with a JSON decision over exit code 2. Both block on a blocking event"',
  'near-miss': 'hooks.md failure modes: "Overly broad matcher, so it fires everywhere and gets disabled out of annoyance."',
  wiring: 'hooks.md: "Matcher: exact string, list (A|B), or regex (unanchored)" and "Tool events match tool_name."',
  'fail-posture': 'hooks.md: "jq is absent on many Windows installs, so the handler exits non-zero, fails open, and silently blocks nothing while looking installed."',
};

export const CASE_KINDS = new Set(['enforce', 'near-miss', 'wiring', 'fail-posture']);
export const MUTATIONS = new Set(['delete-handler', 'crash-handler', 'none']);

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

function ruleApplies(rule, toolName, toolInput, projectDir) {
  const { tool, pattern } = parseRule(rule);
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
  for (const level of ['deny', 'ask', 'allow']) {
    for (const rule of (perms[level] || [])) {
      const r = ruleApplies(rule, toolName, toolInput, projectDir);
      if (r.note) notes.push(r.note);
      if (r.applies) return { decision: level === 'allow' ? 'allow' : level, rule, notes };
    }
  }
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

function runHandler(handler, payload, cwd) {
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
  const m = cmd.match(/^(\S+)\s+"([^"]+)"\s*(.*)$/) || cmd.match(/^(\S+)\s+(\S+)\s*(.*)$/);
  let file, args;
  if (m) { file = m[1]; args = [m[2], ...(m[3] ? m[3].split(/\s+/).filter(Boolean) : [])]; }
  else { file = cmd; args = []; }
  const env = { ...process.env, CLAUDE_PROJECT_DIR: cwd };
  const r = spawnSync(file, args, {
    cwd, env, input: JSON.stringify(payload), encoding: 'utf8',
    timeout: Number(handler.timeout) > 0 ? Number(handler.timeout) * 1000 : 30_000,
    windowsHide: true, shell: false,
  });
  if (r.error && r.error.code === 'ENOENT') {
    // Not found is the documented fail-open case, and it is a real verdict, not a
    // harness failure. Record it as such.
    return { exit: null, stdout: '', stderr: String(r.error.message), notFound: true };
  }
  // MEASURED LIVE (G1, 2 passes): a handler that exceeds its timeout FAILS OPEN.
  // The marker proved it ran; the write proceeded anyway. Report it as a timeout
  // rather than letting a late decision on stdout count.
  const timedOut = r.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT';
  if (timedOut) return { exit: null, stdout: '', stderr: String(r.stderr || ''), timedOut: true };
  return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '', timedOut: false };
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

function matchExpect(expect, verdict) {
  const fails = [];
  for (const [k, want] of Object.entries(expect || {})) {
    if (k === 'decision') {
      const got = verdict.decision;
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
  const targets = [];
  for (const groups of Object.values(settings.hooks || {}))
    for (const g of groups) for (const h of (g.hooks || [])) targets.push(h.command);
  for (const cmd of targets) {
    const m = String(cmd).match(/"([^"]+)"|(\S+)\s*$/);
    const rel = m ? (m[1] || m[2]) : null;
    if (!rel) continue;
    const p = join(dir, basename(rel));
    if (!existsSync(p)) continue;
    if (mutation === 'delete-handler') rmSync(p, { force: true });
    if (mutation === 'crash-handler') {
      writeFileSync(p, '#!/usr/bin/env node\nprocess.exit(1);\n');
      try { chmodSync(p, 0o755); } catch { /* windows */ }
    }
  }
}

export function proveBundle(bundleDir, { onlyKinds = null } = {}) {
  const confPath = join(bundleDir, 'conformance.json');
  if (!existsSync(confPath)) throw new Error(`no conformance.json in ${bundleDir}`);
  const conf = JSON.parse(readFileSync(confPath, 'utf8'));
  const before = hashTree(bundleDir);
  const out = [];

  for (const c of (conf.cases || [])) {
    if (onlyKinds && !onlyKinds.has(c.kind)) continue;
    if (!CASE_KINDS.has(c.kind)) { out.push({ id: c.id, kind: c.kind, ok: false, why: [`unknown case kind "${c.kind}"`] }); continue; }
    const tmp = mkdtempSync(join(tmpdir(), 'xprove-'));
    try {
      cpSync(bundleDir, tmp, { recursive: true });
      const settings = JSON.parse(readFileSync(join(tmp, 'settings.json'), 'utf8'));
      applyMutation(tmp, settings, c.mutate);
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
      const results = handlers.map((h) => runHandler(h, payload, tmp));
      const verdict = verdictOf(event, handlers, results);
      // Permission rules are a separate, harness-owned layer. A deny rule holds
      // even when the hook is deleted or crashing, which is exactly why a
      // requirement with a guarantee clause needs one.
      const perm = permissionDecision(settings, toolName, payload.tool_input, tmp);
      verdict.notes.push(...perm.notes);
      if (perm.decision === 'deny' || perm.decision === 'ask') {
        verdict.decision = perm.decision;
        verdict.notes.push(`permission rule "${perm.rule}" decided ${perm.decision} (harness-owned, independent of the hook)`);
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
  return { extension: conf.extension, mechanism: conf.mechanism, cases: out, mutatedSource: before !== after };
}

// --------------------------------------------------------------------- reporting
function report(res, json) {
  if (json) { console.log(JSON.stringify(res, null, 2)); return res.cases.some((c) => !c.ok) || res.mutatedSource ? 1 : 0; }
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
  return failed > 0 || res.mutatedSource ? 1 : 0;
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
  check('deny wins over allow regardless of order',
    permissionDecision({ permissions: { allow: ['Edit(infra/**)'], deny: ['Edit(infra/**)'] } }, 'Edit', { file_path: 'infra/x' }).decision === 'deny');
  check('glob ** spans directory separators', globToRegex('infra/**').test('infra/a/b/c.tf'));
  check('glob * does not span a separator', !globToRegex('infra/*').test('infra/a/b.tf'));

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
    process.exit(2);
  }
  const res = proveBundle(resolve(argv[bi + 1]));
  process.exit(report(res, argv.includes('--json')));
}

if (IS_MAIN) main();
