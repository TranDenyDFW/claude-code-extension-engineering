#!/usr/bin/env node
/**
 * Lint-bench runner: every installed tool against every fixture, results as
 * data, never as impressions.
 *
 *   node tests/lint-bench/run-bench.mjs --tools-dir <sandbox> [--only tool,tool]
 *   node tests/lint-bench/run-bench.mjs --self-test
 *
 * Isolation model. Each (tool, fixture) run copies the fixture to a temp dir
 * and spawns the tool with HOME and USERPROFILE pointed INTO the copy's home/
 * and cwd at its project/. Tools that hardwire os.homedir(), and the survey
 * found the biggest one does exactly that, therefore walk the fixture instead
 * of this machine's real config. The copy is hashed before and after, so a
 * tool that writes gets recorded as mutating rather than trusted as read-only.
 *
 * Scoring. A tool CATCHES a fixture when its combined output matches the
 * manifest's `signal` regex, which is phrased as concept words so a tool is
 * credited in its own vocabulary. On the clean fixture any parsed finding at
 * all is a FALSE POSITIVE, weighted exactly like a miss: a checker that cries
 * wolf gets ignored, which the repo has already paid to learn.
 *
 * Self-reporting: exits non-zero on runner failure; tool misses are DATA, not
 * failures.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, cpSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { tmpdir } from 'os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FIXTURES = join(HERE, 'fixtures');
const RESULTS = join(HERE, 'results.json');

const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const TOOLS_DIR = arg('--tools-dir');
const ONLY = arg('--only')?.split(',');
const TIMEOUT = 180_000;

// ------------------------------------------------------------------ helpers --

function hashTree(dir) {
  const h = createHash('sha256');
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) { h.update(`D:${e.name}`); walk(p); }
      else { h.update(`F:${e.name}:`); h.update(readFileSync(p)); }
    }
  };
  walk(dir);
  return h.digest('hex');
}

function loadFixtures() {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({
      id: e.name,
      dir: join(FIXTURES, e.name),
      manifest: JSON.parse(readFileSync(join(FIXTURES, e.name, 'manifest.json'), 'utf8')),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function bin(name) {
  if (!TOOLS_DIR) return null;
  for (const cand of [join(TOOLS_DIR, 'node_modules', '.bin', name + '.cmd'),
                      join(TOOLS_DIR, 'node_modules', '.bin', name + '.ps1'),
                      join(TOOLS_DIR, 'node_modules', '.bin', name)]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/**
 * Version probes run with HOME redirected to an EMPTY temp dir, never the real
 * one. This was learned the hard way: skill-validator has no --version flag,
 * so probing it with one ran its DEFAULT action, a full scan of the real
 * ~/.claude. Read-only, but a bench that promises isolation and leaks on the
 * version check has not kept the promise. Every probe now gets the same
 * blank-home treatment as a real run.
 */
let PROBE_HOME = null;
function probeEnv() {
  if (!PROBE_HOME) {
    PROBE_HOME = join(tmpdir(), `lint-bench-probe-${process.pid}`);
    mkdirSync(join(PROBE_HOME, '.claude'), { recursive: true });
  }
  return {
    PATH: process.env.PATH, PATHEXT: process.env.PATHEXT,
    SYSTEMROOT: process.env.SYSTEMROOT, COMSPEC: process.env.COMSPEC,
    TEMP: process.env.TEMP, TMP: process.env.TMP,
    HOME: PROBE_HOME, USERPROFILE: PROBE_HOME,
    NO_COLOR: '1', CI: '1', DO_NOT_TRACK: '1',
  };
}
function probe(cmd, args) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
    shell: typeof cmd === 'string' && cmd.endsWith('.cmd'),
    env: probeEnv(), cwd: PROBE_HOME,
  });
  return r;
}

function spawnTool(cmd, args, { home, cwd }) {
  // Minimal env: PATH so node resolves, TEMP for scratch, and the home
  // redirection that keeps every tool inside the fixture copy.
  const env = {
    PATH: process.env.PATH, PATHEXT: process.env.PATHEXT,
    SYSTEMROOT: process.env.SYSTEMROOT, COMSPEC: process.env.COMSPEC,
    TEMP: process.env.TEMP, TMP: process.env.TMP,
    HOME: home, USERPROFILE: home,
    NO_COLOR: '1', CI: '1', DO_NOT_TRACK: '1',
  };
  const r = spawnSync(cmd, args, {
    cwd, env, timeout: TIMEOUT, encoding: 'utf8', windowsHide: true,
    shell: cmd.endsWith('.cmd'),
  });
  return {
    exit: r.status,
    out: `${r.stdout || ''}\n${r.stderr || ''}`,
    timedOut: r.signal === 'SIGTERM' || (r.error && /ETIMEDOUT/.test(String(r.error))),
    spawnError: r.error ? String(r.error) : null,
  };
}

