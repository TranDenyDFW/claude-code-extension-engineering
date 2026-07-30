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

## What changes because of this

The failure-mode and version-caveat columns are arm C's weakest against B (61 vs 75, 72 vs
80). Those map to specific content: failure paths live mostly in composition cards rather
than per-mechanism sections, and version gates live in one compatibility file rather than
beside each decision point. Both are actionable content moves and are tracked in
IMPROVEMENTS.md.
