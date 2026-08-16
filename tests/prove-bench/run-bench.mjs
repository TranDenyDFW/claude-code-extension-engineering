#!/usr/bin/env node
/**
 * prove-bench: does a tool notice that an extension does not do what it was
 * asked to do?
 *
 * Scored tools:
 *   extension-prove   this repo
 *   test-hook.sh      plugin-dev/skills/hook-development/scripts/test-hook.sh
 *
 * FAIRNESS NOTES, stated up front because they cut against us:
 *   - test-hook.sh hard-depends on jq, which is absent on this machine. Without
 *     it, it reports "Test input is not valid JSON" for valid JSON, because
 *     line 155's `jq empty "$TEST_INPUT" 2>/dev/null` swallows command-not-found.
 *     Scoring it in that state would be scoring a missing dependency, not the
 *     tool. So the bench SHIPS A jq SHIM and puts it on PATH, giving the
 *     competitor its best possible run. The shim is reported in the output.
 *   - test-hook.sh is a single-hook tester, not a bundle checker. It is given the
 *     bundle's handler and the conformance case that a correct implementation
 *     must DENY. That is the most favourable framing available to it.
 *   - Fixtures and expected outcomes are authored here, the same
 *     construct-validity limit tests/results-lint-bench.md already discloses.
 *
 * SCORING
 *   defective fixture: CATCH if the tool exits non-zero, MISS if it exits 0.
 *   control fixture:   CLEAN if the tool exits 0, FALSE-POS if non-zero.
 *   A FALSE-POS is weighted exactly like a MISS, the rule already used in
 *   tests/lint-bench/run-bench.mjs.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIXTURES = join(HERE, 'fixtures');
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
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'extension-prove.mjs'), '--bundle', dir, '--json'],
    { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  let failedIds = [];
  let parsed = false;
  try { failedIds = JSON.parse(r.stdout).cases.filter((c) => !c.ok).map((c) => c.id); parsed = true; } catch { /* keep empty */ }
  return { exit: r.status, failedIds, parsed, detail: failedIds.length ? `failed ${failedIds.join(',')}` : 'all cases pass' };
}

/**
 * bash on Windows cannot resolve a drive-letter path like P:\a\b. It needs the
 * POSIX form /p/a/b. Passing the native path made test-hook.sh error on EVERY
 * fixture including the control, which read as "caught 10/10" and would have
 * been a fabricated result in the comparison. The control is what caught it.
 */
