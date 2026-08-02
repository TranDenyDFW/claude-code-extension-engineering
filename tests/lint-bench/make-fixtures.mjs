#!/usr/bin/env node
/**
 * Generates the lint-bench fixture trees deterministically.
 *
 *   node tests/lint-bench/make-fixtures.mjs           write fixtures/
 *   node tests/lint-bench/make-fixtures.mjs --check   re-derive and verify
 *
 * Fifteen cases: the twelve failure modes this repo's references document, two
 * positive controls that the incumbent linter documents catching (they verify
 * the RUNNER, not the tools), and one clean tree on which any finding at all
 * counts against a tool exactly like a miss.
 *
 * Every fixture is a home/ + project/ pair so scope-aware tools can see both
 * sides of a cross-scope defect. manifest.json carries the defect, the
 * citation behind it, and `signal`, a case-insensitive regex the bench runner
 * tests against a tool's raw output to decide catch versus miss. Signals are
 * deliberately loose (concept words, not exact messages) so a tool is credited
 * for catching the DEFECT in its own vocabulary, not for phrasing.
 *
 * Committed rather than gitignored so the bench is reproducible byte for byte;
 * --check is wired into the runner so drift fails rather than lurks.
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'fixtures');
const CHECK = process.argv.includes('--check');

const J = o => JSON.stringify(o, null, 2) + '\n';

/** A minimal valid skill, used wherever a fixture needs an innocent bystander. */
const GOOD_SKILL = (name, desc) => `---
name: ${name}
description: "${desc}"
---

# ${name}

Use the checked-in scripts. Read references/notes.md for the edge cases.
`;

const GOOD_AGENT = `---
name: log-reader
description: "Reads build logs and reports the first error line with its file and line number."
tools: ["Read", "Grep", "Glob"]
---

Read the log file you are given. Report the first error line verbatim.
`;

/** Valid settings with one working hook whose handler exists in the tree. */
const GOOD_SETTINGS = {
  model: 'claude-sonnet-5',
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'node .claude/hooks/audit.mjs' }],
      },
    ],
  },
};

const AUDIT_HOOK = `#!/usr/bin/env node
// Reads the tool call from stdin, logs the command, always allows.
let raw = '';
process.stdin.on('data', c => raw += c);
process.stdin.on('end', () => { process.exit(0); });
`;

// Long but under-cap description for the clean tree's realism.
const DESC_1300 = ('Reviewing pull requests for the payments service: check idempotency keys, ' +
  'retry semantics, ledger balancing, and the four invariants in docs/invariants.md. ').repeat(9).slice(0, 1300);

