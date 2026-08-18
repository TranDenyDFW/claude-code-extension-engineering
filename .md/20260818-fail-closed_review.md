# Review: wrapped mutant fails closed on reflow
Reviewer: independent subagent

Repository `P:\ClaudeExt\ccx-engineering-work`, branch `mutant-fail-closed` (53dfca5) against
`main` (34247ec). Every command below was run by me. Where a run needed `main`, it ran in a
throwaway worktree at `tmp/rv8/wt-main`, which has since been removed.

The reflow used throughout is a pure wrap move in `docs/RESULTS.md`, applied by
`tmp/rv8/reflow.mjs`, which refuses to write unless the digit sequence of the whole file is
unchanged, the whitespace-flattened file is unchanged, and the CRLF count is unchanged:

    -as a regression gate and through `--prove-fail`, which guts every source file and confirms all
    -280 positive assertions go red. A suite that stays green against deleted content proves
    +as a regression gate and through `--prove-fail`, which guts every source file and confirms
    +all 280 positive assertions go red. A suite that stays green against deleted content proves

    reflow applied; digits identical; only whitespace differs; CRLF count unchanged

Line endings were checked as bytes, not by eye. `docs/RESULTS.md` is CRLF on disk: `CR 383
CRLF 383 bareLF 0`, so every CR belongs to a CRLF pair.

## Checks executed

- 1. the hole existed on `main`, part a: reflow on `main`, prove-fail stays green -> PASS.
  `npm run numbers exit=0`, `npm run numbers:prove-fail exit=0`, closing with
  `GATE CAN FAIL: every known-bad source was rejected.` and, on line 10 of that output,
  `ok   MUST FAIL: a FACTS value that is wrong and already hard-wrapped`. So on `main` the
  reflow costs nothing and M1 still reports as a passing mutant.

- 1. the hole existed on `main`, part b: the passing M1 was no longer testing the paragraph
  scan -> PASS. With the reflow still applied on `main` I reverted only the FACTS scan to
  per-line (`tmp/rv8/revert-scan.mjs`, which cuts `paragraphsOf`/`lineFor` and restores
  `lines.forEach((line, i) =>`, and aborts unless exactly one `lineFor` call is removed and no
  reference survives). `numbers:prove-fail exit=1` with:

        10:  ok   MUST FAIL: a FACTS value that is wrong and already hard-wrapped
        12:  FAIL MUST FAIL: a FACTS value made wrong AND newly wrapped  (exit 0)
        30:GATE CANNOT FAIL: 1 problem(s).

  M1 passes with the paragraph scan gone. That is the residual hole, demonstrated rather than
  asserted. Counterfactual on the same `main` worktree with the reflow restored and the
  per-line revert still in place: `numbers:prove-fail exit=1` with both named,
  `FAIL ... already hard-wrapped  (exit 0)`, `FAIL ... newly wrapped  (exit 0)`,
  `GATE CANNOT FAIL: 2 problem(s).` So the wrap, and only the wrap, is what made M1 stop
  guarding. Both edits restored; `git status --porcelain` empty in the worktree.

- 2. the branch fails closed -> PASS. Same reflow in the primary tree on `mutant-fail-closed`:
  `npm run numbers exit=0` (no digit changed, the live gate is still correct) and
  `npm run numbers:prove-fail exit=1` with:

        10:  FAIL MUST FAIL: a FACTS value that is wrong and already hard-wrapped  (anchor not found, the mutant would be a no-op)
        11:  ok   MUST FAIL: a FACTS value made wrong AND newly wrapped
        29:GATE CANNOT FAIL: 1 problem(s).

  Red, and the reason names M1 as an anchor-not-found no-op rather than M1 simply passing.
  Restored: `git status --porcelain` empty, and `docs/RESULTS.md` compares equal to the `HEAD`
  blob once the stored eol convention is normalised (`bytes equal to HEAD blob after
  normalising eol: true`).

