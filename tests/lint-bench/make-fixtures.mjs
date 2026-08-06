#!/usr/bin/env node
/**
 * Generates the lint-bench fixture trees deterministically.
 *
 *   node tests/lint-bench/make-fixtures.mjs           write fixtures/
 *   node tests/lint-bench/make-fixtures.mjs --check   re-derive and verify
 *
 * Thirty cases in six kinds:
 *
 *   failure-mode       12  the failure modes this repo's references document,
 *                          and the ONLY cohort the published competitor matrix
 *                          in tests/results-lint-bench.md was measured over
 *   enforcement-failure-mode
 *                       9  permission-rule and sandbox failure modes added
 *                          2026-08-05, in a cohort of their own for the same
 *                          reason as the late cohort: the published competitor
 *                          matrix was measured before they existed
 *   late-failure-mode   5  monitor and channel failure modes added 2026-08-05,
 *                          after that competitor run. Scored exactly like a
 *                          failure mode, counted SEPARATELY, because "12 of 12"
 *                          is a published measurement and silently moving its
 *                          denominator would rewrite a number nobody re-measured
 *   control             2  positive controls the incumbent linter documents
 *                          catching; they verify the RUNNER, not the tools
 *   clean               1  a correctly authored tree on which any finding at all
 *                          counts against a tool exactly like a miss
 *   negative-control    1  a correctly authored tree whose names sit in the
 *                          version-asymmetry blind spot (build NEWER than the
 *                          capability catalog). Zero findings required, same as
 *                          clean. It is a separate kind rather than a second
 *                          clean tree because "the clean tree" is a specific
 *                          published concept in the results matrix, and
 *                          overloading it would change what that table means
 *                          without anyone editing the table.
 *
 * Every fixture is a home/ + project/ pair so scope-aware tools can see both
 * sides of a cross-scope defect. manifest.json carries the defect, the
 * citation behind it, and `signal`, a case-insensitive regex the bench runner
 * tests against a tool's raw output to decide catch versus miss. Signals are
 * deliberately loose (concept words, not exact messages) so a tool is credited
 * for catching the DEFECT in its own vocabulary, not for phrasing.
 *
 * VERSION PINNING. Two fixtures carry a marker under
 * home/.local/share/claude/versions/<version>/ so the build a scope-aware tool
 * detects comes from the FIXTURE, not from the machine running the bench. A
 * FILE inside a version-named directory, because git does not track empty
 * directories and a fixture that vanishes on clone is not a fixture.
 * unresolvable-subagent-tools pins 2.1.220, the build the capability catalog
 * covers, so its verdict stays BROKEN; future-tool-unverified pins 2.1.222 so
 * its verdict is taken in the regime where absence from the catalog proves
 * nothing.
 *
 * Committed rather than gitignored so the bench is reproducible byte for byte;
 * --check is wired into the runner so drift fails rather than lurks.
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { tmpdir } from 'os';

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

/**
 * A build marker inside home/. The installer's own store is
 * home/.local/share/claude/versions/<version>/, so the key is a FILE under a
 * version-named directory: git tracks files, not empty directories, and a
 * marker that disappeared on clone would silently hand the verdict back to
 * whatever build the CI box happens to have installed.
 */
const VERSION_MARKER = v => [`home/.local/share/claude/versions/${v}/marker`,
  `Fixture build pin. Present so a scope-aware tool detects ${v} from this tree instead of from the host.\n`];

/** A monitor script that EXISTS, so command-missing stays quiet and the check under test is isolated. */
const WATCH_SCRIPT = `#!/usr/bin/env node
// Prints one line per interesting event. Nothing here is under test; the file
// exists so "the script is missing" is not what a fixture accidentally proves.
process.stdout.write('ready\\n');
`;

