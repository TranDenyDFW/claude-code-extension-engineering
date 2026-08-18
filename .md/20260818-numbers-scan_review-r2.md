# Review round 2: mutants guarding the paragraph scan, and excerpt attribution
Reviewer: independent subagent

Repository `P:\ClaudeExt\ccx-engineering-work`, branch `numbers-paragraph-scan` at `53118f7`
compared against `main` at `ff41b20`. Two commits on the branch: `f048469` (the paragraph scan
and the 247 to 280 correction) and `53118f7` (the two mutants plus the excerpt fix).

Everything below was executed by me in this round. All experiments ran inside throwaway
`git worktree` checkouts under the gitignored `tmp/`, so the branch working tree was never the
experiment surface. All three worktrees were removed at the end.

Three builds were used, and the difference between them was verified by diff, not assumed:

- `tmp/wt-head`, detached at `53118f7`, committed bytes (paragraph scan + mutants).
- `tmp/wt-line`, detached at `53118f7` with ONLY the FACTS scan loop replaced by `main`'s
  per-line version. `git diff` against `53118f7` showed exactly one hunk, the scan; `diff`
  against `main`'s file showed exactly one hunk, the new mutant rows. So the condition is
  precisely "mutants present, scan reverted".
- `tmp/wt-main`, detached at `ff41b20`, used only as the source of the per-line block.

## Checks executed

- **1. Round 1's disproof, re-run with the mutants in place** -> PASS.
  Surgical revert applied in `tmp/wt-head` (later moved to its own worktree `tmp/wt-line`).
  The revert diff against `53118f7` was the scan hunk and nothing else, and the mutant rows
  were confirmed still present at lines 149 and 153 of `tools/coverage-report.mjs`.
  `docs/RESULTS.md` was untouched at the corrected 280.

  `npm run numbers`:

      Documentation statements that disagree:
        none
      NUMBERS_EXIT=0

  So the gate is blind again, which is the expected consequence of the revert and confirms the
  revert actually landed.

  `npm run numbers:prove-fail`:

        ok   the copied docs are GREEN, so a doc mutant below means something
        FAIL MUST FAIL: a FACTS value that is wrong and already hard-wrapped  (exit 0)
        ok   ...and the docs return to GREEN once it is undone
        FAIL MUST FAIL: a FACTS value made wrong AND newly wrapped  (exit 0)
        ok   ...and the docs return to GREEN once it is undone
        ok   MUST FAIL: the retired total split across a hard wrap
        ...
      GATE CANNOT FAIL: 2 problem(s).
      PROVEFAIL_EXIT=1

  Round 1 observed `PROVE_FAIL_EXIT_WITH_FIX_REVERTED=0` in this condition. It is now 1, and the
  two red rows are exactly the two new mutants, named. The nine pre-existing mutants stayed green,
  so the redness is attributable to the new rows and to nothing else. The `(exit 0)` detail is
  itself informative: under a per-line scan the mutated document is entirely GREEN, so neither
  mutant merely failed with a different message.

  The tree was restored afterwards. Final `git status --porcelain` in
  `P:\ClaudeExt\ccx-engineering-work` printed nothing, `git worktree list` shows only the
  repository itself, and `git stash list` is empty.