// -------------------------------------------------------------------- tools --

/**
 * Adapter contract: { id, label, detect() -> string|null (version or null when
 * absent), run(paths) -> { raw, exit, findings } } where findings is the
 * count of PARSED findings, used only for false-positive scoring on clean.
 */
const TOOL_DEFS = [
  {
    id: 'agnix',
    label: 'agnix (bare)',
    detect() {
      const b = bin('agnix');
      if (!b) return null;
      const r = probe(b, ['--version']);
      return (r.stdout || '').trim() || 'installed';
    },
    run({ home, project }) {
      const b = bin('agnix');
      const r = spawnTool(b, [home, project, '--format', 'json'], { home, cwd: project });
      let diags = null;
      try {
        const parsed = JSON.parse(r.out.slice(r.out.indexOf('{')));
        // Error level only. The fourth echo channel an independent review
        // found: agnix's warning-level CC-HK-010 complaint QUOTES the hook's
        // matcher value inside its own message ("at hooks.PreToolUse[matcher=
        // Bash|(]..."), so a style warning about timeouts scored a catch on
        // the bad-matcher fixture agnix never actually validated. Style
        // opinions do not attest defects; errors do. This mirrors how the
        // extension doctor consumes agnix when delegating.
        diags = (parsed.diagnostics || [])
          .filter(d => d.level === 'error')
          .map(d => ({
            file: d.file || '',
            text: `${d.rule || ''} ${d.message || ''} ${d.suggestion || ''}`,
          }));
      } catch { }
      return { ...r, diags, findings: diags ? fileAnchored(diags).length : 0 };
    },
  },
  {
    id: 'cct',
    label: 'claude-code-templates --health-check',
    detect() {
      const b = bin('claude-code-templates') || bin('cct') || bin('aitmpl');
      if (!b) return null;
      const r = probe(b, ['--version']);
      return (r.stdout || '').trim().split(/\r?\n/).pop() || 'installed';
    },
    run({ home, project }) {
      const b = bin('claude-code-templates') || bin('cct') || bin('aitmpl');
      // -y skips the interactive menu; without it the health check waits on
      // stdin forever, which is how the first full bench run hung.
      const r = spawnTool(b, ['--health-check', '-y'], { home, cwd: project });
      // Text-only tool: score against extracted finding LINES, not the whole
      // report. Its banner and section chrome carried words like "not found"
      // that counted as findings on a clean tree, and system-environment rows
      // (node version, RAM) are not about the fixture at all.
      const findingLines = r.out.split(/\r?\n/).filter(l =>
        /(❌|✗|✖|✘)/.test(l) || (/⚠|WARN/i.test(l) && /hook|skill|agent|setting|mcp|command|plugin/i.test(l)));
      return { ...r, findingLines, findings: findingLines.length };
    },
  },
  {
    id: 'cclint',
    label: 'cclint (felixgeelhaar)',
    detect() {
      const b = bin('cclint');
      if (!b) return null;
      const r = probe(b, ['--version']);
      return (r.stdout || '').trim() || 'installed';
    },
    run({ home, project }) {
      const b = bin('cclint');
      const r = spawnTool(b, ['lint', project, '--format', 'json'], { home, cwd: project });
      let diags = null;
      try {
        const j = JSON.parse(r.out.slice(r.out.indexOf('{')));
        diags = (j.results || []).flatMap(res => (res.violations || []).map(v => ({
          file: res.file || '',
          text: `${v.rule || v.ruleId || ''} ${v.message || ''}`,
        })));
      } catch { }
      return { ...r, diags, findings: diags ? fileAnchored(diags).length : 0 };
    },
  },
  {
    id: 'skill-validator',
    label: 'claude-skill-validator (aliksir)',
    detect() {
      const b = bin('skill-validator') || bin('claude-skill-validator');
      if (!b) return null;
      // No --version flag exists: an unknown flag runs the DEFAULT full scan
      // (against the blank probe home, thanks to probeEnv, but still noise).
      // The package manifest is the authoritative version anyway.
      try {
        return JSON.parse(readFileSync(join(TOOLS_DIR, 'node_modules', 'claude-skill-validator', 'package.json'), 'utf8')).version;
      } catch { return 'installed'; }
    },
    run({ home, project }) {
      const b = bin('skill-validator') || bin('claude-skill-validator');
      // No dry-run flag exists; the default mode validates without writing and
      // repair only happens under --update, which the bench never passes.
      const r = spawnTool(b, ['--dir', join(home, '.claude'), '--json'], { home, cwd: project });
      let diags = null;
      try {
        const j = JSON.parse(r.out.slice(r.out.indexOf('{')));
        diags = (j.results || [])
          .filter(x => x.status !== 'pass' && x.status !== 'PASS')
          .map(x => ({ file: x.file || x.path || x.skill || 'x.md', text: `${x.check || ''} ${x.message || x.detail || ''}` }));
      } catch { }
      return { ...r, diags, findings: diags ? diags.length : 0 };
    },
  },
  {
    id: 'plugin-validate',
    label: 'claude plugin validate (official)',
    detect() {
      const r = probe('claude', ['--version']);
      return r.status === 0 ? (r.stdout || '').trim() : null;
    },
    run({ home, project }) {
      // Only meaningful where the fixture contains a plugin directory.
      const findPlugin = base => {
        if (!existsSync(base)) return null;
        for (const e of readdirSync(base, { withFileTypes: true })) {
          if (e.isDirectory() && existsSync(join(base, e.name, '.claude-plugin', 'plugin.json'))) return join(base, e.name);
        }
        return null;
      };
      const target = findPlugin(project) || findPlugin(home);
      if (!target) return { exit: null, out: '(no plugin directory in fixture: not applicable)', findings: 0, notApplicable: true };
      const r = spawnTool('claude', ['plugin', 'validate', target], { home, cwd: project });
      // Score against the warning/error DETAIL lines only; the header echoes
      // the manifest path, which under the old raw-text scoring let the
      // fixture's own directory name fake a catch.
      const findingLines = r.out.split(/\r?\n/).filter(l =>
        /^\s*[>❯]\s+/.test(l) || (/validation failed/i.test(l)));
      return { ...r, findingLines, findings: findingLines.length };
    },
  },
  {
    id: 'doctor',
    label: 'extension-doctor (ours, bare)',
    detect() {
      return existsSync(join(ROOT, 'tools', 'extension-doctor.mjs')) ? 'workspace' : null;
    },
    run({ home, project, manifest }) {
      // A platform-conditional fixture pins the platform, or the row would
      // report the runner's OS instead of the defect. Competitor adapters have
      // no equivalent flag and are scored as they are: a Windows-only defect
      // they do not detect is a real miss, which is why this cohort is counted
      // separately from the published twelve.
      const plat = manifest && manifest.assumePlatform ? ['--assume-platform', manifest.assumePlatform] : [];
      const r = spawnTool(process.execPath,
        [join(ROOT, 'tools', 'extension-doctor.mjs'), '--home', home, '--project', project, '--json', '--no-delegate', ...plat],
        { home, cwd: project });
      let findings = 0;
      try { findings = (JSON.parse(r.out.slice(r.out.indexOf('{'))).findings || []).length; } catch { }
      return { ...r, findings };
    },
  },
  {
    id: 'doctor+agnix',
    label: 'extension-doctor + agnix (wrapper)',
    detect() {
      return existsSync(join(ROOT, 'tools', 'extension-doctor.mjs')) && bin('agnix') ? 'workspace+agnix' : null;
    },
    run({ home, project, manifest }) {
      const plat = manifest && manifest.assumePlatform ? ['--assume-platform', manifest.assumePlatform] : [];
      const r = spawnTool(process.execPath,
        [join(ROOT, 'tools', 'extension-doctor.mjs'), '--home', home, '--project', project, '--json', '--delegate', bin('agnix'), ...plat],
        { home, cwd: project });
      let findings = 0;
      try { findings = (JSON.parse(r.out.slice(r.out.indexOf('{'))).findings || []).length; } catch { }
      return { ...r, findings };
    },
  },
];

