# Review: paragraph-scoped numbers gate and the 247 to 280 correction
Reviewer: independent subagent

Repository `P:\ClaudeExt\ccx-engineering-work`, branch `numbers-paragraph-scan` (single commit
`f048469`) compared against `main` (`ff41b20`). Everything below was executed by me. `main` was
exercised in a throwaway `git worktree` so the branch working tree was never the experiment
surface; both worktrees were removed at the end and the tree verified clean.

## Checks executed

- **1a. Blindness reproduced on `main`: the wrap makes the gate pass over a stale value** -> PASS.
  Worktree of `main` at `tmp/wt-main`, `node tools/coverage-report.mjs --doc-numbers`:

      EXIT=0
      Live values re-derived from the artifacts:
        ...
        positive assertions             280
        ...
      Documentation statements that disagree:
        none

  while that same tree's `docs/RESULTS.md` reads, at lines 55 and 56:

      as a regression gate and through `--prove-fail`, which guts every source file and confirms all
      247 positive assertions go red. A suite that stays green against deleted content proves

  The gate re-derives 280, the doc publishes 247, and the gate reports "none". The premise holds:
  the fact rule is `/all\s+(\d+)\s+positive assertions/gi` and the wrap sits between `all` and `247`,
  so no single line ever contains the span.

- **1b. Rejoining the wrap WITHOUT touching the number makes `main` fail** -> PASS.
  I spliced line 55 and line 56 into one line, changing no digit (`grep -c "247 positive assertions"`
  still returns `1`). Same command, same tree:

      Documentation statements that disagree:
        docs/RESULTS.md:55  positive assertions: doc says 247, live is 280

      1 disagreement(s). ...
      EXIT=1

  The only variable between 1a and 1b is the line break. The blindness is the wrap, not the value.

- **1c. `main` worktree restored cleanly** -> PASS. `git checkout -- docs/RESULTS.md`, then
  `git status --porcelain` printed nothing and the gate returned `RESTORED_GATE_EXIT=0`.

- **2. The branch closes it, proven with a stale value injected where none existed** -> PASS.
  Branch baseline first: clean tree, `--doc-numbers` gives `none`, `EXIT=0`.
  I then appended to `README.md` (a different scanned doc, which contained no `composition cards`
  string at all beforehand) a paragraph whose stale figure is split by a hard wrap, plus a second
  stale figure sitting whole on a later line:

      161: Independent wrap probe: the reference set currently documents 17
      162: composition cards today, which is a deliberately stale figure planted by a reviewer.
      163: It also reports 99 current tools, a single-line stale figure on the third line.

  Branch gate:

      Documentation statements that disagree:
        README.md:161  composition cards: doc says 17, live is 28
        README.md:163  current tools: doc says 99, live is 44

      2 disagreement(s). ...
      EXIT=1

  It fails, and it names both. I then copied that identical `README.md` into the `main` worktree and
  ran `main`'s gate on it, which is the controlled A/B:

      Documentation statements that disagree:
        README.md:163  current tools: doc says 99, live is 44

      1 disagreement(s). ...
      EXIT=1

  `main` sees only the unwrapped one. The wrapped one at 161 is invisible to it. That is precisely
  the capability the branch adds, measured against the same bytes.
  Restored: `git checkout -- README.md` in both trees, `git status --porcelain` empty in both,
  `README.md` back to its original 8140 bytes.

- **2b. The real defect site is caught in place on the branch** -> PASS. On the branch I set only
  the value back to 247, leaving the wrap exactly as committed:

      docs/RESULTS.md:55  positive assertions: doc says 247, live is 280
      1 disagreement(s). ...
      EXIT=1

  Restored with `git checkout -- docs/RESULTS.md`, `git status --porcelain` empty.

- **3. 280 derived independently, not taken from the commit message or the doc** -> PASS.
  Three separate derivations agree.

  `node tests/run-tests.mjs --prove-fail`:

      category            n   pass   fail   rate
      -------------------------------------------
      anti-hallucination  25      0     25     0%
      factual             213      0    213     0%
      navigation          22      0     22     0%
      routing-negative    15     15      0   100%
      routing-positive    20      0     20     0%
      -------------------------------------------
      TOTAL               295     15    280     5%

      prove-fail: 280/280 positive assertions correctly went RED.

  My own count over that output, not its summary line: `grep -c '^FAIL '` gives **280**, and the
  distinct FAIL ids (`awk '{print $2}' | sort -u | wc -l`) give **280**. `grep -c '^PASS '` gives 0,
  so no row is double counted.

  And straight from the corpus, `tests/questions.jsonl`:

      total rows: 295
      with answer_key: 280
      must_not_match: 15
      answer_key && !must_not_match (positive assertions): 280
      no answer_key: 15
      distinct ids: 295

  280 plus 15 is 295, the 15 `must_not_match` rows are exactly the 15 without an `answer_key`, and
  the gate's own re-derivation prints `positive assertions 280`. **280 is correct**; the doc edit
  from 247 to 280 is right, and 247 is nowhere near the live value.

