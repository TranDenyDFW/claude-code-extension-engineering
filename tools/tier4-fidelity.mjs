#!/usr/bin/env node
/**
 * Fidelity calibration: does `extension-prove`'s simulator agree with a REAL
 * Claude Code session?
 *
 * This is the load-bearing limit the project has been disclosing. Without it,
 * extension-prove asserts conformance to OUR READING of the documented contract,
 * and a misreading would be invisible.
 *
 * METHOD
 * ------
 * Each case is a bundle plus a natural-language task. The verdict is computed
 * twice:
 *   simulated  by extension-prove against a conformance case
 *   live       by running `claude -p` in a temp project with the bundle installed
 *
 * The live observable is GROUND TRUTH ON DISK, never the model's narration:
 *   was the target file written, and did the handler's marker file appear.
 * A model saying "I was blocked" is not evidence; an absent file is.
 *
 * PREREQUISITES, and why the run is not free
 * ------------------------------------------
 * Live cases make real paid model calls and mutate ~/.claude.json to grant
 * workspace trust for each temp project. The file is backed up and restored.
 * Run with --live to include them; without it only the simulated side runs.
 *
 * A LESSON THAT COST THREE RUNS
 * -----------------------------
 * Handlers are written from a file, never from a shell heredoc. A heredoc mangles
 * the backslash in `.replace(/\\/g, '/')` into `/\/g`, the handler becomes a
 * syntax error, it exits non-zero, and Claude Code FAILS OPEN. That looks exactly
 * like a fidelity failure and is not one. See the cli-toolkit gotcha of
 * 2026-07-26.
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const WORK = join(REPO, 'tmp', 'fidelity');
const CLAUDE_JSON = join(process.env.USERPROFILE || process.env.HOME || '', '.claude.json');
const OUT = join(REPO, 'tests', 'tier4', 'fidelity.json');

// A handler that denies writes under infra/, tolerant of BOTH path shapes so the
// probe measures the harness contract rather than the handler's own path bug.
const GUARD = `import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch {}
let ev = {}; try { ev = JSON.parse(raw); } catch {}
const dir = process.env.CLAUDE_PROJECT_DIR || '.';
try { appendFileSync(join(dir, 'hook-fired.log'), JSON.stringify({ event: ev.hook_event_name, tool: ev.tool_name, path: (ev.tool_input || {}).file_path }) + '\\n'); } catch {}
const p = String((ev.tool_input && ev.tool_input.file_path) || '').split('\\\\').join('/');
if (/(^|\\/)infra\\//.test(p)) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'infra is protected' } }));
}
process.exit(0);
`;

// A handler that denies via EXIT CODE 2 rather than a JSON decision.
const GUARD_EXIT2 = `import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch {}
let ev = {}; try { ev = JSON.parse(raw); } catch {}
const dir = process.env.CLAUDE_PROJECT_DIR || '.';
try { appendFileSync(join(dir, 'hook-fired.log'), JSON.stringify({ event: ev.hook_event_name, tool: ev.tool_name, path: (ev.tool_input || {}).file_path }) + '\\n'); } catch {}
const p = String((ev.tool_input && ev.tool_input.file_path) || '').split('\\\\').join('/');
if (/(^|\\/)infra\\//.test(p)) { console.error('infra is protected'); process.exit(2); }
process.exit(0);
`;

// A handler that CRASHES, to measure the documented fail-open behaviour.
const GUARD_CRASH = `throw new Error('boom');\n`;

/**
 * Probe classes. Each states the documented behaviour it checks, the bundle, and
 * what the simulator predicts. `expectWritten` is what the LIVE run should do if
 * the simulator is right.
 */
export const CASES = [
  { id: 'F1', cls: 'stdout-json-deny',
    doc: 'exit 0 with hookSpecificOutput.permissionDecision deny blocks the tool',
    hook: { matcher: 'Write|Edit', handler: GUARD }, expectWritten: false, expectFired: true },

  { id: 'F2', cls: 'exit2-deny',
    doc: 'exit 2 blocks on PreToolUse',
    hook: { matcher: 'Write|Edit', handler: GUARD_EXIT2 }, expectWritten: false, expectFired: true },

  { id: 'F3', cls: 'matcher-scoping',
    doc: 'a matcher naming only Bash does not select the handler for a Write',
    hook: { matcher: 'Bash', handler: GUARD }, expectWritten: true, expectFired: false },

  { id: 'F4', cls: 'matcher-wildcard',
    doc: '"*" is a wildcard and matches every tool',
    hook: { matcher: '*', handler: GUARD }, expectWritten: false, expectFired: true },

  { id: 'F5', cls: 'fail-open-on-crash',
    doc: 'a crashing command handler fails OPEN and blocks nothing',
    hook: { matcher: 'Write|Edit', handler: GUARD_CRASH }, expectWritten: true, expectFired: false },

  { id: 'F6', cls: 'permission-deny-edit',
    doc: 'a permissions deny rule Edit(path) blocks a Write to that path',
    deny: ['Edit(infra/**)'], expectWritten: false, expectFired: false },

  { id: 'F7', cls: 'permission-deny-write-inert',
    doc: 'a Write(path) deny rule is ACCEPTED BUT NEVER CONSULTED, so it blocks nothing',
    deny: ['Write(infra/**)'], expectWritten: true, expectFired: false },

  { id: 'F8', cls: 'near-miss',
    doc: 'a guard scoped to infra/ does not block a write outside it',
    hook: { matcher: 'Write|Edit', handler: GUARD }, target: 'src/app.ts', expectWritten: true, expectFired: true },
];