const FIXTURES = [
  {
    id: 'dead-skill-frontmatter',
    defect: 'SKILL.md description contains an unquoted colon-space, so the YAML frontmatter fails to parse and the skill loads with empty metadata; discovery degrades to the directory name alone',
    citation: 'skills.md "Frontmatter" [LOCAL_ENV]; IMPROVEMENTS.md item 19; tests/results-trigger.md (0%/16% recall until fixed)',
    signal: 'frontmatter|yaml|parse',
    files: {
      // The item 19 defect class byte for byte: plain scalar with ": " inside.
      'home/.claude/skills/data-tools/SKILL.md': `---
name: data-tools
description: Building or debugging data pipelines: use when a transform, splitter, or schema map misbehaves.
---

# Data tools

Open references/transforms.md before editing any splitter RULES block.
`,
    },
  },
  {
    id: 'over-cap-description',
    defect: 'description plus when_to_use exceeds the ~1536-character cap Claude Code truncates at, so the trigger surface silently loses its tail',
    citation: 'skills.md description cap [OFFICIAL]; suite row F021',
    signal: 'description.{0,40}(long|length|exceed|cap|limit|truncat)|1536|1024',
    files: {
      'home/.claude/skills/mega-skill/SKILL.md': `---
name: mega-skill
description: "${'Use this when working with the order-processing service, the invoicing service, the reconciliation batch, the settlement exporter, or any of their staging twins. '.repeat(9)}"
when_to_use: "${'Also whenever a ledger row disagrees with the exporter output. '.repeat(8)}"
---

# Mega skill

Body intentionally short.
`,
    },
  },
  {
    id: 'dup-skill-across-scopes',
    defect: 'the same skill name exists at user scope and project scope; one shadows the other and nothing reports which won',
    citation: 'skills.md scope shadowing [OFFICIAL]; /doctor only checks duplicates within one directory',
    signal: 'duplicate|shadow|collision|same name|both scopes',
    files: {
      'home/.claude/skills/deploy-helper/SKILL.md': GOOD_SKILL('deploy-helper', 'Deploying the web app to staging: bundles, uploads, and verifies the health endpoint.'),
      'project/.claude/skills/deploy-helper/SKILL.md': GOOD_SKILL('deploy-helper', 'Deploying THIS repo to its bespoke k8s namespace with the migration pre-step.'),
    },
  },
  {
    id: 'bad-hook-event',
    defect: 'settings.json registers a hook under a nonexistent event name (a one-letter typo), so the hook never fires and nothing says so',
    citation: 'hook-events.md event table [OFFICIAL]; hooks.md fail-open',
    signal: 'event|PreToolUsed|unknown|invalid|unrecognized',
    files: {
      'home/.claude/settings.json': J({
        hooks: {
          PreToolUsed: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/audit.mjs' }] },
          ],
        },
      }),
      'home/.claude/hooks/audit.mjs': AUDIT_HOOK,
    },
  },
  {
    id: 'bad-matcher-regex',
    defect: 'a hook matcher is a regex that does not compile, so the hook can never match and fails open silently',
    citation: 'hooks.md matcher semantics [OFFICIAL]; debug-your-config prose',
    signal: 'matcher|regex|invalid|compile|pattern',
    files: {
      'project/.claude/settings.json': J({
        hooks: {
          PreToolUse: [
            { matcher: 'Bash|(', hooks: [{ type: 'command', command: 'node .claude/hooks/audit.mjs' }] },
          ],
        },
      }),
      'project/.claude/hooks/audit.mjs': AUDIT_HOOK,
    },
  },
  {
    id: 'missing-hook-handler',
    defect: 'a command hook points at a handler file that does not exist; command hooks fail open, so the rule silently never enforces',
    citation: 'hooks.md failure policy [OFFICIAL]',
    signal: 'not found|missing|does not exist|no such file|handler|script',
    files: {
      'project/.claude/settings.json': J({
        hooks: {
          PreToolUse: [
            { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs"' }] },
          ],
        },
      }),
      // guard.mjs intentionally absent
    },
  },
  {
    id: 'disable-all-hooks',
    defect: 'disableAllHooks is set while hooks are configured: every hook in every file is off, there is no per-hook disable, and nothing warns',
    citation: 'selection.md tamper boundary [OFFICIAL]',
    signal: 'disableAllHooks|all hooks.{0,30}(off|disabled)|hooks.{0,20}disabled',
    files: {
      'home/.claude/settings.json': J({
        disableAllHooks: true,
        hooks: GOOD_SETTINGS.hooks,
      }),
      'home/.claude/hooks/audit.mjs': AUDIT_HOOK,
    },
  },
  {
    id: 'settings-shadowing',
    defect: 'the same key is set at user, project, and local scope with different values; precedence resolves it silently and no tool reports which file won',
    citation: 'settings precedence [OFFICIAL]; scope ladder gap measured in the ecosystem survey',
    signal: 'shadow|preceden|overrid|multiple (scopes|files)|conflict',
    files: {
      'home/.claude/settings.json': J({ model: 'claude-opus-5' }),
      'project/.claude/settings.json': J({ model: 'claude-sonnet-5' }),
      'project/.claude/settings.local.json': J({ model: 'claude-haiku-4-5-20251001' }),
    },
  },
  {
    id: 'unresolvable-subagent-tools',
    defect: 'an agent frontmatter tools list names a tool that does not exist; since v2.1.208 an unresolvable list refuses to spawn',
    citation: 'subagents.md tools resolution [OFFICIAL] [v2.1.208]',
    signal: 'tool|FrobnicateTool|unresolv|unknown|invalid',
    files: {
      'project/.claude/agents/checker.md': `---
name: checker
description: "Cross-checks generated reports against their source data and flags mismatched totals."
tools: ["Read", "Grep", "FrobnicateTool"]
---

Check every total in the report against the raw rows.
`,
    },
  },
  {
    id: 'memory-over-cap',
    defect: 'MEMORY.md index exceeds the 200-line cap; over-limit content errors rather than loading (v2.1.210+)',
    citation: 'official memory docs [OFFICIAL] [v2.1.210]; absent from every surveyed tool',
    signal: 'MEMORY\\.md.{0,60}(line|limit|cap|exceed|large)|200.{0,20}line|memory.{0,30}(limit|cap|exceed)',
    files: {
      'home/.claude/projects/P--sample-app/memory/MEMORY.md':
        '# Memory index\n\n' + Array.from({ length: 240 }, (_, i) => `- [note-${i}](note-${i}.md) - observation ${i} about the build`).join('\n') + '\n',
    },
  },
  {
    id: 'mcp-scope-collision',
    defect: 'the same MCP server name is configured at user scope and project scope with different commands; one silently wins and the loser looks configured',
    citation: 'mcp.md scopes [OFFICIAL]',
    signal: 'duplicate|collision|conflict|both scopes|same (server|name)|shadow',
    files: {
      'home/.claude.json': J({
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        },
      }),
      'project/.mcp.json': J({
        mcpServers: {
          github: { command: 'node', args: ['./tools/github-mcp-fork.mjs'] },
        },
      }),
    },
  },
  {
    id: 'plugin-version-pinned',
    defect: 'plugin.json pins a version string; the marketplace treats it as the cache key, so updates stop arriving until the string changes, while commit-SHA flow expects it omitted',
    citation: 'plugins.md versioning [OFFICIAL]; IMPROVEMENTS.md item 6 (measured on this repo)',
    signal: 'version.{0,50}(pin|block|stale|update|cache)|pinned',
    files: {
      'project/my-plugin/.claude-plugin/plugin.json': J({
        name: 'my-plugin',
        description: 'Adds the /deploy-verify command for the staging pipeline.',
        version: '1.0.0',
      }),
      'project/my-plugin/commands/deploy-verify.md': '---\ndescription: Verify the staging deploy end to end\n---\n\nRun the verify script and report PASS or FAIL.\n',
    },
  },
  // ---------------------------------------------------------------- controls --
  {
    id: 'control-array-matcher',
    control: true,
    defect: 'POSITIVE CONTROL: hook matcher is a JSON array, a schema error that rejects the whole settings file; the incumbent documents catching this, so a runner that reports it missed is broken',
    citation: 'debug-your-config [OFFICIAL]: array matcher rejects the whole file',
    signal: 'matcher|array|schema|invalid|string',
    files: {
      'project/.claude/settings.json': J({
        hooks: {
          PreToolUse: [
            { matcher: ['Bash', 'Edit'], hooks: [{ type: 'command', command: 'node .claude/hooks/audit.mjs' }] },
          ],
        },
      }),
      'project/.claude/hooks/audit.mjs': AUDIT_HOOK,
    },
  },
  {
    id: 'control-bad-skill-name',
    control: true,
    defect: 'POSITIVE CONTROL: skill name violates the documented kebab-case format; the incumbent documents catching this',
    citation: 'skills.md name format [OFFICIAL]',
    signal: 'name.{0,40}(format|invalid|kebab|case)|kebab',
    files: {
      'home/.claude/skills/My Fancy_Skill/SKILL.md': `---
name: My Fancy_Skill
description: "Formats release notes from the merged PR list."
---

# Release notes formatter
`,
    },
  },
  {
    id: 'clean',
    clean: true,
    defect: 'NONE. Valid settings with one working hook whose handler exists, one valid skill under every cap, one valid agent with resolvable tools, one MCP server at one scope. Any finding from any tool on this tree is a false positive',
    citation: 'n/a',
    signal: null,
    files: {
      'home/.claude/settings.json': J(GOOD_SETTINGS),
      'home/.claude/hooks/audit.mjs': AUDIT_HOOK,
      'home/.claude/skills/pr-review/SKILL.md': GOOD_SKILL('pr-review', DESC_1300.slice(0, 400)),
      'project/.claude/agents/log-reader.md': GOOD_AGENT,
      'project/.mcp.json': J({
        mcpServers: {
          docs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', './docs'] },
        },
      }),
    },
  },
];

