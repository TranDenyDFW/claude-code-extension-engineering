# Tier 3: architecture-decision benchmark

Scenario set v1 ([architecture-scenarios.jsonl](architecture-scenarios.jsonl), 60 scenarios),
unchanged across every run below. Answering and grading model: `claude-opus-5`.

The current run is the 2026-08-02 four-arm run. The two earlier tables are kept as history,
labelled with the content state they measured.

## What this measures

Tiers 1 and 2 measure whether facts are present and retrievable. Tier 3 measures the thing
the skill is actually for: does it produce better ARCHITECTURE DECISIONS? Sixty realistic
engineering needs, none naming a mechanism, each with a seven-field expected key: primary
mechanism, nearest rejected alternative, enforcement owner, context boundary, lifecycle,
failure mode, and version or experimental caveat.

---

# The 2026-08-02 four-arm run

## The question, and why the arms are shaped this way

Earlier runs showed the skill beating unaided recall and losing to docs-in-hand. The per-field
split suggested the two were solving different halves of the rubric, so the obvious next move
was to combine them and see whether the combination beat the docs.

An arm holding BOTH the docs and the skill has strictly more capability than either baseline,
so it should win, and the win would say only that more context helps. Two factors had to be
separated: the RESOURCE (docs alone versus docs plus the skill) and the PROCEDURE (answer
freely versus decide the structure first, then verify each factual field and cite it).

| Arm | Resource | Procedure | What it isolates |
|---|---|---|---|
| A | none, model knowledge only | free-form | calibration: is the instrument discriminating at all |
| B | official docs | free-form | the baseline to beat |
| B+ | official docs | staged | whether the PROCEDURE alone explains a gain |
| D | docs + this skill | staged, driven by `selection.md` | the thing under test |

`arm-b-plus.md` and `arm-d.md` are byte-identical except the Resource section and step 1 of
the procedure, so the diff between those two files IS the experimental variable. All four
prompts are committed in [tier3/prompts/](tier3/prompts/).

**Arm A was added after a pilot,** and it earned its place. A 20-scenario pilot of B, B+ and D
put all three between 93 and 97 percent, which is less headroom than the decision margin
needs. Nothing in a set of three docs-holding arms distinguishes "the graders were lenient"
from "these scenarios saturate for anything holding the docs". An unaided arm does. Pilot
numbers were discarded and every scenario was answered again from scratch.

## Method

Reproducible this time, which the earlier runs were not. Prompts, batches, blinded packets,
raw answers, raw grades and the blinding map are all committed, and three scripts with
self-tests do the work: [tier3-strip.mjs](../tools/tier3-strip.mjs) emits keys-stripped
batches and gates the leak, [tier3-pack.mjs](../tools/tier3-pack.mjs) blinds the sheets, and
[tier3-score.mjs](../tools/tier3-score.mjs) refuses to score an incomplete set and applies the
decision rule mechanically.

