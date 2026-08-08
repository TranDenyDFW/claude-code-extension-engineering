#!/usr/bin/env node
/**
 * prove-bench, VALIDATION-FAILURE-MODE cohort: the runner.
 *
 * Runs extension-prove and the shipped tester over the twelve fixtures in
 * ./fixtures and writes ./results.json. It does NOT read or write ../results.json,
 * so the published 10-of-10-versus-3-of-10 experiment is untouched.
 *
 * WHAT IS BORROWED AND WHAT IS NOT
 * --------------------------------
 * `score`, `scoreDiagnosis` and `wouldDropRecordedTools` are IMPORTED from the
 * published runner rather than copied. Two scoring functions that were meant to be
 * the same and drifted would make the two cohorts incomparable while looking
 * comparable, and the overwrite guard exists precisely because a re-run on a
 * machine missing a competitor once destroyed a recorded tool column.
 *
 * WHAT IS DIFFERENT, and it is a fix rather than a variation. The published runner
 * hands test-hook.sh a hardcoded `guard.mjs`. These bundles wire their handler at
 * `.claude/hooks/validate.mjs`, the path the settings file actually names, so this
 * runner READS the handler out of settings.json. Handing the competitor a path
 * that does not exist would have scored it a catch on every fixture including the
 * control, which is a fabricated result, and the control is what would have caught
 * it. The control is checked for exactly that here too.
 *
 * usage:
 *   node tests/prove-bench/validation/run-bench.mjs            run and write results.json
 *   node tests/prove-bench/validation/run-bench.mjs --out <f>  write elsewhere
 *   node tests/prove-bench/validation/run-bench.mjs --json     print, write nothing
 *   node tests/prove-bench/validation/run-bench.mjs --self-test
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { score, scoreDiagnosis, wouldDropRecordedTools, TOOL_KEYS } from '../run-bench.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
/**
 * Both overridable, and both exist for ONE reason: proving this bench can report a
 * bad number. A bench that can only ever be pointed at the good fixtures and the
 * good tool is a check that cannot fail, which is the defect this whole repository
 * is about. `PROVE_BENCH_FIXTURES` runs the cohort against a deliberately
 * corrupted copy; `PROVE_BENCH_PROVE_TOOL` runs it against a deliberately
 * weakened prover, which is the audit that caught the published cohort scoring
 * 10 of 10 with no extension code executing at all.
 *
 * Neither is used by the committed run. `results.json` is only ever written from
 * the defaults, and the guard below refuses to overwrite it with a partial run.
 */
const FIXTURES = process.env.PROVE_BENCH_FIXTURES ? resolve(process.env.PROVE_BENCH_FIXTURES) : join(HERE, 'fixtures');
const PROVE_TOOL = process.env.PROVE_BENCH_PROVE_TOOL ? resolve(process.env.PROVE_BENCH_PROVE_TOOL) : join(REPO, 'tools', 'extension-prove.mjs');
const RESULTS = join(HERE, 'results.json');
const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const TEST_HOOK_SH = join(
  process.env.USERPROFILE || process.env.HOME || '', '.claude', 'plugins', 'marketplaces',
  'claude-plugins-official', 'plugins', 'plugin-dev', 'skills', 'hook-development', 'scripts', 'test-hook.sh');

