---
name: cc-ext-packaging-and-integration
description: "Building, debugging, or reasoning about the limits of a Claude Code extension: plugins, MCP servers, the Agent SDK, the GitHub Action, LSP and code intelligence, output styles, and themes. Use when choosing between these mechanisms, writing one, or diagnosing one that will not load, fire, or behave. ALSO capability and scope: what a plugin may ship, which scope an MCP server is resolved from, and whether a surface exists on an older build. ALSO for IMPERATIVE build requests, not only questions: \"package this as a plugin\", \"add an MCP server for...\", \"ship this as an Action\". They presuppose it can, and often it cannot. ALSO for a BARE SYMPTOM or lookup with no artifact attached: \"MCP server not showing up\", \"plugin not loading\", \"output style has no effect\". A bare noun phrase is a QUESTION, not system output to acknowledge. If the question is about another extension mechanism, say so and name the sibling skill rather than answering from the nearest file here. NOT for operating Claude Code rather than extending it: telemetry, permission MODES, containers and VMs, the token budget, the agents dashboard, usage and billing, IDE integrations, install and login. Name the page and stop."
---

# Claude Code extensions: packaging and integration

## Before you wire anything up: check the request is possible

**An imperative is not a licence.** "Wire that up", "make it stop when X" presuppose the mechanism
can do what is being asked, and that presupposition is wrong often enough to check every time. The
costly failures in this domain are not syntax errors, they are configurations that parse, load, and
do nothing: an event that reports but **cannot block** wired to block, a key that is **inert in
project scope** written into the repo settings file, a path rule for a tool it is **never consulted
for**, a matcher naming a tool that **does not exist**. All four look correct in the file and all
four fail silently, so nobody finds out until the thing they were guarding against happens.

Before writing config: name the mechanism the request needs, open its reference, and confirm it can
do the thing **at the scope being asked for**. If it cannot, say so and give the nearest thing that
can. Say which half is deliverable when only half is.

## Before answering: open a reference

**If the question is diagnostic, capability, or scope shaped, open
[INDEX.md](references/INDEX.md) and read the reference it names before you answer.** Answering from
the shape of a settings file, or from the mechanism whose name the question happens to use, is the
failure mode this library exists to prevent.

This skill owns no ambiguous trigger noun. If a question's key noun is `monitor`, `sandbox`, `permission`, `workflow`, `context`, `agent`, `session` or `classifier`, it belongs to a sibling skill; name that skill rather than answering from the nearest file here.

If no reference covers it, say what you could not confirm. A confident wrong mechanism claim is
indistinguishable from a correct one until it ships.

## This is one of four skills

The Claude Code extension library is split by the noun a question names:

| Skill | Owns |
|---|---|
| `cc-ext-enforcement-and-scope` | permission rules, the OS sandbox, settings scope, sessions, the safety classifier |
| `cc-ext-hooks-and-live-events` | hooks and hook events, monitors, channels, status lines, testing |
| `cc-ext-delegation-and-instructions` | subagents, workflows, agent teams, skills, CLAUDE.md, auto memory, context modes |
| `cc-ext-packaging-and-integration` | plugins, MCP, the Agent SDK, the GitHub Action, LSP, output styles, themes |

A question that spans two of them is answered by naming both, not by answering from whichever file
this skill happens to have.

## Where to look

| Need | Open |
|---|---|
| I do not know which of these owns my question | [INDEX.md](references/INDEX.md) |
| Agent SDK | [agent-sdk.md](references/agent-sdk.md) |
| Combining two mechanisms | [composition-cards.md](references/composition-cards.md) |
| GitHub Action | [github-action.md](references/github-action.md) |
| LSP / code intelligence | [lsp.md](references/lsp.md) |
| MCP servers | [mcp.md](references/mcp.md) |
| Custom Output Styles | [output-styles.md](references/output-styles.md) |
| Plugins | [plugins.md](references/plugins.md) |
| Choosing between mechanisms | [selection.md](references/selection.md) |
| Evidence sources | [sources.md](references/sources.md) |
| Custom Themes | [themes.md](references/themes.md) |

## How claims are tagged

The evidence-tag legend lives in the delegation-and-instructions skill and in
[sources.md](references/sources.md). The tags mean the same thing in every one of these skills.