- 2b. the fail-closed property is not specific to one wrap point -> PASS. A second, opposite
  reflow (`tmp/rv8/reflow2.mjs`, moving the break to after the value: `and confirms all 280` /
  `positive assertions go red.`) also gives `exit=1` with
  `FAIL ... already hard-wrapped  (anchor not found, the mutant would be a no-op)` on the
  branch. The same second reflow on `main` also breaks `main`'s anchor and reports the same
  no-op message, `exit=1`. Recorded because it sharpens the finding rather than softening it:
  `main`'s shorter anchor survives exactly the reflow direction that neuters the mutant and
  breaks on the harmless one, which is precisely backwards. Both trees restored, both clean.

- 3. normalisation did not weaken anything else -> PASS. Run by `tmp/rv8/rv8-mutants.mjs`,
  which does NOT retype the mutant table: it slices the `docMutants` array literal out of
  `tools/coverage-report.mjs` and evaluates it, so it cannot agree with a table it is not
  testing. It reported `mutants extracted from the branch source: 9`, matching the nine
  `MUST FAIL` doc rows in a live prove-fail run. Five separate things were checked, not one:

  - Is the gate itself blind to line endings? Two docroots were built from the same tree, one
    verbatim (CRLF) and one with every CRLF file converted to LF:
    `docroot files carrying CRLF: 382; files converted to LF for the B copy: 382`,
    `gate on CRLF docroot: exit 0 | gate on LF docroot: exit 0`,
    `stdout byte-identical across the two line-ending styles: true`. So no verdict anywhere in
    the gate can turn on eol, which is the precondition for the rest.
  - Could removing a CR join two characters that were previously apart, and so let an anchor
    match text it previously did not? Only if a CR appeared without a following LF.
    `files containing a bare CR (a CR not followed by LF): 0` across the whole docroot. With no
    bare CR, removing a CR always leaves the LF in place, so an anchor containing no `\n`
    cannot bridge a break it could not bridge before.
  - Could normalisation make an anchor STOP matching? Only if an anchor contained a literal
    CR. None of the nine does: all nine print `no-CR` for `from` and `to-noCR` for `to`.
  - For the eight anchors that carry no line break, did normalisation change WHICH occurrence
    is mutated or WHAT the mutated file says? All eight report
    `normalise-commutes-with-mutate: true`, that is
    `normalise(raw.replace(from,to)) === normalise(raw).replace(from,to)`, with
    `rawAnchorFound=true(x1) normalisedAnchorFound=true(x1)` in every case. Identical
    occurrence count, identical result modulo eol. Only M1 differs, and in the intended
    direction: `anchorHasNewline=true rawAnchorFound=false(x0) normalisedAnchorFound=true(x1)`.
  - Does any mutant now fire only because an EARLIER mutant left the file LF? Each of the nine
    was re-run in isolation against its own FRESH CRLF docroot. All nine:
    `fresh-docroot verdict: exit 1 want-matched=true -> FIRES`, closing
    `CHECK3 OK: every mutant fires from a fresh CRLF docroot`. The live harness agrees: the
    unmodified branch run shows all nine `MUST FAIL` doc rows `ok`, each followed by
    `ok   ...and the docs return to GREEN once it is undone`.

- 4. the guard still bites -> PASS. On the branch, scan reverted to per-line with the mutant
  table left exactly as it is (`scan reverted to per-line; mutant table untouched`,
  `git diff --stat` shows only `tools/coverage-report.mjs | 32 +-`):

        10:  FAIL MUST FAIL: a FACTS value that is wrong and already hard-wrapped  (exit 0)
        12:  FAIL MUST FAIL: a FACTS value made wrong AND newly wrapped  (exit 0)
        30:GATE CANNOT FAIL: 2 problem(s).

  `numbers:prove-fail exit=1`, both paragraph mutants named. The property from the earlier
  rounds has not regressed. Reverted; `tools/coverage-report.mjs` then compared byte for byte
  against the `HEAD` blob: `coverage-report.mjs matches HEAD blob byte for byte: true`.

