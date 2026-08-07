# Auto memory

> Claude Code 2.1.224, verified 2026-08-07. Re-verified MECHANICALLY against a refreshed docs mirror: every verbatim quote in this file still appears upstream (tools/quote-check.mjs), and the capability surface is unchanged at 51 tools and 31 hook events. 101 of 186 mirrored pages changed since 2.1.220 and were NOT all re-read, so this is a quote-and-capability check, not a full re-reading.


Claude-authored persistent notes per repository, on by default. Cross-referenced because it competes with CLAUDE.md for the same job, not because you author it.

**Layer:** Context / Instruction | **Classification:** builtin | **Status:** builtin

## What it is

- Claude writes its own persistent markdown notes across sessions (build commands, debugging insights, workflow habits) driven by the user's corrections. It is on by default and is not authored by hand.
- A subagent can keep its own separate auto-memory directory through the subagent memory field, distinct from the main conversation's memory.
- Choose CLAUDE.md when the instruction must be stable, reviewable and version-controlled. Auto memory is Claude's own record and you do not control what it keeps. Auto memory was available by 2.1.59, so on earlier builds CLAUDE.md is the only option rather than the preferred one.  [ENGINEERING]  [v2.1.59]
