---
name: claude-code-extension-engineering
description: "Building, debugging, or reasoning about the limits of a Claude Code extension: CLAUDE.md, rules, skills, hooks, hook events, subagents, dynamic workflows, agent teams, MCP servers, output styles, themes, monitors, channels, plugins, the Agent SDK, permission rules and the OS sandbox. Use when choosing between these mechanisms, writing one, or diagnosing one that will not load, fire, or behave. ALSO use for capability and scope questions: whether a hook event can block or refuse, whether a permission or sandbox key is honored in project scope or only user/managed/CLI scope, which tools a path rule is consulted for, whether a feature works on a third-party provider or an older build, what context a subagent receives, or whether a requirement is achievable at all. CRITICALLY, use it for IMPERATIVE build requests about these mechanisms too, not only questions: 'wire up a hook that...', 'make it stop/block/refuse when X', 'whenever X happens, do Y', 'put our sandbox or permission config into settings.json', 'add a rule that prevents...'. Those presuppose the mechanism can do the thing, and half the time it cannot: the event reports but cannot block, the key is inert at that scope, the rule is never consulted for that tool. Use this skill ALONGSIDE any settings-editing help to check the mechanism contract BEFORE writing the file. Wiring up something that silently never fires is the failure this exists to prevent."
---

# Claude Code extension engineering

## Before you wire anything up: check the request is possible

**An imperative is not a licence.** "Wire that up", "make it stop when X", "put the sandbox
config in settings.json" all presuppose the mechanism can do what is being asked, and that
presupposition is wrong often enough to check every time. The costly failures in this domain
are not syntax errors, they are configurations that parse, load, and do nothing:

- an event that reports but **cannot block**, wired to block
- a key that is **inert in project scope**, written into the repo settings file
- a path rule for a tool it is **never consulted for**
- a matcher naming a tool that **does not exist**

All four look correct in the file and all four fail silently, so nobody finds out until the
thing they were guarding against happens.

So before writing config: name the mechanism the request needs, open its reference, and
confirm it can do the thing **at the scope being asked for**. If it cannot, say so and give
the nearest thing that can, rather than delivering config that will never fire. Say which
half is deliverable when only half is.

## Before answering: open a reference

**If the question is diagnostic, capability, or scope shaped, open
[INDEX.md](references/INDEX.md) and read the reference it names before you answer.**
That covers every "can X block", "will this setting take effect here", "does this work on
that provider or version", "it is installed but never fires", and "is this achievable at
all". The mechanism table further down only helps once you already know which mechanism
owns the answer, and for these questions that is the thing you are trying to work out.

Answering from the shape of a settings file, or from the mechanism whose name the question
happens to use, is the failure mode this skill exists to prevent. Several of these
mechanisms report without being able to refuse, and several keys are inert in the scope
people naturally put them in. Both are silent.

If no reference covers it, say what you could not confirm. A confident wrong mechanism
claim is indistinguishable from a correct one until it ships.

## The layers

Twelve authored extension mechanisms across seven layers, plus a cross-referenced
programmatic tier (Agent SDK, GitHub Action), plus an eighth ENFORCEMENT layer you
configure rather than author: permission rules and the OS sandbox. Pick the mechanism
first, then open its reference: choosing wrong is the expensive mistake, and most of these
look interchangeable until you need one to guarantee something.

The count stays at twelve deliberately. Permission rules and the sandbox are settings, not
components you write and ship, so folding them into the authored count would make one
number mean two things. They still decide the outcome whenever a requirement says "must
not", which is why they are a layer here rather than a footnote inside hooks.md.

Two questions decide most cases. **Who owns enforcement**, the model or the harness? And
**where must it run**, this context or an isolated one? Ownership is not a guarantee:
even harness-owned enforcement has a failure policy (fail-open, fail-closed, advisory)
and a tamper boundary (user-, project-, or managed-policy-configurable), and neither
axis is a clean split any more (hooks can carry judgment, skills can be forced into a
subagent), so check `selection.md` before committing to one.

## Where to look

Keyed by mechanism. If you do not already know which mechanism owns the answer, use
[INDEX.md](references/INDEX.md) instead, which is keyed by the question.

| Need | Open |
|---|---|
| **I do not know which of these owns my question** | **[INDEX.md](references/INDEX.md)** |
| Auto memory | [auto-memory.md](references/auto-memory.md) |
| CLAUDE.md family | [claude-md-family.md](references/claude-md-family.md) |
| Compatibility | [compatibility.md](references/compatibility.md) |
| Custom Output Styles | [output-styles.md](references/output-styles.md) |
| Custom Themes | [themes.md](references/themes.md) |
| Skills | [skills.md](references/skills.md) |
| Testing and iteration | [testing.md](references/testing.md) |
| Hooks | [hooks.md](references/hooks.md) |
| Permission rules: allow, ask, deny | [permissions.md](references/permissions.md) |
| OS-level sandboxing (not on native Windows) | [sandboxing.md](references/sandboxing.md) |
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

## Repairing something that is broken

**Reproduce the failure, apply the fix, re-run, and show both outputs.** Not a list of
steps for someone else to run: the actual before and after.

This is not ceremony. A config defect in this domain is usually silent, so "I changed the
thing that looked wrong" and "I fixed it" are indistinguishable without exercising it. A
matcher naming a tool that does not exist, a path rule scoped to a tool it is never
consulted for, a manifest key that replaces a folder instead of adding to it, and a
registration under the wrong top-level name all parse cleanly and all do nothing. Parsing
is not evidence. A startup that emits no warning is not evidence.

Two cases, minimum, or the repair is a hypothesis:

- **the negative case**: the original defect, reproduced, so you know you found the real one
- **the positive case**: the same check against the repaired artifact, passing

If the environment genuinely cannot run either, say which one and why, and label the fix
unverified. That is a worse answer than a tested fix and a better one than a confident
untested claim.

Claims are tagged by evidence: untagged is official documentation, `[ANTHROPIC]` is an
Anthropic recommendation, `[ENGINEERING]` is engineering judgment, `[COMMUNITY]` is
community practice. A `[vX.Y.Z]` tag is the build a behaviour was verified against;
`[EXPERIMENTAL]` means NOT STABLE, in either of two senses: off by default until a flag or
env var turns it on (Agent Teams), or on the moment it is configured but carrying a manifest
schema, flag syntax or protocol contract documented as liable to change between releases
(Monitors, which auto-arm with the plugin and have no off switch; Channels, a research
preview). Reading the tag as "off by default" everywhere is wrong in both directions: it
implies a switch that does not exist and hides a compatibility risk that does.
