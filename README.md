# claude-code-extension-engineering

![freshness](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FTranDenyDFW%2Fclaude-code-extension-engineering%2Fmain%2Fevidence%2Fstatus.json&query=%24.message&label=claude%20code&color=brightgreen)

Decide which Claude Code extension mechanism should own a behavior BEFORE you build it,
and know exactly what that choice does and does not guarantee.

An architecture decision and debugging reference covering CLAUDE.md and rules, skills,
hooks, subagents, context modes, dynamic workflows, agent teams, MCP servers, output
styles, plugins, LSP, and the programmatic tier (Agent SDK, GitHub Action). Every claim
is evidence-tagged, version-gated, and backed by a machine-checked provenance ledger.

## Five things this catches that are easy to get wrong

1. **The Windows hook variable trap.** A bare `$CLAUDE_PROJECT_DIR` in a hook command
   parses as an undefined PowerShell variable and resolves to `$null`, so the hook
   silently does nothing. You need `${CLAUDE_PROJECT_DIR}` or `$env:`. And
   `claude --debug` prints nothing to the terminal; the evidence is in
   `~/.claude/debug/SESSION-ID.txt`.
2. **The plugin version cache trap.** A pinned `"version"` in plugin.json means pushed
   commits NEVER reach installed users until the string changes, and plugin.json silently
   wins over a marketplace-entry version. This repo uses commit-SHA versioning for exactly
   that reason, and documents the catch that the commit-SHA model cannot pass
   `claude plugin validate --strict`.
3. **The manifest path replacement trap.** A custom path field in plugin.json REPLACES
   the default folder for that component type instead of adding to it; `skills` is the
   one exception that adds. `${CLAUDE_PLUGIN_ROOT}` changes on every update, so
   persistent state belongs under `${CLAUDE_PLUGIN_DATA}`.
4. **Workflow versus team.** Dynamic Workflows are stable (since 2.1.154) and give
   deterministic fan-out with script-owned control flow. Agent Teams are experimental,
   env-gated, one per session, and cost multiplies per teammate. Most fan-out needs are
   workflows; most "team" instincts are wrong.
5. **The documented event set is not the shipped event set.** The `DirectoryAdded` hook
   landed in the 2.1.219 changelog and is still absent from the hooks reference page, so
   its contract is unverifiable from the docs alone. This reference tracks
   changelog-only deltas as a named section, re-checked per release.

## Why this exists next to plugin-dev

Anthropic's official `plugin-dev` plugin is a comprehensive toolkit for BUILDING plugin
components. This project answers the question that comes before it, and the two compose:

| Need | plugin-dev | This project |
|---|---|---|
| Generate and scaffold plugin components | Primary purpose | No |
| Learn hook, skill, plugin syntax | Strong | Strong |
| Decide WHICH mechanism should own a behavior | Supporting | Primary purpose |
| Compare the nearest rejected alternative | Limited | Primary purpose |
| Cross-mechanism composition semantics | Component-oriented | 18 composition cards |
| Version gates and changelog-only deltas | Not its pitch | Primary purpose |
| Enforcement ownership, failure policy, tamper boundary | Per-component | Cross-component model |
| Published control-vs-treatment benchmark | No | Yes, with limitations stated |

Use `plugin-dev` to build it. Use this to decide what should be built, how it composes,
what it actually guarantees, and which builds support it.

## The 30-second decision guide

Two questions decide most cases. **Who owns enforcement**, the model or the harness?
**Where must it run**, this context or an isolated one? Then pin down the three
properties the word "guarantee" hides: authority (model- vs harness-owned), failure
policy (fail-open, fail-closed, advisory), and tamper boundary (user-, project-, or
managed-policy-configurable). The full axis walk with caveats is
[selection.md](skills/claude-code-extension-engineering/references/selection.md); the
mechanism pairings are
[composition-cards.md](skills/claude-code-extension-engineering/references/composition-cards.md).

## Measured results

