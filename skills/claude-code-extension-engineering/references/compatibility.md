# Compatibility

> Claude Code 2.1.220, verified 2026-07-29. Delta from 2.1.219: none (changelog: bug fixes and reliability improvements only).


Which Claude Code build introduced each capability. Version gates only: this records when a feature appeared, never that an older build is unsupported. Verify against your own installed build before relying on any of it.

**Layer:** Context / Instruction | **Classification:** supporting | **Status:** stable

## Feature introduction versions

What almost every reader comes here for. Check your own build with claude --version and
compare against the introduction version on each line. The profile contract that governs
how these entries are written is below, under Platform profiles.

- Feature introduction versions - check your build with claude --version [OFFICIAL]
- LSP tool introduced in 2.0.74; plugin-specific behavior still requires a smoke test [OFFICIAL]  [v2.0.74]
- Agent Teams introduced in 2.1.32; the TeamCreate/TeamDelete lifecycle was replaced by the implicit lifecycle at 2.1.178 [OFFICIAL]  [v2.1.32]
- Auto memory available by 2.1.59 [OFFICIAL]  [v2.1.59]
- MCP retry behavior introduced in 2.1.121 [OFFICIAL]  [v2.1.121]
- Plugin ZIP loading introduced in 2.1.128 [OFFICIAL]  [v2.1.128]
- ${CLAUDE_SKILL_DIR} permission substitution introduced in 2.1.129 [OFFICIAL]  [v2.1.129]
- claude plugin init introduced in 2.1.157 [OFFICIAL]  [v2.1.157]
- Current MCP trust behavior introduced in 2.1.196 and tightened in 2.1.207 [OFFICIAL]  [v2.1.196]
- ${CLAUDE_PROJECT_DIR} Skill substitution introduced in 2.1.196 [OFFICIAL]  [v2.1.196]
- Current MCP roots/list_changed behavior introduced in 2.1.203 [OFFICIAL]  [v2.1.203]
- v2.1.216 autocomplete prefix fix for plugin Skills with a name frontmatter field [OFFICIAL]  [v2.1.216]
- Skill background fork behavior introduced in 2.1.218 [OFFICIAL]  [v2.1.218]
- Hook event and handler inventory changes between releases; re-check the changelog after upgrading [OFFICIAL]

## Current support states

- Claude Code - current documentation [OFFICIAL]
- Skills: current frontmatter and user/model invocation model - Supported [OFFICIAL]
- Hooks: 30-event capability matrix spanning five handler types - Supported [OFFICIAL]
- Subagents and conversation forks: current isolated/fork distinctions - Supported [OFFICIAL]
- Agent Teams: implicit lifecycle at v2.1.178+ - Supported / Experimental [OFFICIAL] [EXPERIMENTAL]  [v2.1.178]
- MCP: current transport, trust, retry, roots, and tool-search behavior - Supported [OFFICIAL]
- Plugins: current component inventory and claude plugin init - Supported [OFFICIAL]
- LSP/code intelligence plugins - Supported [OFFICIAL]
- Cowork and cloud sessions, including routines, do not read ~/.claude/skills - a personal skill reports not found on a scheduled run [OFFICIAL]

## Platform profiles, the contract

- Profile contract. One profile per capability, carrying five fields:
  - Stable concept ID, which never gets renamed or repurposed when a platform differs.
  - Platform, plus version or channel.
  - Support state: Supported | Partial | Legacy | Absent | Unverified.
  - Evidence source and verification date.
  - Replacement, migration, or adapter note.
- Never infer support from current documentation alone. Current docs describe the current build, not the one the reader is running.
- Future platform adapters
- Future Claude versions: add a dated profile, diff, migration, and regression result
- Future Codex adapter: map only source-backed equivalents; preserve gaps and non-equivalences
- Unverified platform claims remain placeholders, never operational guidance

## Detail

- Current official Claude Code documentation is canonical; feature introduction versions are an explicit compatibility profile.
- This profile owns canonical current behavior. Re-verification is required before changing the date or claiming a newer baseline.
- Support for each item below depends on the reader's installed build, which this map cannot know. Run claude --version and compare against the introduction version stated on each line.
- Add platform mappings under stable concept IDs. Do not rename or repurpose canonical IDs when a platform differs.
