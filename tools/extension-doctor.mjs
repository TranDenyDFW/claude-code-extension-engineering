#!/usr/bin/env node
/**
 * extension-doctor: walks a Claude Code configuration surface across scopes
 * and reports the silent-failure conditions this repo's references document,
 * each finding citing the reference behind it.
 *
 *   node tools/extension-doctor.mjs [--home <dir>] [--project <dir>] [--json]
 *                                   [--delegate <agnix-bin>] [--no-delegate]
 *   node tools/extension-doctor.mjs --self-test
 *
 * Division of labor, measured rather than asserted (tests/results-lint-bench.md):
 * per-file linting has a capable incumbent in agnix, so when it is available
 * its file-anchored diagnostics are ingested rather than reimplemented. What
 * nothing else does, and what this file is for, is the CROSS-SCOPE and
 * SEMANTIC layer: the same name at two scopes, a key silently shadowed by
 * precedence, a hook that can never fire, a config that is valid but inert on
 * the installed version.
 *
 * Read-only by construction: the only fs writes in this file are inside
 * --self-test's temp fixtures. Exit 1 when any BROKEN finding exists.
 */
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { homedir, tmpdir } from 'os';

const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ doc data --

/**
 * The 30 hook events on current builds. Source: hook-events.md, cross-checked
 * against code.claude.com/docs/en/hooks during the 2026-08-02 ecosystem survey
 * (Anthropic's own plugin-dev validator recognizes 9 of these; the 30k-star
 * health checker recognizes 4).
 */
export const HOOK_EVENTS = new Set([
  'SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse',
  'PermissionRequest', 'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch',
  'Notification', 'MessageDisplay', 'SubagentStart', 'SubagentStop', 'TaskCreated',
  'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle', 'InstructionsLoaded',
  'ConfigChange', 'CwdChanged', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove',
  'PreCompact', 'PostCompact', 'Elicitation', 'ElicitationResult', 'SessionEnd',
]);

/** Built-in tool names a subagent tools list may reference. mcp__* passes by prefix. */
export const KNOWN_TOOLS = new Set([
  'Agent', 'Artifact', 'AskUserQuestion', 'Bash', 'BashOutput', 'Edit', 'EnterPlanMode',
  'ExitPlanMode', 'Glob', 'Grep', 'KillShell', 'LS', 'ListMcpResourcesTool', 'Monitor',
  'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Read', 'ReadMcpResourceTool', 'SendMessage',
  'SendUserFile', 'Skill', 'SlashCommand', 'Task', 'TaskCreate', 'TaskGet', 'TaskList',
  'TaskOutput', 'TaskStop', 'TaskUpdate', 'TodoWrite', 'ToolSearch', 'WebFetch', 'WebSearch',
  'Workflow', 'Write',
]);

/** Skill description + when_to_use combined cap that Claude Code truncates at. */
export const DESC_CAP = 1536;
export const MEMORY_LINE_CAP = 200;
export const MEMORY_BYTE_CAP = 25 * 1024;

