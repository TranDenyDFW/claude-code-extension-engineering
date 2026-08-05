# Tier 3: architecture-decision benchmark

Sixty scenarios, unchanged across every run. The SCENARIO PROSE is identical throughout;
only the expected keys were repaired for v2
([architecture-scenarios.jsonl](architecture-scenarios.jsonl) is v1 and frozen,
[architecture-scenarios-v2.jsonl](architecture-scenarios-v2.jsonl) is current). Answering and
grading model: `claude-opus-5`.

**The current run is the v2 run immediately below.** Everything after it is history, kept
because publishing a retraction beside the claim it corrects is the point. v2 and v1 numbers
are not comparable: keys, grading design, and documentation delivery all changed.

## What this measures

Tiers 1 and 2 measure whether facts are present and retrievable. Tier 3 measures the thing
the skill is actually for: does it produce better ARCHITECTURE DECISIONS? Sixty realistic
engineering needs, none naming a mechanism, each with a seven-field expected key: primary
mechanism, nearest rejected alternative, enforcement owner, context boundary, lifecycle,
failure mode, and version or experimental caveat.

---

# The 2026-08-02 v2 run: repaired instrument, four arms, and a clean negative

The v1 run above could not resolve the question it was built for: its keys had dead fields,
its documentation arrived unevenly, and one grader out of six manufactured a headline that
had to be retracted. This run rebuilds the instrument and asks the same question again.

**v2 numbers are NOT comparable to v1 numbers.** The keys changed, the grading design
changed, and documentation delivery changed. This is a fresh measurement on a better
instrument, not a continuation of the v1 trend lines.

## What was fixed, and how each fix is enforced

| v1 defect | Fix | Enforcement |
|---|---|---|
| 14 of 60 keys had `context_boundary` as the literal string "n/a", so a quarter of that field carried zero signal; 6 keys said `version_caveat` was "none" while another field of the SAME key conceded a version gate | Keys repaired blind against the docs mirror, 42 patches applied plus 14 re-derived unseeded | [tier3-keys-lint.mjs](../tools/tier3-keys-lint.mjs), a CI gate. v1 lints RED at 15 errors; v2 lints GREEN at 0 |
| WebFetch returned unusable dumps for large pages, unevenly across arms (B 11 failures, B+ 22, D 18), and the counts were unverifiable self-reports | 20 documentation pages fetched ONCE as raw markdown and staged byte-identical into every docs arm; no web access during answering | [docs-manifest.json](tier3/docs-manifest.json) with sha256 per page. The three pages no arm could previously read in full are now complete: `hooks` 245 KB, `settings` 273 KB, `sub-agents` 95 KB |
| One grader per batch, and each batch was exactly one focus area, so grader strictness and topic were perfectly confounded | Seeded-shuffle batches mixing focus areas, TWO independent graders per batch, blind adjudication of full-point splits | Completeness gate refuses to score unless every cell has exactly two base grades from different graders |
| "Citation rate" measured URL formatting; 27% of B+ and 20% of D citations pointed at pages those arms had reported unreadable | Citations now carry a verbatim quote, checked mechanically against the mirror bytes | Planted-fake self-test case; fields with no citation count against the rate |

**Repair blindness, and where it initially failed.** Repair agents received the scenario
rows, the mirror, and defect records with all 52 sentences describing sheet or arm behavior
redacted. An independent review then found that the context-boundary prompt embedded a
parenthetical pre-stating the answer shape for the family it repaired. The seeded values
were doc-true and quote-verified, but a prompt carrying answer content is not blind, so all
14 keys were re-derived by a fresh agent with no hints. Both versions are published side by
side in [key-repairs-v2.md](tier3/key-repairs-v2.md); the unseeded values shipped.

## Results

Grades: 1680  scenarios in set: 60  arms: a, b, bplus, d
Completeness gate: PASS, every scenario, sheet and field graded exactly once.
<!-- tier3-score:begin set=v2 -->

Overall = mean across all seven fields, partial counted as half.

