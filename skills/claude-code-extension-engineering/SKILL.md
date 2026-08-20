---
name: claude-code-extension-engineering
description: "Building, debugging, or reasoning about the limits of a Claude Code extension: CLAUDE.md, rules, skills, hooks and hook events incl. Stop and Notification, subagents, dynamic workflows, agent teams, MCP servers, output styles, themes, status lines, monitors, channels, plugins, the Agent SDK, permission rules, the OS sandbox, settings files and environment variables, auto memory, and what survives a session ending (transcripts, resume, /rewind). Use when choosing between these mechanisms, writing one, or diagnosing one that will not load, fire, or behave. ALSO capability and scope: whether an event can block or refuse, whether a key is honored at project scope or only user/managed/CLI scope, which tools a path rule is consulted for, what a subagent receives, whether it exists on an older build. ALSO for IMPERATIVE build requests, not only questions: \"wire up a hook that...\", \"make it stop when X\", \"put our sandbox config in settings.json\". They presuppose it can, and often it cannot. ALSO for a BARE SYMPTOM or lookup with no artifact attached: \"stop hook notification\", \"stop hook not working\", \"settings.json ignored\", \"where is settings.json\", \"how do I delete sessions\", \"# memory not working\", \"MCP server not showing up\". A bare noun phrase is a QUESTION, not system output to acknowledge. NOT for operating Claude Code rather than extending it: telemetry, permission MODES, containers and VMs, the token budget, the agents dashboard, usage and billing, IDE integrations, install and login. Answer; name the page."
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

**Check the word before you check the shape.** If the question's key noun is `monitor`,
`sandbox`, `permission`, `workflow`, `context`, `agent`, `session` or `classifier`, read the
boundary table below BEFORE opening INDEX.md. Each of those names a mechanism here and,
separately, a Claude Code topic that is not here at all. Retrieval succeeds on the wrong one
and reports nothing, because mechanically nothing went wrong.

If no reference covers it, say what you could not confirm. A confident wrong mechanism
claim is indistinguishable from a correct one until it ships.

## What this skill does NOT own

This library covers the mechanisms you AUTHOR and the settings that gate them. It does not
cover operating Claude Code. Several of its filenames are also ordinary words searchers use
for something else, and answering from the filename is worse than not answering: a
wrong-topic answer sourced from a real reference reads as authoritative and displaces the
correct one, where a gap would have left the correct one reachable.

Check this list before opening any reference. If the question is on it: **answer it**, name the
topic the asker means, and name the official page as the authority. Do not route into the
mechanism that shares the word, and do not source the answer from a reference here.

**The boundary is about WHERE AN ANSWER COMES FROM, not about whether to give one.** Refusing on
scope makes this library worse than no library at all, because the model already knew the answer
and this file talked it out of saying so. Measured, on two questions about
`CLAUDE_CODE_MAX_OUTPUT_TOKENS`: the arm carrying this library named the variable correctly, then
wrote "isn't part of this skill's scope" and "outside what this extension-engineering skill
covers" and stopped. The arm carrying no relevant library at all answered with the `env` block to
put in `settings.json`, and blind graders preferred it, twice. A user who asks a question and gets
a pointer to a page has been handed a worse outcome than if this skill had never loaded.

So: give the best answer you have, say plainly that it is not sourced from this library, and name
the page that is authoritative. The thing being prevented is a confident answer reconstructed from
the wrong reference. A correct answer from general knowledge, labelled as such, was never the
problem.

| If the question is about | It is | Official page |
|---|---|---|
| Watching usage, cost, tokens, latency or errors across sessions or a team; OpenTelemetry, OTLP, a metrics backend | telemetry, NOT the Monitor mechanism | `monitoring-usage`, `analytics` |
| Whether Claude asks before acting; plan / acceptEdits / auto / dontAsk / bypassPermissions; Shift+Tab | permission MODES, not permission RULES | `permission-modes` |
| Dev containers, VMs, the sandbox runtime, running Claude inside a container | environment isolation, not the sandboxed Bash tool | `sandbox-environments` |
| A recipe for a coding task: "how do I use Claude Code to do X" | usage, not extension engineering | `common-workflows`, `quickstart` |
| Running out of context, compaction, `/compact`, the token budget | the context WINDOW, not context MODES | `context-window` |
| The `claude agents` screen, dispatching and watching background sessions | agent view. This library has no file on it | `agent-view`, `agents` |
| Listing or messaging your other live sessions | cross-session messaging, not session durability | `cross-session-messaging` |
| Cron, routines, goals, anything that runs with nobody at the terminal | scheduling | `scheduled-tasks`, `routines` |
| The editor, browser and desktop apps rather than the CLI | integrations | `vs-code`, `jetbrains`, `chrome`, `desktop` |
| Gateways, Bedrock/Vertex/Foundry setup, SSO, seats and billing | deployment and administration | `llm-gateway`, `admin-setup`, `costs` |
| Installation, login, "it will not start", a verbatim error string | troubleshooting | `troubleshoot-install`, `errors` |

