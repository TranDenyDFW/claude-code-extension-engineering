# claude-code-extension-engineering

A Claude Code skill for building and debugging Claude Code extensions.

Ten authored extension mechanisms across seven layers, plus a cross-referenced programmatic
tier (Agent SDK, GitHub Action). The skill's job is to make you pick the mechanism *before*
you write it: most of these look interchangeable until you need one to guarantee something,
and choosing wrong is the expensive mistake. Two questions decide most cases. Who must
guarantee the outcome, the harness or the model? And where must it run, this context or an
isolated one?

## Install

**As a plugin (recommended).** In Claude Code:

```
/plugin marketplace add TranDenyDFW/claude-code-extension-engineering
```

then install it:

```
/plugin install claude-code-extension-engineering
```

**As a plain skill.** Clone anywhere, then copy the skill directory into a skills folder:

```bash
git clone https://github.com/TranDenyDFW/claude-code-extension-engineering.git
cp -r claude-code-extension-engineering/skills/claude-code-extension-engineering ~/.claude/skills/
```

Use `.claude/skills/` instead of `~/.claude/skills/` to scope it to one project. The
destination directory name must stay `claude-code-extension-engineering`, because a personal
or project skill takes its command name from the directory.

**Without git:** download the source zip from the GitHub UI and copy
`skills/claude-code-extension-engineering/` out of it into either location.

Verify with `/skills` in Claude Code, or just describe an extension problem and let the model
route to it.

> Note: Cowork and cloud sessions do not read `~/.claude/skills`, so a personally installed
> skill reports "not found" on a scheduled run. See
> [compatibility.md](skills/claude-code-extension-engineering/references/compatibility.md) for
> the details.

## What is inside

| Need | Open |
|---|---|
All paths below are under `skills/claude-code-extension-engineering/`.

| Need | Open |
|---|---|
| Auto memory | [auto-memory.md](skills/claude-code-extension-engineering/references/auto-memory.md) |
| CLAUDE.md family | [claude-md-family.md](skills/claude-code-extension-engineering/references/claude-md-family.md) |
| Compatibility | [compatibility.md](skills/claude-code-extension-engineering/references/compatibility.md) |
| Custom Output Styles | [output-styles.md](skills/claude-code-extension-engineering/references/output-styles.md) |
| Custom Themes | [themes.md](skills/claude-code-extension-engineering/references/themes.md) |
| Skills | [skills.md](skills/claude-code-extension-engineering/references/skills.md) |
| Testing and iteration | [testing.md](skills/claude-code-extension-engineering/references/testing.md) |
| Hooks | [hooks.md](skills/claude-code-extension-engineering/references/hooks.md) |
| Context modes | [context-modes.md](skills/claude-code-extension-engineering/references/context-modes.md) |
| Subagents | [subagents.md](skills/claude-code-extension-engineering/references/subagents.md) |
| Agent Teams [EXPERIMENTAL] | [agent-teams.md](skills/claude-code-extension-engineering/references/agent-teams.md) |
| Dynamic Workflows | [workflows.md](skills/claude-code-extension-engineering/references/workflows.md) |
| MCP servers | [mcp.md](skills/claude-code-extension-engineering/references/mcp.md) |
| LSP / code intelligence | [lsp.md](skills/claude-code-extension-engineering/references/lsp.md) |
| Plugins | [plugins.md](skills/claude-code-extension-engineering/references/plugins.md) |
| Agent SDK | [agent-sdk.md](skills/claude-code-extension-engineering/references/agent-sdk.md) |
| Claude Code GitHub Action | [github-action.md](skills/claude-code-extension-engineering/references/github-action.md) |
| Choosing between them | [selection.md](skills/claude-code-extension-engineering/references/selection.md) |
| Combining two mechanisms | [composition-cards.md](skills/claude-code-extension-engineering/references/composition-cards.md) |
| Hook event contracts | [hook-events.md](skills/claude-code-extension-engineering/references/hook-events.md) |
| Evidence sources | [sources.md](skills/claude-code-extension-engineering/references/sources.md) |

Start at [SKILL.md](skills/claude-code-extension-engineering/SKILL.md) or, if you already know
you are choosing between mechanisms, go straight to
[selection.md](skills/claude-code-extension-engineering/references/selection.md).

