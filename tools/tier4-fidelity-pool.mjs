#!/usr/bin/env node
/**
 * Fidelity at n = 10 per class, run through a fixed worker pool.
 *
 * WHY A POOL, AND WHY IT IS FIXED
 * -------------------------------
 * 150 live sessions run sequentially is over an hour. WORKERS is a CONSTANT and
 * does not scale with the number of cases, which is the house rule: a
 * thread-per-item design over a large N is what blew up a 648K-item migration.
 *
 * THE RACE THAT HAD TO BE REMOVED FIRST
 * -------------------------------------
 * Every session needs its project dir marked trusted in ~/.claude.json. Doing
 * that per session is a read-modify-write on one file from N concurrent workers,
 * which loses grants and makes hooks silently not fire. All trust is therefore
 * granted UP FRONT in a single write, before any worker starts.
 *
 * WHAT 10 PASSES BUYS
 * -------------------
 * Live sessions are nondeterministic. One agreeing run is not a rate. Ten gives a
 * per-class agreement fraction and, more importantly, surfaces a class that
 * flips. A class at 9/10 is a finding, not a rounding error.
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CASES as ROUND1 } from './tier4-fidelity.mjs';
import { ROUND2, NOT_OBSERVABLE } from './tier4-fidelity-cases.mjs';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const WORK = join(REPO, 'tmp', 'fidpool');
const CLAUDE_JSON = join(process.env.USERPROFILE || process.env.HOME || '', '.claude.json');
const OUT_ALL = join(REPO, 'tests', 'tier4', 'fidelity-n10.json');
const OUT_PART = join(REPO, 'tests', 'tier4', 'fidelity-n10-partial.json');

const WORKERS = 4;              // FIXED. Independent of case count.

// --------------------------------------------------------------- bundle build
const DENY = (marker) => `import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch {}
let ev = {}; try { ev = JSON.parse(raw); } catch {}
try { appendFileSync(join(process.env.CLAUDE_PROJECT_DIR || '.', 'MARKER.log'), '${marker}\\n'); } catch {}
const p = String((ev.tool_input && ev.tool_input.file_path) || '').split('\\\\').join('/');
if (/(^|\\/)infra\\//.test(p)) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'infra protected' } }));
}
process.exit(0);
`;

function handlerEntry(h, name) {
  if (h.http) return { type: 'http', url: h.http };
  const e = { type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/.claude/${name}"` };
  if (h.timeout) e.timeout = h.timeout;
  if (h.if) e.if = h.if;
  return e;
}

function build(dir, c) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
  mkdirSync(join(dir, '.claude'), { recursive: true });
  const settings = {};
  if (c.userPromptHook) {
    writeFileSync(join(dir, '.claude', 'ups.mjs'),
      "import { appendFileSync } from 'node:fs';\nimport { join } from 'node:path';\n"
      + "try { appendFileSync(join(process.env.CLAUDE_PROJECT_DIR || '.', 'MARKER.log'), 'UPS\\n'); } catch {}\n"
      + "console.error('blocked by policy');\nprocess.exit(2);\n");
    settings.hooks = { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/ups.mjs"' }] }] };
  } else if (c.hook) {
    if (c.hook.handler) writeFileSync(join(dir, '.claude', 'guard.mjs'), c.hook.handler);
    settings.hooks = { PreToolUse: [{ matcher: c.hook.matcher, hooks: [handlerEntry(c.hook, 'guard.mjs')] }] };
  }
  if (c.deny) settings.permissions = { deny: c.deny };
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  if (c.localHook) {
    writeFileSync(join(dir, '.claude', 'guard-b.mjs'), c.localHook.handler);
    writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: c.localHook.matcher, hooks: [handlerEntry(c.localHook, 'guard-b.mjs')] }] },
    }, null, 2));
  }
}

/**
 * Round 1 handlers write `hook-fired.log`; round 2 handlers write `MARKER.log`.
 *
 * The first n=10 run looked only for MARKER.log, so every round-1 class expecting
 * a fired handler scored 0/10 while every class expecting NO fire scored 10/10.
 * Perfect correlation with one input flag, and `deterministic: yes` on all of
 * them. A deterministic 0/10 is the signature of a HARNESS bug, not of product
 * nondeterminism, which is what made it identifiable rather than believable.
 */