const CHANNEL_SERVER = `#!/usr/bin/env node
// Stand-in channel server. Every check reads CONFIG, never this file's contents.
process.stdin.resume();
`;

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
    defect: 'an agent frontmatter tools list names a tool that does not exist; since v2.1.208 an unresolvable list refuses to spawn. The build is PINNED to 2.1.220 in-fixture, the build the capability catalog enumerates, because absence from a catalog is proof of nonexistence only on a build that catalog covers; without the pin this row would assert whatever the host has installed and would flip from BROKEN to UNVERIFIED on any box a release ahead',
    citation: 'subagents.md tools resolution [OFFICIAL] [v2.1.208]; data/capabilities/catalog.json versionAwareness (catalogVersion 2.1.220)',
    signal: 'tool|FrobnicateTool|unresolv|unknown|invalid',
    files: {
      [VERSION_MARKER('2.1.220')[0]]: VERSION_MARKER('2.1.220')[1],
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
  // ------------------------------------------------- late failure modes (5) --
  // Monitor and channel defects, added 2026-08-05 with the checks that catch
  // them. Only the checks that need a TREE to express live here: a defect that
  // is visible in one JSON blob is cheaper and sharper as a doctor unit
  // assertion, and a fixture tree that adds nothing over a unit test is upkeep
  // with no evidence attached to it.
  {
    id: 'monitor-user-config-ref',
    late: true,
    defect: 'a plugin monitor command interpolates ${user_config.*}; since v2.1.207 Claude Code REJECTS that monitor with an error instead of substituting, so this one component never starts while the rest of the plugin loads and looks healthy',
    citation: 'monitors.md Secrets and ${user_config.*} [OFFICIAL] [v2.1.207]; errors.md plugin-command-references-user-config',
    signal: 'user_config|substitut|reject',
    files: {
      'project/deploy-tools/.claude-plugin/plugin.json': J({
        name: 'deploy-tools',
        description: 'Watches the deploy pipeline and reports status changes into the session.',
        experimental: {
          monitors: [{
            name: 'deploy-status',
            command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/poll-deploy.mjs" --token "${user_config.api_token}"',
            description: 'Deployment status changes',
            when: 'always',
          }],
        },
      }),
      'project/deploy-tools/scripts/poll-deploy.mjs': WATCH_SCRIPT,
    },
  },
  {
    id: 'monitor-command-missing',
    late: true,
    defect: 'a monitor command names a script that is not in the plugin; fail-open is the only posture a monitor has, so a monitor that cannot start is indistinguishable from a monitor with nothing to report',
    citation: 'monitors.md No block or deny contract [ENGINEERING]: fail-open is the only posture available here',
    signal: 'not found|missing|does not exist|no such file|script',
    files: {
      'project/watch-tools/.claude-plugin/plugin.json': J({
        name: 'watch-tools',
        description: 'Streams the application error log into the session as notifications.',
        experimental: {
          monitors: [{
            name: 'error-log',
            command: 'sh "${CLAUDE_PLUGIN_ROOT}/scripts/tail-errors.sh"',
            description: 'Application error log',
            when: 'always',
          }],
        },
      }),
      // scripts/tail-errors.sh intentionally absent: that absence IS the defect.
      'project/watch-tools/README.md': 'The monitor script was renamed and the manifest was not updated.\n',
    },
  },
  {
    id: 'monitor-cwd-assumption',
    late: true,
    defect: 'a monitor command addresses its OWN bundled script through a relative path. Monitors run in the SESSION working directory, so the command only works when the user happens to start Claude Code inside the plugin. The co-presence is the whole point: poll.sh EXISTS under the plugin root, which is what separates this from the documented tail -F ./logs/error.log example, where the relative path legitimately means "the session cwd"',
    citation: 'monitors.md Lifecycle and working directory [OFFICIAL]: cwd is the SESSION working directory, NOT the plugin directory',
    signal: 'cwd|working director|relative path|session',
    files: {
      'project/log-tools/.claude-plugin/plugin.json': J({
        name: 'log-tools',
        description: 'Polls the build queue and reports each state change into the session.',
        experimental: {
          monitors: [{
            name: 'build-queue',
            command: 'sh poll.sh --interval 30',
            description: 'Build queue state changes',
            when: 'always',
          }],
        },
      }),
      // Present under the plugin root, addressed as if the cwd were the plugin.
      'project/log-tools/poll.sh': '#!/bin/sh\necho ready\n',
    },
  },
  {
    id: 'monitor-duplicate-name',
    late: true,
    defect: 'two monitor entries share one name in monitors/monitors.json; name is the dedup key, so a plugin reload or a repeat skill dispatch spawns duplicate processes instead of reusing one. Declared in the default FILE rather than inline, so the file-loading path is exercised by something',
    citation: 'monitors.md Configuration [OFFICIAL] [v2.1.105]: name is the identifier unique within the plugin and is the dedup key',
    signal: 'duplicate|same name|dedup|twice|two',
    files: {
      'project/queue-tools/.claude-plugin/plugin.json': J({
        name: 'queue-tools',
        description: 'Reports queue depth and worker health into the session as they change.',
      }),
      'project/queue-tools/monitors/monitors.json': J([
        {
          name: 'queue-watch',
          command: 'cd "${CLAUDE_PLUGIN_ROOT}" && node "${CLAUDE_PLUGIN_ROOT}/scripts/depth.mjs"',
          description: 'Queue depth crossing the alert threshold',
          when: 'always',
        },
        {
          name: 'queue-watch',
          command: 'cd "${CLAUDE_PLUGIN_ROOT}" && node "${CLAUDE_PLUGIN_ROOT}/scripts/workers.mjs"',
          description: 'Worker process health',
          when: 'always',
        },
      ]),
      'project/queue-tools/scripts/depth.mjs': WATCH_SCRIPT,
      'project/queue-tools/scripts/workers.mjs': WATCH_SCRIPT,
    },
  },
  {
    id: 'channel-server-unbound',
    late: true,
    defect: 'a plugin channel binds to an mcpServers key the plugin does not declare (one transposed character); with no entry Claude Code spawns no subprocess, so the listener never binds and the declaration binds to nothing',
    citation: 'channels.md The four gates [OFFICIAL] gate 2; plugins-reference Channels: the server field is required and must match a key in the plugin mcpServers',
    signal: 'channel|server|unbound|not a key|binds to nothing|mcpServers',
    files: {
      'project/alert-bridge/.claude-plugin/plugin.json': J({
        name: 'alert-bridge',
        description: 'Pushes alerts from the on-call webhook into the running session.',
        mcpServers: {
          alerts: { command: 'node', args: ['./servers/alerts.mjs'] },
        },
        channels: [{ server: 'alert' }],
      }),
      'project/alert-bridge/servers/alerts.mjs': CHANNEL_SERVER,
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
    defect: 'NONE. Valid settings with one working hook whose handler exists, one valid skill under every cap, one valid agent with resolvable tools, one MCP server at one scope, and one VALID plugin carrying a well-formed experimental.monitors array (unique names, every required field, an existing ${CLAUDE_PLUGIN_ROOT}-anchored script, a cd prefix, an on-skill-invoke naming a skill the plugin ships) plus a channels entry bound to a real mcpServers key. Any finding from any tool on this tree is a false positive',
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
      // The legitimate shape of everything the monitor and channel checks look
      // at. Without it those checks are only ever fed defects, the first live
      // run is the first time they meet a correct plugin, and the repo repeats
      // the false-positive history it already paid for once.
      'project/ops-tools/.claude-plugin/plugin.json': J({
        name: 'ops-tools',
        description: 'Watches the deploy pipeline and the build queue, and bridges on-call alerts into the session.',
        experimental: {
          monitors: [
            {
              name: 'deploy-status',
              command: 'cd "${CLAUDE_PLUGIN_ROOT}" && node "${CLAUDE_PLUGIN_ROOT}/scripts/poll-deploy.mjs"',
              description: 'Deployment status changes',
              when: 'always',
            },
            {
              name: 'build-queue',
              command: 'cd "${CLAUDE_PLUGIN_ROOT}" && node "${CLAUDE_PLUGIN_ROOT}/scripts/poll-queue.mjs"',
              description: 'Build queue depth crossing the alert threshold',
              when: 'on-skill-invoke:deploy-check',
            },
          ],
        },
        mcpServers: {
          alerts: { command: 'node', args: ['./servers/alerts.mjs'] },
        },
        channels: [{ server: 'alerts' }],
      }),
      'project/ops-tools/scripts/poll-deploy.mjs': WATCH_SCRIPT,
      'project/ops-tools/scripts/poll-queue.mjs': WATCH_SCRIPT,
      'project/ops-tools/servers/alerts.mjs': CHANNEL_SERVER,
      'project/ops-tools/skills/deploy-check/SKILL.md': GOOD_SKILL('deploy-check', 'Checking a deploy before and after it lands, including the queue drain and the health endpoint.'),
    },
  },
  {
    id: 'future-tool-unverified',
    negativeControl: true,
    defect: 'NONE, and that is the point. The build marker says 2.1.222, NEWER than the capability catalog, which is the regime where absence from the catalog proves nothing. Every name here is real: Read, PowerShell and ReportFindings are current tools, DirectoryAdded is a current hook event. Any finding is a false positive of exactly the class that shipped on 2026-08-02, when a hand-typed name list called 14 real tool names and 1 real hook event broken',
    citation: 'data/capabilities/catalog.json [GENERATED] versionAwareness; tools-reference.md PowerShell/ReportFindings rows; hooks.md DirectoryAdded section',
    signal: null,
    files: {
      [VERSION_MARKER('2.1.222')[0]]: VERSION_MARKER('2.1.222')[1],
      'home/.claude/settings.json': J({
        hooks: {
          DirectoryAdded: [
            { hooks: [{ type: 'command', command: 'node .claude/hooks/on-dir-added.mjs' }] },
          ],
        },
      }),
      'home/.claude/hooks/on-dir-added.mjs': AUDIT_HOOK,
      'project/.claude/agents/windows-helper.md': `---
name: windows-helper
description: "Runs Windows-native maintenance commands and reports the code-review findings it produces."
tools: ["Read", "PowerShell", "ReportFindings"]
---

Run the requested maintenance command and report what changed.
`,
    },
  },
  /**
   * ---- enforcement-failure-mode, 9 cases, added 2026-08-05 -----------------
   *
   * A NEW COHORT, not nine more failure modes. "12 of 12" in
   * tests/results-lint-bench.md is a published measurement against a competitor
   * run that happened before these existed, and quietly moving its denominator
   * would rewrite a number nobody re-measured. Same precedent as the late
   * cohort above.
   *
   * Two of the nine carry assumePlatform, because their defect is
   * platform-conditional: the sandbox does not run on native Windows, so the
   * fixture has to pin the platform or it would pass on this machine and fail
   * on the ubuntu runner, reporting the runner's OS instead of the defect.
   */
  {
    id: 'permission-rule-never-consulted',
    enforcement: true,
    defect: 'a Write(path) deny rule, which Claude Code accepts and NEVER CONSULTS, so the protection is a decoration while looking exactly right',
    citation: 'permissions.md The rule that is accepted and never consulted [OFFICIAL] [v2.1.210]',
    signal: 'never consult|not consulted|Edit\\(',
    files: {
      'project/.claude/settings.json': J({ permissions: { deny: ['Write(infra/**)'] } }),
    },
  },
  {
    id: 'permission-rule-glob-instead-of-read',
    enforcement: true,
    defect: 'a Glob(path) deny rule meant to stop searching a secrets tree; path rules are consulted for Edit and Read only, so this one enforces nothing',
    citation: 'permissions.md The rule that is accepted and never consulted [OFFICIAL] [v2.1.210]',
    signal: 'never consult|not consulted|Read\\(',
    files: {
      'project/.claude/settings.json': J({ permissions: { deny: ['Glob(secrets/**)'] } }),
    },
  },
  {
    id: 'permission-rule-content-field',
    enforcement: true,
    defect: "a deny rule matching on Bash's primary content field, which Claude Code ignores and warns about at startup because a compound command would bypass it",
    citation: 'permissions.md [OFFICIAL]: "A rule like Bash(command:rm *) would be bypassable by a compound command, so Claude Code ignores it"',
    signal: 'content field|ignore|Bash\\(rm',
    files: {
      'project/.claude/settings.json': J({ permissions: { deny: ['Bash(command:rm *)'] } }),
    },
  },
  {
    id: 'permission-rule-degenerate-glob',
    enforcement: true,
    defect: 'a deny rule whose glob contains a "." segment, so it matches no real path; this repo shipped exactly that defect when a sentence-final period was swallowed into an extracted target',
    citation: 'permissions.md [ENGINEERING]; IMPROVEMENTS.md item 31',
    signal: 'matches no|match nothing|degenerate|empty path segment',
    files: {
      'project/.claude/settings.json': J({ permissions: { deny: ['Edit(infra/./**)'] } }),
    },
  },
  {
    id: 'sandbox-enabled-on-windows',
    enforcement: true,
    assumePlatform: 'win32',
    defect: 'sandbox.enabled on native Windows, where the sandbox does not run; Claude Code warns and runs every command unsandboxed, so the key reads as protection and provides none',
    citation: 'sandboxing.md It does not run on Windows [OFFICIAL] [v2.1.220]',
    signal: 'Windows|unsupported platform|unsandboxed',
    files: {
      'home/.claude/settings.json': J({ sandbox: { enabled: true } }),
    },
  },
  {
    id: 'sandbox-fail-if-unavailable-in-repo',
    enforcement: true,
    defect: 'failIfUnavailable set in a CHECKED-IN project settings file; its documented home is managed settings, and if project scope is honoured this file stops Claude Code starting for every developer on an unsupported platform',
    citation: 'sandboxing.md failIfUnavailable [OFFICIAL] [v2.1.220]',
    signal: 'managed settings|failIfUnavailable|project scope|repository settings',
    files: {
      'project/.claude/settings.json': J({ sandbox: { failIfUnavailable: true } }),
    },
  },
  {
    id: 'sandbox-strict-allowlist-in-repo',
    enforcement: true,
    defect: 'strictAllowlist in a repository settings file, where the documentation says setting it "has no effect"; the policy is present, valid and inert',
    citation: 'sandboxing.md Scope restrictions [OFFICIAL] [v2.1.219]',
    signal: 'inert|no effect|repository settings|user, managed',
    files: {
      'project/.claude/settings.json': J({ sandbox: { strictAllowlist: true } }),
    },
  },
  {
    id: 'deny-rule-powershell-gap',
    enforcement: true,
    assumePlatform: 'win32',
    defect: 'a file deny rule beside a PowerShell allow; the documented file-command recognition names Bash and never PowerShell, and a PowerShell Add-Content write through a live Edit(...) deny rule was measured on 2.1.220',
    citation: 'permissions.md PowerShell [OFFICIAL] plus [LOCAL_ENV, measured 2026-08-05]',
    signal: 'PowerShell',
    files: {
      'project/.claude/settings.json': J({
        permissions: { deny: ['Edit(infra/**)'], allow: ['PowerShell(Get-ChildItem *)', 'PowerShell(Add-Content *)'] },
      }),
    },
  },
  {
    id: 'sandbox-scalar-shadowed-across-scopes',
    enforcement: true,
    defect: 'sandbox.enabled set true at user scope and false at project scope; it is a nested SCALAR so exactly one wins and the other silently does nothing, unlike the permission ARRAYS beside it which merge',
    citation: 'settings precedence [OFFICIAL]: managed > CLI > local > project > user',
    signal: 'shadow|precedence|silently does nothing',
    files: {
      'home/.claude/settings.json': J({ sandbox: { enabled: true }, permissions: { deny: ['Edit(a/**)'] } }),
      'project/.claude/settings.json': J({ sandbox: { enabled: false }, permissions: { deny: ['Edit(b/**)'] } }),
    },
  },
];