- **2. Each mutant is genuinely WRAP-dependent** -> PASS.
  Direct A/B (`tmp/mutant-ab.mjs`): the same doc bytes were copied into a throwaway
  `COVERAGE_DOC_ROOT`, the mutant applied, and the SAME docroot fed to both builds.

      M1  a FACTS value that is wrong and already hard-wrapped
        anchor occurrences in docs/RESULTS.md: 1
        CONTROL unmutated  paragraph-scan exit=0  line-scan exit=0
        --- MUTATED, PARAGRAPH scan: exit=1 ---
            Documentation statements that disagree:
              docs/RESULTS.md:56  positive assertions: doc says 999, live is 280
                  hich guts every source file and confirms all 999 positive assertions go red. A suite that stays green against
            1 disagreement(s). ...
        --- MUTATED, PER-LINE scan: exit=0 ---
            Documentation statements that disagree:
              none
        RESTORED paragraph-scan exit=0

      M2  a FACTS value made wrong AND newly wrapped
        anchor occurrences in docs/RESULTS.md: 1
        CONTROL unmutated  paragraph-scan exit=0  line-scan exit=0
        --- MUTATED, PARAGRAPH scan: exit=1 ---
            Documentation statements that disagree:
              docs/RESULTS.md:15  suite rows: doc says 999, live is 295
                  **999 questions (set v2), 100% pass.** Each question carries a rege
            1 disagreement(s). ...
        --- MUTATED, PER-LINE scan: exit=0 ---
            Documentation statements that disagree:
              none
        RESTORED paragraph-scan exit=0

  Four properties hold for both, and each was needed:
  1. The unmutated control docroot is GREEN under BOTH scans, so a red is caused by the mutation.
  2. The anchor occurs exactly once, so the mutation is not a partial or ambiguous edit.
  3. Under the paragraph scan each mutant produces EXACTLY ONE disagreement, and it is the FACTS
     complaint the `want` regex names. Nothing incidental fires, so neither `want` is being
     satisfied by an unrelated failure. This matters most for M2, whose `want` is the loose
     `/doc says 999/`; the single-complaint output shows what actually matched it.
  4. Under the per-line scan each mutated docroot is GREEN with "none", not merely differently
     worded, so a per-line scan genuinely cannot catch either.

  The two exercise different halves of the capability, as intended. M1 mutates 280, a value the
  source already hard-wraps ("...confirms all" ends line 55, "280 positive assertions" begins
  line 56), so the phrase head and the value are on different lines with no edit to the layout.
  M2 leaves a value that is NOT wrapped and introduces the break itself
  (`**999\nquestions (set v2)`), so it tests the widening on a paragraph that had no wrap at all.

- **3. Excerpt and attribution, with values I chose** -> PASS.
  `tmp/excerpt-probe.mjs` appended two paragraphs to `README.md` in the `wt-head` worktree. The
  wrapped probe uses the one FACTS pattern whose match does NOT begin at the value
  (`/all\s+(\d+)\s+positive assertions/gi`), and places the wrap between the phrase head and the
  value, so the paragraph head, the match start and the value all sit on three different lines.
  As appended to disk:

       161: Reviewer probe A. This sentence is padding so the paragraph head is not the
       162: interesting line, and it now goes on to say that the suite exercises all
       163: 777 positive assertions, with the wrap falling between the phrase head and the value.
       164:
       165: Reviewer probe B states 888 composition cards inline on a single unwrapped line.

  Gate output, exit=1:

      Documentation statements that disagree:
        README.md:163  positive assertions: doc says 777, live is 280
            goes on to say that the suite exercises all 777 positive assertions, with the wrap falling between the phrase
        README.md:165  composition cards: doc says 888, live is 28
            Reviewer probe B states 888 composition cards inline on a single unwrapped line.

  Machine assertions the probe made on that output rather than by eye:

      CHECK README.md:163 [positive assertions] value=777
         excerpt contains value : true
         source line 163 text : "777 positive assertions, with the wrap falling between the phrase head and the value."
         source line contains it: true
      CHECK README.md:165 [composition cards] value=888
         excerpt contains value : true
         source line 165 text : "Reviewer probe B states 888 composition cards inline on a single unwrapped line."
         source line contains it: true

  Wrapped case: reported at 163, which is where `777` sits. Paragraph head is 161 and the match
  start (`all`) is 162, so the reported number distinguishes the new behaviour from both the old
  paragraph-head behaviour and from a plausible "line of the match start" implementation. The
  printed excerpt contains 777, which is the regression round 1 raised.
  Unwrapped case: reported at 165, exact, excerpt contains 888.
  Restored: `README.md` back to 8140 bytes, gate exit 0.

