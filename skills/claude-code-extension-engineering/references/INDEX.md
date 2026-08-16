# Symptom index: start here when you do not already know the mechanism

The table in SKILL.md is keyed by **mechanism**, which only helps once you know which
mechanism owns the answer. Most real questions do not arrive that way. They arrive as a
symptom ("this hook never fires"), a capability question ("can it block?"), or a scope
question ("will this setting take effect here"), and the mechanism is the thing you are
trying to work out.

Measured failure mode this exists to stop: a question about repo conventions being missed
during exploration reads as a CLAUDE.md question, so `claude-md-family.md` gets opened,
while the answer lives in `context-modes.md` because the real subject is what the built-in
Explore and Plan agents skip. The reader cannot route correctly from the mechanism table,
because routing correctly requires the answer.

**Match the question shape below, open the file named, and read it before answering.**
If two rows match, open both.

There are two ways to be wrong here, and the guard this file carried until 2026-08-13
covered only one. A MISS is cheap and visible. A FALSE MATCH is neither: the question
carries a word that is also a filename here, a row matches on that word, the reference
loads, and every fact in it is true and about something else. MEASURED: "how to monitor
Claude Code" matched the monitor rows, `monitors.md` was read, and the answer described a
plugin-declared shell command to somebody asking about OpenTelemetry. Retrieval reported no
problem because mechanically nothing had gone wrong. A gap would have scored better than the
hit, and the old guard could never fire, because it was conditioned on nothing matching.

So run the collision table immediately below BEFORE the shape tables. Then:

- collision table silent, a shape row matches, open it.
- collision table names the question, ANSWER it from what you know, say the answer is not sourced
  from this library, and name the official page. Naming the page INSTEAD of answering is not a
  complete answer: measured, that behaviour lost blind pairwise comparisons to an arm carrying no
  relevant library at all. What is forbidden is sourcing the answer from a file HERE that merely
  shares a word with the topic.
- nothing matches anywhere, say what you could not confirm, and name the nearest official
  PAGE rather than the nearest filename here.

## Before the shape tables: is a WORD doing the routing?

| The word | What this library means | What the asker usually means | Where that lives |
|---|---|---|---|
| monitor | a plugin-declared shell command whose stdout reaches the model | observability: usage, cost, tokens, OTel export | `monitoring-usage`, `analytics`. NOT covered here |
| sandbox | the OS-level sandboxed Bash tool | running Claude inside a container or VM | `sandbox-environments`. NOT covered here |
| permission | allow / ask / deny rule syntax | how often Claude asks: plan, acceptEdits, auto, bypassPermissions | `permission-modes`. Only the resume slice is here, in [sessions.md](sessions.md) |
| workflow | an orchestration script in `.claude/workflows/` | how to accomplish a task with Claude Code | `common-workflows`. NOT covered here |
| context | what a delegated worker starts with | the token budget and compaction | `context-window`. NOT covered here |
| agent | subagents, teams, the SDK | the `claude agents` dashboard | `agent-view`, `agents`. NOT covered here |
| session | what survives a session ending, and `/rewind` | messaging your other live sessions | `cross-session-messaging`. NOT covered here |
| classifier | the content safety classifier | the auto-mode permission classifier | [safety-classifier.md](safety-classifier.md) and [sandboxing.md](sandboxing.md). BOTH here |

The last row is the one that already worked before this table existed, and it worked because
the disambiguation lives in the destination file, at the top, before anything else. Every
other row now has the same treatment in its destination; this table is the earlier catch.

## You were told to BUILD something, not asked a question

Imperatives hide the capability question inside an assumption. Translate the request into
the question it presupposes, then look that up before writing anything.

| What you were asked to build | The question it assumes | Open |
|---|---|---|
| "whenever a call is refused, stop the turn" / "wire that up" | can the denial event block? | [hook-events.md](hook-events.md) |
| "make it refuse / block / prevent X" | can that event block at all, or only report? | [hook-events.md](hook-events.md), [selection.md](selection.md) |
| "put our sandbox config in settings.json so it is version controlled" | are those keys honored at repository scope? | [sandboxing.md](sandboxing.md) |
| "add a permission rule that stops writes to this path" | is a path rule consulted for that tool? | [permissions.md](permissions.md), [compatibility.md](compatibility.md) |
| "add a hook on this tool" | is that the real tool name the matcher sees? | [hooks.md](hooks.md), [hook-events.md](hook-events.md) |
| "ship this in a plugin so the team gets it" | does that component type load from that scope? | [plugins.md](plugins.md), [selection.md](selection.md) |
| "have it notify us every time X happens" | can anything push into a session unprompted? | [selection.md](selection.md), [monitors.md](monitors.md), [channels.md](channels.md) |
| "roll this rule out so it is genuinely enforced" | which layer actually enforces, and can it be bypassed? | [selection.md](selection.md), [permissions.md](permissions.md) |
| "make this tool ask for confirmation first" | can the server force it, or only the client? | [mcp.md](mcp.md) |

