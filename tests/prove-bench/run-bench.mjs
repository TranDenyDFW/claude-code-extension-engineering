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
 * all, and the published 10 of 10 versus 3 of 10 came out BYTE-IDENTICAL, because
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
        testHookSh: { ...thsh, score: score(man.control, thsh.exit) },
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
  if (gen.status !== 0) console.log('       ' + String(gen.stdout || gen.stderr).trim().split('\n')[0]);
  console.log(`\n${f === 0 ? 'SELF-TEST PASS' : `SELF-TEST FAIL (${f})`}`);
  return f === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  if (!existsSync(FIXTURES)) { console.error('no fixtures; run make-fixtures.mjs first'); process.exit(1); }
  const rows = bench();
  const code = report(rows, argv.includes('--json'));
  mkdirSync(join(HERE), { recursive: true });
  writeFileSync(join(HERE, 'results.json'), JSON.stringify(rows, null, 2) + '\n');
  process.exit(code);
}

if (IS_MAIN) main();
export { tally };
