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

| Comparison | Scenarios | Wins | Losses | Ties | Mean delta | Sign test |
|---|---|---|---|---|---|---|
| D vs B | 60 | 20 | 11 | 29 | +2 pts | p=0.150 |
| D vs BPLUS | 60 | 7 | 15 | 38 | -1 pts | p=0.134 |
| BPLUS vs B | 60 | 22 | 7 | 31 | +3 pts | p=0.008 |
| B vs A | 60 | 53 | 3 | 4 | +20 pts | p=0.000 |

Ties are reported because they dominate: a split like 22 to 7 describes only the
scenarios where the arms differed at all, and reading it without the tie column
overstates how often one arm actually beat the other.

Leave-one-batch-out. Each batch is graded by ONE grader, so a single lenient or
strict grader can manufacture across ten scenarios what looks like a finding across
sixty. Every comparison is recomputed with each batch removed in turn.

| Comparison | All 60 | Worst single-batch drop | Verdict |
|---|---|---|---|
| D vs B | 20W 11L, p=0.150 | drop batch 6: 13W 11L, p=0.839 | not significant to begin with |
| D vs BPLUS | 7W 15L, p=0.134 | drop batch 6: 7W 9L, p=0.804 | not significant to begin with |
| BPLUS vs B | 22W 7L, p=0.008 | drop batch 6: 13W 7L, p=0.263 | **RESTS ON ONE GRADER** |
| B vs A | 53W 3L, p=0.000 | drop batch 3: 43W 3L, p=0.000 | robust |

**Verdict, by the rule committed before the run: INCONCLUSIVE.** D beats B by 2 points, inside the noise floor of 6. Publish, do not ship.

D is -1 points over B+, inside the noise floor, so the reference did not add anything measurable on top of the procedure.

**Do not carry any of these forward as a finding about the arms.** BPLUS over B loses significance when a single batch is removed, so it is a fact about that grader, not about the arms. What survives every drop: B over A.

<!-- tier3-score:end -->

## What this says

**Corrected 2026-08-02 after independent review.** The first version of this section claimed
"the procedure is the effect, the reference is not", citing the 22-to-7 and 7-to-15 paired
splits. An independent reviewer recomputed the run with each batch removed in turn and found
both halves of that sentence resting on a single grader. The claim was wrong and is retracted
here rather than quietly edited. The leave-one-batch-out table above now runs on every
comparison so this cannot recur silently.

**Only one comparison in this run survives contact with its own data.** Documentation beats
unaided recall: 53 wins to 3, p<0.001, and dropping any single batch leaves it at 43 to 3 or
better. Roughly 20 points, and the largest single component is `version_caveat` at 18 percent
unaided against 82 to 89 percent with docs, which is the intuitive result since version gates
and flag names are exactly what cannot be recalled.

**Nothing distinguishes the three docs-holding arms.** B, B+ and D sit at 90, 93 and 92
percent, and every comparison between them either fails significance outright or collapses
when one batch is removed:

| Comparison | All 60 | Without batch 6 |
|---|---|---|
| B+ over B | 22W 7L, p=0.008 | 13W 7L, p=0.263 |
| D over B+ | 7W 15L, p=0.134 | 7W 9L, p=0.804 |
| D over B | 20W 11L, p=0.150 | 13W 11L, p=0.839 |

Batch 6's B-plus-minus-B gap is +15.0 points. The other five batches are -1.4, +0.7, 0.0,
+2.9 and +1.4. Dropping any batch other than 6 moves the result barely at all. One grader on
ten scenarios produced the entire apparent effect, and because that grader rated B+ far above
both neighbours it manufactured the positive B+ over B and the negative D over B+ at the same
time. They were never two findings.

**The cause of batch 6 is undetermined.** The reviewer proposed answer length: batch 6's B+
agent wrote the longest sheet in 10 of 10 scenarios, mean 2,648 characters against 1,816 to
1,910 for the other arms, and on a rubric where 0.5 means "materially incomplete" length can
buy full marks. That is plausible but it is not established, and batch 3 is a direct
counterexample: its B+ agent wrote the longest answers in the entire run, mean 2,946
characters, and scored exactly level with B at 0.0. Grader strictness varying by batch
remains the simpler explanation. Either way it is a fact about the measurement, not the arms.

**Arm A validates the instrument.** 70 percent here against 71 percent on 2026-07-30 is a
near-exact replication by different grader instances on a different day, which is the
strongest evidence available that the graders are not systematically lenient and the scenario
set discriminates. The ceiling the pilot found is therefore real: anything holding the
documentation saturates these scenarios, the remaining headroom is small, and with six single
grader batches this design cannot resolve differences of two or three points inside it.

**`version_caveat` is where documentation access matters most.** 18 percent unaided against 82
to 89 percent with docs is the largest gap in the table by a wide margin, and it is the
intuitive one: version gates and flag names are exactly what cannot be recalled. This is also
the field the reference has repeatedly failed to improve by adding content.

