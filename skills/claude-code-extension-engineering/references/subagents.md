# Subagents

> Claude Code 2.1.233. What that means here: this file carries ONE verbatim quote and
> `tools/quote-check.mjs` confirms it still appears upstream. Per-claim provenance lives in
> `evidence/claims.jsonl`, where the gates read it; nothing else is asserted here.


A delegated worker with its own context window and its own tool set. Use it to keep a bounded job out of the main context and to hard-limit what that job can touch. Since v2.1.198 subagents run in the background by default, which changes which tools resolve, so one definition can behave differently foreground and background.

**Layer:** Delegation | **Classification:** primitive | **Status:** stable

## Read this first: declaring a worker, not watching one

- This file is about DECLARING a delegated worker and what it inherits. If the question is about watching, listing or steering agents that are already running, that is the `claude agents` dashboard on `agent-view`, which this library does not cover in any file. The official `agents` page compares all four parallelism shapes [OFFICIAL]
- The word "agent" carries both meanings, and only one of them lives here [ENGINEERING]

## Decide a Subagent is correct

- A bounded, repeated task whose search/logs would flood the main chat?
- Would isolating context or restricting tools improve control?
- The term fork is overloaded across mechanisms: a skill's context: fork does not receive conversation history, while a conversation fork receives the full parent conversation. Never infer context inheritance from the word fork; check [context-modes.md](context-modes.md) for what each delegation shape actually starts with [OFFICIAL]

## Configuration (frontmatter)

- Only name + description are required; BODY = system prompt  [OFFICIAL]
- tools is filtered, not a plain allowlist: nine orchestration tools are removed (Agent only until nested spawning is on, ExitPlanMode unless permissionMode is plan; forks skip both filters entirely), and since v2.1.198 subagents run in the BACKGROUND by default with a reduced built-in set, so one definition resolves differently foreground vs background. An unresolvable list refuses to spawn (v2.1.208+) [OFFICIAL]  [v2.1.198]

## Description quality vs System-prompt quality

- Description → routing
- System prompt (body) → behaviour

## Delegation testing

- Explicit invocation (@-mention / agent tool) works
- Automatic delegation fires on matching tasks
- Does NOT over-delegate unrelated tasks
- Fails-to-delegate cases identified
- No ambiguous ownership with the main agent

## Isolation testing

- Context isolation holds (main context stays clean)
- Tool restrictions enforced (no tool-access violations)
- Returns a useful summary (not too little, not a dump)
- No duplicated work vs the main agent
- Runtime limits: 20 concurrent (CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS) and nesting depth via CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, default 3 layers below the main conversation. The per-session cap is GONE: CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION was REMOVED at v2.1.224 and is now a no-op, so the 200-spawn budget this file used to state as live no longer bounds anything, and a runaway delegation loop is limited by depth and concurrency alone. The Task mode parameter was deprecated at 2.1.212, so a subagent inherits the PARENT permission mode [OFFICIAL]  [v2.1.224]
- A subagent's returned report is untrusted content: v2.1.210+ scans it and marks instruction-shaped text, but the scan never removes anything - tool restriction is the real control [OFFICIAL]  [v2.1.210]

## The return contract

The Definition of Done below asks for `Summary quality verified` and nothing in this file said what
a good summary is, so that item passed by default. `Returns a useful summary (not too little, not
a dump)` under Isolation testing gives a direction and still no way to decide. This section is the
criterion for both.
It matters because of the mechanism under Detail: the RESULT is charged to the CALLER, so the
return is the only part of a delegation the caller pays for.