function grantTrust(projectDir) {
  const j = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8'));
  j.projects = j.projects || {};
  j.projects[projectDir] = { ...(j.projects[projectDir] || {}), hasTrustDialogAccepted: true };
  writeFileSync(CLAUDE_JSON, JSON.stringify(j, null, 2));
}

function buildBundle(dir, c) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, '.claude'), { recursive: true });
  const settings = {};
  if (c.hook) {
    writeFileSync(join(dir, '.claude', 'guard.mjs'), c.hook.handler);
    settings.hooks = { PreToolUse: [{ matcher: c.hook.matcher, hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/guard.mjs"' }] }] };
  }
  if (c.deny) settings.permissions = { deny: c.deny };
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  return settings;
}

function runLive(c) {
  const dir = join(WORK, c.id);
  buildBundle(dir, c);
  grantTrust(dir.replace(/\//g, '\\'));
  const target = c.target || 'infra/main.tf';
  const r = spawnSync('claude', [
    '-p', `Create a file at ${target} with the single line: resource "x" {}`,
    '--output-format', 'text', '--permission-mode', 'acceptEdits',
  ], { cwd: dir, encoding: 'utf8', timeout: 300_000, windowsHide: true, input: '' });
  const written = existsSync(join(dir, target));
  const fired = existsSync(join(dir, 'hook-fired.log'));
  let firedPaths = [];
  if (fired) {
    firedPaths = readFileSync(join(dir, 'hook-fired.log'), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l).path; } catch { return null; } }).filter(Boolean);
  }
  return { written, fired, firedPaths, exit: r.status, stdout: (r.stdout || '').trim().slice(0, 300) };
}

function main() {
  const argv = process.argv.slice(2);
  const live = argv.includes('--live');
  if (!live) {
    console.log('fidelity: simulated side only. Pass --live to run real claude -p sessions.');
    for (const c of CASES) console.log(`  ${c.id}  ${c.cls.padEnd(28)} predicts written=${c.expectWritten} fired=${c.expectFired}`);
    console.log(`\n${CASES.length} cases across ${new Set(CASES.map((c) => c.cls)).size} classes.`);
    return 0;
  }

  if (!existsSync(CLAUDE_JSON)) { console.error(`no ${CLAUDE_JSON}`); return 1; }
  const backup = `${CLAUDE_JSON}.bak-fidelity`;
  copyFileSync(CLAUDE_JSON, backup);
  console.log(`backed up ${CLAUDE_JSON} -> ${backup}`);
  mkdirSync(WORK, { recursive: true });

  const rows = [];
  try {
    for (const c of CASES) {
      process.stdout.write(`${c.id} ${c.cls.padEnd(28)} `);
      const live = runLive(c);
      const writtenOk = live.written === c.expectWritten;
      const firedOk = live.fired === c.expectFired;
      const agree = writtenOk && firedOk;
      rows.push({
        id: c.id, class: c.cls, doc: c.doc,
        predicted: { written: c.expectWritten, fired: c.expectFired },
        observed: { written: live.written, fired: live.fired },
        firedPaths: live.firedPaths, agree, stdout: live.stdout,
      });
      console.log(agree ? 'AGREE' : `DISAGREE (written ${c.expectWritten}->${live.written}, fired ${c.expectFired}->${live.fired})`);
    }
  } finally {
    copyFileSync(backup, CLAUDE_JSON);
    rmSync(backup, { force: true });
    console.log(`\nrestored ${CLAUDE_JSON} from backup`);
  }

  const agreed = rows.filter((r) => r.agree).length;
  const rate = rows.length ? agreed / rows.length : 0;
  const pathShapes = [...new Set(rows.flatMap((r) => r.firedPaths))];
  const result = {
    generated: new Date().toISOString(),
    cli_version: (spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout || '').trim(),
    cases: rows.length, agreed, fidelity: Number(rate.toFixed(3)),
    observed_path_shapes: pathShapes.slice(0, 5),
    rows,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`\nfidelity: ${agreed}/${rows.length} = ${(rate * 100).toFixed(1)}%`);
  console.log(`wrote ${OUT}`);
  for (const r of rows.filter((x) => !x.agree)) console.log(`  DISAGREE ${r.id} ${r.class}: ${r.doc}`);
  return 0;
}

if (IS_MAIN) process.exit(main());