const CITE = {
  frontmatter: 'skills.md Frontmatter [LOCAL_ENV, measured 2026-07-30]: unparseable YAML loads with EMPTY metadata; this repo\'s own skill was dead for weeks this way (0%/16% trigger recall until fixed)',
  descCap: 'skills.md description cap [OFFICIAL]: description plus when_to_use truncates at ~1536 chars; the tail silently stops triggering',
  nameFormat: 'skills.md name format [OFFICIAL]: non-kebab-case names are silently ignored',
  dupSkill: 'skills.md scope shadowing [OFFICIAL]: same name at two scopes, one silently wins; /doctor only checks one directory',
  hookEvent: 'hook-events.md event table [OFFICIAL]: a hook under an unknown event never fires and nothing reports it',
  matcher: 'hooks.md matchers [OFFICIAL]: an array matcher is a schema error that rejects the WHOLE settings file; a bad regex never matches and fails open',
  handler: 'hooks.md failure policy [OFFICIAL]: command hooks fail OPEN, so a missing handler means the rule silently never enforces',
  disableAll: 'selection.md tamper boundary [OFFICIAL]: disableAllHooks switches every hook off and there is no per-hook disable',
  shadowing: 'settings precedence [OFFICIAL]: managed > CLI > local > project > user; the loser looks configured and does nothing',
  agentTools: 'subagents.md tools resolution [OFFICIAL] [v2.1.208]: an unresolvable tools list refuses to spawn',
  memoryCap: 'official memory docs [OFFICIAL] [v2.1.210]: MEMORY.md index over 200 lines errors instead of loading',
  mcpScope: 'mcp.md scopes [OFFICIAL]: same server name at two scopes, one config silently wins',
  versionPin: 'plugins.md versioning [OFFICIAL], IMPROVEMENTS.md item 6 (measured on this repo): a pinned version is the update cache key; updates stop until the string changes',
};

// ------------------------------------------------------------------- helpers --

const readText = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = p => { const t = readText(p); if (t === null) return { missing: true }; try { return { value: JSON.parse(t) }; } catch (e) { return { parseError: String(e.message) }; } };
const listDirs = p => { try { return readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } };
const listFiles = (p, re) => { try { return readdirSync(p).filter(f => re.test(f)); } catch { return []; } };

/**
 * Frontmatter strictness, scoped to the defect classes that actually kill
 * skills. Deliberately NOT a full YAML parser: it accepts everything a normal
 * frontmatter uses and flags the shapes real parsers reject, of which the
 * unquoted colon is the one that shipped in this very repo.
 *
 * The first version was single-line and the live calibration run immediately
 * produced two false positives on this machine's real skills: a LEGAL
 * multi-line double-quoted scalar (agent-memory-systems) and a LEGAL
 * zero-indent block sequence under tags:/tools: (claude-monitor). Both shapes
 * are now modeled. A doctor that cries wolf on valid config is worse than no
 * doctor; the clean-tree-zero-findings rule exists for exactly this.
 */
export function frontmatterProblems(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [{ kind: 'no-frontmatter', detail: 'no frontmatter block found' }];
  const problems = [];
  const fields = {};
  const lines = m[1].split('\n');
  let inQuote = null;      // quote char while inside a multi-line quoted scalar
  let inBlockScalar = false; // after key: | or key: >
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inQuote) {
      if (currentKey) fields[currentKey] += ' ' + line.trim().replace(new RegExp(inQuote + '\\s*$'), '');
      if (new RegExp(`${inQuote}\\s*$`).test(line)) inQuote = null;
      continue;
    }
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\t/.test(line)) { problems.push({ kind: 'tab-indent', detail: `line ${i + 1}: tab indentation is invalid YAML` }); continue; }
    if (/^\s+\S/.test(line)) {
      // Indented: block-scalar content, folded continuation, or nested
      // structure. Accumulate into the current field for cap measurement.
      if (currentKey && !/^\s+-\s/.test(line)) fields[currentKey] = (fields[currentKey] || '') + ' ' + line.trim();
      continue;
    }
    inBlockScalar = false;
    if (/^-\s/.test(line) || line === '-') continue; // zero-indent sequence item: legal
    const kv = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!kv) { problems.push({ kind: 'not-a-mapping', detail: `line ${i + 1}: not a key-value line` }); continue; }
    currentKey = kv[1];
    let v = kv[2].trim();
    fields[currentKey] = v;
    if (!v) continue;
    if (v === '|' || v === '>' || /^[|>][+-]?$/.test(v)) { inBlockScalar = true; fields[currentKey] = ''; continue; }
    if (v.startsWith('"') || v.startsWith("'")) {
      const q = v[0];
      if (v.length > 1 && v.endsWith(q) && !v.endsWith(`\\${q}`)) {
        fields[currentKey] = v.slice(1, -1);
      } else {
        inQuote = q;
        fields[currentKey] = v.slice(1);
      }
    } else if (v.startsWith('[') || v.startsWith('{')) {
      // flow collection: accepted
    } else {
      const noComment = v.replace(/\s#.*$/, '');
      if (/:\s/.test(noComment)) {
        // THE defect: a plain scalar containing colon-space is "mapping values
        // are not allowed here" in every real parser. Item 19, byte for byte.
        problems.push({ kind: 'unquoted-colon', detail: `line ${i + 1}: ${currentKey} is an unquoted scalar containing ": "; real YAML parsers reject this and the skill loads with EMPTY metadata. Quote the value.` });
      }
    }
  }
  if (inQuote) problems.push({ kind: 'unclosed-quote', detail: `${currentKey} opens a quote that never closes before the frontmatter ends` });
  return problems.length ? problems : Object.assign([], { fields });
}
export function frontmatterFields(text) {
  const r = frontmatterProblems(text);
  return r.fields || null;
}