## Evidence tags

Every claim is tagged by how well it is backed:

| Tag | Meaning |
|---|---|
| *(untagged)* | Official documentation |
| `[ANTHROPIC]` | An Anthropic recommendation |
| `[ENGINEERING]` | Engineering judgment |
| `[COMMUNITY]` | Community practice |
| `[vX.Y.Z]` | The build a behaviour was verified against |
| `[EXPERIMENTAL]` | Off by default, may change |

## Verified against

Claude Code **2.1.219**, verified **2026-07-26**.

[compatibility.md](skills/claude-code-extension-engineering/references/compatibility.md) records which build introduced
each capability. Those are version gates only: they say when a feature appeared, never that
an older build is unsupported. Check your own build with `claude --version` and compare.

Hook events, plugin components and MCP behaviour all move between releases. Re-read the
changelog after upgrading rather than trusting a dated profile.

## Measured results

`references/testing.md` says to run the task without the extension first and record what
happens, because a control run is what separates content worth shipping from content the model
produces unaided. That measurement is applied to this repo, and the numbers are published
whether or not they flatter it.

**Tier 1, deterministic content coverage.** 160 questions, each with a regex answer key and a
source file, run by [tests/run-tests.mjs](tests/run-tests.mjs).

| Category | n | Pass | Rate |
|---|---|---|---|
| factual | 105 | 105 | 100% |
| navigation | 15 | 15 | 100% |
| routing-positive | 15 | 15 | 100% |
| routing-negative | 10 | 10 | 100% |
| anti-hallucination | 15 | 15 | 100% |
| **TOTAL** | **160** | **160** | **100%** |

That 100% is close to tautological on its own, because the keys were extracted from the
content. It is meaningful for two reasons. `--prove-fail` gutted every source file and
**150 of 150 positive assertions went red**, so the suite is not self-certifying. And it is a
regression gate: when a future Claude Code build changes a fact, the affected rows break.

**Tier 2, control versus treatment.** The same 135 non-routing questions asked twice, once by
subagents with no access to the skill and once by subagents reading only the skill files.
Identical model, prompts and grading on both sides.

| Category | n | Control | Treatment | Delta |
|---|---|---|---|---|
| factual | 105 | 50 (48%) | 105 (100%) | +55 |
| navigation | 15 | 1 (7%) | 15 (100%) | +14 |
| anti-hallucination | 15 | 9 (60%) | 15 (100%) | +6 |
| **TOTAL** | **135** | **60 (44%)** | **135 (100%)** | **+56 points** |

Measured 2026-07-28 against Claude Code 2.1.219 with `claude-opus-5`, question set v1.

**What this does not prove.** The treatment arm read the files the answer keys came from, so
100% means the content is findable and unambiguous, not that it is *true* of Claude Code. The
control arm had no web access, so 44% is unaided recall, not what a model with the official
docs open would score. Tier 2 is model-graded and will not reproduce exactly.
[context-modes.md](skills/claude-code-extension-engineering/references/context-modes.md) scored 100% in **both** arms, which
is evidence that one file is currently earning nothing.

Full method, the blind adjudication pass, per-file breakdown and all 135 per-question rows are
in [tests/results.md](tests/results.md). Open gaps are tracked in [IMPROVEMENTS.md](IMPROVEMENTS.md).

### Re-running

```bash
node tests/run-tests.mjs
node tests/run-tests.mjs --prove-fail
```

Tier 1 green and prove-fail red are the release gate.

## Sources and licensing

[sources.md](skills/claude-code-extension-engineering/references/sources.md) carries the full source table: every entry
with its verification date, redistributability and licence.

The prose in this repository is original work, derived from public documentation and from
direct observation of an installed Claude Code environment. No upstream proprietary text is
redistributed verbatim in bulk. Rows in the source table marked "Redistributable: no" refer
to those upstream documentation pages, not to the text here.

Two third-party sources carry licences worth naming directly:

- Superpowers `writing-skills`, MIT, Copyright (c) 2025 Jesse Vincent
- Anthropic official Skill Creator, Apache-2.0

## Licence

MIT. See [LICENSE](LICENSE).
