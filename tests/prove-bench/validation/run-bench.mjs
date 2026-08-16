#!/usr/bin/env node
/**
 * prove-bench, VALIDATION-FAILURE-MODE cohort: the runner.
 *
 * Runs extension-prove and the shipped tester over the twelve fixtures in
 * ./fixtures and writes ./results.json. It does NOT read or write ../results.json,
 * so the published first-cohort experiment is untouched.
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
 *   node tests/prove-bench/validation/run-bench.mjs                  run and REPORT, writing nothing
 *   node tests/prove-bench/validation/run-bench.mjs --verify-record  re-run and require the record to reproduce
 *   node tests/prove-bench/validation/run-bench.mjs --record         deliberately re-record results.json
 *   node tests/prove-bench/validation/run-bench.mjs --out <f>        write elsewhere
 *   node tests/prove-bench/validation/run-bench.mjs --json           print JSON, write nothing
 *   node tests/prove-bench/validation/run-bench.mjs --self-test
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { score, scoreDiagnosis, wouldDropRecordedTools, TOOL_KEYS, resolveBash, unknownFlags } from '../run-bench.mjs';
import { proveArtifactGate } from '../../../tools/artifact-mutation.mjs';

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
    const r = spawnSync(resolveBash(), [toPosixPath(TEST_HOOK_SH), toPosixPath(handler), toPosixPath(inputPath)],
      { encoding: 'utf8', windowsHide: true, timeout: 120_000, env });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const said = /Test completed successfully/.test(out) ? 'reported success'
      : /Test failed/.test(out) ? 'reported failure'
        : /not valid JSON/.test(out) ? 'claimed the input was invalid JSON'
          : 'no verdict line';
    /* Same rule as the published runner: a non-zero exit with none of the tool's own
       verdict lines means it never reached its own logic, so it is n/a rather than a
       CATCH. Both cohorts must apply this identically or they stop being comparable. */
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
        testHookSh: { ...thsh, score: thsh.scorable === false ? 'n/a' : score(man.control, thsh.exit) },
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
    /**
     * The score is not the only thing that can move. Independent review 2026-08-08
     * fabricated a fixture's whole prove record while leaving `score` intact and
     * this function said nothing, while its own docstring claimed it failed on ANY
     * change to the prove column.
     */
    const idsMoved = JSON.parse(JSON.stringify(prior.rows));
    idsMoved.find((r) => r.fixture === victim.fixture).prove.failedIds = ['not-a-real-case'];
    ok('MUST SEE: a fabricated failing-id list behind an unchanged score',
      recordDiff(prior, idsMoved).some((d) => /failing case ids were/.test(d)), recordDiff(prior, idsMoved).join(' | '));
    const exitMoved = JSON.parse(JSON.stringify(prior.rows));
    exitMoved.find((r) => r.fixture === victim.fixture).prove.exit = 99;
    ok('MUST SEE: a changed exit code behind an unchanged score',
      recordDiff(prior, exitMoved).some((d) => /prove exit was/.test(d)));
    const declMoved = JSON.parse(JSON.stringify(prior.rows));
    declMoved.find((r) => r.fixture === victim.fixture).expectedFailures = [];
    ok('MUST SEE: the DECLARED expectation being quietly rewritten',
      recordDiff(prior, declMoved).some((d) => /DECLARED expectedFailures changed/.test(d)));
    const added = [...JSON.parse(JSON.stringify(prior.rows)), { fixture: 'smuggled-in', control: false, expectedFailures: [], prove: { score: 'CATCH', exit: 1, failedIds: [] }, testHookSh: { score: 'MISS', exit: 0 } }];
    ok('MUST SEE: a fixture appearing that the record never had',
      recordDiff(prior, added).some((d) => /is in this run and absent from the record/.test(d)));
    /**
     * The competitor column must never fall SILENT. Every combination of measured
     * and not-measured gets a note, because the case it used to skip in silence is
     * precisely the one where the comparison changes meaning.
     */
    /* `n/a` now carries TWO meanings, so these fixtures must say WHICH they mean. They
       previously set the score alone and bumped a summary counter, which no longer selects
       a branch: the code reads each row's detail, because counting n/a without reading its
       reason is what produced a note claiming the tool was not installed about a tool that
       was installed and had just run. Independent review 3, 2026-08-13. */
    const absent = (rows) => JSON.parse(JSON.stringify(rows))
      .map((r) => ({ ...r, testHookSh: { exit: null, detail: 'not installed', score: 'n/a' } }));
    ok('MUST NOTE: this machine cannot re-verify a competitor column the record has',
      recordDiff(prior, absent(prior.rows)).some((d) => /NOT re-verified/.test(d)));
    ok('MUST NOTE: a record made without the competitor while this machine has it',
      recordDiff({ ...prior, rows: absent(prior.rows) }, prior.rows).some((d) => /nothing to compare against/.test(d)));
    {
      // The both-unmeasured branch was added by a fix and asserted by nothing:
      // deleting its note left the self-test green. Independent review 2026-08-08.
      ok('MUST NOTE: neither side measured the competitor',
        recordDiff({ ...prior, rows: absent(prior.rows) }, absent(prior.rows)).some((d) => /unverified on both sides/.test(d)));
    }
    {
      /* The distinction the whole change exists for: a competitor that RAN and produced no
         verdict is not an absent competitor. It must be named, and the tallies must still
         be compared rather than skipped. */
      const noVerdict = JSON.parse(JSON.stringify(prior.rows));
      const v = noVerdict.find((r) => !r.control);
      v.testHookSh = { exit: 1, detail: 'NO VERDICT, nothing to score (exit 1)', score: 'n/a' };
      const seen = recordDiff(prior, noVerdict);
      ok('MUST NOTE: a competitor that ran but gave no verdict is NOT reported as uninstalled',
        seen.some((d) => /IS installed and DID run/.test(d)) && !seen.some((d) => /is not installed here/.test(d)),
        seen.join(' | ') || 'reported nothing');
      ok('...and the tally comparison still runs rather than being skipped',
        recordDiff({ ...prior, testHookSh: { ...(prior.testHookSh || {}), caught: 99 } }, noVerdict)
          .some((d) => /testHookSh\.caught: record says 99/.test(d)));
    }
    {
      // Moving the competitor's single catch between fixtures leaves every tally
      // identical, which is why the per-fixture comparison exists.
      /* The record legitimately has NO competitor catch since the verdictless row stopped
         counting as one, so the pair is CONSTRUCTED rather than found. Depending on the
         live record to contain a CATCH made this check silently skip the moment the record
         changed, which is the failure mode it was written to prevent one level down. */
      const base = JSON.parse(JSON.stringify(prior.rows));
      const defective = base.filter((r) => !r.control);
      if (defective.length >= 2) {
        defective[0].testHookSh = { exit: 1, detail: 'reported failure', score: 'CATCH' };
        defective[1].testHookSh = { exit: 0, detail: 'reported success', score: 'MISS' };
      }
      const seededPrior = { ...prior, rows: base };
      const moved = JSON.parse(JSON.stringify(base));
      const winner = moved.find((r) => r.testHookSh.score === 'CATCH');
      const loser = moved.find((r) => !r.control && r.testHookSh.score === 'MISS');
      if (winner && loser) {
        const w = winner.testHookSh;
        winner.testHookSh = { ...loser.testHookSh };
        loser.testHookSh = { ...w };
        const seen = recordDiff(seededPrior, moved);
        ok('MUST SEE: the competitor catch moving to a different fixture, with tallies unchanged',
          seen.some((d) => /test-hook.sh score was/.test(d)), seen.join(' | ') || 'reported nothing');
        // The exit code is compared on its own line and had no row of its own, so
        // deleting that line kept the self-test green. Independent review 2026-08-08.
        const exitOnly = JSON.parse(JSON.stringify(base));
        exitOnly.find((r) => r.fixture === winner.fixture).testHookSh.exit = 77;
        ok('MUST SEE: a competitor exit code moving behind an unchanged score',
          recordDiff(seededPrior, exitOnly).some((d) => /test-hook.sh exit was/.test(d)),
          recordDiff(seededPrior, exitOnly).join(' | ') || 'reported nothing');
      } else ok('MUST SEE: the competitor catch moving to a different fixture', false, 'fewer than two defective rows, so no pair could be constructed');
    }
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
 * This compares a fresh run against the committed record and fails on any change to
 * a fixture's prove score, exit code, failing-id list or DECLARED expectedFailures,
 * and on any fixture appearing or disappearing. The competitor column is compared
 * only when both the record and this run measured it, and every other combination
 * emits a NOTE rather than falling silent.
 */
