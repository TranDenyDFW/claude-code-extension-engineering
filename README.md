# claude-code-extension-engineering

A Claude Code skill for building and debugging Claude Code extensions.

Ten authored extension mechanisms across seven layers, plus a cross-referenced programmatic
tier (Agent SDK, GitHub Action). The skill's job is to make you pick the mechanism *before*
you write it: most of these look interchangeable until you need one to guarantee something,
and choosing wrong is the expensive mistake. Two questions decide most cases. Who must
guarantee the outcome, the harness or the model? And where must it run, this context or an
isolated one?

## Install

**Personal (all projects):**

```bash
git clone https://github.com/TranDenyDFW/claude-code-extension-engineering.git ~/.claude/skills/claude-code-extension-engineering
```

**Project-scoped (this repo only):**

```bash
git clone https://github.com/TranDenyDFW/claude-code-extension-engineering.git .claude/skills/claude-code-extension-engineering
```

**Without git:** download the source zip from the GitHub UI and unpack it into either
location. The directory name must be `claude-code-extension-engineering`.

Verify with `/skills` in Claude Code, or just describe an extension problem and let the
model route to it.

> Note: Cowork and cloud sessions do not read `~/.claude/skills`, so a personally installed
> skill reports "not found" on a scheduled run. See
> [references/compatibility.md](references/compatibility.md) for the details.

## What is inside

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
| Context modes | [context-modes.md](references/context-modes.md) |
| Subagents | [subagents.md](references/subagents.md) |
| Agent Teams [EXPERIMENTAL] | [agent-teams.md](references/agent-teams.md) |
| Dynamic Workflows | [workflows.md](references/workflows.md) |
| MCP servers | [mcp.md](references/mcp.md) |
| LSP / code intelligence | [lsp.md](references/lsp.md) |
| Plugins | [plugins.md](references/plugins.md) |
| Agent SDK | [agent-sdk.md](references/agent-sdk.md) |
| Claude Code GitHub Action | [github-action.md](references/github-action.md) |
| Choosing between them | [selection.md](references/selection.md) |
| Combining two mechanisms | [composition-cards.md](references/composition-cards.md) |
| Hook event contracts | [hook-events.md](references/hook-events.md) |
| Evidence sources | [sources.md](references/sources.md) |

Start at [SKILL.md](SKILL.md) or, if you already know you are choosing between mechanisms,
go straight to [selection.md](references/selection.md).

## Evidence tags

Every claim is tagged by how well it is backed:

| Tag | Meaning |
|---|---|
| *(untagged)* | Official documentation |
| `[ANTHROPIC]` | An Anthropic recommendation |
| `[ENGINEERING]` | Engineering judgment |
| `[COMMUNITY]` | Community practice |
| `[vX.Y.Z]` | The build a behaviour was verified against |
| `[EXPERIMENTAL]` | Off by default, may change |

## Verified against

Claude Code **2.1.219**, verified **2026-07-26**.

[references/compatibility.md](references/compatibility.md) records which build introduced
each capability. Those are version gates only: they say when a feature appeared, never that
an older build is unsupported. Check your own build with `claude --version` and compare.

Hook events, plugin components and MCP behaviour all move between releases. Re-read the
changelog after upgrading rather than trusting a dated profile.

## Sources and licensing

[references/sources.md](references/sources.md) carries the full source table: every entry
with its verification date, redistributability and licence.

The prose in this repository is original work, derived from public documentation and from
direct observation of an installed Claude Code environment. No upstream proprietary text is
redistributed verbatim in bulk. Rows in the source table marked "Redistributable: no" refer
to those upstream documentation pages, not to the text here.

Two third-party sources carry licences worth naming directly:

- Superpowers `writing-skills`, MIT, Copyright (c) 2025 Jesse Vincent
- Anthropic official Skill Creator, Apache-2.0

## Licence

MIT. See [LICENSE](LICENSE).