// ------------------------------------------------------------------ scoring --

/**
 * Diagnostics that name an actual FILE participate in scoring; run-level
 * boilerplate does not. This exists because the first agnix pass "caught"
 * plugin-version-pinned via a VER-001 info line agnix emits on EVERY run
 * ("No tool or spec versions pinned"), whose text collides with the fixture's
 * signal. A diagnostic about the run is not a diagnostic about the defect.
 */
export function fileAnchored(diags) {
  return diags.filter(d => /\.(md|json|mjs|js|cjs|ts|toml|ya?ml|sh|ps1)$/i.test(d.file || ''));
}

/**
 * Kinds on which ANY finding is a false positive. negative-control joins clean
 * here because the scoring rule is identical; it stays a separate KIND because
 * "the clean tree" is a specific published concept in the results matrix, and
 * folding a second tree into it would change what that published table counts
 * without anyone editing the table.
 */
const ZERO_FINDING_KINDS = new Set(['clean', 'negative-control']);

/** Kinds scored against a signal regex. late-failure-mode is scored exactly
 *  like failure-mode and TOTALLED separately: see renderMatrix. */
const SIGNAL_KINDS = new Set(['failure-mode', 'late-failure-mode', 'enforcement-failure-mode', 'control']);

export function scoreCell(manifest, run) {
  if (run.notApplicable) return 'n/a';
  if (run.spawnError || run.timedOut) return 'crash';
  if (ZERO_FINDING_KINDS.has(manifest.kind)) return run.findings > 0 ? 'FALSE-POS' : 'clean';
  // A kind this runner does not know about must be LOUD. Falling through would
  // score it against manifest.signal, and a zero-finding fixture carries signal
  // null, so the failure mode is `new RegExp(null)` matching the string "null"
  // in some tool's output and crediting a catch on a tree that must find
  // nothing. Adding a kind is a two-file change; this makes forgetting the
  // second file impossible instead of merely unlikely.
  if (!SIGNAL_KINDS.has(manifest.kind)) {
    throw new Error(`scoreCell: unknown fixture kind ${JSON.stringify(manifest.kind)}; add it to SIGNAL_KINDS or ZERO_FINDING_KINDS rather than letting it fall through to signal scoring`);
  }
  // Scoring text, strictest available first:
  //   1. structured diagnostics, file-anchored only (a tool that parsed the
  //      config and reported ZERO violations scores miss no matter what its
  //      prose says);
  //   2. extracted finding lines for text-only tools;
  //   3. raw output as the last resort.
  // The second full bench run showed why the raw fallback cannot be trusted
  // alone: tools echo the fixture's temp path, the path contained the fixture
  // id, and ids like settings-shadowing MATCH THEIR OWN SIGNAL. Four fake
  // catches from tools that had found nothing. Copy names are now neutral
  // (fx01...) as defense in depth, and the diag text EXCLUDES the file path.
  const text = run.diags ? fileAnchored(run.diags).map(d => d.text).join('\n')
    : run.findingLines ? run.findingLines.join('\n')
    : run.out;
  const re = new RegExp(manifest.signal, 'i');
  return re.test(text) ? 'catch' : 'miss';
}