If the reference says the mechanism cannot do it, **do not build the thing anyway**. Say
which part is achievable, which is not, and what the nearest working shape is. A config file
that parses and never fires is worse than a refusal, because it looks like protection.

## "Can X block, refuse, or stop something?"

Blocking is the single most common wrong assumption. A mechanism that reports is not a
mechanism that refuses, and several events exist purely to observe.

| The question | Open |
|---|---|
| Can this hook event block, deny, or halt the turn? | [hook-events.md](hook-events.md) |
| What does each event actually receive, and what can its output do? | [hook-events.md](hook-events.md) |
| Can a permission denial itself trigger a stop? | [hook-events.md](hook-events.md) |
| Can worktree creation or removal be refused? | [hook-events.md](hook-events.md) |
| Can a watcher or monitor refuse an action? | [selection.md](selection.md), [monitors.md](monitors.md) |
| Can an MCP server force a human confirmation? | [mcp.md](mcp.md) |
| Can a permission rule stop a shell command that writes the same file? | [permissions.md](permissions.md), [compatibility.md](compatibility.md) |
| Do parallel workers' plans get approved without asking me first? | [agent-teams.md](agent-teams.md) |
| Can I set a different permission mode per parallel worker? | [agent-teams.md](agent-teams.md) |
| Which layer can actually guarantee a "must not"? | [selection.md](selection.md) |

## "Will this setting take effect where I am putting it?"

A key written into the wrong scope is inert, usually silently. This is a scope question
before it is a syntax question.

| The question | Open |
|---|---|
| Is this key honored in project/repo settings, or only user, managed, or CLI scope? | [sandboxing.md](sandboxing.md), [compatibility.md](compatibility.md) |
| Which sandbox keys are unavailable to a checked-in project file? | [sandboxing.md](sandboxing.md) |
| Which tools is a permission path rule actually consulted for? | [permissions.md](permissions.md), [compatibility.md](compatibility.md) |
| Does a custom path field in a plugin manifest replace the default folder or add to it? | [plugins.md](plugins.md) |
| Where does persistent plugin state belong so it survives an update? | [plugins.md](plugins.md) |
| Does this need declaring under an experimental manifest key? | [themes.md](themes.md), [monitors.md](monitors.md), [plugins.md](plugins.md) |
| Do these fields go at the top level of the file or inside the per-server object? | [lsp.md](lsp.md) |
| Which permissions and secrets apply when this runs in CI rather than locally? | [github-action.md](github-action.md) |
| Do my local settings, hooks and permission rules apply when I drive this from my own program? | [agent-sdk.md](agent-sdk.md) |

## "Will this work on my platform, provider, or version?"

| The question | Open |
|---|---|
| Does this work on a third-party model provider (Bedrock, Vertex)? | [compatibility.md](compatibility.md) |
| Does a telemetry or non-essential-traffic switch disable it? | [compatibility.md](compatibility.md) |
| What is the minimum version, and what happens on older builds? | [compatibility.md](compatibility.md) |
| Does this run on native Windows? | [sandboxing.md](sandboxing.md), [compatibility.md](compatibility.md) |
| Do split panes work in my terminal, and do parallel workers inherit my model? | [agent-teams.md](agent-teams.md) |
| Was this behaviour verified against a specific build? | [compatibility.md](compatibility.md), [sources.md](sources.md) |

## "It is installed but it never fires / it runs but ignores its instructions"

