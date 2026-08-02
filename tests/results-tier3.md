# Tier 3: architecture-decision benchmark

Run 2026-07-30. Answering and grading model: `claude-opus-5`. Scenario set v1
([architecture-scenarios.jsonl](architecture-scenarios.jsonl), 60 scenarios).

## What this measures

Tiers 1 and 2 measure whether facts are present and retrievable. Tier 3 measures the thing
the skill is actually for: does it produce better ARCHITECTURE DECISIONS? Sixty realistic
engineering needs, none naming a mechanism, each with a seven-field expected key: primary
mechanism, nearest rejected alternative, enforcement owner, context boundary, lifecycle,
failure mode, and version or experimental caveat.

## Method

**Scenario authoring, independent of the reference.** Six author agents wrote ten scenarios
each across six focus areas (enforcement, knowledge, delegation, orchestration, integration,
cross-cutting traps), with access ONLY to the official documentation at code.claude.com and
explicit instructions never to read this repository. Answer agents received a keys-stripped
scenario file, verified to contain zero expected-key text.

**Three arms, 6 batches of 10, 18 answer agents.**

- **Arm A, unaided:** model knowledge only, no tools, no docs.
- **Arm B, docs in hand:** unlimited WebFetch of code.claude.com documentation.
- **Arm C, the skill:** this reference's files only, no web.

**Blind grading.** Six graders each scored one batch: per scenario, the expected key plus
three anonymous answer sheets whose order rotates per scenario id, so position never encodes
the arm. Each of the seven fields graded correct (1.0), partial (0.5), or incorrect (0).
180 sheets, 1,260 field grades.

## Results

Overall = mean across all seven fields, partial counted as half.

| Arm | Overall | Primary (strict) | Primary | Rejected alt | Owner | Context | Lifecycle | Failure | Version |
|---|---|---|---|---|---|---|---|---|---|
| A: unaided | 71% | 37/60 | 72% | 66% | 84% | 86% | 83% | 58% | 50% |
| B: official docs | **82%** | **52/60** | 88% | 69% | 88% | 86% | 92% | 75% | 80% |
| C: this skill | 79% | 46/60 | 82% | **78%** | 84% | **93%** | 85% | 61% | 72% |

## Reading the numbers honestly

**The skill beats unaided recall and loses to docs-in-hand.** Arm C is 8 points over arm A
overall and 9 scenarios better on strict primary choice. Arm B is 3 points over arm C
overall and 6 scenarios better on primary. The earlier README claim that 44% versus 100%
measured "unaided recall, not looking things up" anticipated exactly this: given the full
official docs, a model out-decides this reference on raw mechanism choice.

**Where the skill wins is where it claims to.** Arm C leads both other arms on
rejected-alternative reasoning (78% vs 69% and 66%) and context boundary (93% vs 86%), the
two comparative dimensions this reference exists for. It also gets there dramatically
cheaper: arm B agents fetched multi-hundred-KB documentation pages repeatedly; arm C read a
100 KB local reference.

**Structural bias toward arm B, disclosed.** The expected keys were authored by agents
reading the same official docs arm B used. Where docs and this reference frame an answer
differently, the key speaks docs. A key set co-authored from both sources, or
independently adjudicated, would be fairer to arm C; building that is future work.

**Other limits.** Single run, model-graded, nondeterministic. Expected keys were authored
with a skip-if-ambiguous rule but not independently re-adjudicated field by field.
Grader strictness varies by batch. n=60 gives roughly plus or minus 6 points at 95%
confidence on the overall percentages.

## Arm C re-run, 2026-08-02: the content fix did not work

The two weakest fields below were treated as a content problem and fixed as one: failure
posture was added as an explicit section to the six mechanism references that lacked it
(`mcp`, `workflows`, `lsp`, `output-styles`, `claude-md-family`, `context-modes`), and
version gates were moved onto the decision lines themselves in `lsp`, `workflows` and
`auto-memory` rather than living only in `compatibility.md`.

Arm C was then re-run against the same 60 scenarios, same rubric, blind-graded.

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
`version_caveat` went down. Publishing this because the plan pre-committed to publishing
whichever way it went, and because a fix that is asserted rather than measured is exactly
what this repo exists to argue against.

**Why it probably failed, stated as a hypothesis and not a finding.** The deficit was read
as "the reference does not say what happens when this fails". The likelier reading now is
that the scenarios ask for the failure mode of a *specific architecture choice in a
specific situation*, and a general per-mechanism posture paragraph does not supply that.
Content presence was never the binding constraint. Testing that would mean rewriting the
composition cards' per-pairing failure paths into the mechanism references, which is a
larger change than this one and should not be attempted until the hypothesis is checked.

**Do not over-read the negative either.** This is one nondeterministic model-graded run of
59 scenarios against a baseline graded on a different day by different grader instances.
The honest claim is no measurable improvement, not a proven regression: the -8 on
`enforcement_owner`, a field this change did not touch, is a good indication of the
run-to-run noise floor.

**One scenario is missing.** S055 received no grade: its grader returned 9 records instead
of 10 and the omission was not noticed until scoring. Percentages above are over 59, not
60. The gap is disclosed rather than backfilled, because re-grading one scenario alone
after seeing the totals would be a different experiment.

## What changes because of this

The failure-mode and version-caveat columns are arm C's weakest against B (61 vs 75, 72 vs
80). Those map to specific content: failure paths live mostly in composition cards rather
than per-mechanism sections, and version gates live in one compatibility file rather than
beside each decision point. Both are actionable content moves and are tracked in
IMPROVEMENTS.md.