const KIND_SUFFIX = {
  control: ' (control)',
  clean: ' (clean)',
  'negative-control': ' (negative control)',
  'late-failure-mode': ' (late)',
  'enforcement-failure-mode': ' (enforcement)',
};

export function renderMatrix(results) {
  const tools = results.tools.filter(t => t.version);
  const L = [];
  L.push(`| Fixture | ${tools.map(t => t.label).join(' | ')} |`);
  L.push(`|---|${tools.map(() => '---').join('|')}|`);
  for (const f of results.fixtures) {
    L.push(`| ${f.id}${KIND_SUFFIX[f.kind] || ''} | ${tools.map(t => f.cells[t.id] ?? 'skip').join(' | ')} |`);
  }
  L.push('');
  // THREE caught columns, not one. The published competitor numbers were
  // measured on the 12 original failure modes; the late and enforcement cohorts
  // landed afterwards and no competitor has ever been run against either.
  // Summing them would restate an unmeasured denominator as though it had been
  // measured, which is the same defect as moving a denominator silently.
  const modes = results.fixtures.filter(f => f.kind === 'failure-mode');
  const late = results.fixtures.filter(f => f.kind === 'late-failure-mode');
  const enf = results.fixtures.filter(f => f.kind === 'enforcement-failure-mode');
  L.push(`| Tool | Caught (of ${modes.length} published failure modes) | Caught (of ${late.length} late failure modes) | Caught (of ${enf.length} enforcement failure modes) | Clean-tree false positives | Negative-control false positives | Crashes |`);
  L.push('|---|---|---|---|---|---|---|');
  for (const t of tools) {
    const caught = modes.filter(f => f.cells[t.id] === 'catch').length;
    const caughtLate = late.filter(f => f.cells[t.id] === 'catch').length;
    const caughtEnf = enf.filter(f => f.cells[t.id] === 'catch').length;
    const fp = results.fixtures.filter(f => f.kind === 'clean' && f.cells[t.id] === 'FALSE-POS').length;
    const fpNeg = results.fixtures.filter(f => f.kind === 'negative-control' && f.cells[t.id] === 'FALSE-POS').length;
    const crash = results.fixtures.filter(f => f.cells[t.id] === 'crash').length;
    L.push(`| ${t.label} | ${caught} | ${caughtLate} | ${caughtEnf} | ${fp} | ${fpNeg} | ${crash} |`);
  }
  return L.join('\n');
}