const MARKER_FILES = ['MARKER.log', 'hook-fired.log'];

/**
 * The target is per-case, not fixed.
 *
 * This ran hardcoded to infra/main.tf, so the `near-miss` case, whose whole point
 * is that it writes src/app.ts OUTSIDE the guarded path, scored 0/10 with
 * deterministic: yes. Third harness bug of this sweep, and all three came from
 * this pool runner reimplementing observation that the round-1 and round-2
 * runners already had correct. Duplicated observation logic is the root cause.
 */
function observe(dir, target = 'infra/main.tf') {
  const written = existsSync(join(dir, ...target.split('/')));
  let marker = false;
  let body = [];
  for (const name of MARKER_FILES) {
    const mp = join(dir, name);
    if (!existsSync(mp)) continue;
    marker = true;
    body = body.concat(readFileSync(mp, 'utf8').trim().split('\n').filter(Boolean));
  }
  return { written, marker, markerBody: body };
}

function judge(c, o) {
  const notes = [];
  let ok = true;
  const wantW = c.expectWritten;
  const wantM = c.expectMarker !== undefined ? c.expectMarker : c.expectFired;
  if (wantW !== null && wantW !== undefined && o.written !== wantW) { ok = false; notes.push(`written ${wantW}->${o.written}`); }
  if (wantM !== null && wantM !== undefined && o.marker !== wantM) { ok = false; notes.push(`marker ${wantM}->${o.marker}`); }
  return { ok, notes };
}

// --------------------------------------------------------------------- runner
async function pool(jobs, workers, fn) {
  let i = 0;
  const out = new Array(jobs.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (i < jobs.length) { const k = i++; out[k] = await fn(jobs[k], k); }
  }));
  return out;
}

function runJob(job) {
  const dir = join(WORK, `${job.id}-p${job.pass}`);
  build(dir, job.c);
  const target = job.c.target || 'infra/main.tf';
  const task = job.c.task || `Create a file at ${target} with the single line: resource "x" {}`;
  const r = spawnSync('claude', ['-p', task, '--output-format', 'text', '--permission-mode', 'acceptEdits'],
    { cwd: dir, encoding: 'utf8', timeout: 420_000, windowsHide: true, input: '' });
  const o = observe(dir, target);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* lock */ }
  return { ...o, ...judge(job.c, job.c), exit: r.status, timedOut: r.error?.code === 'ETIMEDOUT' };
}