export function recordDiff(prior, fresh) {
  const out = [];
  const pt = tally(fresh, 'prove');
  const rec = prior.prove || {};
  for (const k of ['caught', 'of', 'falsePos', 'wrongDiagnosis', 'knownMiss']) {
    if (rec[k] !== undefined && rec[k] !== pt[k]) out.push(`prove.${k}: record says ${rec[k]}, this run measured ${pt[k]}`);
  }
  /**
   * The competitor column is compared only when BOTH sides measured it, and every
   * other combination says so out loud. The first version fell silent whenever the
   * record carried a nonzero `na` while this machine did not, which is exactly the
   * case where the comparison changes meaning. Independent review 2026-08-08.
   */
  const tt = tally(fresh, 'testHookSh');
  const trec = prior.testHookSh || {};
  const recNa = trec.na || 0;
  /* `n/a` used to mean one thing, "the tool is not installed". It now means two, because a
     run that launches the tool and gets no verdict out of it is also unscorable. Reporting
     the second as "not installed" is a false statement about a tool that is installed and
     did run, and skipping the whole comparison on it hides a real difference. So the two
     are counted apart, the comparison still runs on the rows that WERE scored, and the
     unscorable rows are named rather than summarised. Independent review 3, 2026-08-13. */
  const naRows = fresh.filter((r) => (r.testHookSh || {}).score === 'n/a');
  const naAbsent = naRows.filter((r) => /not installed/i.test((r.testHookSh || {}).detail || ''));
  const naNoVerdict = naRows.filter((r) => /NO VERDICT/i.test((r.testHookSh || {}).detail || ''));
  const naOther = naRows.filter((r) => !naAbsent.includes(r) && !naNoVerdict.includes(r));

  if (naNoVerdict.length) {
    out.push(`NOTE test-hook.sh IS installed and DID run, but produced no verdict on ${naNoVerdict.length} row(s), scored n/a rather than counted as a catch: ${naNoVerdict.map((r) => r.fixture).join(', ')}`);
  }
  if (naOther.length) {
    out.push(`NOTE ${naOther.length} row(s) scored n/a for an unrecognised reason, which the record cannot be compared against: ${naOther.map((r) => `${r.fixture} [${(r.testHookSh || {}).detail}]`).join(', ')}`);
  }

  /* The record's own n/a rows are classified the same way, from their stored details, so
     "the record was made without test-hook.sh" is never printed about a record that was made
     WITH it and merely got no verdict out of it. Counting n/a without reading its reason is
     what produced the false message on both sides. */
  const recNaRows = (prior.rows || []).filter((r) => (r.testHookSh || {}).score === 'n/a');
  const recNaAbsent = recNaRows.filter((r) => /not installed/i.test((r.testHookSh || {}).detail || '')).length;

  if (naAbsent.length === 0 && recNaAbsent === 0) {
    for (const k of ['caught', 'of', 'falsePos']) {
      if (trec[k] !== undefined && trec[k] !== tt[k]) out.push(`testHookSh.${k}: record says ${trec[k]}, this run measured ${tt[k]}`);
    }
  } else if (naAbsent.length > 0 && recNaAbsent === 0) {
    out.push(`NOTE test-hook.sh is not installed here (${naAbsent.length} row(s) n/a) but the record measured it, so its column was NOT re-verified`);
  } else if (naAbsent.length === 0 && recNaAbsent > 0) {
    out.push(`NOTE the record was made without test-hook.sh (${recNaAbsent} row(s) n/a) and this machine has it, so there is nothing to compare against; re-record to capture the competitor column`);
  } else {
    out.push('NOTE neither the record nor this run measured test-hook.sh, so that column is unverified on both sides');
  }

  /**
   * Per fixture, compare the WHOLE prove record, not just the score. The first
   * version compared `score` alone, so a fixture's exit code and failing-id list
   * could be fabricated wholesale while the score was left intact, and this
   * function's own docstring claimed it failed on ANY change to the prove column.
   * It now does.
   */
  const byName = new Map(fresh.map((r) => [r.fixture, r]));
  for (const r of (prior.rows || [])) {
    const now = byName.get(r.fixture);
    if (!now) { out.push(`fixture "${r.fixture}" is in the record and absent from this run`); continue; }
    if (now.prove.score !== r.prove.score) out.push(`${r.fixture}: prove score was ${r.prove.score}, now ${now.prove.score}`);
    if (now.prove.exit !== r.prove.exit) out.push(`${r.fixture}: prove exit was ${r.prove.exit}, now ${now.prove.exit}`);
    const was = [...(r.prove.failedIds || [])].sort().join(',');
    const is = [...(now.prove.failedIds || [])].sort().join(',');
    if (was !== is) out.push(`${r.fixture}: failing case ids were [${was}], now [${is}]`);
    const wantWas = [...(r.expectedFailures || [])].sort().join(',');
    const wantIs = [...(now.expectedFailures || [])].sort().join(',');
    if (wantWas !== wantIs) out.push(`${r.fixture}: DECLARED expectedFailures changed from [${wantWas}] to [${wantIs}]`);
    /**
     * The COMPETITOR is compared per fixture too, when both sides measured it. The
     * tallies alone are a sum, so moving the competitor's single catch from one
     * fixture to another left them identical and this function silent, while the
     * write-up names the fixture that catch belongs to. Independent review
     * 2026-08-08.
     */
    if (r.testHookSh && now.testHookSh && r.testHookSh.exit !== null && now.testHookSh.exit !== null) {
      if (now.testHookSh.score !== r.testHookSh.score) out.push(`${r.fixture}: test-hook.sh score was ${r.testHookSh.score}, now ${now.testHookSh.score}`);
      if (now.testHookSh.exit !== r.testHookSh.exit) out.push(`${r.fixture}: test-hook.sh exit was ${r.testHookSh.exit}, now ${now.testHookSh.exit}`);
    }
  }
  for (const r of fresh) {
    if (!(prior.rows || []).some((p) => p.fixture === r.fixture)) out.push(`fixture "${r.fixture}" is in this run and absent from the record`);
  }
  return out;
}