// ---------------------------------------------------------------- self-test --

function selfTest() {
  let bad = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) bad++; };

  const m = { kind: 'failure-mode', signal: 'frontmatter|yaml' };
  check('a matching signal scores catch', scoreCell(m, { out: 'ERROR: YAML frontmatter failed to parse', findings: 1 }) === 'catch');
  check('a non-matching output scores miss', scoreCell(m, { out: 'All 5 files OK', findings: 0 }) === 'miss');
  check('a crash is scored crash, never catch', scoreCell(m, { out: 'yaml', spawnError: 'ENOENT', findings: 0 }) === 'crash');
  check('clean tree with findings scores FALSE-POS', scoreCell({ kind: 'clean' }, { out: 'x', findings: 3 }) === 'FALSE-POS');
  check('clean tree with zero findings scores clean', scoreCell({ kind: 'clean' }, { out: 'ok', findings: 0 }) === 'clean');
  check('not-applicable stays n/a', scoreCell(m, { notApplicable: true, out: '' }) === 'n/a');

  // negative-control scores by the CLEAN rule, not the signal rule. Its
  // manifest carries signal null, so a scorer that fell through to the signal
  // branch would throw on new RegExp(null) or, worse, credit a catch; both
  // failures are pinned here.
  check('negative-control with findings scores FALSE-POS',
    scoreCell({ kind: 'negative-control', signal: null }, { out: 'x', findings: 2 }) === 'FALSE-POS');
  check('negative-control with zero findings scores clean',
    scoreCell({ kind: 'negative-control', signal: null }, { out: 'all names resolve', findings: 0 }) === 'clean');
  check('an unknown fixture kind THROWS rather than falling through to signal scoring', (() => {
    try { scoreCell({ kind: 'made-up-kind', signal: null }, { out: 'null', findings: 0 }); return false; }
    catch (e) { return /unknown fixture kind/.test(e.message); }
  })());
  check('a late failure mode is scored by its signal, exactly like a failure mode',
    scoreCell({ kind: 'late-failure-mode', signal: 'cwd|working director' }, { out: 'resolved against the session working directory', findings: 1 }) === 'catch'
    && scoreCell({ kind: 'late-failure-mode', signal: 'cwd|working director' }, { out: 'no problems found', findings: 0 }) === 'miss');

  // The fake-catch defect the first agnix pass exposed: run-level boilerplate
  // whose text collides with a signal must not score a catch.
  const pin = { kind: 'failure-mode', signal: 'version.{0,50}pin|pinned' };
  const boilerplate = { out: 'irrelevant', findings: 0, diags: [{ file: '', text: 'VER-001 No tool or spec versions pinned. Pin versions in .agnix.toml' }] };
  check('run-level boilerplate cannot fake a catch', scoreCell(pin, boilerplate) === 'miss');
  const anchored = { out: 'irrelevant', findings: 1, diags: [{ file: 'x/.claude-plugin/plugin.json', text: 'CC-PL-003 version pinned blocks updates' }] };
  check('a file-anchored diagnostic still catches', scoreCell(pin, anchored) === 'catch');
  check('fileAnchored keeps files and drops directories and blanks',
    fileAnchored([{ file: 'a/settings.json', text: 't' }, { file: 'a/home', text: 't' }, { file: '', text: 't' }]).length === 1);

  // The fixture-name-in-path defect the second full run exposed: a tool that
  // parsed the config and reported ZERO violations must score miss even when
  // its raw output (an echoed temp path) contains the signal words.
  const shadow = { kind: 'failure-mode', signal: 'shadow|preceden|conflict' };
  const echoedPath = {
    out: 'checked C:/tmp/settings-shadowing--tool/project/.claude/settings.json OK',
    findings: 0,
    diags: [],
  };
  check('zero structured violations beats a signal-bearing echoed path', scoreCell(shadow, echoedPath) === 'miss');
  const lineTool = {
    out: 'BANNER shadow preceden conflict decorative text\n  OK: everything fine',
    findingLines: [],
    findings: 0,
  };
  check('empty findingLines beats signal-bearing banner text', scoreCell(shadow, lineTool) === 'miss');
  const lineToolHit = {
    out: 'banner',
    findingLines: ['  > settings.json: key shadowed by higher-precedence scope'],
    findings: 1,
  };
  check('a real finding line still catches', scoreCell(shadow, lineToolHit) === 'catch');
  check('diag scoring text excludes the file path itself',
    scoreCell(shadow, { out: '', findings: 1, diags: [{ file: 'x/settings-shadowing/settings.json', text: 'unrelated message' }] }) === 'miss');

  // The fourth echo channel, found by independent review: a diagnostic whose
  // MESSAGE quotes the defective config value. The agnix adapter now keeps
  // error-level diagnostics only, so a style warning echoing "matcher=Bash|("
  // must not reach scoring. Simulated at the scoreCell layer: the adapter
  // contract is that warnings never become diags.
  const matcherSig = { kind: 'failure-mode', signal: 'matcher|regex|invalid|compile|pattern' };
  check('a style warning echoing the defective value is not a catch once filtered out',
    scoreCell(matcherSig, { out: 'warning CC-HK-010 Command hook at hooks.PreToolUse[matcher=Bash|(].hooks[0] has no timeout', findings: 0, diags: [] }) === 'miss');

  const fake = {
    tools: [
      { id: 't1', label: 'fake-catcher', version: '1.0.0' },
      { id: 't2', label: 'fake-absent', version: null },
    ],
    // DELIBERATELY ASYMMETRIC: 2 published (1 caught) against 3 late (2 caught),
    // and one crash. A symmetric fake was tried first and could not fail: with
    // equal counts on both sides, a summary that read the WRONG cohort produced
    // the same row as one that read the right one, and the mutant that swapped
    // them stayed green. Every number below is distinct from every other.
    fixtures: [
      { id: 'a', kind: 'failure-mode', cells: { t1: 'catch' } },
      { id: 'b', kind: 'failure-mode', cells: { t1: 'miss' } },
      { id: 'c', kind: 'late-failure-mode', cells: { t1: 'catch' } },
      { id: 'd', kind: 'late-failure-mode', cells: { t1: 'catch' } },
      { id: 'e', kind: 'late-failure-mode', cells: { t1: 'crash' } },
      // 4 enforcement rows, 3 caught: a THIRD distinct count, for the same
      // reason the first two are distinct. With 3 here, no permutation of the
      // three cohort readers produces the same summary row.
      { id: 'f', kind: 'enforcement-failure-mode', cells: { t1: 'catch' } },
      { id: 'g', kind: 'enforcement-failure-mode', cells: { t1: 'catch' } },
      { id: 'h', kind: 'enforcement-failure-mode', cells: { t1: 'catch' } },
      { id: 'i', kind: 'enforcement-failure-mode', cells: { t1: 'miss' } },
      { id: 'clean', kind: 'clean', cells: { t1: 'FALSE-POS' } },
      { id: 'neg', kind: 'negative-control', cells: { t1: 'clean' } },
    ],
  };
  const md = renderMatrix(fake);
  check('matrix includes installed tools only', md.includes('fake-catcher') && !md.includes('fake-absent'));
  check('matrix totals published, late, enforcement, clean-FP, negative-control-FP and crashes separately',
    md.includes('| fake-catcher | 1 | 2 | 3 | 1 | 0 | 1 |'), md.split('\n').pop());
  check('the published failure-mode denominator counts ONLY the failure-mode kind',
    md.includes('Caught (of 2 published failure modes)') && md.includes('Caught (of 3 late failure modes)'),
    md.split('\n').find(l => l.includes('Caught')));
  check('a negative-control false positive is counted in its OWN column',
    renderMatrix({ ...fake, fixtures: fake.fixtures.map(f => f.id === 'neg' ? { ...f, cells: { t1: 'FALSE-POS' } } : f) })
      .includes('| fake-catcher | 1 | 2 | 3 | 1 | 1 | 1 |'));
  check('a late fixture is labelled in the matrix, so no reader mistakes it for a published cell',
    md.includes('| c (late) |') && md.includes('| neg (negative control) |'));

  const fixtures = loadFixtures();
  const byKind = k => fixtures.filter(f => f.manifest.kind === k).length;
  check('all 30 fixtures load with manifests', fixtures.length === 30, `${fixtures.length}`);
  check('every signal-scored manifest carries a signal',
    fixtures.filter(f => SIGNAL_KINDS.has(f.manifest.kind)).every(f => f.manifest.signal));
  check('every signal compiles as a regex', fixtures.every(f => { if (!f.manifest.signal) return true; try { new RegExp(f.manifest.signal, 'i'); return true; } catch { return false; } }));
  check('exactly 12 published failure modes, the cohort the competitor matrix was measured over',
    byKind('failure-mode') === 12, `${byKind('failure-mode')}`);
  check('exactly 5 late failure modes', byKind('late-failure-mode') === 5, `${byKind('late-failure-mode')}`);
  // A THIRD cohort, kept out of the published 12 for the same reason as the
  // late one: that number was measured against competitors before these existed.
  check('exactly 9 enforcement failure modes', byKind('enforcement-failure-mode') === 9, `${byKind('enforcement-failure-mode')}`);
  check('exactly one clean fixture', byKind('clean') === 1);
  check('exactly one negative control', byKind('negative-control') === 1, `${byKind('negative-control')}`);
  check('exactly two controls', byKind('control') === 2);
  check('every fixture kind is one this runner scores',
    fixtures.every(f => SIGNAL_KINDS.has(f.manifest.kind) || ZERO_FINDING_KINDS.has(f.manifest.kind)),
    fixtures.filter(f => !SIGNAL_KINDS.has(f.manifest.kind) && !ZERO_FINDING_KINDS.has(f.manifest.kind)).map(f => f.id).join(', '));
  // The zero-finding fixtures must carry signal null: a signal on a tree that
  // must produce nothing is a contradiction that would never be read again.
  check('zero-finding fixtures carry no signal',
    fixtures.filter(f => ZERO_FINDING_KINDS.has(f.manifest.kind)).every(f => f.manifest.signal === null));
  // The pin from make-fixtures: the two version-sensitive trees must carry
  // their own build marker, or their verdict is the host's, not the fixture's.
  for (const [id, v] of [['unresolvable-subagent-tools', '2.1.220'], ['future-tool-unverified', '2.1.222']]) {
    check(`${id} pins the build in-fixture (${v})`,
      existsSync(join(FIXTURES, id, 'home', '.local', 'share', 'claude', 'versions', v, 'marker')));
  }

  const gen = spawnSync(process.execPath, [join(HERE, 'make-fixtures.mjs'), '--check'], { encoding: 'utf8', windowsHide: true });
  check('fixtures match their generator (no drift)', gen.status === 0, (gen.stdout || '').trim().split(/\r?\n/).pop());

  console.log(bad ? `SELF-TEST FAIL: ${bad} check(s) failed` : 'SELF-TEST PASS: scoring, matrix and fixtures all behave.');
  process.exit(bad ? 1 : 0);
}