- SHAPE: schema where you have one, a grep-able literal format where you do not. [workflows.md](workflows.md) gives the better answer wherever it applies, put the requirement in the output SCHEMA so it is enforced at the tool-call layer and retried. A plain subagent has no schema layer, so declare the exact literal line format instead (path:line rows, receipts, severity lines) and the caller can grep the result rather than parse English. [agent-teams.md](agent-teams.md) names an output contract as a field every task carries and never says what one contains; this is what it contains. The anti-pattern is `Return a JSON with your findings`, which is what people actually write and which specifies nothing  [ENGINEERING]
- PASS PATHS, NOT PAYLOADS, IN BOTH DIRECTIONS. Inbound: a caller that pastes a large diff into the dispatch prompt has put the whole thing into ITS OWN context, which is the cost delegation was meant to avoid, and the worker gets a copy regardless. Write it to a file and pass the path. Outbound: detail goes to a named report file and the returned message is capped to status, a one-line test result, concerns, and the report path. That resolves a tension this file states without settling: Isolation testing asks for a summary that is neither too little nor a dump, and the anti-pattern list names too thin as a failure, while neither says how. Once the dump has somewhere else to live, neither failure is available  [ENGINEERING]
- STATUS: a small CLOSED vocabulary, in the FIRST TOKEN. DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT, each with a caller response defined in advance, so the caller branches instead of interpreting. NEEDS_CONTEXT is the one that earns the set: [context-modes.md](context-modes.md) records that an isolated worker which never received what it needed still returns a confident summary the caller cannot distinguish from a well-informed one, and this is the channel that hazard otherwise lacks. First-token placement is not cosmetic, because a status the caller must scan the whole message to find is one the caller will sometimes miss  [ENGINEERING]
- Say explicitly in the prompt that STOPPING IS ALLOWED and is not a failure. [agent-teams.md](agent-teams.md) states the expectation, that teammates report blockers explicitly, and not the permission. Absent the permission a worker optimises for returning something, and something is worse than nothing when it is wrong and confident  [ENGINEERING]
- Define the FAILURE shape, not only the success one, and have it say WHERE PARTIAL WORK WAS LEFT. This is a different failure from the one [workflows.md](workflows.md) covers, where `agent()` resolves to null because the worker died; here the worker RAN, could not finish, and has to say so in a shape the caller can parse. The partial-work field earns its place because a dispatch that half-wrote files is materially worse than one that wrote nothing, and nothing else lets the caller tell those apart  [ENGINEERING]
- NO PREAMBLE: begin with the verdict and stop. [workflows.md](workflows.md) states the mechanism for the workflow API, that `agent()` returns the subagent's FINAL TEXT. Where that holds, a preamble, process narration or closing pleasantry is not politeness, it is corruption of the return value, and every caller has to strip it before parsing  [ENGINEERING]
- Have the worker TAG each claim it returns as verified or assumed. The untrusted-content entry under Isolation testing already treats a returned report as untrusted in the SECURITY sense, that the text may carry instructions. This is the other sense, that the report may be wrong in your favour, and it is the more common one. The library's own evidence tagging (SKILL.md, where untagged means official documentation) is the same technique applied to authored content; nothing applies it to a delegated return, which is where the quiet-failure hazard actually lives  [ENGINEERING]

## Supported fields

| field | purpose |
|---|---|
| name* | identity used to route / @-mention |
| description* | when to delegate (drives routing) |
| tools | allowlist over a FILTERED inherit, not everything: nine orchestration tools (Agent, AskUserQuestion, EndConversation, EnterPlanMode, ExitPlanMode, ScheduleWakeup, TaskOutput, WaitForMcpServers, Workflow) are removed regardless, and since v2.1.198 the background default reduces the built-in set further. disallowedTools applies FIRST, then tools resolves against what remains |
| disallowedTools | subtract from inherited tools. Applied FIRST, then tools resolves against what remains, and a tool named in BOTH lists is REMOVED rather than rejected as a conflict |
| model | `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit`. It DEFAULTS TO `inherit`, so omitting the field is a decision to run on the main conversation's model rather than the absence of one |
| permissionMode | permission behaviour |
| mcpServers | scoped MCP servers |
| hooks | hooks active while this agent runs |
| skills | preload skills into the subagent |
| isolation | worktree = isolated repo copy |
| maxTurns, memory, effort, background, color | misc controls |


## Worked example

**Two ways to create one, and lead with the first.** `/agents` opens an interactive creator inside
Claude Code that writes the file for you and is the shortest path for anyone who just wants a
subagent. Hand-authoring the Markdown is the other way, and it is the one that matters once the
definition is checked into a repo or generated by a tool.

Measured, on "how to make subagents in claude code": the answer from this library went straight to
hand-authoring and never mentioned `/agents`; the competing answer led with it, and blind graders
preferred the competing answer, twice. Omitting the easy path is a real defect in an answer even
when everything stated is correct.

**Where it goes.** `.claude/agents/<name>.md` (project) or `~/.claude/agents/<name>.md` (user).

```markdown
---
name: schema-reviewer
description: Reviews database migrations for reversibility and lock risk.
tools: Read, Grep, Glob
model: sonnet
---

You review database migrations. Report lock risk and whether each step is reversible.
Return a table, one row per migration file.
```

The BODY is the system prompt. There is no `prompt` frontmatter field for file-based subagents.


## Nesting, measured

- MEASURED on 2.1.219, ceiling included: three levels of subagents run, and the enforcement is structural. An L1 subagent spawned L2, L2 spawned L3, and L3 reported the Agent tool ABSENT from its tool list, so a depth-4 spawn is not refused at call time, it is impossible to attempt. The deepest agent that can itself spawn is L2.  [ENGINEERING] [v2.1.219]
- The documentation now AGREES, and it did not when this was measured. The reference page states that a subagent can spawn subagents up to three layers below the main conversation and that at the limit Claude Code WITHHOLDS the `Agent` tool from every subagent except a fork, which is the same structural enforcement the probe observed rather than a coincidentally equal number  [OFFICIAL]  [v2.1.229]

## Measuring a harness limit, because this file publishes one

