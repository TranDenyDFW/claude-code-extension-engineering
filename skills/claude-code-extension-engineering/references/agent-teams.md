# Agent Teams

> Claude Code 2.1.229, verified 2026-08-13. What that means here: this file carries NO verbatim quotes, so the quote gate says nothing about it; the capability surface moved to 44 current tools and held at 31 current hook events. 129 of 190 mirrored pages changed since 2.1.224 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading.


Independent Claude Code sessions that talk to each other as peers rather than returning a result to a caller. EXPERIMENTAL and disabled by default. Reach for it only when subagent result-return genuinely cannot express the coordination, because cost scales with team size.

**Layer:** Orchestration | **Classification:** primitive | **Status:** experimental | **Since:** v2.1.178

## Read this first: one of four parallelism shapes, and the fourth is not here

- The official `agents` page compares four ways to run work at once: subagents, agent teams, dynamic workflows, and AGENT VIEW. This library has a file for the first three. It has none for the fourth, the `claude agents` dashboard for dispatching and watching background sessions, documented on `agent-view` [OFFICIAL]
- So a question about watching or managing running agents rather than DECLARING one is not answered anywhere here, and naming that page is the complete answer. Saying "agent teams" because the question said "agents" is the predictable error [ENGINEERING]

## Current lifecycle (v2.1.178+)

1. Enable CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS. It is off by default.
2. Spawn named teammates directly. There is no explicit team-creation step on this lifecycle.
3. Create and assign shared tasks with explicit ownership.
4. Use peer messages for findings and dependencies.
5. Monitor idle, blocked, failed, and completed work.
6. Allow automatic cleanup when the session exits.

## Legacy lifecycle, builds before v2.1.178 [OFFICIAL] [LEGACY]

- Feature introduced in 2.1.32 and remains experimental [OFFICIAL]  [v2.1.32]
- Create and name the team explicitly with TeamCreate [OFFICIAL] [LEGACY]  [DEPRECATED]
- Delete the team explicitly with TeamDelete [OFFICIAL] [LEGACY]  [DEPRECATED]
- Do not apply implicit-team instructions to builds before v2.1.178 [OFFICIAL]  [v2.1.178]

## Coordination design

- Lead owns decomposition, task boundaries, and final integration
- Each task has one owner, dependencies, output contract, and completion test
- Messages carry decisions and dependencies, not full duplicated transcripts
- Teammates report blockers and failures explicitly
- Shutdown and cleanup are part of the workflow

## Getting an honest answer out of several agents

Coordination above is about who owns what. This is about whether the answers can be believed, which is a different problem and the one a team is usually bought for.

- Have each agent form an INDEPENDENT first opinion before any of them sees another's reply, then cross-examine. Cross-examination after independence refines; cross-examination before it anchors, and the anchored version is indistinguishable from agreement afterwards  [ENGINEERING]
- The mechanical form is broadcast, then aggregate, with no agent seeing another's answer. This library's own blind pairwise grading packs are built that way for the same reason  [ENGINEERING]
- Treat UNANIMITY as a signal to investigate rather than as a result. Agreement between agents sharing a model and a prompt is cheap, and it is cheapest exactly where they are most alike. For scale: in the pattern corpus this library was audited against, 1,365 patterns drawn from 120 distinct sources, only 1.3 percent appear in three or more sources, so genuine independent convergence is rare and should be surprising when it happens  [ENGINEERING]
- When two delegates disagree, SURFACE the conflict rather than silently picking a winner. The lead is the component with the least evidence about which one is right, since it did not do either piece of work  [ENGINEERING]
- Human approval is a BLOCKING PHASE, not a notification the run continues past. This matters here more than elsewhere: the lead already approves teammate plans autonomously with no prompt to the user, so an approval step that does not block is not an approval step  [ENGINEERING]
- A single checkout is SHARED with any parallel session, so two sessions working in one tree overwrite each other. This is documented rather than inferred: worktrees exist to give each session a separate checkout so parallel sessions never edit the same files, and outside a git repository sessions write to the working directory directly and are not isolated from each other at all. It is the file-ownership hazard one level up, between whole sessions rather than between teammates  [OFFICIAL]

## Limitations and failure handling

- Experimental behavior may change between releases [OFFICIAL]
- Independent sessions increase token cost [OFFICIAL]
- Avoid teams when tasks are tightly coupled or cannot be partitioned [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Detect duplicate ownership, idle loops, stale tasks, and orphan teammates [ENGINEERING BEST PRACTICE]  [ENGINEERING]

## Choosing a team over subagents [OFFICIAL] [EXPERIMENTAL]

- Use when peers must communicate, challenge findings, or self-coordinate [OFFICIAL]
- Prefer subagents for focused work where only the result matters [OFFICIAL]
- Budget higher token and coordination cost [OFFICIAL]
- Reusing a subagent definition as a teammate: tools and model are honored, but the BODY IS APPENDED to the teammate system prompt rather than replacing it, SendMessage and task tools stay available despite a tools allowlist, and the skills and mcpServers frontmatter fields are NOT applied [OFFICIAL]
- Permission model: teammates start with the lead's settings and the skip-permissions flag propagates to all of them; per-teammate modes cannot be set at spawn. The LEAD approves teammate plans autonomously with no prompt to the user, so approval criteria belong in the lead prompt. A teammate cannot approve a prompt or relay a denial around a check [OFFICIAL]
- Hard limits: one team per session, no nested teams, the lead is fixed, in-process teammates cannot run background subagents, and /resume and /rewind do not restore them. teammateMode defaults to in-process since v2.1.179; split panes need tmux or iTerm2 and are unsupported in Windows Terminal, VS Code, and Ghostty. Teammates do NOT inherit the lead /model [OFFICIAL]  [v2.1.179]
- Partition work by FILE ownership: two teammates editing one file overwrite each other. Team config is generated runtime state under ~/.claude/teams/ - never hand-edit or pre-author it, and there is no project-level teams config [OFFICIAL]
- Sizing guidance: 3-5 teammates, 5-6 tasks each [ANTHROPIC RECOMMENDATION]  [ANTHROPIC]

## Definition of Done

- Team use is justified over subagents
- Version-specific lifecycle selected
- Task ownership and dependencies are explicit
- Peer communication path is tested
- Cost and failure posture are accepted
- Cleanup is proven

## Settings

- teammateMode lives in ~/.claude/settings.json and controls in-process versus split-pane teammates. Documented values include "auto" and "iterm2"; auto warns when it cannot find the it2 CLI.  [v2.1.219]

## Detail

- Experimental coordination of independent Claude Code sessions with shared tasks and peer-to-peer messaging.
- The implicit lifecycle replaces the TeamCreate/TeamDelete pair from v2.1.178 and is the default on current builds. Only builds before v2.1.178 use the legacy lifecycle below.  [v2.1.178]
