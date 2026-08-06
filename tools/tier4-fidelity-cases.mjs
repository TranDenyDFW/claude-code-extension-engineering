/**
 * Fidelity cases, round 2: the classes left UNCALIBRATED by the first run.
 *
 * Each case declares what the SIMULATOR predicts and what the live session must
 * do if that prediction is right. Where the simulator has no opinion the case is
 * marked `simulator: 'unmodelled'`, which is a DIFFERENT result from disagreeing
 * and is reported separately. A calibration that quietly counted unmodelled
 * behaviour as agreement would be the same self-certifying defect this project
 * exists to catch.
 *
 * Every observable is GROUND TRUTH ON DISK. Classes whose only signal is model
 * narration are listed in NOT_OBSERVABLE with the reason, not guessed at.
 */

// A handler that denies writes under infra/, tolerant of both path shapes.
export const DENY_INFRA = `import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch {}
let ev = {}; try { ev = JSON.parse(raw); } catch {}
try { appendFileSync(join(process.env.CLAUDE_PROJECT_DIR || '.', 'MARKER.log'), 'A\\n'); } catch {}
const p = String((ev.tool_input && ev.tool_input.file_path) || '').split('\\\\').join('/');
if (/(^|\\/)infra\\//.test(p)) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'infra protected' } }));
}
process.exit(0);
`;

/**
 * Same guard, different marker letter, so a MERGE can be distinguished from an
 * OVERRIDE.
 *
 * Written out in full rather than derived with .replace(). The first attempt used
 * `DENY_INFRA.replace("'A\\\\n'", "'B\\\\n'")`, whose target had one backslash too
 * many, so the replace silently no-opped and BOTH handlers wrote 'A'. The run
 * then produced ["A","A"], which cannot distinguish "both fired" from "one fired
 * twice", and the case proved nothing. Same no-op-substitution defect the fixture
 * generator now guards against.
 */
export const DENY_INFRA_B = `import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch {}
let ev = {}; try { ev = JSON.parse(raw); } catch {}
try { appendFileSync(join(process.env.CLAUDE_PROJECT_DIR || '.', 'MARKER.log'), 'B\\n'); } catch {}
const p = String((ev.tool_input && ev.tool_input.file_path) || '').split('\\\\').join('/');
if (/(^|\\/)infra\\//.test(p)) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'infra protected B' } }));
}
process.exit(0);
`;

// Sleeps well past its configured timeout, then tries to deny.
export const SLOW_DENY = `import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch {}
try { appendFileSync(join(process.env.CLAUDE_PROJECT_DIR || '.', 'MARKER.log'), 'SLOW\\n'); } catch {}
const until = Date.now() + 12000;
while (Date.now() < until) { /* busy wait, survives signal-less timeouts */ }
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'slow deny' } }));
process.exit(0);
`;

// Denies only Bash calls, used with an `if` permission-rule filter on the handler.
export const DENY_BASH = `import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch {}
let ev = {}; try { ev = JSON.parse(raw); } catch {}
try { appendFileSync(join(process.env.CLAUDE_PROJECT_DIR || '.', 'MARKER.log'), 'IF:' + ((ev.tool_input || {}).command || '') + '\\n'); } catch {}
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'filtered' } }));
process.exit(0);
`;

/**
 * ROUND 2 CASES.
 *
 * expectWritten: what the LIVE run should do if the simulator's prediction holds.
 * simulator:     'models' if extension-prove has an implemented opinion,
 *                'unmodelled' if it does not. Unmodelled cases MEASURE the
 *                product so the behaviour can then be implemented, and are never
 *                counted toward the agreement rate.
 */
export const ROUND2 = [
  {
    id: 'G1', cls: 'timeout-fails-open', simulator: 'models',
    doc: 'a command handler that exceeds its timeout: does it block, or fail open',
    hook: { matcher: 'Write|Edit', handler: SLOW_DENY, timeout: 1 },
    expectWritten: true, expectMarker: true,
    why: 'hooks.md documents per-event timeout defaults but never states the verdict on timeout. extension-prove does not model timeouts at all.',
  },
  {
    id: 'G2', cls: 'timeout-within-budget', simulator: 'models',
    doc: 'the same handler with a generous timeout still denies',
    hook: { matcher: 'Write|Edit', handler: SLOW_DENY, timeout: 60 },
    expectWritten: false, expectMarker: true,
  },
  {
    id: 'G3', cls: 'settings-scope-merge', simulator: 'unmodelled',
    doc: 'a hook in .claude/settings.json AND one in .claude/settings.local.json: do both fire, or does one win',
    hook: { matcher: 'Write|Edit', handler: DENY_INFRA },
    localHook: { matcher: 'Write|Edit', handler: DENY_INFRA_B },
    expectWritten: false, expectMarker: true,
    why: 'extension-prove reads ONE settings.json per bundle and has no scope model at all.',
  },
  {
    id: 'G4', cls: 'if-filter-matches', simulator: 'models',
    doc: 'a handler with an `if` permission-rule filter fires when the call matches',
    hook: { matcher: 'Bash', handler: DENY_BASH, if: 'Bash(git *)' },
    task: 'Run the Bash tool with exactly this command: git status',
    expectWritten: null, expectMarker: true,
    why: 'the `if` handler field is documented but extension-prove ignores it entirely.',
  },
  {
    id: 'G5', cls: 'if-filter-excludes', simulator: 'models',
    doc: 'the same handler does NOT fire when the call does not match the filter',
    hook: { matcher: 'Bash', handler: DENY_BASH, if: 'Bash(git *)' },
    task: 'Run the Bash tool with exactly this command: echo HELLO',
    expectWritten: null, expectMarker: false,
  },
  {
    id: 'G6', cls: 'http-handler-unreachable', simulator: 'models',
    doc: 'an http handler whose endpoint refuses the connection: fails OPEN per the docs',
    hook: { matcher: 'Write|Edit', http: 'http://127.0.0.1:59999/deny' },
    expectWritten: true, expectMarker: false,
    why: 'hooks.md states an HTTP gate fails OPEN on connection failure. extension-prove supports only type=command.',
  },
  {
    id: 'G7', cls: 'user-prompt-submit-exit2', simulator: 'unmodelled',
    doc: 'exit 2 on UserPromptSubmit blocks the whole turn',
    // Corrected after the first live pass: exit 2 on UserPromptSubmit blocks the
    // whole TURN, so the write never happens. The original expectation said the
    // write would proceed, which was simply wrong.
    userPromptHook: true,
    expectWritten: false, expectMarker: true,
    why: 'BLOCKING_ON_EXIT2 lists UserPromptSubmit but no case has ever exercised a non-PreToolUse event.',
  },
];

/**
 * Classes deliberately NOT calibrated, with the reason. Listing them is the point:
 * an unlisted gap reads as covered.
 */
export const NOT_OBSERVABLE = [
  ['PostToolUse exit 2', 'the tool has already run, so disk state cannot distinguish blocked from allowed. The only signal is what the model does next, which is narration.'],
  ['SessionStart additionalContext', 'the observable is whether injected text reached the model, detectable only by asking the model to echo it. That measures the model, not the harness.'],
  ['Managed-settings precedence', 'requires writing to the platform managed-settings path, which is an administrator surface on this machine and out of scope for a test harness.'],
  ['PreCompact, SubagentStop, Stop', 'each needs a session shaped to reach the event; not reachable from a single headless -p turn with a disk-visible outcome.'],
];