function main() {
  const argv = process.argv.slice(2);
  const passes = Number(argv[argv.indexOf('--passes') + 1]) || 10;
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
  const cases = [
    ...ROUND1.map((c) => ({ ...c, round: 1 })),
    ...ROUND2.map((c) => ({ ...c, round: 2 })),
  ].filter((c) => !only || only.includes(c.id));
  if (!argv.includes('--live')) {
    console.log(`${cases.length} classes x ${passes} passes = ${cases.length * passes} live sessions at ${WORKERS} workers`);
    console.log(`estimated ~${Math.ceil(cases.length * passes * 25 / WORKERS / 60)} min`);
    return 0;
  }

  const jobs = [];
  for (const c of cases) for (let p = 0; p < passes; p++) jobs.push({ id: c.id, pass: p, c });

  // Grant ALL trust in ONE write before any worker starts. Per-job grants would
  // be a read-modify-write race across workers and would silently lose entries.
  const backup = `${CLAUDE_JSON}.bak-n10`;
  copyFileSync(CLAUDE_JSON, backup);
  const j = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8'));
  j.projects = j.projects || {};
  for (const job of jobs) {
    const d = join(WORK, `${job.id}-p${job.pass}`).replace(/\//g, '\\');
    j.projects[d] = { ...(j.projects[d] || {}), hasTrustDialogAccepted: true };
  }
  writeFileSync(CLAUDE_JSON, JSON.stringify(j, null, 2));
  console.log(`granted trust for ${jobs.length} project dirs in one write`);
  mkdirSync(WORK, { recursive: true });

  const t0 = Date.now();
  let done = 0;
  return pool(jobs, WORKERS, async (job) => {
    const r = runJob(job);
    done++;
    if (done % 10 === 0) process.stderr.write(`  ${done}/${jobs.length}  ${Math.round((Date.now() - t0) / 1000)}s\n`);
    return { id: job.id, pass: job.pass, ...r };
  }).then((results) => {
    copyFileSync(backup, CLAUDE_JSON);
    rmSync(backup, { force: true });
    console.log('restored ~/.claude.json');

    const rows = cases.map((c) => {
      const rs = results.filter((r) => r.id === c.id);
      const judged = rs.map((r) => ({ ...r, ...judge(c, r) }));
      const agreed = judged.filter((r) => r.ok).length;
      const writtenSet = [...new Set(judged.map((r) => r.written))];
      const markerSet = [...new Set(judged.map((r) => r.marker))];
      return {
        id: c.id, class: c.cls, round: c.round, simulator: c.simulator || 'models',
        passes: judged.length, agreed, rate: Number((agreed / judged.length).toFixed(2)),
        deterministic: writtenSet.length === 1 && markerSet.length === 1,
        observedWritten: writtenSet, observedMarker: markerSet,
        divergences: judged.filter((r) => !r.ok).map((r) => ({ pass: r.pass, notes: r.notes })),
      };
    });

    const modelled = rows.filter((r) => r.simulator === 'models');
    const unmodelled = rows.filter((r) => r.simulator === 'unmodelled');
    const result = {
      generated: new Date().toISOString(),
      cli_version: (spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout || '').trim(),
      workers: WORKERS, passes, sessions: jobs.length,
      elapsed_s: Math.round((Date.now() - t0) / 1000),
      modelled_classes: modelled.length,
      modelled_fully_agreeing: modelled.filter((r) => r.rate === 1).length,
      nondeterministic: rows.filter((r) => !r.deterministic).map((r) => r.id),
      not_observable: NOT_OBSERVABLE,
      rows,
    };
    // Declare BEFORE first use. An earlier edit put the const below the
    // mkdirSync that reads it, so 40 completed live sessions were discarded by a
    // temporal-dead-zone ReferenceError at the very last step. Expensive runs get
    // their write path smoke-tested with one pass before the full sweep.
    const OUT = only ? OUT_PART : OUT_ALL;
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(result, null, 2));

    console.log(`\n${'class'.padEnd(28)} rnd  sim         agree   deterministic`);
    for (const r of rows) {
      console.log(`${r.class.padEnd(28)} ${String(r.round).padEnd(4)} ${String(r.simulator).padEnd(11)} ${String(r.agreed + '/' + r.passes).padEnd(7)} ${r.deterministic ? 'yes' : 'NO ' + JSON.stringify(r.observedWritten)}`);
    }
    console.log(`\nmodelled classes fully agreeing: ${result.modelled_fully_agreeing}/${modelled.length}`);
    console.log(`unmodelled (measured only)     : ${unmodelled.length}`);
    if (result.nondeterministic.length) console.log(`NONDETERMINISTIC: ${result.nondeterministic.join(', ')}`);
    console.log(`${jobs.length} sessions in ${result.elapsed_s}s at ${WORKERS} workers`);
    console.log(`wrote ${OUT}`);
    return 0;
  });
}

if (IS_MAIN) main();