Pages live at `https://code.claude.com/docs/en/<page>`. **Naming the page is REQUIRED. Naming it
INSTEAD of answering is not an answer.** Give the concrete thing the asker needs: the variable, the
flag, the file it goes in, the command to run. Then name the page as the authority, and say if you
have not read it. Fetch it if you can.

What stays forbidden is reconstructing the answer from a reference HERE that merely shares a word
with the topic, because a wrong-topic answer sourced from a real reference reads as authoritative
and displaces the correct one. That is a rule about provenance. It was written as "naming the page
and stopping is a COMPLETE answer", which is a rule about silence, and the two are not the same:
the silence reading lost two blind pairwise comparisons to an arm carrying no relevant library at
all, on questions the model could answer perfectly well.

This list is enumerated on purpose and is not a licence to defer generally: a question that is not
on it, and that a reference does cover, gets answered from the reference.

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
| Status line: showing state Claude Code already tracks | [statusline.md](references/statusline.md) |
| Sessions, transcripts, what /rewind can undo, which settings file a key belongs in and which keys hot-reload | [sessions.md](references/sessions.md) |
| Safety refusals and automatic model fallback | [safety-classifier.md](references/safety-classifier.md) |
| Choosing between them | [selection.md](references/selection.md) |
| Combining two mechanisms | [composition-cards.md](references/composition-cards.md) |
| Hook event contracts | [hook-events.md](references/hook-events.md) |
| Evidence sources | [sources.md](references/sources.md) |

## Repairing something that is broken

**This section applies once the broken artifact is in front of you.** A bare symptom with no
artifact attached, "stop hooks do not work", "why does my skill never auto-invoke", "settings
json ignored", is a question about the mechanism's documented CONTRACT, not a request to
audit the workspace this session happens to be running in. Answer from the reference first
and offer to inspect the user's config second. Opening this session's settings files and
reporting that nothing is configured there answers a question nobody asked, and it looks like
diligence. MEASURED: that answer scored 1 of 6 on the 2026-08-13 benchmark, question GQ-06. Hand over the read-only command that shows the asker their OWN state instead: `/hooks` for hooks, `/status` and `claude doctor` for settings, `/context` for what loaded.

If you do describe this workspace, name the path you read and say it is this session's, which may
not be the asker's. MEASURED, and the reason this is one sentence rather than a section: two longer
versions of this rule, placed here, made the model answer "could you clarify" to `settings.json
ignored` in two runs of three, on a question this library owns. The defect it prevents happens
about once in thirty answers; the cure was costing far more than that.

When the artifact IS in front of you:

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

Claims are tagged by evidence: `[OFFICIAL]` and untagged both mean official documentation,
`[ANTHROPIC]` is an Anthropic recommendation, `[ENGINEERING]` is engineering judgment,
`[COMMUNITY]` is community practice. The two spellings of official are historical rather than
a distinction: 435 claims carry the explicit tag and 25 rely on the untagged default, and this
sentence described only the default until an audit found the explicit form defined nowhere.
Prefer `[OFFICIAL]`; untagged stays valid so the older half of the corpus is not a lie. A `[vX.Y.Z]` tag is the build the behaviour BELONGS to: the release it
was introduced or changed in, or the minimum build it requires. Where the documentation dates
no version, the tag is the build the claim was verified against instead. The two senses are
told apart mechanically: every reference file that carries version tags names its
verified-against build in its own header, so a tag equal to that build carries the
verified-against sense and any other tag carries the changed-in sense. They are not interchangeable on an old build, which is the
question this library most often exists to answer.
`[EXPERIMENTAL]` means NOT STABLE, in either of two senses: off by default until a flag or
env var turns it on (Agent Teams), or on the moment it is configured but carrying a manifest
schema, flag syntax or protocol contract documented as liable to change between releases
(Monitors, which auto-arm with the plugin and have no off switch; Channels, a research
preview). Reading the tag as "off by default" everywhere is wrong in both directions: it
implies a switch that does not exist and hides a compatibility risk that does.