| Arm | Overall | Primary (strict) | Primary | Rejected alt | Owner | Context | Lifecycle | Failure | Version |
|---|---|---|---|---|---|---|---|---|---|
| A: unaided (calibration) | 71% | 35/60 | 71% | 61% | 90% | 96% | 80% | 67% | 35% |
| B: official docs | 89% | 58/60 | 98% | 66% | 95% | 98% | 97% | 88% | 83% |
| B+: docs, staged procedure, no skill | 89% | 58/60 | 98% | 67% | 97% | 98% | 98% | 87% | 81% |
| D: docs + skill, staged procedure | 89% | 58/60 | 98% | 64% | 96% | 99% | 97% | 86% | 81% |

VERIFIED-quote rate: the share of the four factual fields whose citation carries a quote that
appears VERBATIM in the cited mirror page, checked mechanically. Fields with no citation count
against the rate, so this measures verification, not formatting.

| Arm | Verified-quote rate |
|---|---|
| A: unaided (calibration) | not requested |
| B: official docs | not requested |
| B+: docs, staged procedure, no skill | 98% |
| D: docs + skill, staged procedure | 99% |

Paired per-scenario comparison. Every arm answered the identical scenario, so
comparing scenario by scenario cancels the scenario's own difficulty and detects a
small effect that two overall percentages near a ceiling cannot. Secondary and
reported only: the pre-committed margin above is what decides the outcome.

| Comparison | Scenarios | Wins | Losses | Ties | Mean delta | Sign test |
|---|---|---|---|---|---|---|
| D vs B | 60 | 21 | 20 | 19 | +0 pts | p=1.000 |
| D vs BPLUS | 60 | 15 | 16 | 29 | -1 pts | p=1.000 |
| BPLUS vs B | 60 | 20 | 16 | 24 | +0 pts | p=0.618 |
| B vs A | 60 | 48 | 9 | 3 | +18 pts | p=0.000 |

Ties are reported because they dominate: a split like 22 to 7 describes only the
scenarios where the arms differed at all, and reading it without the tie column
overstates how often one arm actually beat the other.

Inter-grader agreement. Every cell was graded twice by independent graders, so this
benchmark finally has a reliability number instead of assuming one. Full-point splits
(0 versus 1) went to a blind adjudicator who saw the key and the answer but neither
the two scores nor which arm produced the sheet.

| Field | Cells | Exact agreement | Within half a point |
|---|---|---|---|
| primary | 240 | 99% | 100% |
| rejected_alternative | 240 | 87% | 100% |
| enforcement_owner | 240 | 97% | 100% |
| context_boundary | 240 | 99% | 100% |
| lifecycle | 240 | 93% | 100% |
| failure_mode | 240 | 85% | 100% |
| version_caveat | 240 | 85% | 96% |
| **all fields** | **1680** | **92%** | **99%** |

Disagreements of any size: 133 of 1680 cells. Full-point splits requiring adjudication: 9.

Leave-one-batch-out. Every comparison is recomputed with each grading batch removed in
turn, because a batch that behaves unlike the rest can manufacture across ten scenarios
what looks like a finding across sixty. This is what caught the retracted v1 headline.

| Comparison | All 60 | Worst single-batch drop | Verdict |
|---|---|---|---|
| D vs B | 21W 20L, p=1.000 | drop batch 1: 16W 16L, p=1.000 | not significant to begin with |
| D vs BPLUS | 15W 16L, p=1.000 | drop batch 2: 14W 15L, p=1.000 | not significant to begin with |
| BPLUS vs B | 20W 16L, p=0.618 | drop batch 6: 16W 15L, p=1.000 | not significant to begin with |
| B vs A | 48W 9L, p=0.000 | drop batch 4: 40W 8L, p=0.000 | robust |

**Verdict, by the rule committed before the run: NEGATIVE.** D does not beat B (0 points). Publish the negative.

D is 0 points over B+, inside the noise floor, so the reference did not add anything measurable on top of the procedure.

Robust across every single-batch drop: B over A.

<!-- tier3-score:end -->
<!-- tier3-score:end -->

## What this says

**Combining the reference with the documentation produces no measurable benefit.** D versus
B is 20 wins, 20 losses, p=1.000. Not a small effect the instrument struggled to see: a dead
heat, on an instrument specifically rebuilt to detect a small effect. The verdict by the rule
committed before any v2 answer existed is NEGATIVE.

**The staged procedure also produces nothing.** B+ over B is 19 to 16, p=0.736. The v1 run's
retracted headline claimed the procedure was the effect; with repaired keys, two graders per
cell, and equalized documentation, it is not.

