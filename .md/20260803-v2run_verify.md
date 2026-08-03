# Verification spec: the v2 Tier 3 run (commit 3475e47)

Context-free. Execute every check fresh. The published prose states conclusions; decide
whether the committed artifacts support them.

`WORK` =
`C:\Users\Shake\AppData\Local\Temp\claude\P--ClaudeExt-QuestionExtension\260040da-5e33-434b-b658-3f1f525e0bc4\scratchpad\ccx-c-drive`

`MIRROR` =
`C:\Users\Shake\AppData\Local\Temp\claude\P--ClaudeExt-QuestionExtension\260040da-5e33-434b-b658-3f1f525e0bc4\scratchpad\t3docs`

## Constraints

- Never run git against `P:\ClaudeExt`. Never touch `Z:\backup`.
- `WORK` is READ-ONLY except your review file. Tamper tests go in temp copies, deleted
  after, deletion confirmed. Issue copy and delete as separate commands.

## Checks

**1.** `git -C <WORK> log --oneline -3`, `git -C <WORK> status --porcelain`. PASS if HEAD is
`3475e47` or later touching only `.md/`, and the tree is clean or `.md/`-only.

**2.** Every gate, reporting each exit code: the five original repo gates; extension-doctor
and lint-bench self-tests; `tier3-strip/pack/score --self-test`; `tier3-keys-lint
--self-test`, `--defects`, `--set v2` (expect 0) and `--set v1` (expect 1); and the four
`--check` modes including `tier3-score --set v2 --check`. PASS if every expectation holds.

**3.** Re-derive the four-arm table YOURSELF from `tests/tier3/grades-v2.jsonl` and
`tests/tier3/blinding-map-v2.json`, with your own script, without calling tier3-score.
Aggregation rule: each cell is the mean of its two base grades unless a `grader:"adj"`
record exists, which overrides. PASS if your per-arm overall, per-field, and strict-primary
numbers match the published block exactly. Report your numbers.

**4.** Re-derive the paired comparisons and sign tests for D vs B, D vs B+, B+ vs B, B vs A.
PASS if wins, losses, ties and p-values match. State whether you agree D vs B is a null
result (published 20W 20L, p=1.000).

**5.** Grading integrity: confirm 3,369 records, exactly two base grades per cell from two
DIFFERENT graders across all 1,680 cells, and that the 9 adjudication records correspond
exactly to the full-point disagreements. PASS if all three hold; report any cell with a
full-point split lacking an adjudication.

**6.** Inter-grader agreement: re-derive exact-agreement and within-half-point rates per
field and overall. PASS if they match the published 92% and 99%.

**7.** Verified quotes: with your own script, check every citation in
`tests/tier3/answers-v2/` against `<MIRROR>`, whitespace-normalized. Report the per-arm rate
over ALL factual fields (not only cited ones) and compare to the published 98% and 99%, and
to `tests/tier3/verified-quote-rates-v2.json`. Report how many supplied quotes do NOT verify.

**8.** Key repair integrity: `tier3-keys-lint --set v2` green and `--set v1` red are check 2;
here, spot-verify 6 repairs of your choosing from `tests/tier3/key-repairs-v2.md` by reading
the cited mirror passage IN CONTEXT and judging whether the new key value is actually true
per that page. PASS if all 6 hold. Also confirm the 14 context_boundary keys in
`architecture-scenarios-v2.jsonl` match the UNSEEDED values in the log, not the seeded ones.

**9.** Frozen v1: `git -C <WORK> diff 26f60f3..HEAD -- tests/architecture-scenarios.jsonl
tests/tier3/grades.jsonl tests/tier3/blinding-map.json tests/tier3/answers` PASS if empty.

**10.** Pre-commitment: confirm from `git log -p -- tools/tier3-score.mjs` that
`DECISION_MARGIN`, `SIGN_ALPHA`, `verdictV2` and `REPLICATE_RULE` all landed BEFORE any file
under `tests/tier3/answers-v2/` existed. Report the commits and their order. This is the
check that decides whether the verdict was applied or fitted.

**11.** Gutting: in a temp copy, gut `aggregateCells` to return empty structures and run
`tier3-score --self-test`; gut `lintKeys` and run `tier3-keys-lint --self-test`. PASS only if
BOTH exit non-zero. Name the failing rows.

**12.** Drift: in a temp copy, change one digit in the published v2 block and run
`tier3-score --set v2 --check`; revert and re-run. PASS only if exit 1 then exit 0.

**13.** Blinding: confirm no file under `tests/tier3/packets-v2/` contains an arm label or a
`citations` key, that all 240 sheets share one key set, and that grading batches mix focus
areas (they should NOT be the natural S001-S010 blocks). Report the distinct sheet orderings
used out of 24.

**14.** Judgment. Read the v2 section of `tests/results-tier3.md` and the Tier 3 paragraph of
`README.md`. Is the NEGATIVE conclusion overstated, understated, or fair? Address
specifically: (a) whether a single replicate supports the strength of the wording, (b)
whether the disclosed S040 key defect is handled honestly, (c) whether a reader seeing only
the README would be misled. Your verdict on this check stands.

**15.** Dash scan `WORK` excluding `.git` and `.md/`. PASS if 0. Then
`$env:GITHUB_TOKEN=$null; gh run list --repo TranDenyDFW/claude-code-extension-engineering --limit 2`
and report CI status on HEAD.

## What the spec may have missed

Name anything you checked beyond this list and any defect you believe is real.

## Output

Write to `<WORK>\.md\20260803-v2run_review.md`. First line exactly
`Reviewer: independent subagent`; numbered PASS/FAIL blocks with pasted evidence; the missed
section; final line exactly one of `## Verdict: PASS`, `## Verdict: PARTIAL`,
`## Verdict: FAIL`. No em dashes or en dashes anywhere.
