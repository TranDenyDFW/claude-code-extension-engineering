# Skill split: where it stands

Steps 0 through 8 of a nine-step migration are done. **Step 9, the cutover, has not run.** Both
trees are on disk on purpose: the single `claude-code-extension-engineering` skill still exists and
still works, and four `cc-ext-*` skills exist beside it.

## One gate is RED, by design, and only one

`npm run verify` reports **6 errors**, all of the same shape:

```
DRIFT: tagged line CLM-DELEGATION-SKILL-053 (skills/cc-ext-delegation-and-instructions/SKILL.md:53)
       has no ledger record
```

Six tagged lines in the four new `SKILL.md` files have no record in `evidence/claims.jsonl`, which
is correct: that ledger describes the OLD tree. The new tree's ledger is
`evidence/claims.split.jsonl`, and the two swap at cutover. `verify` re-runs the extraction and
diffs by record, so while five skills exist and one ledger covers four of them, six drifts is the
honest answer.

The count is pinned here on purpose. **Six is expected. Seven is a bug.** If this number moves
before cutover, something changed that was not supposed to.

Every other gate is green: `test` 262 of 262, `numbers`, `doctor` (1 SILENT, the expected
duplicate-across-scopes while both trees exist), `quotes`, the doctor self-test, routing 8 of 8
against 141 rows, and `split-map-check`.

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

- **Step 9, cutover**: swap the ledgers in, delete the old tree, update README / RESULTS /
  SUBMISSION / plugin.json, one commit. Not started, and it is the point of no return.
- **Part D**: re-run the 36-question benchmark against the split and compare with the 26 of 36 the
  single skill scored on 2026-08-15. Revert step 9 if the listing overflows and descriptions are
  dropped, or if arm A invocation falls below that baseline.
- `cc-ext-packaging-and-integration` still has **no routing fixture**, so it would ship with an
  unproven routing surface. That was risk 4 in the plan and it is still open.