**Keys-stripped inputs, gated rather than promised.** Answer agents received only `id`, `focus`
and `scenario`. The gate is structural (the emitted object carries exactly those three keys)
and textual (no 7-word run from any of the eight key fields survives anywhere in the prompt,
checked across all scenarios, not just each scenario's own key).

**Blind grading.** Six graders, one batch each: the expected key plus four anonymous sheets.
Sheet order is a deterministic permutation of the scenario id, so all 24 orderings occur and
position encodes nothing. Every sheet carries an identical key set, because a structural
difference identifies an arm just as surely as a label. Each of the seven fields graded
correct (1.0), partial (0.5) or incorrect (0). 240 sheets, 1,680 field grades, all present.

**The decision rule was committed before the first answer agent ran**, as constants in the
scorer: D must beat B by 6 points or more to ship, since n=60 gives roughly plus or minus 6 at
95 percent and an untouched field moved 8 points between two earlier runs.

## Results

<!-- tier3-score:begin -->

Overall = mean across all seven fields, partial counted as half.

| Arm | Overall | Primary (strict) | Primary | Rejected alt | Owner | Context | Lifecycle | Failure | Version |
|---|---|---|---|---|---|---|---|---|---|
| A: unaided (calibration) | 70% | 34/60 | 68% | 68% | 88% | 94% | 79% | 71% | 18% |
| B: official docs | 90% | 55/60 | 94% | 75% | 95% | 99% | 94% | 89% | 82% |
| B+: docs, staged procedure, no skill | 93% | 57/60 | 96% | 78% | 97% | 100% | 96% | 94% | 89% |
| D: docs + skill, staged procedure | 92% | 57/60 | 96% | 75% | 96% | 100% | 97% | 89% | 88% |

Citation rate is the share of the four factual fields carrying a documentation URL. An arm
with a low rate answered from memory rather than looking it up, which the overall score hides.

| Arm | Citation rate |
|---|---|
| A: unaided (calibration) | not requested |
| B: official docs | not requested |
| B+: docs, staged procedure, no skill | 100% |
| D: docs + skill, staged procedure | 100% |

Paired per-scenario comparison. Every arm answered the identical scenario, so
comparing scenario by scenario cancels the scenario's own difficulty and detects a
small effect that two overall percentages near a ceiling cannot. Secondary and
reported only: the pre-committed margin above is what decides the outcome.

| Comparison | Scenarios | Wins | Losses | Ties | Mean delta |
|---|---|---|---|---|---|
| D vs B | 60 | 20 | 11 | 29 | +2 pts |
| D vs BPLUS | 60 | 7 | 15 | 38 | -1 pts |
| BPLUS vs B | 60 | 22 | 7 | 31 | +3 pts |
| B vs A | 60 | 53 | 3 | 4 | +20 pts |

**Verdict, by the rule committed before the run: INCONCLUSIVE.** D beats B by 2 points, inside the noise floor of 6. Publish, do not ship.

The procedure carried it, not the reference: D is -1 points over B+, inside the noise floor. The honest headline is about the staged procedure.

<!-- tier3-score:end -->

## What this says

**The procedure is the effect. The reference is not.** B+ beats B on 22 scenarios and loses on
7, which is the most consistent signal in the run outside the calibration arm. Adding the
skill on top of that same procedure does not extend the gain: D loses to B+ on 15 scenarios
and wins on 7. The overall numbers say the same thing more quietly, +3 for the procedure and
-1 for the reference.

Without arm B+ this run would have read as a modest win. D at 92 percent against B at 90
percent, with the skill in the winning arm, is exactly the shape that invites "the skill
helps a little". The control says the 2 points came from the staging, and the reference
contributed nothing on top of it.

**Arm A validates the instrument.** 70 percent here against 71 percent on 2026-07-30 is a
near-exact replication by different grader instances on a different day, which is the
strongest evidence available that the graders are not lenient and the scenario set
discriminates. The ceiling the pilot found is therefore real: anything holding the
documentation saturates these scenarios, and the remaining headroom is genuinely small.

**`version_caveat` is where documentation access matters most.** 18 percent unaided against 82
to 89 percent with docs is the largest gap in the table by a wide margin, and it is the
intuitive one: version gates and flag names are exactly what cannot be recalled. This is also
the field the reference has repeatedly failed to improve by adding content.

**What this means for the skill's claim.** On this benchmark the reference adds nothing when
the documentation is available. Its defensible claims are narrower than before: it beats
unaided recall, and it reaches that from a 120 KB local read rather than dozens of network
fetches. It does not improve on docs-in-hand, and this run found no evidence that combining
them helps.

## Limitations, including two that are serious

**Documentation access was NOT equal across the docs arms, and this is the worst flaw in the
run.** WebFetch returned an unusable oversized page dump instead of an answer for the largest
documentation pages (`sub-agents` 92.7 KB, `mcp` 79 KB, `skills` 72.1 KB, `permissions` 59.4
KB), and section anchors did not reduce the payload, so retries failed identically.

| Arm | URLs used | Fetch failures |
|---|---|---|
| B | 37 | 11 |
| B+ | 40 | 22 |
| D | 44 | 18 |

B+ absorbed twice the failures of B, and B+ is the control that decides whether a D gain is
attributed to the skill or to the procedure. Agents also recovered inconsistently: most
declined to open the persisted dump files on isolation grounds and re-sourced facts from
smaller sibling pages, while one B+ agent read them and obtained page text the others could
not. Arms that differ in more than the variable under test cannot carry a clean attribution,
and this run has that defect. It argues for caution on the exact magnitudes, though not
obviously in a direction that would rescue arm D, since B+ was the most degraded arm and
still finished ahead.

**27 expected-key defects across 26 of the 60 scenarios**, reported by graders who were
required to grade to the key anyway and record the disagreement rather than adjust a score.
Recorded in [tier3/key-defects.jsonl](tier3/key-defects.jsonl). By field: `rejected_alternative`
9, `version_caveat` 8, `enforcement_owner` 4, `context_boundary` 3, `failure_mode` 2,
`lifecycle` 1. One pattern repeats: a key states `version_caveat` is "none" while another
field of the SAME key concedes a version-gated fact, as in S037, where the key's own
`failure_mode` says project-level frontmatter hooks require workspace trust on v2.1.218 or
later. Keys were frozen for this run to stay comparable with the historical tables; repairing
them is separate work with its own before and after.

**The keys are docs-authored**, so every docs-holding arm inherits an advantage, and arm D
inherits it too. The claim available from this run is about D against arms sharing the key's
provenance, which is the hard direction rather than the easy one.

**Some scenarios closely mirror documented example prompts.** An answering agent reported 6 of
10 in one batch matching example prompts on the workflows and agent-teams pages near
verbatim. That inflates every docs-holding arm and is not quantified across the full set.

**Other limits.** Single run, model-graded, nondeterministic. Grader strictness varies by
batch. n=60 gives roughly plus or minus 6 points at 95 percent confidence on the overall
percentages, which is why the decision margin is 6.

## What changes because of this

The `/architecture-review` command does not ship. The rule committed before the run returned
INCONCLUSIVE, and the attribution says the reference was not what produced the gain.

The finding worth carrying forward is the staged procedure: decide the structure before
looking anything up, then verify each factual field against the documentation and cite it.
That is worth +3 points and 22 scenarios to 7 over free-form documentation use, and it needs
none of this reference to work.

---

# Historical: the 2026-07-30 three-arm run

Measured against the pre-2026-08-02 content. Method described in prose only; no harness,
prompts, raw answers or raw grades were committed, so these numbers cannot be re-derived. That
gap is what the current harness exists to close.

| Arm | Overall | Primary (strict) | Primary | Rejected alt | Owner | Context | Lifecycle | Failure | Version |
|---|---|---|---|---|---|---|---|---|---|
| A: unaided | 71% | 37/60 | 72% | 66% | 84% | 86% | 83% | 58% | 50% |
| B: official docs | 82% | 52/60 | 88% | 69% | 88% | 86% | 92% | 75% | 80% |
| C: this skill | 79% | 46/60 | 82% | 78% | 84% | 93% | 85% | 61% | 72% |

Arm C led both other arms on rejected-alternative reasoning and context boundary, the two
comparative dimensions the reference exists for, and reached that from a 100 KB local read
rather than repeated multi-hundred-KB fetches.

# Historical: the arm C re-run, 2026-08-02

Measured against the CURRENT content, after failure posture was added as an explicit section
to the six mechanism references that lacked it and version gates were moved onto the decision
lines themselves.

| Field | Before (2026-07-30) | After (2026-08-02) | Delta |
|---|---|---|---|
| primary | 82% | 83% | +1 |
| rejected_alternative | 78% | 75% | -3 |
| enforcement_owner | 84% | 76% | -8 |
| context_boundary | 93% | 89% | -4 |
| lifecycle | 85% | 85% | 0 |
| **failure_mode** (the target) | **61%** | **61%** | **0** |
| **version_caveat** (the target) | **72%** | **68%** | **-4** |
| Overall | 79% | 77% | -2 |

Primary strict: 46 of 60 before, 45 of 59 after.

**The intervention failed on its own terms.** `failure_mode` did not move at all and
`version_caveat` went down. Published because the plan pre-committed to publishing whichever
way it went. The likelier reading is that the scenarios ask for the failure mode of a specific
architecture choice in a specific situation, and a general per-mechanism posture paragraph
does not supply that. Content presence was never the binding constraint. The 2026-08-02
four-arm run is consistent with this: the reference did not lift the factual fields even when
paired with the documentation.

**One scenario is missing.** S055 received no grade: its grader returned 9 records instead of
10 and the omission was not noticed until scoring, so percentages above are over 59, not 60.
The gap is disclosed rather than backfilled. The current harness makes this specific failure
impossible: the scorer refuses to run until every scenario, sheet and field is graded exactly
once, and it checks the total record count independently of the per-cell sweep.