/**
 * --prove-can-fail: mutate the COMMITTED record and require `recordDiff` to reject
 * each doctored copy for the reason the mutant DECLARES.
 *
 * `recordDiff` was hardened twice: once after review round 3 found a whole prove
 * record could be fabricated behind an unchanged `score`, and once after round 4
 * found that swapping two fixtures' competitor results leaves every aggregate
 * tally identical. Both hardenings were verified by a reviewer's hand, once, into
 * a document that then evaporated. This is that verification as an artifact.
 *
 * The self-test already feeds `recordDiff` doctored rows in memory. This is the
 * other half: the real committed file, serialised and re-read, so a change to how
 * the record is written cannot slip past a check that only ever saw objects.
 */
function proveCanFail() {
  /**
   * Map recordDiff's prose complaints onto stable reason codes, so a mutant can
   * declare WHICH complaint must fire rather than merely "something did". Review
   * round 3 found a guard that never fired while its gate went red for an
   * unrelated reason; an exit-code-only proof scores that mutant killed.
   */
  const codeFor = (lines) => {
    const out = new Set();
    for (const l of lines) {
      if (/^NOTE/.test(l)) continue;
      if (/prove score was/.test(l)) out.add('SCORE_MOVED');
      else if (/prove exit was/.test(l)) out.add('EXIT_MOVED');
      else if (/failing case ids were/.test(l)) out.add('IDS_MOVED');
      else if (/DECLARED expectedFailures changed/.test(l)) out.add('EXPECTATION_REWRITTEN');
      else if (/absent from this run/.test(l)) out.add('FIXTURE_MISSING');
      else if (/absent from the record/.test(l)) out.add('FIXTURE_ADDED');
      else if (/test-hook\.sh score was/.test(l)) out.add('COMPETITOR_SCORE_MOVED');
      else if (/test-hook\.sh exit was/.test(l)) out.add('COMPETITOR_EXIT_MOVED');
      else if (/^prove\./.test(l.trim())) out.add('TALLY_MOVED');
      else out.add('OTHER');
    }
    return [...out];
  };
  const victim = (rows) => rows.find((r) => !r.control && r.prove.score === 'CATCH');

  return proveArtifactGate({
    artifact: RESULTS,
    label: 'validation record',
    parse: (t) => JSON.parse(t),
    serialise: (v) => JSON.stringify(v, null, 2) + '\n',
    // The gate is the REAL comparison --verify-record runs: the committed record
    // as the baseline, the candidate file standing in for a fresh measurement.
    gate: (p) => {
      const cand = JSON.parse(readFileSync(p, 'utf8'));
      const prior = JSON.parse(readFileSync(RESULTS, 'utf8'));
      return codeFor(recordDiff(prior, cand.rows));
    },
    mutants: [
      { label: 'a CATCH turned into a MISS', expect: 'SCORE_MOVED',
        mutate: (v) => { victim(v.rows).prove.score = 'MISS'; return v; } },
      { label: 'the failing-id list fabricated behind an unchanged score', expect: 'IDS_MOVED',
        mutate: (v) => { victim(v.rows).prove.failedIds = ['not-a-real-case']; return v; } },
      { label: 'the exit code changed behind an unchanged score', expect: 'EXIT_MOVED',
        mutate: (v) => { victim(v.rows).prove.exit = 99; return v; } },
      { label: 'the DECLARED expectation quietly rewritten', expect: 'EXPECTATION_REWRITTEN',
        mutate: (v) => { victim(v.rows).expectedFailures = []; return v; } },
      { label: 'a fixture dropped from the run', expect: 'FIXTURE_MISSING',
        mutate: (v) => { const name = victim(v.rows).fixture; v.rows = v.rows.filter((r) => r.fixture !== name); return v; } },
      { label: 'a fixture smuggled in that the record never had', expect: 'FIXTURE_ADDED',
        mutate: (v) => { v.rows.push({ ...JSON.parse(JSON.stringify(victim(v.rows))), fixture: 'smuggled-in' }); return v; } },
      /**
       * The compensating swap. Every aggregate tally is identical afterwards,
       * which is precisely why comparing sums was not enough and why round 4
       * found this one by hand.
       */
      { label: "the competitor's catch moved to another fixture, tallies unchanged", expect: 'COMPETITOR_SCORE_MOVED',
        /* Swap TWO DEFECTIVE ROWS WHOSE COMPETITOR SCORES DIFFER, whatever those scores
           are. The original hunted for a CATCH/MISS pair by name and threw the moment the
           record stopped containing a CATCH, which happened as soon as a verdictless run
           stopped counting as one. A mutant that depends on the artifact holding a
           particular value is a mutant that disappears when the artifact changes, and it
           takes the gate's proof with it. MISS and n/a both contribute zero to the caught
           tally, so the swap still moves per-fixture scores with the tallies unchanged. */
        mutate: (v) => {
          const d = v.rows.filter((r) => !r.control);
          const a = d[0];
          const b = d.find((r) => r.testHookSh.score !== a.testHookSh.score);
          if (!b) throw new Error('every defective row carries the same competitor score, so no swap can move one');
          const keep = { ...a.testHookSh };
          a.testHookSh = { ...b.testHookSh };
          b.testHookSh = keep;
          return v;
        } },
    ],
  });
}