// -------------------------------------------------------------------- checks --

function F(severity, check, where, what, fix, citation) {
  return { severity, check, where, what, fix, citation, source: 'doctor' };
}

export function runChecks({ home, project }) {
  const findings = [];
  const scopes = [];

  // ---- discovery -----------------------------------------------------------
  const managedPath = process.platform === 'win32'
    ? 'C:\\Program Files\\ClaudeCode\\managed-settings.json'
    : process.platform === 'darwin'
      ? '/Library/Application Support/ClaudeCode/managed-settings.json'
      : '/etc/claude-code/managed-settings.json';
  const settingsFiles = [
    { scope: 'managed', file: managedPath, base: dirname(managedPath) },
    { scope: 'user', file: join(home, '.claude', 'settings.json'), base: home },
    { scope: 'project', file: join(project, '.claude', 'settings.json'), base: project },
    { scope: 'local', file: join(project, '.claude', 'settings.local.json'), base: project },
  ].filter(s => existsSync(s.file));
  for (const s of settingsFiles) scopes.push({ scope: s.scope, file: s.file });

  const skillRoots = [
    { scope: 'user', dir: join(home, '.claude', 'skills') },
    { scope: 'project', dir: join(project, '.claude', 'skills') },
  ];
  const agentRoots = [
    { scope: 'user', dir: join(home, '.claude', 'agents') },
    { scope: 'project', dir: join(project, '.claude', 'agents') },
  ];

  // ---- skills: frontmatter, caps, name format, cross-scope duplicates ------
  const skillsByName = new Map();
  for (const root of skillRoots) {
    for (const d of listDirs(root.dir)) {
      const p = join(root.dir, d, 'SKILL.md');
      const text = readText(p);
      if (text === null) continue;
      const problems = frontmatterProblems(text);
      if (problems.length) {
        for (const pr of problems) {
          findings.push(F('BROKEN', 'skill-frontmatter', p,
            `frontmatter does not parse (${pr.kind}): ${pr.detail}`,
            'Fix the YAML; quote any value containing a colon. Then confirm the description shows in /skills.',
            CITE.frontmatter));
        }
        continue;
      }
      const f = frontmatterFields(text) || {};
      const name = f.name || d;
      const combined = (f.description || '').length + (f.when_to_use || '').length;
      if (combined > DESC_CAP) {
        findings.push(F('SILENT', 'skill-description-cap', p,
          `description plus when_to_use is ${combined} chars, past the ~${DESC_CAP} cap; the tail is silently truncated out of triggering`,
          'Cut the combined length under the cap; move detail into the body.',
          CITE.descCap));
      }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
        findings.push(F('BROKEN', 'skill-name-format', p,
          `skill name "${name}" is not kebab-case; Claude Code silently ignores it`,
          'Rename to lowercase-kebab-case and keep the directory in sync.',
          CITE.nameFormat));
      }
      if (!skillsByName.has(name)) skillsByName.set(name, []);
      skillsByName.get(name).push({ scope: root.scope, path: p });
    }
  }
  for (const [name, sites] of skillsByName) {
    if (sites.length > 1) {
      findings.push(F('SILENT', 'skill-duplicate-across-scopes', sites.map(s => s.path).join(' AND '),
        `skill "${name}" exists at ${sites.map(s => s.scope).join(' and ')} scope; one silently shadows the other`,
        'Rename one, or delete the one that should lose.',
        CITE.dupSkill));
    }
  }

  // ---- settings: parse, hooks, disableAllHooks, cross-scope shadowing ------
  const parsedSettings = [];
  for (const s of settingsFiles) {
    const r = readJson(s.file);
    if (r.parseError) {
      findings.push(F('BROKEN', 'settings-parse', s.file,
        `settings file does not parse: ${r.parseError}`,
        'Fix the JSON; the whole file is rejected as-is.',
        CITE.matcher));
      continue;
    }
    parsedSettings.push({ ...s, value: r.value });

    const hooks = r.value.hooks;
    const hookEventCount = hooks && typeof hooks === 'object' ? Object.keys(hooks).length : 0;

    if (r.value.disableAllHooks === true && hookEventCount > 0) {
      findings.push(F('SILENT', 'disable-all-hooks', s.file,
        `disableAllHooks is true while ${hookEventCount} hook event(s) are configured: every hook in every file is off`,
        'Remove disableAllHooks, or remove the dead hook config so the state is honest.',
        CITE.disableAll));
    }

    if (hooks && typeof hooks === 'object') {
      for (const [event, entries] of Object.entries(hooks)) {
        if (!HOOK_EVENTS.has(event)) {
          findings.push(F('BROKEN', 'hook-unknown-event', `${s.file} hooks.${event}`,
            `"${event}" is not a hook event on current builds; every hook under it never fires`,
            `Use a real event. Nearest guesses: ${[...HOOK_EVENTS].filter(e => e.toLowerCase().startsWith(event.slice(0, 4).toLowerCase())).join(', ') || 'see hook-events.md'}.`,
            CITE.hookEvent));
        }
        if (!Array.isArray(entries)) continue;
        entries.forEach((entry, i) => {
          const where = `${s.file} hooks.${event}[${i}]`;
          if (Array.isArray(entry.matcher)) {
            findings.push(F('BROKEN', 'hook-matcher-array', where,
              'matcher is a JSON array; this is a schema error and the WHOLE settings file is rejected, so no hook in it appears in /hooks',
              'Join alternatives into one regex string: "Bash|Edit".',
              CITE.matcher));
          } else if (typeof entry.matcher === 'string' && entry.matcher && entry.matcher !== '*') {
            // "*" is the documented match-everything wildcard, not a regex;
            // the first live run flagged it BROKEN while the hook wired with
            // it was demonstrably firing. Empty string also matches all.
            try { new RegExp(entry.matcher); } catch (e) {
              findings.push(F('BROKEN', 'hook-matcher-regex', where,
                `matcher "${entry.matcher}" does not compile as a regex (${e.message}); the hook can never match and fails open`,
                'Fix the pattern, or use "*" to match every tool.',
                CITE.matcher));
            }
          }
          for (const h of entry.hooks || []) {
            if (h.type !== 'command' || typeof h.command !== 'string') continue;
            const scriptTok = h.command.replace(/"/g, '').split(/\s+/).find(t => /\.(mjs|cjs|js|py|sh|ps1)$/i.test(t));
            if (!scriptTok) continue;
            const expanded = scriptTok
              .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, project)
              .replace(/^~[\\/]/, home + '/');
            const candidates = resolve(expanded) === expanded.replace(/[\\/]+/g, resolve(expanded).includes('\\') ? '\\' : '/') && /^([A-Za-z]:|\/)/.test(expanded)
              ? [expanded]
              : [join(project, expanded), join(s.base, expanded)];
            if (!candidates.some(c => existsSync(c))) {
              findings.push(F('SILENT', 'hook-handler-missing', where,
                `handler "${scriptTok}" not found (checked ${candidates.join(' and ')}); command hooks fail OPEN, so this rule silently never enforces`,
                'Create the file or fix the path; prefer $CLAUDE_PROJECT_DIR-anchored paths.',
                CITE.handler));
            }
          }
        });
      }
    }
  }

  // cross-scope shadowing on scalar top-level keys
  const PRECEDENCE = ['managed', 'local', 'project', 'user'];
  const keySites = new Map();
  for (const s of parsedSettings) {
    for (const [k, v] of Object.entries(s.value)) {
      if (typeof v === 'object' && v !== null) continue;
      if (!keySites.has(k)) keySites.set(k, []);
      keySites.get(k).push({ scope: s.scope, file: s.file, value: v });
    }
  }
  for (const [k, sites] of keySites) {
    const distinct = new Set(sites.map(s => JSON.stringify(s.value)));
    if (sites.length > 1 && distinct.size > 1) {
      const winner = sites.slice().sort((a, b) => PRECEDENCE.indexOf(a.scope) - PRECEDENCE.indexOf(b.scope))[0];
      findings.push(F('INFO', 'settings-shadowing', sites.map(s => `${s.scope}:${s.file}`).join(' AND '),
        `"${k}" is set at ${sites.map(s => `${s.scope}=${JSON.stringify(s.value)}`).join(', ')}; precedence resolves to ${winner.scope} (${JSON.stringify(winner.value)}) and the others silently do nothing`,
        'Keep the key at one scope, or make the shadowing intentional and documented.',
        CITE.shadowing));
    }
  }

  // ---- agents: frontmatter + tools resolution ------------------------------
  for (const root of agentRoots) {
    for (const f of listFiles(root.dir, /\.md$/)) {
      const p = join(root.dir, f);
      const text = readText(p);
      if (text === null) continue;
      const problems = frontmatterProblems(text);
      if (problems.length) {
        for (const pr of problems) {
          findings.push(F('BROKEN', 'agent-frontmatter', p,
            `frontmatter does not parse (${pr.kind}): ${pr.detail}`,
            'Fix the YAML.',
            CITE.frontmatter));
        }
        continue;
      }
      const fm = frontmatterFields(text) || {};
      const toolsRaw = fm.tools;
      if (toolsRaw) {
        let tools = [];
        try { tools = JSON.parse(toolsRaw.replace(/'/g, '"')); } catch { tools = toolsRaw.split(',').map(t => t.trim()).filter(Boolean); }
        for (const t of tools) {
          if (!KNOWN_TOOLS.has(t) && !/^mcp__/.test(t) && t !== '*') {
            findings.push(F('BROKEN', 'agent-unresolvable-tool', p,
              `tools lists "${t}", which is not a built-in tool or an mcp__ name; since v2.1.208 an unresolvable list refuses to spawn`,
              'Remove or correct the entry.',
              CITE.agentTools));
          }
        }
      }
    }
  }

  // ---- memory cap ----------------------------------------------------------
  const memFiles = [];
  const projRoot = join(home, '.claude', 'projects');
  for (const d of listDirs(projRoot)) {
    const p = join(projRoot, d, 'memory', 'MEMORY.md');
    if (existsSync(p)) memFiles.push(p);
  }
  const direct = join(home, '.claude', 'memory', 'MEMORY.md');
  if (existsSync(direct)) memFiles.push(direct);
  for (const p of memFiles) {
    const text = readText(p) || '';
    const lines = text.split(/\r?\n/).length;
    const bytes = Buffer.byteLength(text);
    if (lines > MEMORY_LINE_CAP || bytes > MEMORY_BYTE_CAP) {
      findings.push(F('SILENT', 'memory-over-cap', p,
        `MEMORY.md index is ${lines} lines / ${bytes} bytes, past the ${MEMORY_LINE_CAP}-line / ${MEMORY_BYTE_CAP}-byte cap; over-limit content errors instead of loading (v2.1.210+)`,
        'Move detail into per-topic files and keep MEMORY.md a one-line-per-memory index.',
        CITE.memoryCap));
    }
  }

  // ---- MCP scope collisions ------------------------------------------------
  const userMcp = readJson(join(home, '.claude.json')).value?.mcpServers || {};
  const projMcp = readJson(join(project, '.mcp.json')).value?.mcpServers || {};
  for (const name of Object.keys(userMcp)) {
    if (name in projMcp && JSON.stringify(userMcp[name]) !== JSON.stringify(projMcp[name])) {
      findings.push(F('SILENT', 'mcp-scope-collision', `${join(home, '.claude.json')} AND ${join(project, '.mcp.json')}`,
        `MCP server "${name}" is configured at user scope and project scope with DIFFERENT configs; one silently wins and the loser looks configured`,
        'Keep the server at one scope, or align the configs deliberately.',
        CITE.mcpScope));
    }
  }

  // ---- plugin version pinning ---------------------------------------------
  const pluginDirs = [];
  const scan = (base, depth) => {
    if (depth < 0 || !existsSync(base)) return;
    for (const d of listDirs(base)) {
      if (d === 'node_modules' || d.startsWith('.git')) continue;
      const pj = join(base, d, '.claude-plugin', 'plugin.json');
      if (existsSync(pj)) pluginDirs.push(pj);
      else scan(join(base, d), depth - 1);
    }
  };
  scan(project, 2);
  for (const pj of pluginDirs) {
    const r = readJson(pj);
    if (r.value && typeof r.value.version === 'string') {
      findings.push(F('INFO', 'plugin-version-pinned', pj,
        `plugin.json pins version "${r.value.version}"; the marketplace treats the version as the update cache key, so updates stop arriving until the string changes`,
        'Omit version to use commit-SHA flow, or bump it on every release without exception.',
        CITE.versionPin));
    }
  }

  return { scopes, findings };
}

// --------------------------------------------------------------- delegation --

export function delegateToAgnix(agnixBin, { home, project, allLevels = false }) {
  const r = spawnSync(agnixBin, [home, project, '--format', 'json'], {
    encoding: 'utf8', timeout: 120_000, windowsHide: true, shell: agnixBin.endsWith('.cmd'),
    env: { ...process.env, NO_COLOR: '1', DO_NOT_TRACK: '1' },
  });
  const out = `${r.stdout || ''}`;
  try {
    const parsed = JSON.parse(out.slice(out.indexOf('{')));
    return (parsed.diagnostics || [])
      .filter(d => /\.(md|json|mjs|js|cjs|ts|toml|ya?ml|sh|ps1)$/i.test(d.file || ''))
      // Errors only by default. agnix warnings include style opinions (a valid
      // hook with no timeout field draws CC-HK-010), and on the bench's clean
      // tree that made the WRAPPER throw a false positive our own checks never
      // would. Delegation exists to import agnix's hard failures, not its
      // taste; --delegate-all restores everything.
      .filter(d => allLevels || d.level === 'error')
      .map(d => ({
        severity: d.level === 'error' ? 'BROKEN' : d.level === 'warning' ? 'SILENT' : 'INFO',
        check: `agnix:${d.rule}`,
        where: `${d.file}:${d.line ?? 1}`,
        what: d.message,
        fix: d.suggestion || '',
        citation: `agnix ${d.rule} (agent-sh/agnix)`,
        source: 'agnix',
      }));
  } catch {
    return [{ severity: 'INFO', check: 'agnix:unparseable', where: agnixBin, what: `agnix output was not parseable JSON (exit ${r.status})`, fix: '', citation: '', source: 'agnix' }];
  }
}

// ---------------------------------------------------------------- self-test --

function selfTest() {
  let bad = 0;
  const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) bad++; };

  // The committed bench fixtures are the ground truth: every failure-mode
  // fixture must produce its check's finding, and the clean tree must produce
  // none. Gutting any check turns exactly its row red here.
  const FIX = join(HERE, '..', 'tests', 'lint-bench', 'fixtures');
  const EXPECT = {
    'dead-skill-frontmatter': 'skill-frontmatter',
    'over-cap-description': 'skill-description-cap',
    'dup-skill-across-scopes': 'skill-duplicate-across-scopes',
    'bad-hook-event': 'hook-unknown-event',
    'bad-matcher-regex': 'hook-matcher-regex',
    'missing-hook-handler': 'hook-handler-missing',
    'disable-all-hooks': 'disable-all-hooks',
    'settings-shadowing': 'settings-shadowing',
    'unresolvable-subagent-tools': 'agent-unresolvable-tool',
    'memory-over-cap': 'memory-over-cap',
    'mcp-scope-collision': 'mcp-scope-collision',
    'plugin-version-pinned': 'plugin-version-pinned',
    'control-array-matcher': 'hook-matcher-array',
    'control-bad-skill-name': 'skill-name-format',
  };
  for (const [fixture, checkId] of Object.entries(EXPECT)) {
    const dir = join(FIX, fixture);
    if (!existsSync(dir)) { check(`fixture ${fixture} exists`, false); continue; }
    const { findings } = runChecks({ home: join(dir, 'home'), project: join(dir, 'project') });
    const hit = findings.some(f => f.check === checkId);
    check(`${fixture} -> ${checkId}`, hit, hit ? '' : `got: ${[...new Set(findings.map(f => f.check))].join(', ') || 'nothing'}`);
  }
  {
    const dir = join(FIX, 'clean');
    const { findings } = runChecks({ home: join(dir, 'home'), project: join(dir, 'project') });
    check('clean tree yields ZERO findings', findings.length === 0,
      findings.length ? findings.map(f => f.check).join(', ') : '');
  }

  // Unit coverage for the frontmatter classifier: the defect shapes it must
  // catch, and the legal shapes the live calibration run proved it must NOT.
  check('unquoted colon-space is rejected', frontmatterProblems('---\nname: x\ndescription: a thing: with colon\n---\nbody').some(p => p.kind === 'unquoted-colon'));
  check('unclosed quote at frontmatter end is rejected', frontmatterProblems('---\ndescription: "half open\nstill open\n---\nbody').some(p => p.kind === 'unclosed-quote'));
  check('quoted colon passes', frontmatterProblems('---\ndescription: "a thing: quoted"\n---\nbody').length === 0);
  check('tab indentation is rejected', frontmatterProblems('---\n\tname: x\n---\nbody').some(p => p.kind === 'tab-indent'));
  check('fields are extracted from clean frontmatter', frontmatterFields('---\nname: ok-skill\ndescription: "fine"\n---\nbody')?.name === 'ok-skill');
  // The two live false positives, now modeled:
  check('a LEGAL multi-line quoted scalar passes (live FP #1)',
    frontmatterProblems('---\nname: x\ndescription: "Memory is the cornerstone. Without it, every\n  interaction starts from zero. It covers\n  memory: short-term and long-term."\n---\nbody').length === 0);
  check('a LEGAL zero-indent block sequence passes (live FP #2)',
    frontmatterProblems('---\nname: x\ntags:\n- monitoring\n- performance\ntools:\n- claude-code\n---\nbody').length === 0);
  check('colon-space INSIDE a multi-line quote is not flagged',
    !frontmatterProblems('---\ndescription: "first line\n  second: with colon"\n---\nbody').some(p => p.kind === 'unquoted-colon'));
  check('block scalar content is accepted and accumulated', (() => {
    const f = frontmatterFields('---\nname: x\ndescription: >-\n  folded line one\n  folded line two\n---\nbody');
    return f && /folded line one/.test(f.description) && /folded line two/.test(f.description);
  })());
  check('multi-line quoted description accumulates for cap measurement', (() => {
    const f = frontmatterFields('---\ndescription: "abc\n  def"\n---\nbody');
    return f && f.description.includes('abc') && f.description.includes('def');
  })());

  // The live false positive: matcher "*" is the documented wildcard and must
  // never be flagged, while a genuinely broken pattern still is.
  {
    const tmp = join(tmpdir(), `doctor-st-${Date.now()}`);
    mkdirSync(join(tmp, 'home', '.claude'), { recursive: true });
    mkdirSync(join(tmp, 'project'), { recursive: true });
    writeFileSync(join(tmp, 'home', '.claude', 'settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo ok' }] }] },
    }));
    const { findings } = runChecks({ home: join(tmp, 'home'), project: join(tmp, 'project') });
    check('matcher "*" wildcard is NOT flagged (live FP #3)', !findings.some(f => f.check === 'hook-matcher-regex'),
      findings.map(f => f.check).join(', '));
    rmSync(tmp, { recursive: true, force: true });
  }

  // Every finding must carry a citation: an uncited complaint is an opinion.
  {
    const dir = join(FIX, 'bad-hook-event');
    const { findings } = runChecks({ home: join(dir, 'home'), project: join(dir, 'project') });
    check('every finding carries a citation', findings.every(f => f.citation && f.citation.length > 10));
  }

  console.log(bad ? `SELF-TEST FAIL: ${bad} check(s) failed` : 'SELF-TEST PASS: every documented failure mode detected, clean tree silent.');
  process.exit(bad ? 1 : 0);
}