**What this means for the skill's claim.** This run found no measurable benefit from the
reference once the documentation is available, and it also found no measurable harm. The
correct reading is that the experiment could not resolve a difference, not that it proved
there is none: three arms clustered inside three points on an instrument whose per-batch
noise reaches fifteen. The reference's defensible claims are unchanged rather than
strengthened: it beats unaided recall, and it reaches that from a 120 KB local read rather
than dozens of network fetches. The hypothesis that motivated this whole run, that combining
the reference with the docs would beat the docs, is not supported.

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

**These two columns are agent self-reports and no committed artifact verifies them.** They
came back in the run receipts, not from an instrumented fetch log, and an independent reviewer
noted the URL counts do not reconcile with the citations actually present in the answers.
Treat the table as disclosure that the problem occurred and was uneven, not as a measurement
of how uneven.

B+ absorbed roughly twice the failures of B, and B+ is the control that decides whether a D
gain is attributed to the skill or to the procedure. Agents also recovered inconsistently:
most declined to open the persisted dump files on isolation grounds and re-sourced facts from
smaller sibling pages, while one B+ agent read them and obtained page text the others could
not. Arms that differ in more than the variable under test cannot carry a clean attribution,
and this run has that defect. Since no comparison among the docs arms survived the
leave-one-batch-out check anyway, this flaw is not what decided the outcome, but it would have
to be fixed before any rerun could claim a small difference between them.

**27 expected-key defect records covering at least 36 of the 60 scenarios**, reported by
graders who were required to grade to the key anyway and record the disagreement rather than
adjust a score. Recorded in [tier3/key-defects.jsonl](tier3/key-defects.jsonl). By field:
`rejected_alternative` 9, `version_caveat` 8, `enforcement_owner` 4, `context_boundary` 3,
`failure_mode` 2, `lifecycle` 1.

An earlier version of this line said 26 scenarios, counting each record's `scenario` string as
one id. Two records name ranges instead ("all ten (S041 through S050)" and a nine-scenario
list), so the true coverage is at least 36 and the file has no schema forcing one id per
record. That is a defect in the artifact, not only in the count.

One pattern repeats: a key states `version_caveat` is "none" while another field of the SAME
key concedes a version-gated fact, as in S037, where the key's own `failure_mode` says
project-level frontmatter hooks require workspace trust on v2.1.218 or later. Keys were frozen
for this run to stay comparable with the historical tables; repairing them is separate work
with its own before and after.

**The 100 percent citation rate is a format check, not a verification check**, and it should
not be read as evidence the arms confirmed their facts. Every factual field in B+ and D
carries a well-formed documentation URL, which is all the metric measures. Cross-checking
those URLs against this run's own fetch-failure reports, 27 percent of B+ citations and 20
percent of D citations point at the very pages the arms reported as returning unusable dumps.
The arms said they re-sourced those facts from smaller sibling pages while citing the
canonical page for the fact; that is defensible practice and it is also unverifiable from the
artifacts. Treat the citation column as "a URL was supplied", nothing more.

**The keys are docs-authored**, so every docs-holding arm inherits an advantage, and arm D
inherits it too. The claim available from this run is about D against arms sharing the key's
provenance, which is the hard direction rather than the easy one.

**Some scenarios closely mirror documented example prompts.** An answering agent reported 6 of
10 in one batch matching example prompts on the workflows and agent-teams pages near
verbatim. That inflates every docs-holding arm and is not quantified across the full set.

**One grader per batch is the design flaw that matters most.** Each of the six graders scored
ten consecutive scenarios alone, so grader effect and scenario-focus effect are perfectly
confounded with each other, and a single grader's strictness moves a tenth of the run. The
leave-one-batch-out table exists because of this and shows it biting. A design where every
batch is scored by two or three graders, or where graders are rotated across scenarios rather
than assigned whole batches, would cost more and would be the first thing to change in a
rerun.

**Other limits.** Single run, model-graded, nondeterministic. n=60 gives roughly plus or minus
6 points at 95 percent confidence on the overall percentages, which is why the decision margin
is 6. Arm A is trivially identifiable from its first-person hedging, which is a consequence of
being genuinely unaided rather than a structural leak, and it does not help a grader separate
B, B+ and D.

## What changes because of this

The `/architecture-review` command does not ship. The rule committed before the run returned
INCONCLUSIVE at 2 points against a required 6.

**Nothing from the comparisons among the docs arms is carried forward.** The staged procedure
looked worth keeping on the first reading of this data and it is not established: without one
grader's batch it is 13 wins to 7 at p=0.263. It may still be a good practice, and this run is
not evidence that it is.

What the run does establish is narrower and was never in doubt: having the documentation is
worth about 20 points over unaided recall, most of it in version and flag facts.

The durable output is the harness. Prompts, batches, packets, raw answers, raw grades and the
blinding map are committed, every published figure re-derives from them, CI fails if the prose
drifts, and the leave-one-batch-out check now runs on every comparison so a single-grader
artifact cannot be published as a finding again.

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
