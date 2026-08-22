# Auto memory

> Claude Code 2.1.239. What that means here: this file carries NO verbatim quotes, so the quote gate
> says nothing about it. Per-claim provenance lives in `evidence/claims.jsonl`, where the gates read
> it; nothing else is asserted here.


Claude-authored persistent notes per repository, on by default. Cross-referenced because it competes with CLAUDE.md for the same job, not because you author it.

**Layer:** Context / Instruction | **Classification:** builtin | **Status:** builtin

## What it is

- Claude writes its own persistent markdown notes across sessions (build commands, debugging insights, workflow habits) driven by the user's corrections. It is on by default and is not authored by hand.
- A subagent can keep its own separate auto-memory directory through the subagent memory field, distinct from the main conversation's memory. Each subagent reads and writes its OWN `MEMORY.md`, not the main session's  [OFFICIAL]
- **`MEMORY.md` is the INDEX, not the memory.** It lives in `~/.claude/projects/<project>/memory/`, Claude writes and maintains it, and only its first 200 lines (capped at 25KB, whichever comes first) load at session start. It points at topic files like `debugging.md` or `architecture.md`, which Claude creates when the index grows too long and reads back ON DEMAND rather than at startup. All of it is plain markdown you may edit or delete, and Claude will keep updating it  [OFFICIAL]
- The `<project>` segment is derived from the GIT REPOSITORY, so every worktree and subdirectory of one repo shares a single auto-memory directory. Outside a git repo the project root is used instead. This is not the same derivation as the transcript directory, which is keyed by working-directory path  [OFFICIAL]
- A topic file carries FLAT frontmatter, `name`, `description` and `type` at the top level. Do not describe a nested `metadata:` block or a fixed vocabulary of memory types: the documented example shows `type: reference`, and the index groups entries under plain headings. **A local convention someone built on top of auto memory is not the product's format**, and stating one as the other is the exact error this library exists to prevent  [ENGINEERING]
- Choose CLAUDE.md when the instruction must be stable, reviewable and version-controlled. Auto memory is Claude's own record and you do not control what it keeps. Auto memory was available by 2.1.59, so on earlier builds CLAUDE.md is the only option rather than the preferred one.  [ENGINEERING]  [v2.1.59]

## The `#` shortcut is GONE, and its absence is the usual complaint

- Starting a message with `#` once added it to memory directly. The shortcut arrived in v0.2.54 and was REMOVED in v2.0.70, whose changelog entry directs users to tell Claude to edit CLAUDE.md instead  [OFFICIAL]  [v2.0.70]
- On a current build the documented replacement is to ask Claude to edit CLAUDE.md, which is what the removal entry itself directs  [OFFICIAL]  [v2.0.70]
- The other route is auto memory, which the memory page states is on by default, so the note may already be captured with no shortcut involved. It is toggled from `/memory`, which writes `autoMemoryEnabled` to user settings, and can be turned off per project by setting the same key there  [OFFICIAL]
- So a report that the `#` memory shortcut stopped working is not a broken configuration and there is nothing to repair. The feature was withdrawn, and no setting brings it back  [ENGINEERING]  [v2.0.70]
- Establish the build before diagnosing anything else. A user on a pre-2.0.70 CLI still HAS the shortcut, so the identical symptom means opposite things either side of that line and every other explanation is a wasted step  [ENGINEERING]  [v2.0.70]
