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
        diags = (parsed.diagnostics || []).map(d => ({
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
    run({ home, project }) {
      const r = spawnTool(process.execPath,
        [join(ROOT, 'tools', 'extension-doctor.mjs'), '--home', home, '--project', project, '--json', '--no-delegate'],
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
    run({ home, project }) {
      const r = spawnTool(process.execPath,
        [join(ROOT, 'tools', 'extension-doctor.mjs'), '--home', home, '--project', project, '--json', '--delegate', bin('agnix')],
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

export function scoreCell(manifest, run) {
  if (run.notApplicable) return 'n/a';
  if (run.spawnError || run.timedOut) return 'crash';
  if (manifest.kind === 'clean') return run.findings > 0 ? 'FALSE-POS' : 'clean';
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

export function renderMatrix(results) {
  const tools = results.tools.filter(t => t.version);
  const L = [];
  L.push(`| Fixture | ${tools.map(t => t.label).join(' | ')} |`);
  L.push(`|---|${tools.map(() => '---').join('|')}|`);
  for (const f of results.fixtures) {
    L.push(`| ${f.id}${f.kind === 'control' ? ' (control)' : f.kind === 'clean' ? ' (clean)' : ''} | ${tools.map(t => f.cells[t.id] ?? 'skip').join(' | ')} |`);
  }
  L.push('');
  const modes = results.fixtures.filter(f => f.kind === 'failure-mode');
  L.push(`| Tool | Caught (of ${modes.length} failure modes) | Clean-tree false positives | Crashes |`);
  L.push('|---|---|---|---|');
  for (const t of tools) {
    const caught = modes.filter(f => f.cells[t.id] === 'catch').length;
    const fp = results.fixtures.filter(f => f.kind === 'clean' && f.cells[t.id] === 'FALSE-POS').length;
    const crash = results.fixtures.filter(f => f.cells[t.id] === 'crash').length;
    L.push(`| ${t.label} | ${caught} | ${fp} | ${crash} |`);
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

  const fake = {
    tools: [
      { id: 't1', label: 'fake-catcher', version: '1.0.0' },
      { id: 't2', label: 'fake-absent', version: null },
    ],
    fixtures: [
      { id: 'a', kind: 'failure-mode', cells: { t1: 'catch' } },
      { id: 'b', kind: 'failure-mode', cells: { t1: 'miss' } },
      { id: 'clean', kind: 'clean', cells: { t1: 'FALSE-POS' } },
    ],
  };
  const md = renderMatrix(fake);
  check('matrix includes installed tools only', md.includes('fake-catcher') && !md.includes('fake-absent'));
  check('matrix totals caught count correctly', md.includes('| fake-catcher | 1 | 1 | 0 |'), md.split('\n').pop());

  const fixtures = loadFixtures();
  check('all 15 fixtures load with manifests', fixtures.length === 15, `${fixtures.length}`);
  check('every failure-mode manifest carries a signal', fixtures.filter(f => f.manifest.kind === 'failure-mode').every(f => f.manifest.signal));
  check('every signal compiles as a regex', fixtures.every(f => { if (!f.manifest.signal) return true; try { new RegExp(f.manifest.signal, 'i'); return true; } catch { return false; } }));
  check('exactly one clean fixture', fixtures.filter(f => f.manifest.kind === 'clean').length === 1);
  check('exactly two controls', fixtures.filter(f => f.manifest.kind === 'control').length === 2);

  const gen = spawnSync(process.execPath, [join(HERE, 'make-fixtures.mjs'), '--check'], { encoding: 'utf8', windowsHide: true });
  check('fixtures match their generator (no drift)', gen.status === 0, (gen.stdout || '').trim().split(/\r?\n/).pop());

  console.log(bad ? `SELF-TEST FAIL: ${bad} check(s) failed` : 'SELF-TEST PASS: scoring, matrix and fixtures all behave.');
  process.exit(bad ? 1 : 0);
}

// --------------------------------------------------------------------- main --

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  if (argv.includes('--self-test')) selfTest();
  else main();
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
      try { run = t.run({ home, project }); }
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
  writeFileSync(RESULTS, JSON.stringify(results, null, 2) + '\n');
  console.log('\n' + renderMatrix(results));
  console.log(`\nRaw results: tests/lint-bench/results.json`);
}