function makeJqShim() {
  const dir = mkdtempSync(join(tmpdir(), 'jqshim-'));
  writeFileSync(join(dir, 'jq'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('-'));
const filter = positional[0] || '.';
const file = positional[1];
try {
  const v = JSON.parse(file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8'));
  if (filter !== 'empty') process.stdout.write(JSON.stringify(v, null, 2) + '\\n');
  process.exit(0);
} catch { process.exit(5); }
`);
  try { chmodSync(join(dir, 'jq'), 0o755); } catch { /* windows */ }
  return dir;
}

function runProve(dir) {
  const r = spawnSync(process.execPath, [PROVE_TOOL, '--bundle', dir, '--json'],
    { encoding: 'utf8', windowsHide: true, timeout: 180_000 });
  let failedIds = [];
  let parsed = false;
  try { failedIds = JSON.parse(r.stdout).cases.filter((c) => !c.ok).map((c) => c.id); parsed = true; } catch { /* keep empty */ }
  return { exit: r.status, failedIds, parsed, detail: failedIds.length ? `failed ${failedIds.join(',')}` : 'all cases pass' };
}

function toPosixPath(p) {
  const m = String(p).match(/^([A-Za-z]):[\\/](.*)$/);
  if (!m) return String(p).replace(/\\/g, '/');
  return `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

/**
 * The handler path the bundle's OWN settings file names, with the documented
 * placeholder expanded. Hardcoding a filename here is how a competitor gets handed
 * a path that does not exist and scores a catch on the control.
 */
export function handlerPathFor(dir) {
  const s = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
  const groups = (s.hooks && s.hooks.PreToolUse) || [];
  const cmd = String((((groups[0] || {}).hooks || [])[0] || {}).command || '');
  const expanded = cmd.replace(/\$\{(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT)\}/g, () => dir);
  const m = expanded.match(/^(\S+)\s+"([^"]+)"/) || expanded.match(/^(\S+)\s+(\S+)/);
  const script = m ? m[2] : expanded;
  return /^([A-Za-z]:[\\/]|[\\/])/.test(script) ? script : join(dir, script);
}

function runTestHookSh(dir, shimDir) {
  if (!existsSync(TEST_HOOK_SH)) return { exit: null, detail: 'not installed' };
  const conf = JSON.parse(readFileSync(join(dir, 'conformance.json'), 'utf8'));
  // Give it the case a correct implementation must DENY: its best chance.
  const c = conf.cases.find((x) => x.kind === 'enforce' && x.expect && x.expect.decision === 'deny') || conf.cases[0];
  const tmp = mkdtempSync(join(tmpdir(), 'thsh-v-'));
  try {
    const payload = { session_id: 'bench', transcript_path: join(tmp, 't.jsonl'), cwd: dir, hook_event_name: c.event || 'PreToolUse', ...c.input };
    const inputPath = join(tmp, 'input.json');
    writeFileSync(inputPath, JSON.stringify(payload, null, 2));
    const handler = handlerPathFor(dir);
    const sep = process.platform === 'win32' ? ';' : ':';
    const env = { ...process.env };
    const existing = env.PATH || env.Path || '';
    delete env.Path;
    env.PATH = `${shimDir}${sep}${existing}`;
    const r = spawnSync('bash', [toPosixPath(TEST_HOOK_SH), toPosixPath(handler), toPosixPath(inputPath)],
      { encoding: 'utf8', windowsHide: true, timeout: 120_000, env });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const said = /Test completed successfully/.test(out) ? 'reported success'
      : /Test failed/.test(out) ? 'reported failure'
        : /not valid JSON/.test(out) ? 'claimed the input was invalid JSON'
          : 'no verdict line';
    return { exit: r.status, detail: said };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

export function bench() {
  const dirs = readdirSync(FIXTURES).map((n) => join(FIXTURES, n))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'conformance.json'))).sort();
  const shimDir = makeJqShim();
  const rows = [];
  try {
    for (const dir of dirs) {
      const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      const prove = runProve(dir);
      const thsh = runTestHookSh(dir, shimDir);
      rows.push({
        fixture: man.name, control: !!man.control, defect: man.defect, citation: man.citation,
        expectedFailures: man.expectedFailures || [],
        ...(man.knownMiss ? { knownMiss: man.knownMiss } : {}),
        prove: { ...prove, score: scoreDiagnosis(man.control, prove, man.expectedFailures || []) },
        testHookSh: { ...thsh, score: score(man.control, thsh.exit) },
      });
    }
  } finally { rmSync(shimDir, { recursive: true, force: true }); }
  return rows;
}

/**
 * A declared known miss is NOT counted against the tool and NOT counted for it.
 * Folding it into `of` would quietly lower the score for a gap that is documented;
 * dropping it from the table entirely would hide the gap. It gets its own line.
 */
export function tally(rows, key) {
  const d = rows.filter((r) => !r.control && !(key === 'prove' && r.knownMiss));
  return {
    caught: d.filter((r) => r[key].score === 'CATCH').length,
    of: d.length,
    wrongDiagnosis: d.filter((r) => r[key].score === 'WRONG-DIAGNOSIS').length,
    falsePos: rows.filter((r) => r.control && r[key].score === 'FALSE-POS').length,
    knownMiss: rows.filter((r) => r.knownMiss).length,
    na: rows.filter((r) => r[key].score === 'n/a').length,
  };
}

function report(rows) {
  console.log('prove-bench: validation-failure-mode cohort');
  console.log(`test-hook.sh: ${existsSync(TEST_HOOK_SH) ? 'found, run with a jq shim on PATH so it gets its best chance' : 'NOT INSTALLED'}`);
  console.log('');
  const w = Math.max(...rows.map((r) => r.fixture.length)) + 2;
  for (const r of rows) {
    const tag = r.control ? ' (control)' : r.knownMiss ? ' (known miss)' : '';
    console.log(`${(r.fixture + tag).padEnd(w + 14)}  ${r.prove.score.padEnd(16)}  ${r.testHookSh.score.padEnd(10)}  [${r.testHookSh.detail}]`);
    if (r.prove.score === 'WRONG-DIAGNOSIS') {
      console.log(`${' '.repeat(w + 14)}  expected ${r.expectedFailures.join(',') || '(none)'}`);
      console.log(`${' '.repeat(w + 14)}  got      ${r.prove.failedIds.join(',') || '(none)'}`);
    }
  }
  const p = tally(rows, 'prove');
  const t = tally(rows, 'testHookSh');
  console.log('');
  console.log(`extension-prove : ${p.caught} of ${p.of} caught with the correct diagnosis, ${p.falsePos} false positive(s) on the control, ${p.wrongDiagnosis} wrong diagnosis`);
  console.log(`test-hook.sh    : ${t.caught} of ${t.of} caught, ${t.falsePos} false positive(s) on the control${t.na ? `, ${t.na} not measured` : ''}`);
  if (p.knownMiss) console.log(`known blind spot: ${p.knownMiss} fixture(s) excluded from the denominator and named in results.json`);
  return rows.some((r) => r.control && r.prove.score !== 'clean') || p.wrongDiagnosis > 0 ? 1 : 0;
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  let fails = 0;
  const ok = (n, c, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : `  (${d})`}`); if (!c) fails++; };

  ok('scoring is IMPORTED from the published runner, not re-implemented',
    typeof score === 'function' && typeof scoreDiagnosis === 'function' && TOOL_KEYS.join(',') === 'prove,testHookSh');
  ok('a wrong diagnosis is not a catch', scoreDiagnosis(false, { exit: 1, parsed: true, failedIds: ['X'] }, ['Y']) === 'WRONG-DIAGNOSIS');
  ok('an exact diagnosis is a catch', scoreDiagnosis(false, { exit: 1, parsed: true, failedIds: ['Y', 'X'] }, ['X', 'Y']) === 'CATCH');
  ok('a clean run against a defect is a MISS', scoreDiagnosis(false, { exit: 0, parsed: true, failedIds: [] }, ['X']) === 'MISS');

  const fake = [
    { control: true, prove: { score: 'clean' }, testHookSh: { score: 'clean' } },
    { control: false, prove: { score: 'CATCH' }, testHookSh: { score: 'MISS' } },
    { control: false, knownMiss: 'invisible to the verdict model', prove: { score: 'MISS' }, testHookSh: { score: 'MISS' } },
  ];
  const p = tally(fake, 'prove');
  ok('a declared known miss leaves the prove denominator', p.of === 1 && p.caught === 1, JSON.stringify(p));
  ok('...but is still reported rather than hidden', p.knownMiss === 1);
  ok('...and it stays in the COMPETITOR denominator, because the gap is ours not theirs',
    tally(fake, 'testHookSh').of === 2, JSON.stringify(tally(fake, 'testHookSh')));

  /**
   * The handler path must come from the bundle. Handing the competitor a path that
   * does not exist scores it a catch on every fixture INCLUDING the control, which
   * is a fabricated comparison; the published runner's own history records exactly
   * that happening with a native Windows path.
   */
  const tmp = mkdtempSync(join(tmpdir(), 'hpath-'));
  try {
    mkdirSync(join(tmp, '.claude', 'hooks'), { recursive: true });
    writeFileSync(join(tmp, '.claude', 'hooks', 'validate.mjs'), '// x');
    writeFileSync(join(tmp, 'settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/validate.mjs"' }] }] },
    }));
    const got = handlerPathFor(tmp);
    ok('the handler path is read from settings.json and the placeholder expanded', existsSync(got), got);
    ok('...and it is NOT the hardcoded guard.mjs the other cohort uses', !/guard\.mjs$/.test(got));
    writeFileSync(join(tmp, 'settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/validate.mjs"' }] }] },
    }));
    ok('the BARE variable form yields a path that does not exist, which is the real defect',
      !existsSync(handlerPathFor(tmp)), handlerPathFor(tmp));
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  const row = (prove, hook) => ({ fixture: 'f', prove: { exit: prove }, testHookSh: { exit: hook } });
  ok('the overwrite guard is the published one and still fires',
    wouldDropRecordedTools([row(1, 0)], [row(1, null)]).join(',') === 'testHookSh');
  ok('...and stays silent when nothing is dropped', wouldDropRecordedTools([row(1, 0)], [row(1, 0)]).length === 0);

  if (existsSync(RESULTS)) {
    const prior = JSON.parse(readFileSync(RESULTS, 'utf8'));
    ok('the committed record has twelve rows', (prior.rows || []).length === 12, String((prior.rows || []).length));
    ok('...and a control that both tools saw', (prior.rows || []).some((r) => r.control));
    /**
     * recordDiff must be able to SEE a score change. Fed the real record against a
     * doctored copy of its own rows, it has to complain; fed the record against
     * itself, it has to stay quiet apart from an n/a note.
     */
    const same = recordDiff(prior, prior.rows);
    ok('recordDiff is quiet when a run reproduces the record', same.filter((d) => !d.startsWith('NOTE')).length === 0, same.join(' | '));
    const degraded = JSON.parse(JSON.stringify(prior.rows));
    const victim = degraded.find((r) => !r.control && r.prove.score === 'CATCH');
    victim.prove.score = 'MISS';
    const seen = recordDiff(prior, degraded);
    ok('MUST SEE: a CATCH turning into a MISS', seen.some((d) => new RegExp(`^${victim.fixture}: prove score`).test(d)), seen.join(' | '));
    ok('...and the caught tally dropping with it', seen.some((d) => /^prove\.caught:/.test(d)));
    const missing = degraded.filter((r) => r.fixture !== victim.fixture);
    ok('MUST SEE: a fixture vanishing from the run', recordDiff(prior, missing).some((d) => /is in the record and absent/.test(d)));
  }

  console.log(fails ? `\nSELF-TEST FAIL (${fails})` : '\nSELF-TEST PASS');
  return fails ? 1 : 0;
}

/**
 * RE-MEASURE THE PUBLISHED NUMBER AND REFUSE A SILENT CHANGE.
 *
 * `report()` returns non-zero only for a dirty control or a wrong diagnosis, so a
 * prover regression that turned every row into a MISS exited 0, and a re-run per
 * the write-up's own instructions would have overwritten results.json with the
 * degraded numbers and still exited 0. `wouldDropRecordedTools` guards against
 * losing a tool COLUMN, not against a score moving. Independent review 2026-08-07.
 *
 * This compares a fresh run against the committed record and fails on ANY change to
 * the prove column. The competitor column is compared only when it was measured on
 * this machine, because a machine without test-hook.sh legitimately cannot
 * reproduce it and must not be able to erase it either.
 */
export function recordDiff(prior, fresh) {
  const out = [];
  const pt = tally(fresh, 'prove');
  const rec = prior.prove || {};
  for (const k of ['caught', 'of', 'falsePos', 'wrongDiagnosis', 'knownMiss']) {
    if (rec[k] !== undefined && rec[k] !== pt[k]) out.push(`prove.${k}: record says ${rec[k]}, this run measured ${pt[k]}`);
  }
  const tt = tally(fresh, 'testHookSh');
  const trec = prior.testHookSh || {};
  if (tt.na === 0 && trec.na === 0) {
    for (const k of ['caught', 'of', 'falsePos']) {
      if (trec[k] !== undefined && trec[k] !== tt[k]) out.push(`testHookSh.${k}: record says ${trec[k]}, this run measured ${tt[k]}`);
    }
  } else if (tt.na > 0) {
    out.push(`NOTE test-hook.sh is not installed here (${tt.na} row(s) n/a), so its column was not re-measured`);
  }
  const byName = new Map(fresh.map((r) => [r.fixture, r]));
  for (const r of (prior.rows || [])) {
    const now = byName.get(r.fixture);
    if (!now) { out.push(`fixture "${r.fixture}" is in the record and absent from this run`); continue; }
    if (now.prove.score !== r.prove.score) out.push(`${r.fixture}: prove score was ${r.prove.score}, now ${now.prove.score}`);
  }
  return out;
}

if (IS_MAIN) {
  const a = process.argv.slice(2);
  if (a.includes('--self-test')) process.exit(selfTest());
  const rows = bench();
  if (a.includes('--verify-record')) {
    if (!existsSync(RESULTS)) { console.error(`no committed record at ${RESULTS}`); process.exit(1); }
    const diff = recordDiff(JSON.parse(readFileSync(RESULTS, 'utf8')), rows);
    const real = diff.filter((d) => !d.startsWith('NOTE'));
    for (const d of diff) console.log(`  ${d}`);
    if (real.length) {
      console.log(`\nRECORD DIVERGED: ${real.length} difference(s). Either the tool regressed or the published`);
      console.log('numbers are stale. Re-run without --verify-record to re-record, and update');
      console.log('tests/results-prove-bench-validation.md in the same commit.');
      process.exit(1);
    }
    console.log(`\nPASS the committed record still reproduces (${tally(rows, 'prove').caught} of ${tally(rows, 'prove').of} with the correct diagnosis).`);
    process.exit(0);
  }
  const code = report(rows);
  if (a.includes('--json')) { console.log(JSON.stringify({ rows, prove: tally(rows, 'prove'), testHookSh: tally(rows, 'testHookSh') }, null, 2)); process.exit(code); }

  const oi = a.indexOf('--out');
  const dest = oi >= 0 ? resolve(a[oi + 1]) : RESULTS;
  // A run against overridden fixtures or an overridden prover is an EXPERIMENT, not
  // a record. Letting one land in results.json would publish a number produced by a
  // tool or a fixture set nobody can see from the committed tree.
  if (dest === RESULTS && (process.env.PROVE_BENCH_FIXTURES || process.env.PROVE_BENCH_PROVE_TOOL)) {
    console.error('\nREFUSED to write results.json from an overridden run. Use --out to record it elsewhere.');
    process.exit(1);
  }
  if (existsSync(dest)) {
    const prior = JSON.parse(readFileSync(dest, 'utf8')).rows || [];
    const dropped = wouldDropRecordedTools(prior, rows);
    if (dropped.length) {
      console.error(`\nREFUSED to overwrite ${dest}: this run would DROP a recorded tool column (${dropped.join(', ')}).`);
      console.error('The committed record has a measurement this machine cannot reproduce. Re-run where that tool');
      console.error('is installed, or write elsewhere with --out. A results file that silently loses a column is');
      console.error('worse than no results file, because the published number keeps citing it.');
      process.exit(1);
    }
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify({ rows, prove: tally(rows, 'prove'), testHookSh: tally(rows, 'testHookSh') }, null, 2) + '\n');
  console.log(`\nwrote ${dest}`);
  process.exit(code);
}
