# Skill split: measured, and reverted

The four-skill split was built, cut over, measured against the benchmark, and **reverted** because
it lost on the metric it was built to improve.

| | arm A invoked the library |
|---|---|
| one skill | **26 of 36** |
| four skills | **22 of 36** |

The pre-committed rule was frozen in `google-questions/analyze-part-d.mjs` before the run finished:
revert if arm A invoked the library in fewer than 26 of 36. Observed 22. Reverted.

Three independent sources agree on 22: the arena transcripts, the CLI's own `skillUsage` counter,
and the ledger's `skillsLoaded` field, all reading 9 / 7 / 3 / 3 across the four skills. The
analyzer was calibrated against the baseline pack first and reproduces its 26 exactly.

**All four skills were used.** The seam is sound as a routing structure; it simply did not pay for
itself. The budget argument was also sound and was delivered, 1,534 characters to 5,048, but the
budget was never the goal. The likely mechanism is the one the plan named in writing beforehand:
the listing drops descriptions starting with the least-invoked skills, and the split discarded 111
accumulated invocations to start four skills at zero. This run establishes the outcome, not the
cause.

Full write-up: `google-questions/rev/2026-08-15-fix11-split/RESULT.md`.

## What was kept

The split is gone; the work it surfaced is not:

- `extension-doctor.mjs` no longer mis-measures the description cap it exists to enforce
- `rekey-claims.mjs` refuses to write a ledger missing claims, rather than destroying then warning
- five tools discover skills by content instead of naming one
- the `R-sdk-hooks` routing fixture and the `hooks.md` SDK disambiguation, both re-pointed at the
  single skill, because that collision is a property of the subject and not of the packaging
- skill content pinned to LF
- retired test rows are counted and reported rather than deleted

The four skills remain in history at `e6e4eb4` if the trade ever changes.

## What this does not settle

No grader ran on either side, so this says nothing about answer quality. And 26 against 22 on 36
paired questions, 7 lost and 3 gained, is not a well-separated effect. The rule was set in advance
so that a marginal result still produces a decision rather than an argument.

## What each step produced

| Step | What | Verified by |
|---|---|---|
| 0 | Baseline captured | 563 claims, 262 questions, 29 references, 141 routing rows, every gate exit 0 |
| 1 | `data/routing/skill-split.json` | `split-map-check.mjs`, 5 known-bad maps all caught |
| 2 | Five tools discover skills by content | `test`, `verify`, `numbers` byte-identical to baseline while N was still 1 |
| 3 | 29 references copied to 41 destinations | sha256 per file, manifest beside the bytes |
| 4 | `evidence/claims.split.jsonl` | 563 in, 563 out, built from the extractor's own output |
| 5 | `rekey-claims` guarded | refuses to write when claims would vanish; proved both ways |
| 6 | `tests/questions.split.jsonl` | 262 rows, all resolve on disk, shared clauses identical in all four descriptions |
| 7 | Four `SKILL.md` + descriptions | 1400 / 1231 / 1218 / 1199 chars, all under the 1536 cap |
| 8 | Checkers resolve across skills | `collision-check` unresolved files 75 to 63 |

## The budget, which is the whole point

One skill had **1534** chars of description. Four skills have **1400, 1231, 1218 and 1199**, so
5,048 usable against 1,534, about 3.3x. The plan's honest estimate was ~2.9x; the shared clauses
repeated four times cost less than feared.

That number is the JUSTIFICATION, not the result. Whether four descriptions actually get invoked
more than one is what Part D measures, against a pre-committed revert condition, because the
listing budget drops descriptions starting with the least-invoked skills and four brand-new skills
have no invocation history at all.

## Three things found while doing this, that were not the split

1. **`extension-doctor.mjs` mis-measured the cap it exists to enforce.** It stripped the quotes off
   a YAML scalar without undoing the escapes, so every `\"` counted as two characters. It reported
   this project's own skill at 1554 against a ~1536 cap when the parsed value was 1534. The
   over-count equalled the escape count exactly, 20 for 20. Fixed, and guarded by a fixture in the
   CLEAN lint bench whose description is 1530 parsed and 1664 raw.
2. **`rekey-claims.mjs` destroyed before it warned.** It wrote `unchanged + moved` and only THEN
   exited 1 to report what vanished. With the references moved, every claim vanishes: measured, 563
   claims became a 1-line file. It now refuses to write when anything would be dropped.
3. **The plan's step order was wrong in one place.** Step 6 assigns questions, and 36 of them assert
   phrases in a description that step 7 writes. Those 36 cannot be assigned before the descriptions
   exist, so 7 ran before 6.

## What is left

- **Part D, the measurement that justifies all of this.** Re-run the 36-question benchmark against
  the split and compare with the **26 of 36** the single skill scored on 2026-08-15. The
  pre-committed revert condition stands: revert this cutover if the listing overflows and
  descriptions are dropped, or if arm A invocation falls below that baseline. Four brand-new skills
  have no invocation history, and the listing budget drops descriptions starting with the least
  invoked, so the plausible failure is four name-only skills, strictly worse than one.
- **Nothing here has been independently reviewed.** Every claim above is the author's own, and this
  session's base rate for that is poor.
- Risk 2 from the plan is now live and unmitigated: a question spanning two skills is answered by
  naming both, and 11 questions in the corpus target exactly that shape. `R-sdk-hooks` is the only
  fixture that asserts a cross-skill route.