// --------------------------------------------------------------------- main --

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) main();

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

  const home = resolve(arg('--home') || homedir());
  const project = resolve(arg('--project') || process.cwd());
  const asJson = argv.includes('--json');

  const { scopes, findings } = runChecks({ home, project });

  let delegated = [];
  const explicit = arg('--delegate');
  const allLevels = argv.includes('--delegate-all');
  if (explicit) delegated = delegateToAgnix(explicit, { home, project, allLevels });
  else if (!argv.includes('--no-delegate')) {
    const probe = spawnSync('agnix', ['--version'], { encoding: 'utf8', timeout: 15_000, shell: true, windowsHide: true });
    if (probe.status === 0) delegated = delegateToAgnix('agnix', { home, project, allLevels });
  }
  const all = [...findings, ...delegated];

  if (asJson) {
    console.log(JSON.stringify({ home, project, scopes, findings: all }, null, 2));
  } else {
    console.log(`extension-doctor  home=${home}  project=${project}`);
    console.log(`scopes found: ${scopes.map(s => s.scope).join(', ') || 'none'}${delegated.length || explicit ? '  (agnix delegated)' : '  (agnix not found; per-file lint coverage reduced)'}`);
    console.log('');
    if (!all.length) console.log('No findings. All documented silent-failure conditions absent.');
    for (const f of all.sort((a, b) => ['BROKEN', 'SILENT', 'INFO'].indexOf(a.severity) - ['BROKEN', 'SILENT', 'INFO'].indexOf(b.severity))) {
      console.log(`${f.severity.padEnd(7)} [${f.check}] ${f.where}`);
      console.log(`        ${f.what}`);
      if (f.fix) console.log(`        fix: ${f.fix}`);
      if (f.citation) console.log(`        why: ${f.citation}`);
      console.log('');
    }
    const broken = all.filter(f => f.severity === 'BROKEN').length;
    console.log(`${all.length} finding(s): ${broken} BROKEN, ${all.filter(f => f.severity === 'SILENT').length} SILENT, ${all.filter(f => f.severity === 'INFO').length} INFO.`);
  }
  process.exit(all.some(f => f.severity === 'BROKEN') ? 1 : 0);
}
