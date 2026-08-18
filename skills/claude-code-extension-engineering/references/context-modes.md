# Context modes

> Claude Code 2.1.229, verified 2026-08-13. What that means here: this file carries NO verbatim quotes, so the quote gate says nothing about it; the capability surface moved to 44 current tools and held at 31 current hook events. 129 of 190 mirrored pages changed since 2.1.224 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading.


How a piece of work gets its context: the main thread, a forked context, or a fully isolated subagent window. Choose by starting context, tool boundary, communication path and lifecycle, not by how big the task feels.

**Layer:** Delegation | **Classification:** supporting | **Status:** stable

## Read this first: what a worker STARTS with, not what it RUNS OUT OF

- This file is about inheritance: which context a fork, a subagent or a teammate begins with, and what each cannot see. If the question is about running out of room, compaction, `/compact`, or what each file read costs against the token budget, that is the context WINDOW and it lives on the `context-window` page, which this library does not restate [OFFICIAL]
- Both are "context questions" and they have opposite shapes. Inheritance is about what crosses a boundary at the start; the window is about what survives pressure at the end. Answering one with the other produces advice that is true and inapplicable [ENGINEERING]

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
- What a fork is FOR, as opposed to what it starts with: route a HEAVY INTAKE inside the fork and return only a digest, so the bulky inputs die with the discarded context and only the conclusion crosses back. The frontmatter field is documented above; this is the reason to reach for it  [ENGINEERING]
- There is NO `.claudeignore`. A corpus pattern recommends shipping one to keep build output and bulk data out of context; the string appears zero times across the whole documentation mirror, so it is not a Claude Code mechanism. The nearest real setting is `respectGitignore`, which defaults to true and is NARROWER than the pattern implies: it governs whether the `@` file picker excludes files matching `.gitignore`, not what may enter context by other routes  [OFFICIAL]