**What survives is what always survived.** Documentation beats unaided recall by 18 points,
48 scenarios to 9, p<0.001, robust to dropping any batch. The single largest component is
`version_caveat`: 35% unaided against 80 to 82% with docs, which is the intuitive result
since version gates and flag names are exactly what cannot be recalled.

**The instrument itself is now credible, which is the run's real product.** 92% exact
inter-grader agreement across 1,680 double-graded cells, 99% within half a point, and only 9
full-point splits needing adjudication. Verified-quote rates of 98% and 99% with ZERO
non-verifying quotes among those supplied: every quote an arm offered was genuinely present
in the page it cited. A benchmark that can report those numbers can be argued with.

## Limitations, including two that bound the conclusion

**Single replicate.** This is one answer pass per arm. Answer-agent nondeterminism is the
variance this design cannot see, and it is the main reason not to read the 1-point D-versus-B
gap as anything but noise. The pooled multi-replicate endpoint is already committed in the
scorer (`pooledVerdict`, `REPLICATE_RULE`), written before any replicate data existed, so
replicates 2 and 3 can be added later and pooled without touching the rule. They were
deferred for budget, not for convenience, and this line is the disclosure.

**S040's key was wrong, and has now been repaired. Read how before reading the result.**
The key selected an advisory remedy while its OWN `failure_mode` conceded that "a hard
guarantee needs a different mechanism entirely, such as a permissions deny rule, a PreToolUse
hook, or denying Agent(Explore)". All four arms independently chose the deny rule, so all four
scored zero on primary and on the fields derived from it, roughly 20 zero-scores from one key.
It never biased D against B; it depressed every absolute number.

Repairing an expected key AFTER a run is normally the practice that invalidates a benchmark,
so the full procedure is recorded in `tests/tier3/key-repairs-v2.md`. In short: the defect and
the repair DIRECTION were published in git on 2026-08-04, before any repair; the lint rule that
catches the class landed before the key was touched, and produces 1 true positive per set with
0 false positives across all 120 committed keys; the WORDING was authored by an agent that
never read an answer sheet, a grade file or this document, verified by a directional 7-shingle
check; and the arithmetic bound was **published before the re-grade ran**.

That bound said the D-versus-B margin could only land in [-2, +1] against a `DECISION_MARGIN`
of 6, and the sign test could only move from 20W/20L to at worst 21W/20L or 20W/21L, both
p=1.0000, because reaching p < 0.05 at n=41 needs 28W/13L and one scenario cannot travel eight
wins. **The observed outcome was 21W/20L at a margin of 0 points.** The bound held. The
verdict is NEGATIVE, exactly as before the repair, and it was incapable of being anything else.

What did change is that S040 became gradeable at all: per-arm totals moved from a flat
{a 2.00, b 1.75, b+ 1.75, d 1.75} out of 7 to {a 5.75, b 5.50, b+ 6.00, d 7.00}. The absolute
numbers rose accordingly, which is what "it depresses every absolute number" predicted.

**Test-retest reliability, measured for the first time.** The re-grade gave both graders the
full batch-1 packet rather than a one-scenario packet, because a ten-scenario packet is a
different grading task. Only the 56 S040 records were used; the other 504 cells are the same
graders scoring the same sheets against the same unchanged keys a second time. They agreed
with themselves on **90.5% of cells exactly (456 of 504) and 100% within half a point**. That
is a bound on grader self-consistency this benchmark previously had no measurement of, and it
is published whether or not it flatters the instrument. Raw records in `tests/tier3/retest-v2/`.

**The re-grade surfaced four more key defects, which are recorded and NOT repaired.** Both
graders independently flagged that S018's `rejected_alternative` names the status quo the
scenario says has already failed twice, so the field discriminates nothing, and that S018,
S023 and S045 assert `version_caveat: none` while the answers cite concrete version-gated
facts. They are filed in `tests/tier3/key-defects.jsonl`. Repairing them now would be a second
post-hoc key change without pre-registration, which is the discipline this section exists to
maintain. They belong to the next instrument revision.

