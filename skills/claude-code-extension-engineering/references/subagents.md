# Subagents

> Claude Code 2.1.224, verified 2026-08-07. Re-verified MECHANICALLY against a refreshed docs mirror: every verbatim quote in this file still appears upstream (tools/quote-check.mjs), and the capability surface is unchanged at 51 tools and 31 hook events. 101 of 186 mirrored pages changed since 2.1.220 and were NOT all re-read, so this is a quote-and-capability check, not a full re-reading.


A delegated worker with its own context window and its own tool set. Use it to keep a bounded job out of the main context and to hard-limit what that job can touch. Since v2.1.198 subagents run in the background by default, which changes which tools resolve, so one definition can behave differently foreground and background.

**Layer:** Delegation | **Classification:** primitive | **Status:** stable

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
- Runtime limits: 20 concurrent (CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS), 200 per session (CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION, reset by /clear), nesting depth via CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH. The nesting default was measured on 2.1.219 at depth 3: three levels run, and the third level has no Agent tool to spawn a fourth (see Nesting, measured). The subagents reference page still says nesting is off, which does not match the measured build. The Task mode parameter was deprecated at 2.1.212, so a subagent inherits the PARENT permission mode [OFFICIAL]  [v2.1.219]
- A subagent's returned report is untrusted content: v2.1.210+ scans it and marks instruction-shaped text, but the scan never removes anything - tool restriction is the real control [OFFICIAL]  [v2.1.210]

## Supported fields

| field | purpose |
|---|---|
| name* | identity used to route / @-mention |
| description* | when to delegate (drives routing) |
| tools | allowlist over a FILTERED inherit, not everything: nine orchestration tools (Agent, AskUserQuestion, EndConversation, EnterPlanMode, ExitPlanMode, ScheduleWakeup, TaskOutput, WaitForMcpServers, Workflow) are removed regardless, and since v2.1.198 the background default reduces the built-in set further. disallowedTools applies FIRST, then tools resolves against what remains |
| disallowedTools | subtract from inherited tools |
| model | e.g. sonnet / haiku / inherit |
| permissionMode | permission behaviour |
| mcpServers | scoped MCP servers |
| hooks | hooks active while this agent runs |
| skills | preload skills into the subagent |
| isolation | worktree = isolated repo copy |
| maxTurns, memory, effort, background, color | misc controls |


## Worked example

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

- MEASURED on 2.1.219, ceiling included: three levels of subagents run, and the enforcement is structural. An L1 subagent spawned L2, L2 spawned L3, and L3 reported the Agent tool ABSENT from its tool list, so a depth-4 spawn is not refused at call time, it is impossible to attempt. This matches the changelog's depth-3 default and settles the disagreement: the subagents reference page saying nesting is off does not match this build. The deepest agent that can itself spawn is L2.  [ENGINEERING] [v2.1.219]

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
- The nesting default was the one point where two official sources disagreed; a live measurement settled it at depth 3 on 2.1.219, with the reference page still carrying the stale "off". When documentation cannot settle a question, one measurement on the installed build can.
- Built-in subagents ship by default: Explore and Plan (read-only, Write/Edit denied), general-purpose, statusline-setup, claude-code-guide. A same-named user or project agent overrides the built-in and keeps its own model field; remove via permissions.deny or CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1 [OFFICIAL]
