# CLAUDE.md family

> Claude Code 2.1.233. What that means here: this file carries NO verbatim quotes, so the quote gate
> says nothing about it. Per-claim provenance lives in `evidence/claims.jsonl`, where the gates read
> it; nothing else is asserted here.


Instruction files loaded into context automatically, every session. CLAUDE.md at four scopes (managed, user, project, directory), CLAUDE.local.md, @path imports that recurse up to four hops, and .claude/rules for modular or path-scoped sets. This is the only mechanism that costs context whether or not it is used, so it is the wrong home for anything procedural or long.

**Layer:** Context / Instruction | **Classification:** primitive | **Status:** stable

## Scope and loading

- Additive is true of CLAUDE.md only. Skills, Subagents, and MCP servers OVERRIDE by name: skills managed > user > project; subagents managed > --agents CLI > project > user > plugin; MCP local > project > user, and the winning entry is used whole with no field merge. Plugin skills are namespaced. Hooks are the inverse: all registered hooks MERGE and every match fires, so a local hook cannot replace a plugin hook [OFFICIAL]
- Files from the working directory upward load at launch; nested files load as work enters them [OFFICIAL]
- More-specific instructions typically take precedence through model judgment [OFFICIAL]

## Rules, imports, and modularization

- .claude/rules separates unconditional and path-scoped guidance [OFFICIAL]
- @path imports organize content but do not reduce launch context by themselves [OFFICIAL]
- Target fewer than 200 lines per CLAUDE.md [ANTHROPIC RECOMMENDATION]  [ANTHROPIC]

## CLAUDE.md versus auto memory

- CLAUDE.md is authored instruction; auto memory is Claude-authored learning [OFFICIAL]
- Review auto memory separately; never treat it as a policy file [ENGINEERING BEST PRACTICE]  [ENGINEERING]

## Testing and maintenance

- Start a fresh session and verify the intended files load [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Test conflicting scopes and path-trigger boundaries [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Trim derivable facts, stale commands, duplicated references, and vague prose [ANTHROPIC RECOMMENDATION]  [ANTHROPIC]
- Re-test after directory moves, imports, or Claude Code upgrades [ENGINEERING BEST PRACTICE]  [ENGINEERING]

## CLAUDE.md and Rules

- Use for concise, durable project facts and conventions [OFFICIAL]
- Do not use as a guaranteed enforcement boundary [OFFICIAL]
- Repository owners maintain project instructions; users maintain personal instructions [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Path scoping is declared with a paths: YAML frontmatter glob list; a rule without paths loads at launch with .claude/CLAUDE.md priority, and a path-scoped rule triggers when Claude READS a matching file, not on every tool use [OFFICIAL]
- Claude Code reads CLAUDE.md, never AGENTS.md: bridge with an @AGENTS.md import (a symlink needs Administrator or Developer Mode on Windows) [OFFICIAL]
- @path imports resolve relative to the IMPORTING file, recurse at most four hops, and are skipped inside backticks or code fences; a project import resolving outside the working directory prompts once and a decline disables it permanently [OFFICIAL]
- Verify with /context and read the Memory files list; browse and edit with /memory; bootstrap with /init [OFFICIAL]

## Instruction surfaces are model-read text, and so is anything they import

CLAUDE.md, `.claude/rules`, a skill body, a subagent prompt and an MCP tool description are all
text the model reads as guidance. That makes them an injection surface, and the surfaces load
independently of each other.

- A rule stated in ONE instruction surface is absent from the others, because each is loaded on its own path. Anything you rely on holding everywhere has to be restated everywhere, or scoped to the surface that actually carries it  [ENGINEERING]
- Invisible and confusable Unicode is a real vector in exactly these files: zero-width characters, bidirectional overrides and homoglyphs render as nothing or as something else while still being read. A file that looks clean in a diff can carry text the model follows  [ENGINEERING]
- The exposure is highest where the content is not yours: an imported `@path`, a vendored rules file, a skill installed from a marketplace. Review those as code rather than as prose  [ENGINEERING]
- None of this is enforcement. See Failure posture below for why: a defence written in an instruction surface is a request, and the enforcing equivalents are a hook or a permission rule  [ENGINEERING]

## Definition of Done

- Scope and owner are explicit
- Instructions are concise, specific, and non-duplicative
- Path rules load only where intended
- Imports resolve
- No claim of deterministic enforcement
- Fresh-session and conflict tests pass


## Failure posture

- CLAUDE.md is ADVISORY by construction: it is context, not configuration, and there is no failure mode in which it forces an outcome. A rule that must hold belongs in a hook or a permission rule; anything written here is a request the model can miss under pressure  [ENGINEERING]  [v2.1.220]
- Import failure is silent: an @path that does not resolve, or that exceeds the four-hop limit, drops that content with no error surfaced in the session. Verify imports resolve in a fresh session rather than assuming loaded means present  [ENGINEERING]

## Detail

- Persistent project, user, organization, and directory-scoped instructions loaded into Claude Code context.
- ANTI-PATTERN with a named instance: a CHANGELOG inside the always-loaded instruction file. The 200-line target and the rule against anything procedural or long are already here; the changelog is the case that makes them actionable, because it grows monotonically, is read by nobody, and pays its context cost on every session forever  [ENGINEERING]
