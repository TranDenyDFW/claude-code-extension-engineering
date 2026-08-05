---
name: claude-code-extension-engineering
description: "Building or debugging a Claude Code extension: CLAUDE.md, rules, skills, hooks, subagents, dynamic workflows, agent teams, MCP servers, output styles, plugins, or the Agent SDK. Use when choosing between these mechanisms, writing one, or diagnosing one that will not load, fire, or behave."
---

# Claude Code extension engineering

Twelve authored extension mechanisms across seven layers, plus a cross-referenced
programmatic tier (Agent SDK, GitHub Action). Pick the mechanism first, then open its
reference: choosing wrong is the expensive mistake, and most of these look
interchangeable until you need one to guarantee something.

Two questions decide most cases. **Who owns enforcement**, the model or the harness? And
**where must it run**, this context or an isolated one? Ownership is not a guarantee:
even harness-owned enforcement has a failure policy (fail-open, fail-closed, advisory)
and a tamper boundary (user-, project-, or managed-policy-configurable), and neither
axis is a clean split any more (hooks can carry judgment, skills can be forced into a
subagent), so check `selection.md` before committing to one.

## Where to look

| Need | Open |
|---|---|
| Auto memory | [auto-memory.md](references/auto-memory.md) |
| CLAUDE.md family | [claude-md-family.md](references/claude-md-family.md) |
| Compatibility | [compatibility.md](references/compatibility.md) |
| Custom Output Styles | [output-styles.md](references/output-styles.md) |
| Custom Themes | [themes.md](references/themes.md) |
| Skills | [skills.md](references/skills.md) |
| Testing and iteration | [testing.md](references/testing.md) |
| Hooks | [hooks.md](references/hooks.md) |
| Monitors [EXPERIMENTAL] | [monitors.md](references/monitors.md) |
| Context modes | [context-modes.md](references/context-modes.md) |
| Subagents | [subagents.md](references/subagents.md) |
| Agent Teams [EXPERIMENTAL] | [agent-teams.md](references/agent-teams.md) |
| Dynamic Workflows | [workflows.md](references/workflows.md) |
| MCP servers | [mcp.md](references/mcp.md) |
| Channels [EXPERIMENTAL] | [channels.md](references/channels.md) |
| LSP / code intelligence | [lsp.md](references/lsp.md) |
| Plugins | [plugins.md](references/plugins.md) |
| Agent SDK | [agent-sdk.md](references/agent-sdk.md) |
| Claude Code GitHub Action | [github-action.md](references/github-action.md) |
| Choosing between them | [selection.md](references/selection.md) |
| Combining two mechanisms | [composition-cards.md](references/composition-cards.md) |
| Hook event contracts | [hook-events.md](references/hook-events.md) |
| Evidence sources | [sources.md](references/sources.md) |

Claims are tagged by evidence: untagged is official documentation, `[ANTHROPIC]` is an
Anthropic recommendation, `[ENGINEERING]` is engineering judgment, `[COMMUNITY]` is
community practice. A `[vX.Y.Z]` tag is the build a behaviour was verified against;
`[EXPERIMENTAL]` means NOT STABLE, in either of two senses: off by default until a flag or
env var turns it on (Agent Teams), or on the moment it is configured but carrying a manifest
schema, flag syntax or protocol contract documented as liable to change between releases
(Monitors, which auto-arm with the plugin and have no off switch; Channels, a research
preview). Reading the tag as "off by default" everywhere is wrong in both directions: it
implies a switch that does not exist and hides a compatibility risk that does.
