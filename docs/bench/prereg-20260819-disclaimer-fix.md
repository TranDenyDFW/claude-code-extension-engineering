# Preregistration: the scope-disclaimer fix, frozen 2026-08-19 before any run

Frozen BEFORE the measurement, following the house precedent in `32adbf3`, which froze its
revert rule before its run finished, observed 22 against a floor of 26, and reverted.

## What changed

- `SKILL.md`, boundary section: the provenance note must come LAST and in one clause, and must
  never describe this library's own filing. Plus: answer the whole question, including the half
  that is off the boundary list.
- `references/sessions.md`: a new section on usage limits, sourced to `errors` and `costs`.
- `tests/questions.jsonl`: F371.

## What was NOT changed, and why

The approved plan carried a workstream to make the library inspect the workspace on a bare
symptom. It was dropped on evidence gathered after approval:

- Arm C used a filesystem tool in **2 of the 13 losses**, not the 5 the plan asserted, and in
  **4 of all 60 cells**.
- Both winning answers there carry no documentation substance. GQ-09's winner is 717 characters
  that inspect the machine and then ask the user what they tried.
- GQ-06 and GQ-09 are the two fixtures flagged `bare_symptom: true` in
  `tests/routing-live/fixtures.json`. A working version of that change would make the committed
  scorer fail the exact rows it was built to protect.

Recorded as a measured negative rather than attempted.

## The claim under test

Arm A opening with a scope disclaimer costs it the cell. Evidence at freeze time, all 60 cells
of the 2026-08-19 head-to-head:

| arm A behaviour | cells | A | C | A share of decided |
|---|---|---|---|---|
| scope disclaimer, "this skill does not cover X" | 4 | 0 | 3 | 0.0% |
| provenance note only, "not sourced from my library" | 8 | 3 | 3 | 50.0% |
| neither | 50 | 18 | 9 | 66.7% |

Corroborating, and the reason the fix separates the two behaviours instead of deleting both:

- `SKILL.md:63-75` already records the same behaviour losing twice on `CLAUDE_CODE_MAX_OUTPUT_TOKENS`.
  Across those and this run the scope disclaimer is **0 wins in 5 measured instances**.
- **GQ-41 versus GQ-47 is a natural control.** Same variable, `claude_code_max_output_tokens`.
  GQ-41 carries a provenance note, no scope disclaimer, and arm A WINS. GQ-47 adds the scope
  disclaimer and omits the VS Code half, and arm A LOSES.

## Cells, frozen

**Target, 5** (4 losses and 1 order-dependent): GQ-18, GQ-22, GQ-32, GQ-47, GQ-60.

**Regression guard, 6**, all currently arm A wins. The first three carry a provenance note, so
they are where an over-broad edit would show up first: GQ-25, GQ-41, GQ-43. Then GQ-03, GQ-33
(sessions.md, the file W3 edits) and GQ-46.

## Method, frozen

Arm A regenerates only. Arm C's answers are REUSED FROZEN from
`tmp/bench-20260819/responses.jsonl`, which removes C-side run-to-run variance. Blind pairwise,
both grader orders, same grader model and deny rules as the 2026-08-19 run.

## The rule, frozen

- **SHIP if** at least **2 of the 5 target cells** move from a C win or an unusable verdict to an
  A win or a TIE, **AND zero of the 6 regression cells** move away from an A win.
- **REVERT if** either half fails. A regression on even one guard cell reverts the change
  regardless of how the target cells moved, because this repo has two recorded cases of a fix
  reddening an unrelated cell, at 5 of 5 (`211f906`) and 2 of 3 (`SKILL.md:173-177`).
- Report the result either way.

## Stated limits

An 11-cell re-run cannot detect a change that helps these and hurts some of the other 49. The
regression guard narrows that gap and does not close it. Any headline number is provisional
until a full 60-cell run.