export const kindOf = f =>
  f.clean ? 'clean'
  : f.negativeControl ? 'negative-control'
  : f.control ? 'control'
  : f.enforcement ? 'enforcement-failure-mode'
  : f.late ? 'late-failure-mode'
  : 'failure-mode';

function build() {
  const out = new Map();
  for (const f of FIXTURES) {
    out.set(join(f.id, 'manifest.json'), J({
      id: f.id,
      kind: kindOf(f),
      defect: f.defect,
      citation: f.citation,
      signal: f.signal,
      // Only present on a platform-conditional fixture. The runner passes it to
      // the doctor as --assume-platform, so the row measures the defect rather
      // than whichever OS the CI runner happens to be.
      ...(f.assumePlatform ? { assumePlatform: f.assumePlatform } : {}),
    }));
    for (const [rel, content] of Object.entries(f.files)) {
      out.set(join(f.id, rel), content);
    }
  }
  return out;
}

const derived = build();

const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

/** Materialize the derived map under `root`. The only writer in this file. */
function materialize(root) {
  for (const [rel, content] of derived) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
}

/** Content fingerprint of a tree, used to PROVE --check wrote nothing into it. */
function fingerprint(dir) {
  if (!existsSync(dir)) return 'ABSENT';
  const h = createHash('sha256');
  for (const p of walk(dir).sort()) {
    h.update(p.slice(dir.length + 1).replace(/\\/g, '/'));
    h.update(readFileSync(p));
  }
  return h.digest('hex');
}