| The question | Open |
|---|---|
| A skill is listed but never auto-invokes | [skills.md](skills.md) |
| A hook is configured but never runs | [hooks.md](hooks.md), [hook-events.md](hook-events.md) |
| "&lt;event&gt; hook not working / not firing", with no config shown | [hooks.md](hooks.md), [hook-events.md](hook-events.md). Answer the documented contract; do NOT audit this workspace's settings files |
| A Stop or SubagentStop hook runs but the turn ends anyway, or the turn will not end | [hooks.md](hooks.md), [hook-events.md](hook-events.md) |
| A subagent runs but ignores its detailed guidance | [subagents.md](subagents.md) |
| An MCP server is configured but no tools appear | [mcp.md](mcp.md) |
| A plugin loads but one component type is missing | [plugins.md](plugins.md) |
| Something works by hand but not from a real session | [hooks.md](hooks.md), [hook-events.md](hook-events.md), [testing.md](testing.md) |
| I edited a config mid-session and nothing changed | [sessions.md](sessions.md) FIRST for the general rule, THEN [output-styles.md](output-styles.md), [testing.md](testing.md). Most keys hot-reload and the restart-only keys are the enumerated exception, so do NOT generalise from the output-styles page to settings as a whole |
| A settings key is ignored, or settings.json appears to do nothing | [sessions.md](sessions.md), [permissions.md](permissions.md). Establish WHICH FILE the key belongs in before checking scope, syntax or precedence: some keys live in `~/.claude.json` and are silently ignored when placed in `settings.json`. Answer the documented contract; do NOT audit this workspace's settings files |
| A plugin is installed but nothing happens at all | [plugins.md](plugins.md), [mcp.md](mcp.md) |
| The `#` shortcut for adding to memory does nothing | [auto-memory.md](auto-memory.md) |
| I want to be notified when Claude finishes or needs me | [hooks.md](hooks.md), [hook-events.md](hook-events.md). Notification and Stop are different events and only one of them can block |
| The tone or response format config seems to do nothing, or replaced more than expected | [output-styles.md](output-styles.md) |
| One integration is skipped at startup while the others load, and validation passes | [lsp.md](lsp.md), [plugins.md](plugins.md) |
| An agent definition's tools or frontmatter is ignored when it runs as a peer | [agent-teams.md](agent-teams.md), [subagents.md](subagents.md) |
| It answered, but a different model answered than the one I picked | [safety-classifier.md](safety-classifier.md) |
| A refusal on work that is obviously benign, sometimes on the very first request | [safety-classifier.md](safety-classifier.md) |
| My display script runs far more or far less often than I expected | [statusline.md](statusline.md) |
| I need to isolate which layer is responsible | [testing.md](testing.md) |

## "What context does this get, and what does it skip?"

| The question | Open |
|---|---|
| Do the built-in Explore and Plan agents read CLAUDE.md? | [context-modes.md](context-modes.md) |
| What does a named subagent receive that a built-in does not? | [context-modes.md](context-modes.md), [subagents.md](subagents.md) |
| Why are documented conventions ignored during exploration? | [context-modes.md](context-modes.md) |
| Which context does a skill, fork, or teammate run in? | [context-modes.md](context-modes.md) |
| Can a subagent keep its own persistent notes, separate from the main conversation? | [auto-memory.md](auto-memory.md), [context-modes.md](context-modes.md) |
| Where do Claude's own written-back notes live, and are they a policy file? | [auto-memory.md](auto-memory.md), [claude-md-family.md](claude-md-family.md) |
| How do CLAUDE.md, rules and imports compose? | [claude-md-family.md](claude-md-family.md) |
| I resumed and something I had configured is gone | [sessions.md](sessions.md) |
| Can I undo what it just did to my files? | [sessions.md](sessions.md) |
| Where is the conversation actually stored, and can I read it from a script? | [sessions.md](sessions.md) |
| I can see the number on screen but I cannot get at it | [statusline.md](statusline.md) |

## "Can a server or outside system reach into a session?"

| The question | Open |
|---|---|
| Can an MCP server push an event without being asked? | [selection.md](selection.md), [mcp.md](mcp.md) |
| Can an external system wake or interrupt a running session? | [channels.md](channels.md), [selection.md](selection.md) |
| Can something notice a file change and act on it? | [monitors.md](monitors.md), [selection.md](selection.md) |
| How do I get live events into a session at all? | [selection.md](selection.md) |

## Writing an orchestration script

| The question | Open |
|---|---|
| What happens when one agent call fails? | [workflows.md](workflows.md), [composition-cards.md](composition-cards.md) |
| Can the script read the filesystem, the time, or randomness? | [workflows.md](workflows.md) |
| What are the caps on items, invocations, concurrency and nesting? | [workflows.md](workflows.md) |
| What may the exported header contain? | [workflows.md](workflows.md) |
| How do two mechanisms combine, and what breaks at the seam? | [composition-cards.md](composition-cards.md) |

## Output size, truncation and cost

| The question | Open |
|---|---|
| Why is a tool result being cut off, and what raises the ceiling? | [mcp.md](mcp.md) |
| What happens to hook output over the cap? | [sources.md](sources.md), [hooks.md](hooks.md) |
| What does each mechanism cost in context? | [context-modes.md](context-modes.md), [selection.md](selection.md) |

## Choosing, and refusing to choose

| The question | Open |
|---|---|
| Which mechanism should own this requirement? | [selection.md](selection.md) |
| Is this achievable at all, or only partly? | [selection.md](selection.md), then the mechanism's own reference |
| Is this documented anywhere, or am I about to assert it? | [sources.md](sources.md) |

**If the honest answer is that no source covers it, say so.** `sources.md` records what is
documented and what is not. An unverified mechanism claim stated confidently is the most
expensive failure in this domain, because it is indistinguishable from a correct one until
someone ships it.
