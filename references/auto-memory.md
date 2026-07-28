# Auto memory

> Claude Code 2.1.219, verified 2026-07-26.


Claude-authored persistent notes per repository, on by default. Cross-referenced because it competes with CLAUDE.md for the same job, not because you author it.

**Layer:** Context / Instruction &middot; **Classification:** builtin &middot; **Status:** builtin

## What it is

- Claude writes its own persistent markdown notes across sessions (build commands, debugging insights, workflow habits) driven by the user's corrections. It is on by default and is not authored by hand.
- A subagent can keep its own separate auto-memory directory through the subagent memory field, distinct from the main conversation's memory.
- Choose CLAUDE.md when the instruction must be stable, reviewable and version-controlled. Auto memory is Claude's own record and you do not control what it keeps.  [ENGINEERING]
