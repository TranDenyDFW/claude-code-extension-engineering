# Context modes

> Claude Code 2.1.219, verified 2026-07-26.


How a piece of work gets its context: the main thread, a forked context, or a fully isolated subagent window. Choose by starting context, tool boundary, communication path and lifecycle, not by how big the task feels.

**Layer:** Delegation &middot; **Classification:** supporting &middot; **Status:** stable

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
