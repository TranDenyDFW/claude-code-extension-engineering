# Plugins

> Claude Code 2.1.229, verified 2026-08-13. What that means here: this file carries NO verbatim quotes, so the quote gate says nothing about it; the capability surface moved to 44 current tools and held at 31 current hook events. 129 of 190 mirrored pages changed since 2.1.224 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading.


The packaging and distribution boundary. A plugin bundles any combination of skills, agents, hooks, MCP servers, commands, workflows, output styles, themes, monitors and LSP configuration, and ships them as one installable, versioned unit. Several component types, LSP among them, exist ONLY inside a plugin.

**Layer:** Packaging | **Classification:** primitive | **Status:** stable

## Decide a Plugin is justified

- Need reuse across projects / sharing / versioning / rollback?
- Prove each component independently FIRST, then bundle  [ENGINEERING BEST PRACTICE]  [ENGINEERING]

## Structure

- Namespacing: /plugin-name:skill (prevents conflicts)  [OFFICIAL]
- The manifest is OPTIONAL (components auto-discover, name comes from the directory). Once present, custom path fields REPLACE the default folder for commands, agents, workflows, outputStyles, experimental.themes and experimental.monitors - list the default explicitly to keep it. skills is the exception and ADDS [OFFICIAL]
- Marketplace installs are COPIED into ~/.claude/plugins/cache, not run in place: parent-path traversal breaks after install; within-plugin symlinks are preserved, same-marketplace ones dereferenced, outside-marketplace skipped. ${CLAUDE_PLUGIN_ROOT} CHANGES on every update - write persistent state only under ${CLAUDE_PLUGIN_DATA} [OFFICIAL]
- userConfig prompts for values at enable time (the sanctioned home for tokens, instead of telling users to hand-edit settings); pluginConfigs option values are no longer read from project settings since 2.1.207 (user, --settings, managed only); dependencies are enforced - enable force-enables transitively and disable refuses while a dependent is enabled (2.1.143) [OFFICIAL]  [v2.1.207]

## Local development + testing

- claude --plugin-dir ./my-plugin  (or --plugin-url zip)  [OFFICIAL]
- /reload-plugins to pick up edits without restart  [OFFICIAL]
- claude plugin validate  (same check the review pipeline runs)  [OFFICIAL]
- claude plugin init (introduced v2.1.157)  [OFFICIAL]  [v2.1.157]
- Skills-directory plugin: any folder under a skills dir with .claude-plugin/plugin.json loads as NAME@skills-dir next session, in place, no marketplace and no install. At project scope MCP needs per-server approval, LSP needs trust, and background monitors do NOT load; it does not walk up to the repo root [OFFICIAL]
- claude plugin validate: unrecognized top-level fields are WARNINGS and still load (wrong types still fail) - use --strict in CI or the gate is hollow [OFFICIAL]
- claude plugin details NAME reports the component inventory and projected token cost, split always-on (paid every session by listing text) vs on-invoke; defaultEnabled: false ships installed-but-disabled (v2.1.154+), and a user's enabledPlugins entry at any scope wins permanently thereafter [OFFICIAL]  [v2.1.154]

## Release flow

Run in order. Each step gates the next.

1. Every component passes its own tests, standalone.
2. Bundle into the plugin.
3. Install in a CLEAN environment, not the one you developed in.
4. Integration test: the components working together.
5. Namespace test: /plugin-name:skill resolves and collides with nothing.
6. Upgrade test: install over the previous version.
7. Rollback test: the previous pinned version is still installable.

## Distribution + versioning