- **4. Line attribution did not regress** -> PASS. This is the naive-implementation trap, so I built
  a paragraph where the interesting matches deliberately do NOT start at the head. Appended to
  `README.md`, paragraph head at line 161:

      161: Attribution probe paragraph line one carries no countable claim at all.
      162: Line two also carries nothing countable, it only takes up vertical space.
      163: Line three ends with the stale figure 17
      164: composition cards, so that span begins on line three of this paragraph.
      165: Line five states 99 current tools inline so its span begins on line five.

  Result:

      README.md:163  composition cards: doc says 17, live is 28
      README.md:165  current tools: doc says 99, live is 44

  The wrap-spanning span is reported at **163**, where `17` actually sits, not at the paragraph head
  161. The single-line span is reported at **165**, again not the head. Both exact.
  Check 2 gives the same result independently: a single-line match at 163 attributed to 163 while
  its paragraph began at 161, and `main` reported that same single-line match at 163 too, so the
  single-line path is byte for byte unchanged.
  Check 2b covers the wrapped case in the real document: the span `all 280 positive assertions`
  starts with `all` on line 55, and 55 is what is reported.
  Reading `lineFor`, the scan keeps a `starts` list of `{at, line}` per paragraph and walks it for
  the greatest `at <= index`, so attribution is by construction rather than by luck; `starts[0].at`
  is always 0 so the lookup cannot fall off the front.

- **5. No false positives introduced** -> PASS, with the residual mechanism named.
  I did not rely on the gate's own verdict. I wrote a differential probe (`tmp/scan-diff.mjs`) that
  extracts all 20 FACT regexes verbatim out of `tools/coverage-report.mjs` (with an explicit
  regex-literal scanner, because a regex-based extraction silently truncated the two patterns
  containing an escaped forward slash), reproduces the exact `docs` list, and runs BOTH the old line
  scan and the new paragraph scan over every scanned file, diffing the span sets:

      FACT patterns extracted: 20
      scanned docs: 41
      numeric-resolving matches: line-scan=66  paragraph-scan=68

      === VISIBLE ONLY UNDER PARAGRAPH SCAN (2) ===
        README.md:37  [purpose packs] value=2  span="Two purpose packs"
        docs/RESULTS.md:55  [positive assertions] value=280  span="all 280 positive assertions"

      === VISIBLE ONLY UNDER LINE SCAN (0) ===

  Exactly two spans become newly visible across all 41 files, and both are genuine statements.
  The `README.md:37` one is a second claim the wrap was hiding all along ("Two purpose / packs:"),
  and it happens to agree with the live value of 2, so it produces no complaint. Nothing is lost:
  the line-only set is empty, so the widening strictly adds.

  On whether a join can fabricate a match, I probed the widest pattern in the set,
  `/(?:grown to\s+)?(\w+)\s+fixtures/gi`, the only one whose capture is `\w+` rather than `\d+`.
  The mechanism is real but narrow (`tmp/fp-probe.mjs`):

      heading then body, no blank line           line-scan: (none)   para-scan: 20 fixtures
      sentence ends in bare number, next line     line-scan: (none)   para-scan: 2026 fixtures
      sentence ends in number WITH a period       line-scan: (none)   para-scan: (none)
      markdown table rows                         line-scan: (none)   para-scan: (none)
      list bullets                                line-scan: (none)   para-scan: (none)
      genuine hard wrap                           line-scan: (none)   para-scan: nine fixtures

  So a fabricated match needs a line to end in a bare, unpunctuated number and the next line to
  begin with the fact phrase. Sentence-final punctuation kills it (the `\s+` cannot match the `.`),
  markdown table pipes kill it, and list bullet markers kill it. The only structural shape that
  survives is a heading joined directly to body text with no blank line between them.
  I then measured that shape in the real corpus: of **1378** paragraphs, exactly **1** contains a
  heading line, 74 contain a table row, 43 contain a fence, 233 contain two or more bullets. I also
  enumerated every line break that creates a new digits-then-word adjacency: **45** of them, listed
  in full in the probe output, and none produces a FACTS match, which the differential probe above
  confirms independently by finding only the two genuine spans.

  Gate run across all scanned docs, before and after: with 247 restored, exactly **1** disagreement
  and it is the intended one; on the committed tree, `none` and `EXIT=0`.