- 5. M2 is independently wrap-dependent -> PASS. Read out of the branch source:

        M2: MUST FAIL: a FACTS value made wrong AND newly wrapped
           from="**295 questions (set v2)"  fromHasBreak=false
           to  ="**999\nquestions (set v2)"  toHasBreak=true

  M2 carries the line break in its own replacement, so it does not borrow the source's wrap
  the way M1 does. M1 was then deleted from the table outright (`tmp/rv8/drop-m1.mjs`, which
  aborts unless the cut block contains M1's payload and M2 survives; it reported
  `M1 removed (5 source lines cut); M2 retained`, and `grep "MUST FAIL: a FACTS"` afterwards
  returns the single line 149, M2). With M1 gone:

  - per-line scan: `numbers:prove-fail exit=1`,
    `10:  FAIL MUST FAIL: a FACTS value made wrong AND newly wrapped  (exit 0)`,
    `28:GATE CANNOT FAIL: 1 problem(s).`
  - paragraph scan: `numbers:prove-fail exit=0`,
    `10:  ok   MUST FAIL: a FACTS value made wrong AND newly wrapped`,
    `28:GATE CAN FAIL: every known-bad source was rejected.`

  So M2 alone is a working guard: green while the paragraph scan is there, red the moment it
  is removed. Protection does not rest on M1. Restored; tree clean.

- 6. eleven gates -> PASS. Run twice, once before I touched anything and once after every edit
  was restored. Identical both times:

        verify exit=0            test exit=0             quotes exit=0
        numbers exit=0          facts exit=0            drift exit=0
        verify:prove-fail exit=0    test:prove-fail exit=0    numbers:prove-fail exit=0
        facts:prove-fail exit=0     drift:prove-fail exit=0

  `npm run test` reports `TOTAL               295    295      0   100%` and
  `PASS: 295 of 295 rows passed.`

- 7. scope -> PASS. `git diff --stat main...HEAD`:

        .md/20260818-numbers-scan_review-r2.md | 281 +++++++++++++++++++++++++++++++++
        tools/coverage-report.mjs              |  10 +-
        2 files changed, 288 insertions(+), 3 deletions(-)

  Filtering the name list for anything that is neither `tools/coverage-report.mjs` nor under
  `.md/` returns nothing.

- 8. tree left clean -> PASS. `git status --porcelain` empty, `git diff --stat` empty,
  `git worktree list` shows only `P:/ClaudeExt/ccx-engineering-work  53dfca5
  [mutant-fail-closed]`. The `tmp/rv8/wt-main` worktree was removed and pruned. My scratch
  files live under `tmp/`, which `.gitignore` already excludes. No temp docroot survived:
  `(no leftover docroots)`.

## Issues found

- none.

Observations, none of which is a defect and none of which blocks the change, recorded so the
next reviewer does not have to rediscover them:

- The fix converts a silent pass into a loud stop, which also means a HARMLESS reflow of that
  sentence now turns the gate red until someone re-anchors M1. That is the trade the change is
  named for, and the message it prints (`anchor not found, the mutant would be a no-op`) says
  what to do. Measured above under check 2b in both wrap directions.
- The mutant loop restores `orig`, the normalised text, rather than `origRaw`. So after the
  first mutant on a file, later mutants on that same file run against an LF copy instead of
  the CRLF bytes that are really on disk. I looked for a way this could matter and could not
  find one: the gate's stdout is byte-identical across the two styles, every mutant still
  fires from a fresh CRLF docroot, and the docroot is a temp tree that is deleted at the end.
  Writing `origRaw` back would remove the question entirely, at the cost of one word.
- Environment note that cost me a false start and is not about this branch: `core.autocrlf` is
  `true` here, so `git worktree add` lands `tools/coverage-report.mjs` as CRLF while the
  primary working tree holds it as LF. Any script that matches source text across lines has to
  normalise first. For the same reason `docs/RESULTS.md` and `IMPROVEMENTS.md` are byte
  different from their `HEAD` blobs in a clean tree; `IMPROVEMENTS.md`, which I never touched,
  shows the identical pattern, which is how I confirmed it is the storage convention and not
  damage.

## Verdict: PASS