- **4. No regression in what round 1 established** -> PASS, three parts.

  **4a. The gate still catches the wrapped real case.** In `wt-head` I set only the value back to
  247, leaving the wrap as committed:

      Documentation statements that disagree:
        docs/RESULTS.md:56  positive assertions: doc says 247, live is 280
            hich guts every source file and confirms all 247 positive assertions go red. A suite that stays green against
      1 disagreement(s). ...
      EXIT=1

  Restored with `git checkout -- docs/RESULTS.md`, `git status --porcelain` empty. Note the line
  moved from 55 (round 1's observation) to 56, which is where 247 actually sits, and the excerpt
  now contains it. That is the round 1 issue 2 fix visible on the real defect site.

  **4b. 280 is the correct live positive-assertion count, derived by me three ways.**
  Straight from `tests/questions.jsonl`:

      total rows                         295
      positive (answer_key,!must_not)    280
      must_not_match rows                15
      rows with no answer_key            15
      distinct ids                       295
      pos+neg == total                   true

  From `npm run test:prove-fail`, counted over its rows rather than trusting its summary:
  `grep -c '^FAIL '` gives **280**, `grep -c '^PASS '` gives **0**, and the distinct FAIL ids
  (`awk '{print $2}' | sort -u | wc -l`) give **280**, so no row is double counted. Its own
  summary agrees: `TOTAL 295 15 280 5%` and `prove-fail: 280/280 positive assertions correctly
  went RED.` And the gate's own re-derivation prints `positive assertions 280`.

  **4c. No new false positives across the scanned docs.** I did not rely on the gate's verdict.
  `tmp/diff-scan.mjs` instruments the REAL FACTS loop in each build (so the regexes and the docs
  list are the shipped ones, not a re-extraction), prints every numeric-resolving match with its
  reported line, restores the file byte for byte, and diffs the two sets:

      paragraph build: exit=0  numeric-resolving matches=68
      line build: exit=0  numeric-resolving matches=66

      === VISIBLE ONLY UNDER PARAGRAPH SCAN (2) ===
        README.md:37 [purpose packs] value=2 span="Two purpose packs"
        docs/RESULTS.md:56 [positive assertions] value=280 span="all 280 positive assertions"

      === VISIBLE ONLY UNDER LINE SCAN (0) ===

  Across all **41** scanned docs (count re-derived from `skillDirs` plus the fixed list plus
  `tests/results*.md`), exactly two spans become newly visible and both are genuine statements
  that agree with their live value, so neither produces a complaint. `README.md:37` is the
  "Two purpose / packs" claim wrapped across lines 37 and 38, confirmed by reading the file.
  Nothing is lost: the line-only set is empty, so the widening strictly adds. This independently
  reproduces round 1's differential result by a different method.

- **5. Eleven gates, and 295 rows** -> PASS. Run on the clean branch tree.

      verify             -> EXIT 0   PASS: evidence ledger is internally consistent
      test               -> EXIT 0   TOTAL 295 295 0 100% / PASS: 295 of 295 rows passed.
      quotes             -> EXIT 0   PASS every verbatim quote still appears upstream.
      numbers            -> EXIT 0   Documentation statements that disagree: none
      facts              -> EXIT 0   PASS  1 fact(s) consistent across 5 artifact reads.
      drift              -> EXIT 0   PASS  657 claim(s) match their full-text hash...
      verify:prove-fail  -> EXIT 0   EVIDENCE LEDGER GATE CAN FAIL: all 6 mutants were rejected...
      test:prove-fail    -> EXIT 0   prove-fail: 280/280 positive assertions correctly went RED.
      numbers:prove-fail -> EXIT 0   GATE CAN FAIL: every known-bad source was rejected.
      facts:prove-fail   -> EXIT 0   PASS  8/8 self-test rows.
      drift:prove-fail   -> EXIT 0   PASS  6/6 self-test rows.

  `npm run test` reports **295** rows. The full `numbers:prove-fail` output on the committed tree
  shows both new mutants green, which is the positive control for check 1:

        ok   MUST FAIL: a FACTS value that is wrong and already hard-wrapped
        ok   ...and the docs return to GREEN once it is undone
        ok   MUST FAIL: a FACTS value made wrong AND newly wrapped
        ok   ...and the docs return to GREEN once it is undone

- **6. Scope** -> PASS. `git diff --name-only main...HEAD`:

      .md/20260818-docs-adoptions_review-r2.md
      .md/20260818-numbers-scan_review.md
      docs/RESULTS.md
      tools/coverage-report.mjs

  and `--stat` gives `4 files changed, 740 insertions(+), 4 deletions(-)`, of which 689 insertions
  are the two `.md/` artifacts. Only `tools/coverage-report.mjs`, `docs/RESULTS.md` and files
  under `.md/`. The `docs/RESULTS.md` diff is one line, 247 to 280, with the wrap unchanged.

- **7. Working tree left clean** -> PASS. `git worktree list` shows only
  `P:/ClaudeExt/ccx-engineering-work  53118f7 [numbers-paragraph-scan]`; `git status --porcelain`
  printed nothing and `git stash list` is empty, checked after every restore and again at the end.
  Probe scripts live under the gitignored `tmp/` (`revert-scan.mjs`, `mutant-ab.mjs`,
  `excerpt-probe.mjs`, `diff-scan.mjs`, `reflow-durability.mjs`). The only working-tree addition
  after this review is this file.

## Issues found

1. **None blocking.** Both things round 1 asked to be added are present and both do what they
   claim, measured in both directions.

2. **Durability observation, measured, non-blocking: M1's wrap-dependence is a property of the
   current formatting of `docs/RESULTS.md`, not of the mutant.** M1's anchor is the bare string
   `280 positive assertions`, and it is invisible to a per-line scan only because the source
   happens to break between `all` and `280`. I did not assert this, I ran it
   (`tmp/reflow-durability.mjs`): a docroot copy with that one wrap reflowed onto a single line,
   value untouched, then mutated.

       control, reflowed but unmutated: para exit=0  line exit=0
       M1 on REFLOWED source: para exit=1  line exit=1   (line exit 1 would mean M1 stopped being wrap-dependent)
       M2 on REFLOWED source: para exit=1  line exit=0   (line exit 0 means M2 is still wrap-dependent)

   So if that paragraph is ever reflowed, M1 keeps passing while silently no longer testing the
   paragraph scan. M2 does not have this property, because it carries its own line break in the
   replacement text, so it stays wrap-dependent under any source layout. The protection therefore
   survives the reflow through M2 alone, and a revert of the scan would still turn
   `numbers:prove-fail` red. Recording it because a mutant that quietly stops being a mutant is
   the same defect class this file exists to catch; a cheap hardening would be to make M1's
   `from` anchor include the line break it depends on, so a reflow makes the mutant a no-op and
   the harness reports "anchor not found" instead of a false green.

3. Procedural note, not a finding: my first run of `tmp/reflow-durability.mjs` crashed on a
   premise assertion because `docs/RESULTS.md` is CRLF and the probe searched for a bare `\n`.
   That was a fault in my probe, not in the branch. I fixed the probe, verified what landed on
   disk (`grep | cat -A` showed the literal `\r\n`), and re-ran it; the numbers above are from
   the successful run. No conclusion was drawn from the crashed run.

## Verdict: PASS

Round 1's central finding is closed, and closed by the mechanism it named. Reverting only the
scan while leaving the mutants in place now turns `numbers:prove-fail` RED at exit 1 and names
both new rows, where round 1 measured exit 0 and full green. Both mutants are genuinely
wrap-dependent rather than incidentally failing: each is silent under a per-line scan
(exit 0, "none") and each produces exactly one complaint under the paragraph scan, the one its
`want` regex names, against a control docroot that is green under both. The excerpt regression is
fixed and verified with my own injected values in both the wrapped and unwrapped cases, including
on the real 247 defect site, where the report moved to line 56 and the excerpt now contains the
number being reported. Nothing round 1 established regressed: the wrapped case is still caught,
280 is confirmed by three independent derivations, and a differential instrumentation of the real
FACTS loop across 41 docs finds the same two newly visible spans, both genuine, none lost. Eleven
gates green, 295 rows, scope limited to the three permitted paths, tree clean.
