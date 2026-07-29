# Choosing a mechanism

> Claude Code 2.1.219, verified 2026-07-26.


Answer the axis questions in order, then open the matching mechanism reference. Many real needs combine two or more mechanisms; the composition cards cover the pairings that actually work.

## Decision axes (ask in order)

- **Model judgment or deterministic enforcement?**
  - Judgment that varies by context → Skill (guidance the model reads). A rule that must always fire the same way → Hook (harness runs it, model cannot talk it out of it). Caveat below: hooks are no longer strictly mechanical.
  - go to: [Skills](skills.md)
  - go to: [Hooks](hooks.md)
  - Caveat: Too simple on current builds; see the nuance note. Hooks now carry judgment via prompt and agent handlers, and a skill can be forced into a subagent with context: fork. Choose by WHO must guarantee the outcome and WHERE it runs.
- **Automatic invocation or explicit user trigger?**
  - Auto when-relevant → Skill discovery (description) or a Hook (event). Only on demand → a user-invoked Skill with disable-model-invocation: true.
  - go to: [Skills](skills.md)
  - Caveat: Both answers are the same primitive. Set the mode in frontmatter: disable-model-invocation for on-demand only. This is not a choice between two mechanisms.
- **Main-agent behaviour or delegated isolated work?**
  - Shape the main thread → Skill / Hook. Offload a bounded job into its own context window with its own tools → Subagent.
  - go to: [Skills](skills.md)
  - go to: [Subagents](subagents.md)
- **One project, or reusable and shared?**
  - One repo → standalone .claude/. Shared, versioned, cross-project → Plugin.
  - go to: [CLAUDE.md family](claude-md-family.md)
  - go to: [Plugins](plugins.md)
- **Procedural knowledge or mechanically-enforceable policy?**
  - A procedure the model should follow → Skill. A checkable invariant (regex, exit code, file present) → Hook.
  - go to: [Skills](skills.md)
  - go to: [Hooks](hooks.md)
- **Need context isolation?**
  - Yes → Subagent (fresh window, returns only a summary).
  - go to: [Subagents](subagents.md)
- **Need tool restriction?**
  - Per-turn pre-approval → Skill allowed-tools. Hard capability limit for a delegated worker → Subagent tools / disallowedTools.
  - go to: [Skills](skills.md)
  - go to: [Subagents](subagents.md)
- **Behaviour tied to a lifecycle moment?**
  - Yes → Hook (before/after tool, prompt submit, session start/end, stop, compaction, ...).
  - go to: [Hooks](hooks.md)
- **Distribution, versioning, or rollback needed?**
  - Yes → Plugin (marketplace, pinned version).
  - go to: [Plugins](plugins.md)
- **Persistent every-session instruction, or path-scoped rule?**
  - Use CLAUDE.md for concise always-on project context; use .claude/rules for modular or path-scoped instruction sets.
  - go to: [CLAUDE.md family](claude-md-family.md)
- **Need external data or actions behind an authenticated boundary?**
  - Use MCP when Claude needs a governed connection to an external service.
  - go to: [MCP servers](mcp.md)
- **Need to fan work out across tens or hundreds of agents?**
  - go to: [Dynamic Workflows](workflows.md)
  - go to: [Subagents](subagents.md)
- **Need independent peers that communicate directly?**
  - Use Agent Teams only when subagent result-return is insufficient and coordination justifies the higher token cost.
  - go to: [Agent Teams](agent-teams.md)
  - Caveat: Agent Teams is EXPERIMENTAL and disabled by default; it needs CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1. It is the only mechanism here that is not stable, and coordination cost is high.
- **Need to change how Claude itself responds, not what it knows?**
  - go to: [Custom Output Styles](output-styles.md)
  - go to: [Skills](skills.md)
- **Need symbol-aware navigation or live language diagnostics?**
  - Use an LSP/code-intelligence plugin.
  - go to: [LSP / code intelligence](lsp.md)
  - Caveat: LSP has no standalone authoring path. It is configured only as a plugin component via .lsp.json or lspServers in plugin.json, so building one means building a plugin.