if (IS_MAIN) {
  const a = process.argv.slice(2);
  /* Same refusal as the published runner, and for the same reason: this one takes
     `--record`, so an unrecognised flag falling through would rewrite a committed
     measurement. The check is shared rather than reimplemented so the two cannot drift. */
  const bad = unknownFlags(a, ['--self-test', '--prove-can-fail', '--verify-record', '--record', '--json', '--out']);
  if (bad.length) {
    console.error(`unrecognised flag(s): ${bad.join(', ')}`);
    console.error('known flags: --self-test, --prove-can-fail, --verify-record, --record, --json, --out');
    console.error('Refusing to run rather than guessing: a mistyped flag once fell through to a');
    console.error('bench run that overwrote the committed record.');
    process.exit(2);
  }
  if (a.includes('--self-test')) process.exit(selfTest());
  if (a.includes('--prove-can-fail')) process.exit(proveCanFail());
  const rows = bench();
  if (a.includes('--verify-record')) {
    if (!existsSync(RESULTS)) { console.error(`no committed record at ${RESULTS}`); process.exit(1); }
    const diff = recordDiff(JSON.parse(readFileSync(RESULTS, 'utf8')), rows);
    const real = diff.filter((d) => !d.startsWith('NOTE'));
    for (const d of diff) console.log(`  ${d}`);
    if (real.length) {
      console.log(`\nRECORD DIVERGED: ${real.length} difference(s). Either the tool regressed or the published`);
      console.log('numbers are stale. Re-record deliberately with --record, and update');
      console.log('tests/results-prove-bench-validation.md in the same commit.');
      process.exit(1);
    }
    console.log(`\nPASS the committed record still reproduces (${tally(rows, 'prove').caught} of ${tally(rows, 'prove').of} with the correct diagnosis).`);
    process.exit(0);
  }
  const code = report(rows);
  if (a.includes('--json')) { console.log(JSON.stringify({ rows, prove: tally(rows, 'prove'), testHookSh: tally(rows, 'testHookSh') }, null, 2)); process.exit(code); }

  /**
   * WRITING THE RECORD IS OPT-IN, and it did not used to be.
   *
   * A plain run overwrote results.json, and `report()` returns non-zero only for a
   * dirty control or a wrong diagnosis, so a total prover collapse reported
   * "0 of 10", exited 0, and replaced the published record with the degraded
   * numbers. The write-up's own "Re-running it" section named that command.
   * Independent review 2026-08-08 called the previous fix half closed for exactly
   * that reason: --verify-record existed, and nothing made it the default path.
   *
   * So a bare run now REPORTS and writes nothing. Re-recording is `--record`, which
   * is a deliberate act, and it still refuses when the run would drop a tool column.
   */
  const oi = a.indexOf('--out');
  const wantsRecord = a.includes('--record');
  if (oi < 0 && !wantsRecord) {
    console.log('');
    console.log('Reported only; results.json was NOT written. Re-record deliberately with --record,');
    console.log('or check the committed record still reproduces with --verify-record.');
    process.exit(code);
  }
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