**Arm A identifies itself in 10 of its 60 sheets**, writing phrases like "unaided", "from
memory" or "I recall" in the answer text. Zero such phrases appear in B, B+ or D. Blinding
holds structurally (packets carry no arm labels, one key set across all 240 sheets, all 24
orderings used), but an attentive grader could recognize the unaided arm from content.
This cannot touch D versus B, the null this run reports; it cuts against **B over A**, the
one comparison reported as robust, in the direction of inflating it. Found by independent
review, not by the harness. A future run should strip first-person epistemic phrasing from
sheets before packing, or instruct the unaided arm not to narrate its own condition.

**The published leave-one-batch-out table originally dropped the wrong batches.** The scorer
derived batch membership arithmetically from the scenario number, which yields the natural
S001-S010 blocks; in v2 those are the ANSWER batches and exactly the six focus areas, while
grading batches are a seeded shuffle in which 48 of 60 scenarios sit elsewhere. So the run
had no grading-batch robustness check while the prose claimed the one that caught the
retracted v1 headline. Found by independent review, fixed, and the table above is
regenerated from the true grading batches. Every verdict is unchanged: D versus B worst drop
p=1.000, B over A p<0.001 on all six drops. A self-test now asserts the two groupings are
distinguishable, since the bug was invisible precisely because both produced six plausible
batches of ten.

**Graders reported further key defects** during this run, recorded in
[key-defects.jsonl](tier3/key-defects.jsonl). The repeated pattern is unchanged from v1: a
`version_caveat` of "none" colliding with a version-dated fact multiple arms independently
assert. The adjudicator flagged v2.1.199, v2.1.196 and v2.1.208 as candidates worth checking
against the changelog before the next run, while noting honestly that arms sharing a base
model can converge on the same fabrication, so convergence is not proof.

**Every scenario is self-authored, and no public replacement exists.** The 60 scenarios were
written by agents reading the official documentation, independently of this reference, but
still inside this project. The obvious criticism is that a benchmark says what its author
built it to say. A search of the HuggingFace hub on 2026-08-03 found nothing that could serve
as an external scenario set: the ecosystem has agent execution traces, SFT corpora, and
tool-CALLING benchmarks, but no dataset asks which extension mechanism should own a behavior.
The most promising candidate, 32,133 real Claude Code conversation traces, was downloaded and
mined; of 2,922 prompts in the sampled shard, 26 mentioned an extension mechanism, 14 were
decision-shaped, and on reading all 14 every one turned out to be a SWE-bench harness prompt
or a captured Claude Code system prompt, not a user question. Zero usable. The likelier
external source is GitHub issues and discussions on `anthropics/claude-code`, which has not
been tried. Until then this limitation stands unfixed, not merely unaddressed.

**Ceiling compression bounds the null.** The three docs arms sit at 87 to 88 percent with four
of seven fields at 95 percent or above, so the room in which a difference could appear is
small by construction. "No measurable benefit" is therefore a statement about what this
instrument can resolve at this difficulty, not a proof that no benefit exists anywhere. A
harder scenario set would test the same hypothesis with more headroom, and nothing here rules
out an effect that only appears where the docs arms stop saturating.

**Model-graded throughout.** The agreement numbers measure how consistently this model grades
against these keys, not human ground truth. n=60 gives roughly plus or minus 6 points at 95%
confidence, which is why the decision margin is 6.

**One pre-commitment claim was looser than stated.** `DECISION_MARGIN`, `SIGN_ALPHA`,
`verdict()` and `verdictV2()`, which are the constants and code that produced this NEGATIVE,
are byte-identical from before any v2 answer existed through publication, verified by an
independent reviewer against git history. But `REPLICATE_RULE` and `pooledVerdict`, the
unused multi-replicate endpoint, landed in the publishing commit, about 11.5 hours AFTER the
v2 answers existed, not before as an earlier draft of this section implied. They governed
nothing in this run and produced no number in it; the correction is recorded because the
claim, not the result, was wrong.

## What changes because of this

Nothing ships. The `/architecture-review` command stays unbuilt, now for a measured reason
rather than an unresolvable one.

The reference's defensible claim is unchanged and narrower than the project once hoped: it
beats unaided recall, and it reaches that from a local read rather than dozens of network
fetches. On this benchmark it adds nothing once the documentation is present, and the
hypothesis that motivated three runs, that the reference and the docs solve different halves
of the rubric so combining them should win, is not supported.


---

# Historical: the 2026-08-02 four-arm run (v1 keys, one grader per batch)

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

<!-- v1 tables, frozen history: the machine-checked block below now governs the v2 run -->

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
