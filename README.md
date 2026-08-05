# claude-code-extension-engineering

![freshness](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FTranDenyDFW%2Fclaude-code-extension-engineering%2Fmain%2Fevidence%2Fstatus.json&query=%24.message&label=claude%20code&color=brightgreen)

Decide which Claude Code extension mechanism should own a behavior BEFORE you build it,
and know exactly what that choice does and does not guarantee. Then run `/extension-doctor`
and find out which of your existing extensions are silently broken right now.

An architecture decision and debugging reference covering CLAUDE.md and rules, skills,
hooks, monitors, subagents, context modes, dynamic workflows, agent teams, MCP servers,
channels, output styles, plugins, LSP, and the programmatic tier (Agent SDK, GitHub
Action). Every claim
is evidence-tagged, version-gated, and backed by a machine-checked provenance ledger.

## The extension doctor

The reference documents how extensions fail silently. The doctor finds those failures in
your actual setup: a read-only, zero-dependency checker that walks the managed policy file,
`~/.claude`, and your project's `.claude/`, and reports what can never fire and why, every
finding citing the reference section and evidence tag behind it.

```
node tools/extension-doctor.mjs
```

or, with the plugin installed, `/extension-doctor`. It covers the cross-scope and semantic
checks measured as covered by NOTHING else (see the benchmark below): a dead skill whose
frontmatter does not parse, a hook under a nonexistent event, a matcher that cannot compile,
a handler file that does not exist, `disableAllHooks` silently switching everything off, the
same key shadowed across settings scopes, an unresolvable subagent tools list, the MEMORY.md
index cap, MCP server-name collisions across scopes, and pinned plugin versions blocking
updates. If the `agnix` linter is installed, its error-level per-file findings are ingested
too, so the two compose instead of competing.

The origin story is this repo's own: its skill shipped with an unparseable description and
was dead for weeks with zero symptoms (see item 19 and the trigger benchmark). The doctor's
first calibrated run on the machine it was built on found the SAME defect class live in two
more installed skills, adjudicated against a real YAML parser, with zero false positives.

**Benchmarked, not asserted.** Four ecosystem linters plus the official validator were
installed sandboxed and run against fifteen committed fixtures encoding the documented
failure modes. Best competitor: 3 of 12. Nothing else caught the matcher validity, the
cross-scope duplicates, settings shadowing, `disableAllHooks`, the missing handler, the
memory cap, MCP scope collisions, the description cap, or version pinning. Full matrix,
FOUR rounds of scoring hardening that each deflated fake catches (the fourth found by an
independent reviewer after publication), and the limitations (including why our own 12 of
12 is by construction and NOT the headline) are in
[tests/results-lint-bench.md](tests/results-lint-bench.md).

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
| Generate and scaffold plugin components | Primary purpose | Composes with it, does not replace it |
| Learn hook, skill, plugin syntax | Strong | Strong |
| Decide WHICH mechanism should own a behavior | Supporting | Primary purpose |
| Compare the nearest rejected alternative | Limited | Primary purpose |
| Cross-mechanism composition semantics | Component-oriented | 24 composition cards |
| Version gates and changelog-only deltas | Not its pitch | Primary purpose |
| Enforcement ownership, failure policy, tamper boundary | Per-component | Cross-component model |
| Published control-vs-treatment benchmark | No | Yes, with limitations stated |
| **Prove the extension BEHAVES as specified** | **No** | **`extension-prove`, measured** |

Use `plugin-dev` to build it. Use this to decide what should be built, how it composes,
what it actually guarantees, which builds support it, and then to PROVE the thing you built
does what you asked for.

### Proving it, which is the part nothing else does

Every shipped checker in this ecosystem asks whether an extension is well-FORMED. None asks
whether it BEHAVES as specified. `plugin-dev/skills/hook-development/scripts/test-hook.sh`
ends with `if [ $exit_code -eq 0 ] || [ $exit_code -eq 2 ]`, printing success for both: exit 0
is allow, exit 2 is deny, and it accepts no expected outcome. It also never reads `hooks.json`,
so the matcher is never evaluated.

```bash
node tools/extension-prove.mjs --bundle <dir>     # assert an expected outcome
node tools/extension-scaffold.mjs --requirement "..." --out <dir>
```

`extension-scaffold` emits the bundle AND a `conformance.json` that `extension-prove` can
fail, then runs it and refuses to report done while any case is red. Measured comparison in
[tests/results-prove-bench.md](tests/results-prove-bench.md): 10 of 10 defects caught versus
3 of 10, both with zero false positives on a correct control.

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