// --------------------------------------------------------------------- main --

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  if (argv.includes('--self-test')) selfTest();
  // main() returns 1 when it REFUSES to overwrite recorded evidence. That has to
  // reach the shell, or a run that wrote nothing reports success.
  else process.exit(main());
}

function main() {
  const fixtures = loadFixtures();
  const tools = TOOL_DEFS
    .filter(t => !ONLY || ONLY.includes(t.id))
    .map(t => ({ ...t, version: t.detect() }));

  console.log('Tools:');
  for (const t of tools) console.log(`  ${t.id.padEnd(16)} ${t.version ? t.version : 'NOT INSTALLED (skipped, recorded)'}`);

  const results = {
    date: new Date().toISOString().slice(0, 10),
    platform: process.platform,
    node: process.version,
    tools: tools.map(({ id, label, version }) => ({ id, label, version })),
    fixtures: [],
  };

  const scratch = join(tmpdir(), `lint-bench-${Date.now()}`);
  mkdirSync(scratch, { recursive: true });

  let fxN = 0;
  for (const f of fixtures) {
    fxN++;
    const row = { id: f.id, kind: f.manifest.kind, cells: {}, raw: {} };
    let tN = 0;
    for (const t of tools) {
      tN++;
      if (!t.version) { row.cells[t.id] = 'skip'; continue; }
      // Copy names are NEUTRAL on purpose: fixture ids describe their defect
      // ("settings-shadowing"), tools echo paths, and an echoed path that
      // contains the defect's own name matches the signal with zero findings.
      const copy = join(scratch, `fx${String(fxN).padStart(2, '0')}t${tN}`);
      cpSync(f.dir, copy, { recursive: true });
      const home = join(copy, 'home');
      const project = join(copy, 'project');
      mkdirSync(home, { recursive: true });
      mkdirSync(project, { recursive: true });
      const before = hashTree(copy);
      let run;
      try { run = t.run({ home, project, manifest: f.manifest }); }
      catch (err) { run = { out: String(err), spawnError: String(err), findings: 0 }; }
      const mutated = hashTree(copy) !== before;
      row.cells[t.id] = scoreCell(f.manifest, run);
      row.raw[t.id] = {
        exit: run.exit ?? null, findings: run.findings ?? 0, mutated,
        out: (run.out || '').slice(0, 4000),
      };
      if (mutated) row.raw[t.id].note = 'tool WROTE into the fixture copy';
      process.stdout.write(`  ${f.id.padEnd(30)} ${t.id.padEnd(16)} ${row.cells[t.id]}${mutated ? '  [mutated copy]' : ''}\n`);
    }
    results.fixtures.push(row);
  }

  rmSync(scratch, { recursive: true, force: true });

  /**
   * NEVER OVERWRITE RECORDED COMPETITOR EVIDENCE.
   *
   * results.json is not an output, it is the RECORD of a competitor run. Four of
   * the seven tools in the committed file are installed on the machine that
   * produced it and on no other, so re-running elsewhere writes a file where
   * those columns simply do not exist. That happened on 2026-08-05: a re-run
   * dropped the agnix 0.45.0 tool list, and the capability catalog anchors its
   * crosscheck AT THAT LIST, so the catalog failed verification, its load failed
   * soft as designed, and every capability name check silently degraded to
   * UNVERIFIED. One command, three layers of evidence gone, and no error.
   *
   * So the write refuses when this run would lose a tool the recorded file has
   * data for. --out sends a partial run somewhere else, which is the right home
   * for a cohort measured on a machine that lacks the competitors.
   */
  const outArg = arg('--out');
  const outPath = outArg ? resolve(outArg) : RESULTS;
  if (outPath === RESULTS && existsSync(RESULTS)) {
    let prior = null;
    try { prior = JSON.parse(readFileSync(RESULTS, 'utf8')); } catch { prior = null; }
    const lost = prior && Array.isArray(prior.tools)
      ? prior.tools.filter(t => t.version).map(t => t.id)
        .filter(id => !results.tools.some(t => t.id === id && t.version))
      : [];
    if (lost.length) {
      console.error('');
      console.error(`REFUSING to overwrite ${RESULTS}: this run would DROP recorded data for ${lost.join(', ')}.`);
      console.error('Those tools are not installed here, so their columns would vanish from the record');
      console.error('rather than be re-measured. The capability catalog anchors its crosscheck to that');
      console.error('data, and losing it silently degrades every name check to UNVERIFIED.');
      console.error('');
      console.error('Re-run on a machine with those tools installed, or send this run elsewhere:');
      console.error('  node tests/lint-bench/run-bench.mjs --out tests/lint-bench/results-<name>.json');
      console.log('\n' + renderMatrix(results));
      return 1;
    }
  }
  writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n');
  console.log('\n' + renderMatrix(results));
  console.log(`\nRaw results: ${outPath}`);
  return 0;
}
