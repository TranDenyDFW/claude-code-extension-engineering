---
name: cc-ext-enforcement-and-scope
description: "Building, debugging, or reasoning about the limits of a Claude Code extension: permission rules (allow, ask, deny), the OS sandbox, settings files and environment variables, what survives a session ending (transcripts, resume, /rewind), the safety classifier, and which build a capability exists on. Use when choosing between these mechanisms, writing one, or diagnosing one that will not load, fire, or behave. ALSO capability and scope: whether a key is honored at project scope or only user/managed/CLI scope, which tools a path rule is consulted for, and whether a rule exists on an older build. ALSO for IMPERATIVE build requests, not only questions: \"put our sandbox config in settings.json\", \"deny that tool\", \"make this rule apply to the repo\". They presuppose it can, and often it cannot. ALSO for a BARE SYMPTOM or lookup with no artifact attached: \"settings.json ignored\", \"where is settings.json\", \"how do I delete sessions\", \"permission rule not applying\". A bare noun phrase is a QUESTION, not system output to acknowledge. If the question is about another extension mechanism, say so and name the sibling skill rather than answering from the nearest file here. NOT for operating Claude Code rather than extending it: telemetry, permission MODES, containers and VMs, the token budget, the agents dashboard, usage and billing, IDE integrations, install and login. Name the page and stop."
---

# Claude Code extensions: enforcement and scope

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

**Check the word before you check the shape.** If the question's key noun is `permission`, `sandbox`, `session`, `classifier`, read the boundary table in [selection.md](references/selection.md) BEFORE opening INDEX.md. Each names a mechanism here and, separately, a Claude Code topic that is not here at all. Retrieval succeeds on the wrong one and reports nothing, because mechanically nothing went wrong.

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
| Compatibility | [compatibility.md](references/compatibility.md) |
| Combining two mechanisms | [composition-cards.md](references/composition-cards.md) |
| Permission rules: allow, ask, deny | [permissions.md](references/permissions.md) |
| Safety classifier | [safety-classifier.md](references/safety-classifier.md) |
| OS-level sandboxing (not on native Windows) | [sandboxing.md](references/sandboxing.md) |
| Choosing between mechanisms | [selection.md](references/selection.md) |
| Sessions, transcripts, resume, /rewind | [sessions.md](references/sessions.md) |
| Evidence sources | [sources.md](references/sources.md) |

## How claims are tagged

The evidence-tag legend lives in the delegation-and-instructions skill and in
[sources.md](references/sources.md). The tags mean the same thing in every one of these skills.