`testing.md` in this reference demands a control run before shipping any extension. That
standard is applied to this repo itself, and the numbers are published whether or not
they flatter it.

**Tier 1, deterministic regression: 184 questions (set v2), 100% pass.** Each question
carries a regex answer key and a source file, run by
[tests/run-tests.mjs](tests/run-tests.mjs). Near-tautological on the first run since the
keys derive from the content; it earns its keep as a regression gate and through
`--prove-fail`, which guts every source file and confirms all 174 positive assertions go
red. A suite that stays green against deleted content proves nothing; this one cannot.
Set v2 (2026-07-31) added coverage for the marketplace-submission facts, the frontmatter
gotcha, and the measured behaviors, and retired the two known-deficient v1 keys; the
changelog is in [tests/results.md](tests/results.md).

**Tier 2, control versus treatment: 135 questions, 44% unaided versus 100% with the
skill.** Identical model, prompts, and blind adjudicated grading on both arms; the only
difference was access to the skill files. Measured 2026-07-28 on Claude Code 2.1.219
with claude-opus-5. The treatment score is a retrieval result, not a truth result, and
the control had no web access; both caveats are spelled out in
[tests/results.md](tests/results.md) along with per-question detail.

**Tier 3, architecture decisions: 60 scenarios, three arms, and the skill loses one of
them.** Docs-independent scenarios, blind-graded on a seven-field rubric. Unaided model:
71% (37/60 correct primary choices). Model with the full official docs: 82% (52/60). Model
with this skill: 79% (46/60). The skill beats unaided recall and loses to docs-in-hand
overall, while leading BOTH other arms on the two dimensions it exists for:
rejected-alternative reasoning (78%) and context boundary (93%). The expected keys were
docs-authored, which structurally favors the docs arm; that bias and the rest of the method
are in [tests/results-tier3.md](tests/results-tier3.md).

**Trigger benchmark, live: precision 100%, recall 96%.** One hundred fifty real headless
sessions, three passes per prompt, majority scoring, in a clean profile. The description
never fired on any of the 25 near-miss negatives and fired on 24 of 25 in-scope prompts.
The earlier 16% run turned out to have measured an EMPTY description: the skill's own
frontmatter had been unparseable YAML since authoring, caught the moment the CI validation
gate was armed. The full three-run history, the frontmatter gotcha, and what did and did
not move the number: [tests/results-trigger.md](tests/results-trigger.md).

## Evidence, not just tags

Every tagged claim in the references maps to a record in
[evidence/claims.jsonl](evidence/claims.jsonl); every source carries a URL, retrieval
date, and status in [evidence/sources.json](evidence/sources.json); measured behaviours
have reproduction commands under [evidence/observations/](evidence/observations/).
[tools/verify-evidence.mjs](tools/verify-evidence.mjs) checks the ledger's integrity,
including drift detection when a tagged line moves, and CI runs it on every push. A
daily workflow compares the verified build against the latest npm release and opens a
verification issue when Claude Code moves ahead; the badge above is that status.

## Install

**Marketplace listing pending.** This plugin has been submitted to the Claude Code
community marketplace and is under review. Once approved it will install with
`/plugin install claude-code-extension-engineering@claude-community`. Until then, two
paths work today:

**As a plugin, loaded from a clone:**

```bash
git clone https://github.com/TranDenyDFW/claude-code-extension-engineering.git
claude --plugin-dir ./claude-code-extension-engineering
```

**As a plain skill.** Clone anywhere, then copy the skill directory into a skills folder:

```bash
git clone https://github.com/TranDenyDFW/claude-code-extension-engineering.git
cp -r claude-code-extension-engineering/skills/claude-code-extension-engineering ~/.claude/skills/
```

Use `.claude/skills/` instead to scope it to one project. The destination directory name
must stay `claude-code-extension-engineering`.

> Note: Cowork and cloud sessions do not read `~/.claude/skills`; see
> [compatibility.md](skills/claude-code-extension-engineering/references/compatibility.md).

## What is inside