function build() {
  const out = new Map();
  for (const f of FIXTURES) {
    out.set(join(f.id, 'manifest.json'), J({
      id: f.id,
      kind: f.clean ? 'clean' : f.control ? 'control' : 'failure-mode',
      defect: f.defect,
      citation: f.citation,
      signal: f.signal,
    }));
    for (const [rel, content] of Object.entries(f.files)) {
      out.set(join(f.id, rel), content);
    }
  }
  return out;
}

const derived = build();

if (CHECK) {
  let bad = 0;
  for (const [rel, want] of derived) {
    const p = join(OUT, rel);
    if (!existsSync(p)) { console.log(`FAIL missing ${rel}`); bad++; continue; }
    const got = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    if (got !== want.replace(/\r\n/g, '\n')) { console.log(`FAIL drift ${rel}`); bad++; }
  }
  // Anything on disk the generator does not derive is drift too.
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  if (existsSync(OUT)) {
    for (const p of walk(OUT)) {
      const rel = p.slice(OUT.length + 1);
      if (!derived.has(rel)) { console.log(`FAIL extra file ${rel}`); bad++; }
    }
  }
  console.log(bad ? `${bad} problem(s)` : `PASS: ${derived.size} fixture files match the generator.`);
  process.exit(bad ? 1 : 0);
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
for (const [rel, content] of derived) {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}
console.log(`Wrote ${derived.size} files across ${FIXTURES.length} fixtures to tests/lint-bench/fixtures/.`);