**Tier 1, deterministic regression: 217 questions (set v2), 100% pass.** Each question
carries a regex answer key and a source file, run by
[tests/run-tests.mjs](tests/run-tests.mjs). Near-tautological on the first run since the
keys derive from the content; it earns its keep as a regression gate and through
`--prove-fail`, which guts every source file and confirms all 206 positive assertions go
red. A suite that stays green against deleted content proves nothing; this one cannot.
Set v2 (2026-07-31) added coverage for the marketplace-submission facts, the frontmatter
gotcha, and the measured behaviors, and retired the two known-deficient v1 keys; the
2026-08-05 pass added 26 rows for monitors and channels, including one routing-NEGATIVE
row asserting the skill does not present itself as an observability tool, because
documenting monitors is exactly what creates that over-trigger risk. The changelog is in
[tests/results.md](tests/results.md).

**Tier 2, control versus treatment: 135 questions, 44% unaided versus 100% with the
skill.** Identical model, prompts, and blind adjudicated grading on both arms; the only
difference was access to the skill files. Measured 2026-07-28 on Claude Code 2.1.219
with claude-opus-5. The treatment score is a retrieval result, not a truth result, and
the control had no web access; both caveats are spelled out in
[tests/results.md](tests/results.md) along with per-question detail.

**Tier 3, architecture decisions: 60 scenarios, four arms, twice-graded, and a clean
negative.** The hypothesis was that this reference and the official docs solve different
halves of the rubric, so combining them should beat the docs. Three runs later, on an
instrument rebuilt specifically to detect a small effect, it does not.

Measured 2026-08-02 (v2, repaired keys, one answer pass per arm, every cell graded twice):
unaided 71%, official docs 89%, docs plus a staged decide-then-verify-then-cite procedure
89%, docs plus that procedure plus this skill 89%. **Combined versus docs alone: 21 scenarios
to 20, p=1.000.** A dead heat. The pre-committed rule returned NEGATIVE and nothing shipped.

**What survives is what always survived**: documentation beats unaided recall by 18 points,
48 paired scenarios to 9, p<0.001, robust to dropping any batch. The largest single component
is `version_caveat`, 35% unaided against 81 to 83% with docs, which is the intuitive result
since version gates are exactly what cannot be recalled.

**The instrument is the real product of that work.** v1 could not resolve the question: dead
key fields, documentation arriving unevenly across arms, and one grader in six who
manufactured a headline that had to be retracted. v2 fixes all four defects and gates each
one: a key linter that the frozen v1 set fails at 15 errors and v2 passes at 0; a
byte-identical local docs mirror with sha256 per page; two independent graders per cell with
blind adjudication; and citations carrying verbatim quotes checked against the mirror. First
reliability number this benchmark has ever had: **92% exact inter-grader agreement across
1,680 double-graded cells**, 99% within half a point, zero non-verifying quotes.

So the reference's claim is narrower than the project once hoped and now well measured: it
beats unaided recall, and reaches that from a local read rather than dozens of network
fetches. It adds nothing MEASURABLE once the documentation is present, on a single answer
pass where the three docs arms sit within one point of each other near a ceiling. That is a
statement about what this instrument can resolve, not a proof that no benefit exists.

Full method, both runs, the retraction, the repair log, and the still-open key defects are in
[tests/results-tier3.md](tests/results-tier3.md). Every number is re-derivable from committed
raw grades and CI fails if the prose drifts from them.

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
| Combining mechanisms (24 cards) | [composition-cards.md](skills/claude-code-extension-engineering/references/composition-cards.md) |
| Hooks | [hooks.md](skills/claude-code-extension-engineering/references/hooks.md) |
| Hook event contracts (30 events + deltas) | [hook-events.md](skills/claude-code-extension-engineering/references/hook-events.md) |
| Monitors [EXPERIMENTAL] | [monitors.md](skills/claude-code-extension-engineering/references/monitors.md) |
| Skills | [skills.md](skills/claude-code-extension-engineering/references/skills.md) |
| Subagents | [subagents.md](skills/claude-code-extension-engineering/references/subagents.md) |
| Context modes | [context-modes.md](skills/claude-code-extension-engineering/references/context-modes.md) |
| Dynamic Workflows | [workflows.md](skills/claude-code-extension-engineering/references/workflows.md) |
| Agent Teams [EXPERIMENTAL] | [agent-teams.md](skills/claude-code-extension-engineering/references/agent-teams.md) |
| MCP servers | [mcp.md](skills/claude-code-extension-engineering/references/mcp.md) |
| Channels [EXPERIMENTAL] | [channels.md](skills/claude-code-extension-engineering/references/channels.md) |
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
| `[EXPERIMENTAL]` | Not stable: either off by default until a flag is set, or on as soon as it is configured but carrying a manifest schema, flag syntax, or protocol contract that may change between releases |

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