if (CHECK) {
  // --check BUILDS INTO A TEMP DIR and compares. Two reasons it is not an
  // in-memory string compare: the temp build exercises the same writer the
  // committed tree came from, so a bug in the writer cannot hide behind a
  // comparison that never calls it; and the committed tree is read-only here by
  // construction, since the only write path points somewhere else. A drift gate
  // that can repair the drift it detects reports nothing but its own last run.
  const before = fingerprint(OUT);
  const tmp = join(tmpdir(), `lint-bench-check-${process.pid}-${Date.now()}`);
  let bad = 0;
  try {
    materialize(tmp);
    const built = new Map();
    for (const p of walk(tmp)) built.set(p.slice(tmp.length + 1), readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));

    for (const [rel, want] of built) {
      const p = join(OUT, rel);
      if (!existsSync(p)) { console.log(`FAIL missing ${rel}`); bad++; continue; }
      const got = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
      if (got !== want) { console.log(`FAIL drift ${rel}`); bad++; }
    }
    // Anything on disk the generator does not derive is drift too.
    if (existsSync(OUT)) {
      for (const p of walk(OUT)) {
        const rel = p.slice(OUT.length + 1);
        if (!built.has(rel)) { console.log(`FAIL extra file ${rel}`); bad++; }
      }
    }
    if (fingerprint(OUT) !== before) {
      console.log('FAIL --check MUTATED the committed fixtures; a drift gate must never repair the drift it detects');
      bad++;
    }
    console.log(bad ? `${bad} problem(s)` : `PASS: ${built.size} fixture files match the generator.`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(bad ? 1 : 0);
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
materialize(OUT);
console.log(`Wrote ${derived.size} files across ${FIXTURES.length} fixtures to tests/lint-bench/fixtures/.`);