function toPosixPath(p) {
  const m = String(p).match(/^([A-Za-z]):[\\/](.*)$/);
  if (!m) return String(p).replace(/\\/g, '/');
  return `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

/**
 * Resolve a bash that is actually bash.
 *
 * Under a PowerShell PATH, bare `bash` resolves to C:\Users\<u>\AppData\Local\Microsoft\
 * WindowsApps\bash.exe, the Store WSL alias. It exits 1 with an elevation error without
 * ever reading the script, and since `score()` reads a non-zero exit on a defective
 * fixture as CATCH, the competitor scored 10 of 10 while never running. The bench was
 * green from Git Bash and wrong from PowerShell, which is the worst shape a benchmark
 * can take: correct on the machine of whoever built it.
 *
 * So the candidate is PROBED rather than trusted, and a failure throws rather than
 * degrading, because a bench that cannot launch its competitor has no result to report.
 */
let BASH = null;
export function resolveBash(candidates = null) {
  /* The cache is bypassed when candidates are named explicitly. Without that, the
     self-test's known-bad candidates would return whatever a previous real call had
     cached, and the two checks that prove this function can REFUSE would silently
     stop being able to fail. */
  if (BASH && !candidates) return BASH;
  const list = candidates || (process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe', 'bash']
    : ['bash']);
  const tried = [];
  for (const c of list) {
    /* Never accept the Store alias, whatever it claims: it is a launcher, not a shell. */
    if (/WindowsApps/i.test(c)) { tried.push(`${c}: Microsoft Store alias, skipped`); continue; }
    if (c !== 'bash' && !existsSync(c)) { tried.push(`${c}: not present`); continue; }
    const p = spawnSync(c, ['-c', 'echo BASH_PROBE_OK'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    if (p.status === 0 && /BASH_PROBE_OK/.test(p.stdout || '')) { if (!candidates) BASH = c; return c; }
    tried.push(`${c}: exit ${p.status}, ${String(p.stderr || p.error || '').trim().split('\n')[0] || 'no output'}`);
  }
  throw new Error(`prove-bench cannot find a working bash, so the competitor cannot be run and nothing may be scored.\n  ${tried.join('\n  ')}`);
}

function runTestHookSh(dir, shimDir) {
  if (!existsSync(TEST_HOOK_SH)) return { exit: null, detail: 'not installed' };
  const conf = JSON.parse(readFileSync(join(dir, 'conformance.json'), 'utf8'));
  // Give it the case a correct implementation must DENY: its best chance.
  const c = conf.cases.find((x) => x.kind === 'enforce' && x.expect && x.expect.decision === 'deny') || conf.cases[0];
  const tmp = mkdtempSync(join(tmpdir(), 'thsh-'));
  try {
    const payload = { session_id: 'bench', transcript_path: join(tmp, 't.jsonl'), cwd: dir, hook_event_name: c.event, ...c.input };
    const inputPath = join(tmp, 'input.json');
    writeFileSync(inputPath, JSON.stringify(payload, null, 2));
    const handler = join(dir, 'guard.mjs');
    const sep = process.platform === 'win32' ? ';' : ':';
    // Windows env is Path, not PATH. Setting only PATH leaves the original Path
    // in place and the child can end up with neither the shim nor node.
    const env = { ...process.env };
    const existing = env.PATH || env.Path || '';
    delete env.Path;
    env.PATH = `${shimDir}${sep}${existing}`;
    const r = spawnSync(resolveBash(), [toPosixPath(TEST_HOOK_SH), toPosixPath(handler), toPosixPath(inputPath)],
      { encoding: 'utf8', windowsHide: true, timeout: 120_000, env });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const said = /Test completed successfully/.test(out) ? 'reported success'
      : /Test failed/.test(out) ? 'reported failure'
      : /not valid JSON/.test(out) ? 'claimed the input was invalid JSON'
      : 'no verdict line';
    /* A non-zero exit carrying none of the tool's own verdict lines means the tool did
       not reach its own logic, and scoring that as a CATCH credits the competitor for
       our launch failing. Downgrade it to the n/a the bench already uses for a tool
       that is not installed, and say so in the detail column rather than silently. */
    if (said === 'no verdict line') {
      /* Keep the REAL exit code. Returning null here also silenced the per-fixture
         competitor comparison in recordDiff, which skips a row whose exit is null, so a
         score change on this fixture became invisible. Unscorability is carried by an
         explicit flag instead, and the measured exit stays measured. */
      return { exit: r.status, detail: `NO VERDICT, nothing to score (exit ${r.status})`, scorable: false };
    }
    return { exit: r.status, detail: said };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * Exit-code-only scoring, kept for the competitor because a single verdict is all
 * it produces. It answers "did the tool flag this bundle as defective".
 */
export function score(isControl, exit) {
  if (exit === null) return 'n/a';
  if (isControl) return exit === 0 ? 'clean' : 'FALSE-POS';
  return exit !== 0 ? 'CATCH' : 'MISS';
}

/**
 * Diagnosis-level scoring, applied to extension-prove ONLY, which holds it to a
 * STRICTER bar than the competitor.
 *
 * An adversarial audit stubbed `runHandler` so that no extension code executed at
 * all, and the published headline of the day came out BYTE-IDENTICAL, because
 * exit-code scoring counts any non-zero as a catch, including "everything failed
 * for the wrong reason". Under that stub `blocks-the-near-miss` passed the very
 * case that defines its defect.
 *
 * So a CATCH now requires the failing case-id set to EQUAL the set the fixture's
 * defect predicts. Detecting a defect for the wrong reason scores WRONG-DIAGNOSIS,
 * which is not a catch.
 */
export function scoreDiagnosis(isControl, run, expected) {
  if (run.exit === null) return 'n/a';
  if (!run.parsed) return 'NO-OUTPUT';
  const got = [...(run.failedIds || [])].sort().join(',');
  const want = [...(expected || [])].sort().join(',');
  if (isControl) return run.exit === 0 && got === '' ? 'clean' : 'FALSE-POS';
  if (run.exit === 0) return 'MISS';
  return got === want ? 'CATCH' : 'WRONG-DIAGNOSIS';
}

function bench() {
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
        prove: { ...prove, score: scoreDiagnosis(man.control, prove, man.expectedFailures || []) },
        testHookSh: { ...thsh, score: thsh.scorable === false ? 'n/a' : score(man.control, thsh.exit) },
      });
    }
  } finally { rmSync(shimDir, { recursive: true, force: true }); }
  return rows;
}

function tally(rows, key) {
  const d = rows.filter((r) => !r.control);
  return {
    caught: d.filter((r) => r[key].score === 'CATCH').length,
    of: d.length,
    falsePos: rows.filter((r) => r.control && r[key].score === 'FALSE-POS').length,
    na: rows.filter((r) => r[key].score === 'n/a').length,
  };
}

function report(rows, json) {
  if (json) { console.log(JSON.stringify({ rows, prove: tally(rows, 'prove'), testHookSh: tally(rows, 'testHookSh') }, null, 2)); return 0; }
  const w = Math.max(...rows.map((r) => r.fixture.length));
  console.log(`prove-bench  ${rows.length} fixtures (${rows.filter((r) => r.control).length} control, ${rows.filter((r) => !r.control).length} defective)`);
  console.log(`test-hook.sh: ${existsSync(TEST_HOOK_SH) ? 'found, run with a jq shim on PATH so it gets its best chance' : 'NOT INSTALLED'}`);
  console.log('');
  console.log(`${'fixture'.padEnd(w)}  ${'extension-prove'.padEnd(16)}  test-hook.sh`);
  console.log(`${'-'.repeat(w)}  ${'-'.repeat(16)}  ${'-'.repeat(28)}`);
  for (const r of rows) {
    const tag = r.control ? ' (control)' : '';
    const note = r.prove.score === 'WRONG-DIAGNOSIS' ? `  [expected ${r.expectedFailures.join(',') || 'none'}, got ${r.prove.failedIds.join(',') || 'none'}]` : '';
    console.log(`${(r.fixture + tag).padEnd(w)}  ${r.prove.score.padEnd(16)}  ${r.testHookSh.score}  [${r.testHookSh.detail}]${note}`);
  }
  const p = tally(rows, 'prove'), t = tally(rows, 'testHookSh');
  console.log('');
  const wrong = rows.filter((r) => r.prove.score === 'WRONG-DIAGNOSIS').length;
  console.log(`extension-prove : caught ${p.caught}/${p.of} defects, ${p.falsePos} false positive(s) on the control${wrong ? `, ${wrong} WRONG-DIAGNOSIS` : ''}`);
  console.log(`                  (a catch requires the failing case set to MATCH the fixture's declared defect, not merely a non-zero exit)`);
  console.log(`test-hook.sh    : caught ${t.caught}/${t.of} defects, ${t.falsePos} false positive(s) on the control`);
  return 0;
}

// -------------------------------------------------------------------- self-test
function selfTest() {
  let f = 0;
  const check = (n, c) => { if (c) console.log(`  ok   ${n}`); else { console.log(`  FAIL ${n}`); f++; } };
  check('a defective fixture with a non-zero exit is a CATCH', score(false, 1) === 'CATCH');
  check('a defective fixture with exit 0 is a MISS', score(false, 0) === 'MISS');
  check('the control with exit 0 is clean', score(true, 0) === 'clean');
  check('FALSE POSITIVE: the control with a non-zero exit is scored, not excused', score(true, 1) === 'FALSE-POS');
  check('an uninstalled tool scores n/a, never a silent CATCH', score(false, null) === 'n/a');

  /* The bash resolver, which exists because bare `bash` under a PowerShell PATH ran the
     Microsoft Store WSL alias and scored the competitor 10 of 10 without executing it. */
  check('resolveBash REFUSES the Microsoft Store alias by path',
    (() => { try { resolveBash(['C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe']); return false; } catch (e) { return /cannot find a working bash/.test(e.message) && /Store alias/.test(e.message); } })());
  check('resolveBash THROWS rather than returning a shell it could not probe',
    (() => { try { resolveBash([join(HERE, 'definitely-not-a-shell.exe')]); return false; } catch (e) { return /nothing may be scored/.test(e.message); } })());
  /* The typo guard. `--selftest` must be REFUSED, not silently run as a bench. */
  check('a mistyped --selftest is caught as unknown', unknownFlags(['--selftest']).length === 1);
  check('the real flags are accepted', unknownFlags(['--self-test', '--json']).length === 0);
  /* The value must be CONSUMED, so a dash-leading value is not read as a flag. The
     first version passed a value that could not look like a flag anyway, so deleting the
     consumption left the check green: it asserted nothing. */
  check('--out consumes its value rather than reading it as a flag', unknownFlags(['--out', '--tmp-x.json']).length === 0);
  check('--out=value form is accepted too', unknownFlags(['--out=tmp/x.json']).length === 0);
  check('MUST FAIL: an invented flag is not waved through', unknownFlags(['--record-everything']).length === 1);

  check('resolveBash accepts a real bash and its probe actually runs',
    (() => { try { const b = resolveBash(); const p = spawnSync(b, ['-c', 'echo BASH_PROBE_OK'], { encoding: 'utf8' }); return p.status === 0 && /BASH_PROBE_OK/.test(p.stdout); } catch { return false; } })());

  // Diagnosis scoring. An audit stubbed runHandler so nothing executed and the
  // old exit-code-only headline came out byte-identical, so a catch now requires
  // the failing case set to MATCH the fixture's declared defect.
  const D = (ctrl, exit, got, want) => scoreDiagnosis(ctrl, { exit, parsed: true, failedIds: got }, want);
  check('CATCH requires the failing set to MATCH the declared defect', D(false, 1, ['C6','C7'], ['C6','C7']) === 'CATCH');
  check('order does not matter when comparing the sets', D(false, 1, ['C7','C6'], ['C6','C7']) === 'CATCH');
  check('WRONG-DIAGNOSIS: right that it is broken, wrong about why', D(false, 1, ['C1','C3','C5','C6','C7'], ['C6','C7']) === 'WRONG-DIAGNOSIS');
  check('a WRONG-DIAGNOSIS is NOT counted as a catch', tally([{ control: false, prove: { score: 'WRONG-DIAGNOSIS' }, testHookSh: { score: 'MISS' } }], 'prove').caught === 0);
  check('exit 0 on a defective fixture is still a MISS', D(false, 0, [], ['C6','C7']) === 'MISS');
  check('the control must fail NOTHING to be clean', D(true, 0, [], []) === 'clean');
  check('the control failing any case is a FALSE-POS', D(true, 1, ['C1'], []) === 'FALSE-POS');
  check('unparseable output is never a silent catch', scoreDiagnosis(false, { exit: 1, parsed: false, failedIds: [] }, ['C1']) === 'NO-OUTPUT');
  const fake = [
    { control: true, prove: { score: 'clean' }, testHookSh: { score: 'clean' } },
    { control: false, prove: { score: 'CATCH' }, testHookSh: { score: 'MISS' } },
    { control: false, prove: { score: 'CATCH' }, testHookSh: { score: 'CATCH' } },
  ];
  check('tally counts only defective fixtures in the denominator', tally(fake, 'prove').of === 2);
  check('tally counts catches correctly', tally(fake, 'testHookSh').caught === 1);
  const fp = [{ control: true, prove: { score: 'FALSE-POS' }, testHookSh: { score: 'clean' } }];
  check('a false positive on the control is surfaced', tally(fp, 'prove').falsePos === 1);
  // The generator must not have drifted, or the scores describe fixtures nobody committed.
  const gen = spawnSync(process.execPath, [join(HERE, 'make-fixtures.mjs'), '--check'], { encoding: 'utf8', windowsHide: true });
  check('committed fixtures match the generator', gen.status === 0);

  /**
   * The overwrite guard, fed known-bad pairs. Added 2026-08-07: this harness
   * wrote results.json unconditionally, so a run on a machine without
   * test-hook.sh silently deleted the competitor column the published comparison
   * rests on. lint-bench grew the same guard two days earlier for the same reason.
   */
  const row = (prove, hook) => ({ fixture: 'f', tools: undefined, prove: { exit: prove }, testHookSh: { exit: hook } });
  check('MUST FAIL: a run where the competitor is absent would DROP it',
    wouldDropRecordedTools([row(1, 0)], [row(1, null)]).join(',') === 'testHookSh');
  check('...and a run that keeps both measured drops nothing',
    wouldDropRecordedTools([row(1, 0)], [row(1, 0)]).length === 0);
  check('...and losing OUR OWN tool is reported too, not just the competitor',
    wouldDropRecordedTools([row(1, 0)], [row(null, 0)]).join(',') === 'prove');
  check('...and gaining a tool is never reported as a loss',
    wouldDropRecordedTools([row(1, null)], [row(1, 0)]).length === 0);
  check('exit 0 is MEASURED data, not absence, so a clean control still counts',
    wouldDropRecordedTools([row(0, 0)], [row(0, null)]).join(',') === 'testHookSh');
  check('a missing prior record cannot manufacture a loss',
    wouldDropRecordedTools(null, [row(1, 1)]).length === 0);
  check('the guard reads the REAL committed row shape, not an invented one',
    wouldDropRecordedTools(JSON.parse(readFileSync(join(HERE, 'results.json'), 'utf8')), []).length > 0);
  if (gen.status !== 0) console.log('       ' + String(gen.stdout || gen.stderr).trim().split('\n')[0]);
  console.log(`\n${f === 0 ? 'SELF-TEST PASS' : `SELF-TEST FAIL (${f})`}`);
  return f === 0 ? 0 : 1;
}

/**
 * Would writing these rows DROP a competitor column the committed record has?
 *
 * results.json is not an output, it is the record of a run against a competitor
 * installed on the machine that produced it and possibly nowhere else.
 * `test-hook.sh` resolves under `~/.claude/plugins/marketplaces/...`; on a machine
 * without it every row scores `n/a`, and writing that over the record silently
 * deletes a measured column while reporting success.
 *
 * lint-bench grew exactly this guard on 2026-08-05, after a re-run destroyed the
 * agnix tool list the capability catalog anchors its crosscheck to. prove-bench
 * never got it, and was found without it on 2026-08-07 while reading the harness
 * to add a second cohort: same class, same file shape, one directory across.
 *
 * Exported and pure so the self-test can feed it a known-bad pair.
 */
export const TOOL_KEYS = ['prove', 'testHookSh'];

export function wouldDropRecordedTools(prior, fresh) {
  // A tool counts as MEASURED on a row when it actually ran: `exit === null` is
  // how the harness records "not installed" and must never look like data.
  //
  // The first version of this read `r.tools` as a map, which this file has never
  // produced: rows carry the tool keys at top level. That version found nothing
  // on any input and was therefore a guard that could not fail, caught by reading
  // the committed record instead of trusting the shape.
  const measured = (rows) => new Set((rows || []).flatMap((r) => TOOL_KEYS
    .filter((k) => r && r[k] && r[k].exit !== null && r[k].exit !== undefined)));
  const had = measured(prior);
  const has = measured(fresh);
  return [...had].filter((t) => !has.has(t)).sort();
}

/**
 * An unrecognised flag is refused rather than ignored.
 *
 * `--selftest` is not `--self-test`, and the typo did not fail: it fell through to a real
 * bench run whose default output path is the COMMITTED record, so a command meant to assert
 * nothing quietly rewrote a published measurement. The overwrite guard below did not stop it
 * because it only refuses to DROP a tool's column, and this run measured every tool. The
 * cheapest place to catch that is here, before anything runs.
 */
export const KNOWN_FLAGS = ['--self-test', '--json', '--out', '--record', '--verify-record'];
export function unknownFlags(argv, known = KNOWN_FLAGS) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (!known.includes(name)) out.push(a);
    else if (name === '--out' && !a.includes('=')) i++;
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const bad = unknownFlags(argv);
  if (bad.length) {
    console.error(`unrecognised flag(s): ${bad.join(', ')}`);
    console.error(`known flags: ${KNOWN_FLAGS.join(', ')}`);
    console.error('Refusing to run: an unrecognised flag once fell through to a full bench run');
    console.error('that overwrote the committed record, so this exits instead of guessing.');
    process.exit(2);
  }
  if (argv.includes('--self-test')) process.exit(selfTest());
  if (!existsSync(FIXTURES)) { console.error('no fixtures; run make-fixtures.mjs first'); process.exit(1); }
  const rows = bench();
  const code = report(rows, argv.includes('--json'));

  /* --verify-record: re-run and require the COMMITTED record to reproduce.
   *
   * The validation cohort has had this since it was written; this cohort, whose numbers are
   * the published headline, had nothing re-verifying its record and CI never re-ran it.
   * Independent review 5 named that and review 6 confirmed it was still true. The record
   * that carries the headline is the last one that should go unchecked. */
  if (argv.includes('--verify-record')) {
    const recPath = join(HERE, 'results.json');
    if (!existsSync(recPath)) { console.error(`no record at ${recPath}`); process.exit(1); }
    const prior = JSON.parse(readFileSync(recPath, 'utf8'));
    const priorRows = Array.isArray(prior) ? prior : (prior.rows || Object.values(prior).filter((x) => x && x.fixture));
    const byName = new Map(rows.map((r) => [r.fixture, r]));
    const diffs = [];
    for (const p of priorRows) {
      const now = byName.get(p.fixture);
      if (!now) { diffs.push(`fixture "${p.fixture}" is in the record and absent from this run`); continue; }
      for (const col of ['prove', 'testHookSh']) {
        const was = (p[col] || {}), is = (now[col] || {});
        if (was.score !== is.score) diffs.push(`${p.fixture}: ${col} score was ${was.score}, now ${is.score}`);
        if (was.exit !== is.exit) diffs.push(`${p.fixture}: ${col} exit was ${was.exit}, now ${is.exit}`);
      }
      const a = [...(p.prove?.failedIds || [])].sort().join(','), b = [...(now.prove?.failedIds || [])].sort().join(',');
      if (a !== b) diffs.push(`${p.fixture}: failing case ids were [${a}], now [${b}]`);
    }
    for (const r of rows) if (!priorRows.some((p) => p.fixture === r.fixture)) diffs.push(`fixture "${r.fixture}" is in this run and absent from the record`);
    if (diffs.length) {
      console.error('');
      for (const d of diffs) console.error(`  ${d}`);
      console.error('');
      console.error(`RECORD DIVERGED: ${diffs.length} difference(s). Either the tool changed or the`);
      console.error('published numbers are stale. Re-record deliberately with --record, and update');
      console.error('tests/results-prove-bench.md in the same commit.');
      process.exit(1);
    }
    console.log('');
    console.log('PASS the committed record still reproduces, per fixture and per column.');
    process.exit(0);
  }

  const oi = argv.indexOf('--out');
  /* A BARE RUN NO LONGER WRITES THE COMMITTED RECORD.
   *
   * It used to, and the file's own reproduce line told the reader to run exactly that, so
   * following the documentation rewrote the published measurement. The sibling validation
   * runner has always required an explicit `--record` for this; the two now agree.
   * Independent review 4, 2026-08-13. */
  if (oi < 0 && !argv.includes('--record')) {
    console.log('');
    console.log('Reported only. This run wrote nothing.');
    console.log('  --record        deliberately update tests/prove-bench/results.json');
    console.log('  --out <file>    write somewhere else');
    process.exit(code);
  }
  const dest = oi >= 0 ? resolve(argv[oi + 1]) : join(HERE, 'results.json');
  if (oi < 0 && existsSync(dest)) {
    let prior = null;
    try { prior = JSON.parse(readFileSync(dest, 'utf8')); } catch { prior = null; }
    const lost = wouldDropRecordedTools(prior, rows);
    if (lost.length) {
      console.error('');
      console.error(`REFUSING to overwrite ${dest}: this run would DROP recorded data for ${lost.join(', ')}.`);
      console.error('Those tools are not installed here, so their columns would vanish from the record');
      console.error('rather than be re-measured, and the published comparison in');
      console.error('tests/results-prove-bench.md rests on them.');
      console.error('');
      console.error('Re-run where they are installed, or send this run elsewhere:');
      console.error('  node tests/prove-bench/run-bench.mjs --out tests/prove-bench/results-<name>.json');
      process.exit(1);
    }
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(rows, null, 2) + '\n');
  console.log(`\nwrote ${dest}`);
  process.exit(code);
}

if (IS_MAIN) main();
export { tally };
