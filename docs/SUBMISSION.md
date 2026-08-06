# Marketplace submission text

Paste-ready fields for platform.claude.com/plugins/submit (Console form, individual
authors) or the claude.ai directory form (Team/Enterprise orgs). Numbers below must match
README.md, tests/results.md and tests/results-tier3.md at submission time; re-check before
pasting. The Tier 3 negative result travels with the Tier 2 headline: whenever the 44/100
figure is quoted here, the dead heat against the docs is quoted next to it.

## Link to plugin

https://github.com/TranDenyDFW/claude-code-extension-engineering

## Path within repository

(leave blank; .claude-plugin/ is at the repo root)

## Plugin homepage

https://github.com/TranDenyDFW/claude-code-extension-engineering

## Plugin name

claude-code-extension-engineering

## Plugin description

Choose the right Claude Code extension mechanism before you build it.

This is an architecture decision and debugging reference for Claude Code extensions:
CLAUDE.md and rules, skills, hooks, subagents, dynamic workflows, agent teams, MCP
servers, output styles, plugins, LSP and code intelligence, and the programmatic Agent
SDK and GitHub Action tier.

It is not a generator or a linter. Its purpose is to answer the expensive question
first: which mechanism should own this behavior, and why is the nearest alternative
wrong? The selection model distinguishes model-owned behavior from harness-owned
enforcement, current-context work from isolated execution, lifecycle triggers from
procedural guidance, and individual delegation from deterministic fan-out and peer
coordination. Ownership is analyzed past the word "guarantee" into authority, failure
policy (fail-open, fail-closed, advisory), and tamper boundary (user, project, managed
policy).

Includes a cross-mechanism selection guide, 28 composition cards, 31 documented
hook-event contracts including DirectoryAdded, which the docs gained on 2026-08-03, dated
build and version gates, platform-specific failure modes, and a machine-checked evidence
ledger giving every tagged claim a source, retrieval date, and drift detection.

The reference is tested rather than merely asserted. The suite carries 191 deterministic
regression checks with a prove-fail inversion, plus a separate 135-question
control-versus-treatment evaluation on which the same model scored 44 percent from
unaided recall and 100 percent with the reference available. Those numbers are
intentionally scoped: the treatment result demonstrates the information is findable and
unambiguous, not that every underlying product claim is automatically true.

The next benchmark up returned NEGATIVE, and it is published beside the good one. On 60
architecture-decision scenarios, four arms, every cell graded twice: unaided 71 percent,
official docs 89 percent, docs plus a staged decide-then-verify-then-cite procedure 89
percent, and docs plus that procedure plus this reference 89 percent. Combined versus docs
alone is 21 paired scenarios to 20, p=1.000, a dead heat, so the pre-committed rule
returned negative and nothing shipped on the strength of it. What survives is the
retrieval result: documentation beats unaided recall by 18 points, 48 paired scenarios to
9, p<0.001, robust to dropping any grading batch. So the honest claim is the narrow one.
Having this material locally, organized, and citable beats unaided recall by a wide
margin; the authored decision layer added nothing MEASURABLE once the official docs were
already in the arm, on an instrument whose three docs arms sit within one point of each
other near a ceiling. That is a statement about what this benchmark can resolve, not a
proof that no benefit exists, and it is stated here rather than left to the reader to find.

The repository publishes the question sets, grading method, per-question results, known
limitations, and verification gaps, and a daily freshness workflow flags every new
Claude Code release for re-verification.

Use Anthropic's plugin-dev when you need help constructing plugin components. Use this
reference when you need to decide which components should exist, how they should
compose, what guarantees they actually provide, and which Claude Code versions support
them.

## Example use cases

Example 1: You need writes outside /src prevented no matter what the model decides. The
selection guide routes by enforcement ownership to a PreToolUse hook, then makes you pin
down the parts "guarantee" hides: the handler's failure policy (an HTTP handler fails
open on connection failure), and the tamper boundary (disableAllHooks kills every user
hook; enforcement that must survive the user needs the managed-policy tier).

Example 2: Your hook works on macOS and silently does nothing on Windows. The hooks
reference records that a bare $CLAUDE_PROJECT_DIR parses as an undefined variable and
resolves to null, and that claude --debug writes its evidence to a file while printing
nothing to the terminal.

Example 3: You push a fix to your plugin and installed users never receive it. The
plugins reference records the version resolution order, the pinned-version cache trap,
and the catch that the documented commit-SHA model cannot pass validate --strict.

Example 4: You need identical analysis over 300 files with deterministic fan-out. The
three-way composition card separates script-owned control flow (Dynamic Workflows,
stable since 2.1.154) from experimental env-gated peer coordination (Agent Teams) and
from a single subagent, by who owns the control flow and how each one fails.

Example 5: You wire a SessionStart hook and assume it is context-only. The event
contract table lists its five special outputs, including that watchPaths requires
absolute paths and that initialUserMessage creates the first turn in non-interactive
mode rather than attaching to one.
