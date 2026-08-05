#!/usr/bin/env node
/**
 * Fidelity round 2: measure the classes the first run left uncalibrated, and add
 * repeat passes to the round-1 classes so n stops being 1.
 *
 * Two kinds of result, kept strictly apart:
 *   AGREE / DISAGREE  for classes extension-prove actually models.
 *   MEASURED          for classes it does NOT model. These record what the
 *                     product does so the behaviour can be implemented. They are
 *                     never counted toward the agreement rate, because counting
 *                     unmodelled behaviour as agreement is the self-certifying
 *                     defect this project exists to catch.
 *
 * Observable is always ground truth on disk: does the target file exist, did the
 * handler's MARKER.log appear, and what did it record.
 *
 * usage:
 *   node tools/tier4-fidelity-run2.mjs --live [--passes N]
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROUND2, NOT_OBSERVABLE } from './tier4-fidelity-cases.mjs';

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const WORK = join(REPO, 'tmp', 'fid2');
const CLAUDE_JSON = join(process.env.USERPROFILE || process.env.HOME || '', '.claude.json');
const OUT = join(REPO, 'tests', 'tier4', 'fidelity-round2.json');

function grantTrust(dir) {
  const j = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8'));
  j.projects = j.projects || {};
  j.projects[dir] = { ...(j.projects[dir] || {}), hasTrustDialogAccepted: true };
  writeFileSync(CLAUDE_JSON, JSON.stringify(j, null, 2));
}

function handlerEntry(h, name) {
  if (h.http) return { type: 'http', url: h.http };
  const e = { type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/.claude/${name}"` };
  if (h.timeout) e.timeout = h.timeout;
  if (h.if) e.if = h.if;
  return e;
}

function build(dir, c) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock; unique dir per pass makes this safe */ }
  mkdirSync(join(dir, '.claude'), { recursive: true });
  const settings = {};

  if (c.userPromptHook) {
    writeFileSync(join(dir, '.claude', 'ups.mjs'),
      `import { appendFileSync } from 'node:fs';\nimport { join } from 'node:path';\n`
      + `try { appendFileSync(join(process.env.CLAUDE_PROJECT_DIR || '.', 'MARKER.log'), 'UPS\\n'); } catch {}\n`
      + `console.error('blocked by policy');\nprocess.exit(2);\n`);
    settings.hooks = { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/ups.mjs"' }] }] };
  } else if (c.hook) {
    if (c.hook.handler) writeFileSync(join(dir, '.claude', 'guard.mjs'), c.hook.handler);
    settings.hooks = { PreToolUse: [{ matcher: c.hook.matcher, hooks: [handlerEntry(c.hook, 'guard.mjs')] }] };
  }
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));

  if (c.localHook) {
    writeFileSync(join(dir, '.claude', 'guard-b.mjs'), c.localHook.handler);
    writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: c.localHook.matcher, hooks: [handlerEntry(c.localHook, 'guard-b.mjs')] }] },
    }, null, 2));
  }
}

