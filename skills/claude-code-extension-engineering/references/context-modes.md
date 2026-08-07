# Context modes

> Claude Code 2.1.224, verified 2026-08-07. Re-verified MECHANICALLY against a refreshed docs mirror: every verbatim quote in this file still appears upstream (tools/quote-check.mjs), and the capability surface is unchanged at 51 tools and 31 hook events. 101 of 186 mirrored pages changed since 2.1.220 and were NOT all re-read, so this is a quote-and-capability check, not a full re-reading.


How a piece of work gets its context: the main thread, a forked context, or a fully isolated subagent window. Choose by starting context, tool boundary, communication path and lifecycle, not by how big the task feels.

**Layer:** Delegation | **Classification:** supporting | **Status:** stable

## Context comparison

- The term fork is overloaded. Skill isolation and conversation forks have different inputs.

## Main session

- Starting context: Current conversation

## Named subagent

- Starting context: Fresh context with its system prompt, delegation message, the full CLAUDE.md hierarchy plus a parent git-status snapshot (but NOT output style, auto memory, or the parent context-window size; Explore and Plan skip CLAUDE.md and git status with no field to change it), and preloaded Skills

## Explicit @agent / Agent invocation

- Starting context: Same named-subagent contract with a user-selected agent

## Skill with context: fork

- Starting context: SKILL.md content becomes the task; current docs say it does not receive conversation history

## Conversation fork (/subtask in current versions)

- Starting context: Full parent conversation, system prompt, tools, model, and prompt cache

## Agent Team teammate

- Starting context: Independent Claude Code session with team task and peer messages
- Selection rule: do not infer context inheritance from the word fork [OFFICIAL]

## Failure posture

- Context isolation fails QUIETLY in one direction only: an isolated worker that never received the context it needed still returns a confident summary, and the caller cannot tell a well-informed answer from an uninformed one. Check what the mode actually starts with, above, rather than assuming inheritance  [ENGINEERING]  [v2.1.220]
- The word fork carries no guarantee about any of this. Two mechanisms both called fork start with different inputs, so treat the label as a name, not a contract  [OFFICIAL]