- Two public marketplaces, and they are NOT reached the same way. claude-plugins-official is curated by Anthropic and registers itself on the first interactive start (a non-interactive script running before that first launch must add anthropics/claude-plugins-official explicitly). claude-community is where third-party submissions land after review; users add anthropics/claude-plugins-community and install from it as @claude-community  [OFFICIAL]  [v2.1.219]
- There is NO application process for the official marketplace. Anthropic decides what to include at its discretion, and the submission form does not add anything to it. Submitting only ever targets the community marketplace  [OFFICIAL]  [v2.1.219]
- Community submission is an authenticated IN-APP form, not a pull request, and which form depends on the account: claude.ai/admin-settings/directory/submissions/plugins/new needs a Team or Enterprise organization with directory management access (Owners have it by default), while individual authors outside such an org use platform.claude.com/plugins/submit  [OFFICIAL]  [v2.1.219]
- Run claude plugin validate ./your-plugin before submitting: the review pipeline runs the same check plus automated safety screening. Approved plugins are pinned to a specific commit SHA in the community catalog and CI bumps the pin as you push, but the public catalog syncs nightly, so approval and installability are not simultaneous  [OFFICIAL]  [v2.1.219]
- Neither listing is required to ship. Any repository carrying .claude-plugin/marketplace.json is its own marketplace: /plugin marketplace add owner/repo then /plugin install name@marketplace works with no review and no catalog entry  [ENGINEERING]  [v2.1.219]
- Versioning: explicit version bump, or pinned git commit SHA  [OFFICIAL]
- Version resolution order: plugin.json version, then the marketplace entry version, then the git commit SHA, then "unknown" for npm sources or non-git local directories. A pinned plugin.json version means pushed commits NEVER reach installed users until the string changes, and plugin.json silently wins over a marketplace-entry version, so never set both  [OFFICIAL]  [v2.1.220]
- The two official recommendations conflict at --strict: the docs say omit version to get commit-SHA updates, but claude plugin validate warns "No version specified" on an omitted version, and --strict promotes that advisory to a failure. A commit-SHA plugin therefore cannot pass validate --strict; gate CI on plain validate plus an assertion that the version advisory is the ONLY warning, so new warnings still fail  [ENGINEERING]  [v2.1.220]
- Compatibility + rollback: keep the previous pinned version installable

## Component inventory (current)

- Skills and legacy commands [OFFICIAL]
- Agents [OFFICIAL]
- Hooks [OFFICIAL]
- MCP servers [OFFICIAL]
- LSP servers [OFFICIAL]
- Monitors and themes: declare under experimental.*; top level still works but validate warns [OFFICIAL] [EXPERIMENTAL]
- Manifest, settings, executables, and supporting assets [OFFICIAL]
- Workflows (workflows/) [OFFICIAL]
- Output styles (output-styles/) [OFFICIAL]

## Compatibility profile

- claude plugin init introduced in v2.1.157 [OFFICIAL]  [v2.1.157]
- ZIP plugin loading requires v2.1.128+ [OFFICIAL]  [v2.1.128]
- Use claude --plugin-dir to load a local plugin directory during development [OFFICIAL]

## Manifest: .claude-plugin/plugin.json

| field | req | purpose |
|---|---|---|
| name | yes | identity + skill namespace (/name:skill) |
| description | no | shown in the plugin manager; recommended. The MANIFEST ITSELF is optional - components auto-discover and the name defaults to the directory - but once present, name is its only required field |
| version | no | bump to ship updates; else git SHA per commit |
| author, homepage, repository, license | no | attribution + metadata |


## Components live at the plugin ROOT, NOT inside .claude-plugin/

| dir / file | holds |
|---|---|
| skills/ | <name>/SKILL.md skills (preferred) |
| commands/ | flat-file skills (legacy) |
| agents/ | subagent definitions |
| hooks/hooks.json | event handlers |
| .mcp.json | MCP servers |
| .lsp.json | LSP servers |
| monitors/monitors.json | background monitors |
| bin/ | executables added to PATH |
| settings.json | default settings (agent, subagentStatusLine) |


## Worked example

**Layout.** The manifest is optional; components live at the plugin ROOT, not inside
`.claude-plugin/`.

```
my-plugin/
  .claude-plugin/plugin.json     optional manifest
  skills/<name>/SKILL.md
  agents/<name>.md
  commands/<name>.md
  workflows/<name>.js
  hooks/hooks.json
  .lsp.json
```

```json
{
  "name": "my-plugin",
  "description": "Team tooling",
  "version": "1.0.0"
}
```