- **6. Eleven gates, and 295 rows** -> PASS. Run on the clean restored tree.

      verify            -> EXIT 0   PASS: evidence ledger is internally consistent
      test              -> EXIT 0   TOTAL 295 295 0 100% / PASS: 295 of 295 rows passed.
      quotes            -> EXIT 0   PASS every verbatim quote still appears upstream.
      numbers           -> EXIT 0   Documentation statements that disagree: none
      facts             -> EXIT 0   PASS  1 fact(s) consistent across 5 artifact reads.
      drift             -> EXIT 0   PASS  657 claim(s) match their full-text hash...
      verify:prove-fail -> EXIT 0   EVIDENCE LEDGER GATE CAN FAIL: all 6 mutants were rejected...
      test:prove-fail   -> EXIT 0   prove-fail: 280/280 positive assertions correctly went RED.
      numbers:prove-fail-> EXIT 0   GATE CAN FAIL: every known-bad source was rejected.
      facts:prove-fail  -> EXIT 0   PASS  8/8 self-test rows.
      drift:prove-fail  -> EXIT 0   PASS  6/6 self-test rows.

  Eleven, and the accounting is right: `package.json` defines `prove-fail` counterparts for exactly
  five of the six (`verify`, `test`, `numbers`, `facts`, `drift`); `quotes` has none, which is why
  six plus five is eleven and not twelve. `npm run test` reports **295** rows.

- **7. Scope** -> PASS. `git diff --name-only main...HEAD`:

      .md/20260818-docs-adoptions_review-r2.md
      docs/RESULTS.md
      tools/coverage-report.mjs

  and `--stat` shows `3 files changed, 438 insertions(+), 3 deletions(-)`, of which 408 insertions
  are the `.md/` artifact. Only the two named files plus one file under `.md/`. Single commit
  `f048469` on the branch.

- **8. Working tree left clean** -> PASS. Both temporary worktrees removed
  (`git worktree list` shows only `P:/ClaudeExt/ccx-engineering-work ... [numbers-paragraph-scan]`),
  `git status --porcelain` empty, `git stash list` empty, `git diff --stat` empty. `README.md` is
  back to 8140 bytes. Probe scripts live under the gitignored `tmp/`.

## Issues found

1. **The widened behaviour ships with no must-fail mutant, and I proved the gap mechanically.**
   This is the substantive finding. `tools/coverage-report.mjs --prove-can-fail` has 24 assertions,
   including `MUST FAIL: the retired total split across a hard wrap`, but that mutant exercises the
   RETIRED-value ban, which already flattened whitespace across the whole file before this change.
   Nothing exercises the FACTS/`docs` scan that this commit actually modified. To verify rather than
   assume, I made a detached worktree at `f048469` and reverted only the code half with
   `git checkout main -- tools/coverage-report.mjs`, leaving `docs/RESULTS.md` at the corrected 280:

       PROVE_FAIL_EXIT_WITH_FIX_REVERTED=0
       GATE CAN FAIL: every known-bad source was rejected.
       NUMBERS_EXIT=0

   With the entire fix removed, the gate's own must-fail proof is still fully green. A future edit
   that returns the FACTS loop to `split(/\r?\n/)` would pass every one of the eleven gates. The
   file's own header states the standard it is failing here: a claimed invariant with no mutation
   behind it is the same defect as a check that cannot fail. Two invariants are claimed in the new
   comment (wrapped values are caught, line numbers stay exact) and neither has a mutant.
   The fix: add two rows to the `--prove-can-fail` doc-mutant table, one wrapping a live FACTS value
   across a line break with the value made stale, one asserting the reported line number, each with
   the existing "and the docs return to GREEN once it is undone" counterpart.

2. **The diagnostic context line regressed from the matching line to the paragraph head.**
   The second line of each complaint is `line.trim().slice(0, 110)`, and `line` is now the whole
   joined paragraph rather than the source line. So the quoted context can come from a different
   line than the one reported and need not contain the offending number. Observed directly in
   check 4, where the report is correct at `README.md:165` but the excerpt shown is the text of
   line 161:

       README.md:165  current tools: doc says 99, live is 44
           Attribution probe paragraph line one carries no countable claim at all. Line two also carries nothing countabl

   `main` printed the matching line itself. The line number is exact so nothing is unfindable, and
   this does not affect pass or fail, but it is a real loss of signal in the output a human acts on.
   Slicing a window around `m.index` instead of the paragraph head restores it, at no cost.

3. Not a defect, an observation worth recording: the wrap was hiding **two** claims in the scanned
   corpus, not one. `README.md:37` publishes "Two purpose / packs" across a line break and was
   equally invisible to `main`. It is currently correct at 2, so nothing was wrong, but it had the
   same zero protection the 247 had, and it is now guarded.

## Verdict: PARTIAL

Every one of the seven requested checks passed when I ran it, and I produced the evidence for each
above. The change does exactly what it claims in both directions: `main` is blind to the wrapped
value and the branch catches it, 280 is independently correct, line attribution is exact including
for mid-paragraph and wrap-spanning matches, and the widening adds two genuine spans across 41 files
while losing none and fabricating none.

PARTIAL rather than PASS for one reason, issue 1: reverting the entire code change leaves all eleven
gates green, so the newly widened behaviour has no committed protection at all. In a repository whose
stated discipline is that every gate ships a proof it can fail, and which already carries a hard-wrap
mutant for its other scanner, shipping this widening without one is a shortfall in the change rather
than in the reviewer's checklist. Add the two mutants named in issue 1 and this is a clean PASS.