The ceiling above is a RESULT. Anyone who wants to check it, or measure the next announced limit,
needs the method, and until now this file gave a number without one.

- A SELF-REPLICATING PROBE measures a nesting limit: write one agent prompt that instructs its worker to spawn another agent with the same prompt and a depth counter incremented by one, dispatch it headlessly, and read the ceiling off what actually ran rather than off what was refused. The design point is that the prompt is its own payload, so one dispatch enumerates every layer  [ENGINEERING]
- Classify the ceiling by WHAT THE DEEPEST AGENT COULD SEE, not by an error. The probe here settled the question because L3 reported the `Agent` tool absent from its tool list: a structural limit and a refused call look identical in a transcript, and only the tool list separates them  [ENGINEERING]
- The technique generalises to any announced limit with an observable boundary, and it earns its place precisely when documentation and changelog disagree, which is the condition that produced this measurement. Note how it resolved: the probe was right and the reference page caught up, so a measurement that contradicts the docs is worth recording rather than discarding  [ENGINEERING]
- Re-check a measured limit against the docs on every verification pass. The nesting entry under Detail below records what it cost this file to skip that. The transferable half is the mechanism: a quote-and-capability check cannot catch a claim that went stale, because the claim's own words never change and its quotes keep resolving. Only re-reading the cited page does  [ENGINEERING]

## Common failure modes / anti-patterns

- Reducing the whole mechanism to 'create .claude/agents/name.md' and skipping the routing work.
- Vague description, which produces either no delegation or over-delegation.
- Putting the system prompt in a 'prompt' frontmatter field. That is wrong for file-based agents; the body IS the prompt.
- No tool restriction on a risky agent.
- Summary too thin to be actionable, so the caller has to redo the work.
- Duplicating the main agent's work instead of offloading it.
- Not testing routing separately from behaviour.

## Definition of Done

- Right task routes in; wrong tasks do not
- System prompt produces correct behaviour
- Tool limits enforced
- Context isolation verified
- Summary quality verified
- Regression cases pass

## Detail

- Name collisions resolve managed > --agents CLI > project > user > plugin, so a PROJECT agent beats a same-named USER agent. The winning entry is used whole, with no field merge.  [v2.1.219]
- A specialised Claude instance: own context window, own system prompt, own tools + permissions. A Markdown file under .claude/agents/ (or a plugin agents/). The BODY is the system prompt.
- There is NO prompt frontmatter field for file-based subagents; the Markdown body IS the system prompt. (prompt exists only in the --agents JSON form.) A subagent gets its own prompt plus basic env, NOT the full Claude Code prompt.
- Plugin subagents IGNORE hooks / mcpServers / permissionMode. Project + user .claude/agents/ definitions override same-named plugin agents.
- Two different problems, tested separately. DESCRIPTION governs ROUTING (does the right task reach this agent?). SYSTEM PROMPT (the body) governs BEHAVIOUR (does it do the job well once it runs?). A great prompt behind a vague description never runs.
- The nesting default was once the point where two official sources disagreed, and a live measurement settled it at depth 3 on 2.1.219 while the reference page still said otherwise. The page has since been corrected to match, so the disagreement is HISTORY rather than a live caveat, and this file went on asserting it in three places after it stopped being true. Both halves are the lesson: when documentation cannot settle a question one measurement on the installed build can, and a measurement recorded as contradicting the docs has to be re-checked against them or it becomes the stale claim itself.
- Model resolution has four sources in a fixed ORDER: the `CLAUDE_CODE_SUBAGENT_MODEL` environment variable, then the per-invocation model parameter, then the frontmatter, then the main conversation's model. Since v2.1.196 setting that variable to `inherit` is the same as leaving it unset and resolution continues down the chain; in EARLIER versions `inherit` forced the main conversation's model and ignored the other two, so the same configuration means opposite things across that boundary. All three of the first sources are checked against an organisation availableModels allowlist, and a blocked value is SUBSTITUTED rather than refused: a blocked family alias runs on the newest permitted version of that family, and anything else falls back to the inherited model. The substitution IS announced, but only where someone is watching: in interactive sessions Claude Code warns naming both the requested model and the one the subagent actually runs on  [OFFICIAL]  [v2.1.196]
- The RESULT is charged to the CALLER, which is the fact the whole return contract hangs on. Delegation isolates the work, not the payload: "the verbose output stays in the subagent's context while only the relevant summary returns to your main conversation". So the return is the only part the caller pays for, and a summary that is really a dump costs exactly what delegating was meant to save  [OFFICIAL]  [v2.1.220]
- Built-in subagents ship by default: Explore and Plan (read-only, Write/Edit denied), general-purpose, statusline-setup, claude-code-guide. A same-named user or project agent overrides the built-in and keeps its own model field; remove via permissions.deny or CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1 [OFFICIAL]