`name` is the only required field once the manifest exists.

**`.lsp.json`**, keyed by language id:

```json
{
  "go": {
    "command": "gopls",
    "args": ["serve"],
    "extensionToLanguage": { ".go": "go" }
  }
}
```

The same object may be inlined in `plugin.json` under `lspServers`.


## Manifest path fields and collisions

- A custom path field accepts BOTH a string and an array: "skills": "./custom/skills/" and "commands": ["./custom/commands/special.md"] are both valid.  [v2.1.219]
- Replace-versus-add is per field. REPLACES the default folder: commands, agents, workflows, outputStyles, experimental.themes, experimental.monitors. ADDS to the default: skills, where skills/ is always scanned. Own merge rules: hooks, MCP servers, LSP servers.  [v2.1.219]
- Since v2.1.140 Claude Code WARNS when a plugin has both a default folder and the matching manifest key, so a silently orphaned default folder is surfaced rather than passing unnoticed.  [v2.1.140]
- With nested .claude/ directories the agent, workflow or output-style CLOSEST to the working directory wins a name collision.  [ANTHROPIC] [v2.1.219]

## Publishing to a marketplace

**Where it goes.** `.claude-plugin/marketplace.json` in a git repo. Teammates run
`/plugin marketplace add <repo>` then `/plugin install <name>`.

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "team-tools",
  "description": "Internal Claude Code plugins",
  "owner": { "name": "Platform Team", "url": "https://github.com/acme" },
  "plugins": [
    {
      "name": "deploy-kit",
      "description": "Deploy checklist, guard hooks, and the release workflow.",
      "source": "./",
      "category": "productivity",
      "author": "Platform Team",
      "homepage": "https://github.com/acme/deploy-kit",
      "version": "1.2.0"
    }
  ]
}
```

**Required:** `name` and `plugins` at the top level; `name` and `source` on every entry.
Everything else is optional.

**`source` takes three forms.** A relative path string for a plugin in the same repo, or an
object for anything else:

```json
"source": "./"
"source": { "source": "local", "path": "./plugin" }
"source": {
  "source": "git-subdir",
  "url": "https://github.com/acme/plugins.git",
  "path": "plugins/deploy-kit",
  "ref": "v1.5.5"
}
```

Pin `ref` (or a `sha`) for reproducible installs; without it teammates track the moving branch.

**Also seen in production marketplaces:** `strict`, `lspServers`, `displayName`, `tags`,
`keywords`, `metadata`, `id`.

- A marketplace is .claude-plugin/marketplace.json in a git repo. Only `name` and `plugins` are required at the top level, and only `name` and `source` on each entry.  [ANTHROPIC] [v2.1.219]
- `source` takes a relative path string for a same-repo plugin, or an object: {"source": "local", "path": "./plugin"} or {"source": "git-subdir", "url": ..., "path": ..., "ref": "v1.5.5"}. Pin `ref` or `sha` or teammates track a moving branch.  [ANTHROPIC] [v2.1.219]

## Detail

- A distribution/package layer: bundles skills, agents, hooks, MCP + LSP servers, monitors, and settings, versioned and shareable via a marketplace. It is a product lifecycle, not another prompt mechanism.
- Skill passes its tests, Hook passes its tests, Subagent passes its tests → only then bundle. Debugging a broken bundle is far harder than a proven part.  [ENGINEERING]
- Only plugin.json goes inside .claude-plugin/.

## Common failure modes / anti-patterns

- Putting components inside .claude-plugin/ (must be at root)
- Bundling unproven components
- No version → every commit is a new version
- Testing only from source, never a clean install
- No upgrade / rollback test
- Namespace collisions unhandled
- Shipping instructions in a plugin-root CLAUDE.md - it is NOT loaded as context; ship them as a Skill [OFFICIAL]
- Adding a custom path key and silently losing the default folder's components  [ENGINEERING]

## Definition of Done

- Manifest valid; components at root
- Each component passed its own tests first
- Clean-install integration test passes
- Namespacing verified
- Upgrade + rollback tested
- claude plugin validate passes
- README + version set