function runOne(c, pass = 0) {
  const dir = join(WORK, `${c.id}-p${pass}`);
  build(dir, c);
  grantTrust(dir.replace(/\//g, '\\'));
  const task = c.task || 'Create a file at infra/main.tf with the single line: resource "x" {}';
  const r = spawnSync('claude', ['-p', task, '--output-format', 'text', '--permission-mode', 'acceptEdits'],
    { cwd: dir, encoding: 'utf8', timeout: 300_000, windowsHide: true, input: '' });
  const written = existsSync(join(dir, 'infra', 'main.tf'));
  const markerPath = join(dir, 'MARKER.log');
  const marker = existsSync(markerPath);
  const markerBody = marker ? readFileSync(markerPath, 'utf8').trim().split('\n') : [];
  return { written, marker, markerBody, exit: r.status, stdout: (r.stdout || '').trim().slice(0, 200) };
}

function judge(c, obs) {
  const notes = [];
  let ok = true;
  if (c.expectWritten !== null && c.expectWritten !== undefined) {
    if (obs.written !== c.expectWritten) { ok = false; notes.push(`written ${c.expectWritten} -> ${obs.written}`); }
  }
  if (c.expectMarker !== undefined) {
    if (obs.marker !== c.expectMarker) { ok = false; notes.push(`marker ${c.expectMarker} -> ${obs.marker}`); }
  }
  return { ok, notes };
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes('--live')) {
    console.log(`round 2: ${ROUND2.length} cases, ${ROUND2.filter((c) => c.simulator === 'unmodelled').length} of them UNMODELLED by extension-prove.`);
    for (const c of ROUND2) console.log(`  ${c.id} ${c.cls.padEnd(26)} ${c.simulator}`);
    console.log('\nnot calibratable by disk observation:');
    for (const [k, v] of NOT_OBSERVABLE) console.log(`  ${k}\n    ${v}`);
    return 0;
  }
  const passes = Number((argv[argv.indexOf('--passes') + 1]) || 1) || 1;
  const backup = `${CLAUDE_JSON}.bak-fid2`;
  copyFileSync(CLAUDE_JSON, backup);
  mkdirSync(WORK, { recursive: true });
  const rows = [];
  try {
    const only = argv.includes('--only') ? argv[argv.indexOf('--only')+1].split(',') : null;
    for (const c of ROUND2.filter((x) => !only || only.includes(x.id))) {
      const obs = [];
      for (let i = 0; i < passes; i++) {
        process.stdout.write(`${c.id} ${c.cls.padEnd(26)} pass ${i + 1}/${passes} `);
        const o = runOne(c, i);
        const j = judge(c, o);
        obs.push({ ...o, ...j });
        console.log(`${j.ok ? 'as predicted' : 'DIVERGES'}${j.notes.length ? ' (' + j.notes.join('; ') + ')' : ''}`);
      }
      const stable = obs.every((o) => o.written === obs[0].written && o.marker === obs[0].marker);
      rows.push({
        id: c.id, class: c.cls, simulator: c.simulator, doc: c.doc, why: c.why || null,
        predicted: { written: c.expectWritten, marker: c.expectMarker },
        observations: obs.map((o) => ({ written: o.written, marker: o.marker, markerBody: o.markerBody, ok: o.ok, notes: o.notes, exit: o.exit })),
        stable, agree: obs.every((o) => o.ok),
      });
    }
  } finally {
    copyFileSync(backup, CLAUDE_JSON);
    rmSync(backup, { force: true });
    console.log('\nrestored ~/.claude.json');
  }

  const modelled = rows.filter((r) => r.simulator === 'models');
  const unmodelled = rows.filter((r) => r.simulator === 'unmodelled');
  const result = {
    generated: new Date().toISOString(),
    cli_version: (spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout || '').trim(),
    passes,
    modelled: { cases: modelled.length, agreed: modelled.filter((r) => r.agree).length },
    unmodelled_measured: unmodelled.length,
    unstable: rows.filter((r) => !r.stable).map((r) => r.id),
    not_observable: NOT_OBSERVABLE,
    rows,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2));

  console.log(`\nmodelled classes : ${result.modelled.agreed}/${result.modelled.cases} agree`);
  console.log(`unmodelled       : ${unmodelled.length} MEASURED (not counted as agreement)`);
  if (result.unstable.length) console.log(`UNSTABLE across passes: ${result.unstable.join(', ')}`);
  console.log(`\nwhat the product actually does, for the unmodelled classes:`);
  for (const r of unmodelled) {
    const o = r.observations[0];
    console.log(`  ${r.id} ${r.class.padEnd(26)} written=${o.written} marker=${o.marker}${o.markerBody.length ? ' ' + JSON.stringify(o.markerBody.slice(0, 2)) : ''}`);
  }
  console.log(`\nwrote ${OUT}`);
  return 0;
}

if (IS_MAIN) process.exit(main());