All paths under `skills/claude-code-extension-engineering/`. Start at
[SKILL.md](skills/claude-code-extension-engineering/SKILL.md), or go straight to
[selection.md](skills/claude-code-extension-engineering/references/selection.md) if you
are choosing between mechanisms.

| Need | Open |
|---|---|
| Choosing between mechanisms | [selection.md](skills/claude-code-extension-engineering/references/selection.md) |
| Combining mechanisms (18 cards) | [composition-cards.md](skills/claude-code-extension-engineering/references/composition-cards.md) |
| Hooks | [hooks.md](skills/claude-code-extension-engineering/references/hooks.md) |
| Hook event contracts (30 events + deltas) | [hook-events.md](skills/claude-code-extension-engineering/references/hook-events.md) |
| Skills | [skills.md](skills/claude-code-extension-engineering/references/skills.md) |
| Subagents | [subagents.md](skills/claude-code-extension-engineering/references/subagents.md) |
| Context modes | [context-modes.md](skills/claude-code-extension-engineering/references/context-modes.md) |
| Dynamic Workflows | [workflows.md](skills/claude-code-extension-engineering/references/workflows.md) |
| Agent Teams [EXPERIMENTAL] | [agent-teams.md](skills/claude-code-extension-engineering/references/agent-teams.md) |
| MCP servers | [mcp.md](skills/claude-code-extension-engineering/references/mcp.md) |
| Plugins | [plugins.md](skills/claude-code-extension-engineering/references/plugins.md) |
| LSP / code intelligence | [lsp.md](skills/claude-code-extension-engineering/references/lsp.md) |
| CLAUDE.md family | [claude-md-family.md](skills/claude-code-extension-engineering/references/claude-md-family.md) |
| Auto memory | [auto-memory.md](skills/claude-code-extension-engineering/references/auto-memory.md) |
| Custom Output Styles | [output-styles.md](skills/claude-code-extension-engineering/references/output-styles.md) |
| Custom Themes | [themes.md](skills/claude-code-extension-engineering/references/themes.md) |
| Agent SDK | [agent-sdk.md](skills/claude-code-extension-engineering/references/agent-sdk.md) |
| Claude Code GitHub Action | [github-action.md](skills/claude-code-extension-engineering/references/github-action.md) |
| Testing and iteration | [testing.md](skills/claude-code-extension-engineering/references/testing.md) |
| Compatibility and version gates | [compatibility.md](skills/claude-code-extension-engineering/references/compatibility.md) |
| Evidence sources | [sources.md](skills/claude-code-extension-engineering/references/sources.md) |

## Evidence tags

| Tag | Meaning |
|---|---|
| *(untagged)* | Official documentation |
| `[ANTHROPIC]` | An Anthropic recommendation |
| `[ENGINEERING]` | Engineering judgment |
| `[COMMUNITY]` | Community practice |
| `[vX.Y.Z]` | The build a behaviour was introduced in or verified against |
| `[EXPERIMENTAL]` | Off by default, may change |

Verified against Claude Code **2.1.220** on **2026-07-29**. Version gates record when a
feature appeared, never that an older build is unsupported; check your own build with
`claude --version`.

## Methodology and re-running

```bash
node tests/run-tests.mjs
node tests/run-tests.mjs --prove-fail
node tools/verify-evidence.mjs
```

Tier 1 green, prove-fail red, and the evidence gate green are the release bar. Full
grading method, adjudication protocol, and per-question tables:
[tests/results.md](tests/results.md). Known gaps: [IMPROVEMENTS.md](IMPROVEMENTS.md).

## Sources and licensing

[sources.md](skills/claude-code-extension-engineering/references/sources.md) carries the
source ledger. The prose here is original work derived from public documentation and
direct observation of an installed environment; no upstream proprietary text is
redistributed verbatim in bulk. Third-party licences worth naming: Superpowers
writing-skills (MIT, Jesse Vincent) and the Anthropic Skill Creator (Apache-2.0).

## Licence

MIT. See [LICENSE](LICENSE).
