# Review round 3: the return-contract section in subagents.md
Reviewer: independent subagent

Run from `P:\ClaudeExt\ccx-engineering-work`, branch `return-contract-section` at `37ecccf`,
against `main` at `3e6580d` (the merge base, confirmed with `git merge-base`). The reflog shows
`ab653d9` (round 1) amended to `0a7760a` (round 2) amended to `37ecccf`, so this is one commit
past what round 2 saw. I did not write this and did not perform rounds 1 or 2. I read both prior
reviews for context and then re-ran every check myself; nothing below is inherited.

Environment facts I established rather than assumed: `docs/RESULTS.md`, `subagents.md` and
`tools/coverage-report.mjs` are all **LF** on disk, not CRLF, so every byte match below was done
against the actual bytes. `core.autocrlf` is `true` and git warned it would rewrite
`coverage-report.mjs` to CRLF, so the check-8 restore was done by reversing my own edit and
byte-comparing against `git show HEAD:...`, never by `git checkout --`. No `/tmp` was used; all
working files went to `tmp/` (which self-ignores via `tmp/.gitignore` containing `*`). No
worktree was created. Tree was clean before, during the one interval I deliberately dirtied it,
and after.

## Checks executed

- **1a. Ledger, text-keyed pairing across the WHOLE file** -> PASS. I parsed
  `git show main:evidence/claims.jsonl` (657 records, 432205 bytes) and the live
  `evidence/claims.jsonl` (664 records, 453810 bytes) and paired every record by
  **byte-identical `text`**. **0 duplicate texts on either side**, so the pairing is unambiguous
  and not a positional guess. **657 of 657** main texts are present on the branch. For each of
  those 657 pairs I compared `source`, `note`, `status`, `tags`, `versions`, `file`,
  `text_sha256` **and the key set/order**, treating an **empty string and an absent key as
  DIFFERENT** (`shape(v) = v === undefined ? 'ABSENT' : JSON.stringify(v)`).
  **Field differences among the 657 pairs: 0.** I then re-ran the comparison as a full deep
  equality of each record with only `id` and `line` deleted, which covers any field my list
  omitted: **657 of 657 deep-identical, 0 differing.**

- **1b. The round 2 residue is gone** -> PASS. `CLM-subagents-144` (main's `CLM-subagents-127`,
  the `Built-in subagents ship by default ...` claim) now has
  `hasOwnProperty('note') === false`. Its key list is
  `id,file,line,text,tags,versions,source,status,text_sha256`, identical to its main
  counterpart's. Note-shape census over the whole ledger: **main absent=164 empty=0
  nonempty=493**; **branch absent=164 empty=0 nonempty=500** (the seven new claims supply the
  seven extra non-empty notes). Round 2 measured branch `absent=163 empty=1`; that record moved
  back into `absent`, which is exactly the one-key fix it asked for. Independent byte-level
  confirmation: a raw regex sweep of the file for `"note"\s*:\s*""` returns **0 occurrences**,
  and whitespace-only notes are also **0**.

- **1c. Seven return-contract claims** -> PASS. Exactly **7** texts are new on the branch:
  `CLM-subagents-057` through `CLM-subagents-063`, at `line` 57 to 63 of
  `skills/claude-code-extension-engineering/references/subagents.md`, which are the seven new
  bullets. All seven carry `"source":"SRC_EXTINDEX_SURVEY"`, `"status":"attributed"`,
  `"tags":["ENGINEERING"]` and the same repair note.

- **1d. Nothing vanished** -> PASS. Texts present on `main` and missing from the branch: **0**.
  Structural companions on the branch: **0 duplicate ids**, and the trailing number of all 664
  ids equals that record's own `line` field.

- **2a. `docs/RESULTS.md`, every changed line accounted for** -> PASS. Rather than trust git's
  diff heuristics I ran three independent accountings against `git show main:docs/RESULTS.md`.
  - *Exact LCS line diff* (my own table, no heuristics): **378 lines unchanged, 6 removed, 8
    added**, and nothing else. Removed are main lines **15, 17, 18, 19, 20** (the suite-count
    sentence and the 2026-08-18 enumeration) and main line **56** (the `280` value). Added are
    branch lines **15, 17 to 22** and **58**. Both changed regions are contiguous; there is no
    third region.
  - *Multiset accounting*, which catches a duplicated line even where an LCS would absorb it:
    exactly **14 distinct line texts** have a differing count, and they are precisely the 6
    removed (main x1, branch x0) and the 8 added (main x0, branch x1). **No line text has a
    count above 1 on either side that it did not have on the other.**
  - *Word-level LCS over the whole file*: main 3710 words, branch 3725. **7 words removed**
    (`**295`, `Ten`, `2026-08-18,`, `covering`, `and`, `claims.`, `280`) and **22 added**
    (`**301`, `Sixteen`, `2026-08-18:`, three loose `for`, `claims,`, then
    `and six for the return-contract section, the first content adopted from the pattern-corpus
    audit.`, then `286`). Every one of the 29 is explained by the intended rewrite:
    `Ten`->`Sixteen`, comma->colon, `covering three`->`three for`, `two facts`->`two for facts`,
    `and five findings`->`five for findings`, `claims.`->`claims,` plus the new sixth clause,
    and the two value updates. **No word is dropped or duplicated anywhere in the file.** Net
    +15 words matches 3725 - 3710.
  - **Positive control, at the scope of the claim.** To prove the accounting can actually fire
    rather than merely returning quiet numbers, I planted each named defect class into a copy of
    the branch file, far from the intended edits, and re-ran all three accountings:
    (A) a fragment dropped from line 270 -> lineRem 6->7, msDiff 14->16, wordRem 7->17;
    (B) a blank line duplicated at 200 -> lineAdd 8->9, msDiff 14->15;
    (D) a content line duplicated at 152 -> lineAdd 8->9, msDiff 14->15, wordAdd 22->38;
    (C) a line truncated by 12 chars at 101 -> lineRem 6->7, msDiff 14->16, wordRem 7->11.
    **All four fire.** Worth recording honestly: the word-level scan alone is blind to a
    duplicated BLANK line (case B leaves wordRem/wordAdd unmoved); the line-level and multiset
    scans catch it. The three together are what makes the absence claim sound, not any one.

- **2b. The enumeration sums to sixteen** -> PASS. I reflowed the paragraph and extracted the
  sentence mechanically. It reads: `Sixteen more were added on 2026-08-18: three for Stop-hook
  mechanics measured against a live production hook, two for facts a refuted probe uncovered on
  the way past, five for findings confirmed against the documentation mirror while resolving
  flagged claims, and six for the return-contract section, the first content adopted from the
  pattern-corpus audit.` A regex for `<number-word> for` finds exactly four terms,
  `[["three",3],["two",2],["five",5],["six",6]]`, which **sum to 16**, and the headline word is
  **Sixteen**. Round 2's arithmetic nit (a trailing enumeration summing to ten under a headline
  of sixteen) is genuinely resolved: the sentence was restructured from "covering N, N and N"
  into "N for X, N for Y, N for Z, and N for W", so the enumeration is now the whole of the
  sixteen rather than a subset the reader has to guess at.

- **2c. The `claude mcp add` phrase is intact and not duplicated** -> PASS. `claude mcp add`
  occurs **exactly once on main and exactly once on the branch**. The wrapped phrase
  ``eight for the `claude mcp add` CLI`` occurs **1 on main, 1 on the branch**, and the full
  sentence across its hard wrap,
  ``eight for the `claude mcp add` CLI\nsurface, which the library did not document in any
  form``, is present on both. It sits on branch lines 22 to 23, immediately after the last added
  line, which is exactly where a faulty line-index splice would have clipped or doubled it. It
  did not.

- **2d. No stale value left behind** -> PASS. Occurrence sweep: `295` main=1 branch=**0**;
  `301` main=0 branch=**1**; `280` main=1 branch=**0**; `286` main=0 branch=**1**;
  `Ten more` main=1 branch=**0**; `Sixteen more` main=0 branch=**1**. `Sixteen rows` and
  `Twenty-two`, which refer to earlier dated passes, are **1 on both** and correctly untouched.
  I also read every line of the file containing a digit alongside `question|row|assertion|suite|
  pass`: only lines 15 and 58 state the current suite and assertion totals. Line 71's
  `135 questions` is the head-to-head set, a different artifact, and is unrelated.

- **2e. The suite count matches the LIVE one, derived not read** -> PASS, derived three
  independent ways before looking at the doc. (i) `tests/questions.jsonl` parses to **301** rows
  with **0 duplicate ids**, categories 219 factual / 25 anti-hallucination / 22 navigation /
  20 routing-positive / 15 routing-negative, summing to 301. (ii) `node tests/run-tests.mjs`
  prints `TOTAL 301 301 0 100%` and `PASS: 301 of 301 rows passed.` (iii) the numbers gate
  re-derives `suite rows 301` from the artifacts. The doc says **301**. For the assertion count:
  301 rows minus the 15 routing-negative must-not-match rows = **286**; `--prove-fail` prints
  `TOTAL 301 15 286 5%` and `286/286 positive assertions correctly went RED`; the numbers gate
  re-derives `positive assertions 286`. The doc says **286**. Both match.

- **2f. Line geometry** -> PASS, and round 2's wrap nit is fixed. Branch `docs/RESULTS.md` has
  **0 lines over 110 characters**; longest non-empty line is **101**, next 101, next 101, median
  89, over 309 non-empty lines. Round 2 measured line 17 at **137 characters**; it is now **80**,
  and the paragraph was genuinely re-wrapped rather than extended (lines 15 to 22 measure
  92/86/80/50/82/82/82/66). See Issues for the one cosmetic residue.

- **3a. Zero bare line citations in `references/subagents.md`** -> PASS. Scanned in Node, not
  `grep -P`. Pattern `[A-Za-z0-9_.-]+\.md:\d+`: **0 hits** across all 145 split-lines / 14830
  bytes. Separately, a colon immediately followed by digits **anywhere on any line**,
  `:\d+`: **0 hits**. Baseline so the scan is known to be capable of finding them: the same
  `file.md:NN` scan against `ab653d9` returns **7 hits** on lines 55 to 61 (`workflows.md:102`,
  `agent-teams.md:34`, `context-modes.md:46`, `agent-teams.md:36`, `workflows.md:100`,
  `workflows.md:32`, `subagents.md:46`), which with the two bare intra-file forms is the nine the
  repair note describes. Widened to the whole library: **0 `file.md:NN` tokens across 30
  markdown files under `skills/`**.

- **3b. The section opening's factual claims** -> PASS, checked claim by claim against the
  blocks named, all in the live file. Headings resolved first: `## Isolation testing` at 39,
  `## The return contract` at 48, `## Common failure modes / anti-patterns` at 115,
  `## Definition of Done` at **125**, `## Detail` at 134.
  - "The Definition of Done **below** asks for `Summary quality verified`": the DoD block is at
    125, which is below the opening at 50, and line **131** is `- Summary quality verified`, an
    exact match. Correctly placed.
  - "nothing in this file said what a good summary is, so that item passed by default": I read
    all six DoD items (127 to 132) - `Right task routes in; wrong tasks do not`, `System prompt
    produces correct behaviour`, `Tool limits enforced`, `Context isolation verified`, `Summary
    quality verified`, `Regression cases pass`. **None carries a criterion, threshold or
    parenthetical.** No uniqueness claim is made, so round 1's second falsity stays gone.
  - "`Returns a useful summary (not too little, not a dump)` under Isolation testing": line
    **43**, inside `## Isolation testing` (39 to 46). **Byte-exact including the parenthetical**,
    and attributed to Isolation testing rather than to the DoD, which was round 1's third
    falsity. The follow-on "gives a direction and still no way to decide" is what keeps the
    preceding sentence from contradicting this one, and it is accurate: a direction is stated,
    a decidable criterion is not.
  - "the mechanism under Detail: the RESULT is charged to the CALLER, so the return is the only
    part of a delegation the caller pays for": line **143**, inside `## Detail`, reads `The
    RESULT is charged to the CALLER ... So the return is the only part the caller pays for`,
    tagged `[OFFICIAL]  [v2.1.220]`. True.
  - Supporting cross-references in the bullets, resolved against the live files independently:
    `workflows.md:32` is the `agent(prompt, opts)` table row stating it returns the subagent's
    final text; `:100` is the null-return validation bullet; `:102` is the output-SCHEMA bullet
    worded as the section paraphrases it; `agent-teams.md:34` carries `output contract` and that
    string occurs **exactly once** in that file, so "never says what one contains" holds;
    `agent-teams.md:36` is `- Teammates report blockers and failures explicitly`, an expectation
    and not a permission; `context-modes.md:46` is the quiet-isolation-failure bullet the section
    paraphrases near verbatim. Intra-file: "the anti-pattern list names too thin as a failure"
    resolves to line **121**, `- Summary too thin to be actionable, so the caller has to redo the
    work.`, inside the anti-pattern block; "The untrusted-content entry under Isolation testing"
    resolves to line **46**. "A plain subagent has no schema layer" holds against the Supported
    fields table (67 to 79, eleven fields: name, description, tools, disallowedTools, model,
    permissionMode, mcpServers, hooks, skills, isolation, and a combined misc row; **no
    `schema`**). All three markdown link targets exist in `references/`.

- **3c. The guard still bites** -> PASS, all three halves.
  - *Revert.* I spliced ONLY the FACTS scan back to per-line, by exact string replacement on the
    bytes: `paragraphsOf(srcLines.join('\n')).forEach((para) => {` plus
    `      const line = para.text;` became `    srcLines.forEach((line, i) => {`, and
    `          const i = lineFor(para, vAt);` was deleted. Both anchors were asserted to occur
    exactly once before writing. `git diff` showed **1 insertion, 3 deletions in two hunks**,
    all inside the FACTS scan; `node --check` parsed clean; the mutant table was untouched.
  - *Result.* `node tools/coverage-report.mjs --prove-can-fail` exited **1** and printed
    `GATE CANNOT FAIL: 2 problem(s).`, naming **exactly** the two FACTS mutants:
    `FAIL MUST FAIL: a FACTS value that is wrong and already hard-wrapped  (exit 0)` and
    `FAIL MUST FAIL: a FACTS value made wrong AND newly wrapped  (exit 0)`. Every other entry,
    including the four retired-total wrap variants and the allowlist mutant, stayed `ok`, which
    isolates the revert to the FACTS scan and nothing else.
  - *Restore.* Reversed both edits by hand. Result is **51989 bytes**, sha256
    `13d9e1ec04b7ece6a6d4f84ec877f0f234a2ab791b39424dd85e013d9a93ab7d`, and `Buffer.compare`
    against `git show HEAD:tools/coverage-report.mjs` returns **0**. `git status --porcelain`
    empty. Re-run `--prove-can-fail` EXIT=**0**, `GATE CAN FAIL: every known-bad source was
    rejected.`

- **3d. The re-anchoring did not weaken the mutants** -> PASS, established from the harness code
  rather than from the passing result. The whole branch change to `tools/coverage-report.mjs` is
  **2 lines**: the two FACTS mutant `from` anchors moved from the retired values to the live ones
  (`confirms all\n280 positive assertions` -> `...286...`, `**295 questions (set v2)` ->
  `**301 ...`). The applier at the docMutants loop contains
  `if (!orig.includes(m.from)) { check(m.n, false, 'anchor not found, the mutant would be a
  no-op'); continue; }`, so an anchor that stops matching **fails the gate rather than passing
  quietly**, and the success condition is `r.status !== 0 && m.want.test(r.stdout)`, so the
  mutant must also produce its specific complaint (`/positive assertions: doc says 999/` and
  `/doc says 999/`). Both report `ok` on HEAD, which therefore proves the anchors are live and
  the right complaint fires. I confirmed the anchors against the doc directly:
  `confirms all\n286 positive assertions` present **once**, `**301 questions (set v2)` present
  **once**, and both retired forms absent. The first still mutates a value ALREADY wrapped in the
  source and the second still introduces a new wrap, so both defect classes remain covered.

- **4. Eleven gates plus rekey and claim-drift, each run fresh as its own process with its own
  exit code** -> PASS. `git status --porcelain` empty before and after the whole run.
  - `verify` EXIT=0, `sources=44 claims=664 (attributed=664, unattributed=0) tagged-lines=664`,
    `PASS: evidence ledger is internally consistent`
  - `test` EXIT=0, `TOTAL 301 301 0 100%`, `PASS: 301 of 301 rows passed.`
  - `quotes` EXIT=0, 44 verbatim quotes from 8 reference files against 191 mirrored pages
  - `numbers` EXIT=0, `Documentation statements that disagree:` `none`, with `suite rows 301` and
    `positive assertions 286` among the re-derived values
  - `facts` EXIT=0, `PASS  1 fact(s) consistent across 5 artifact reads.`
  - `drift` EXIT=0, `PASS  664 claim(s) match their full-text hash`
  - `verify:prove-fail` EXIT=0, `EVIDENCE LEDGER GATE CAN FAIL: all 6 mutants were rejected`
  - `test:prove-fail` EXIT=0, `TOTAL 301 15 286 5%`, `286/286 positive assertions correctly went
    RED`, `PASS: the suite is not self-certifying.`
  - `numbers:prove-fail` EXIT=0, `GATE CAN FAIL: every known-bad source was rejected.`
  - `facts:prove-fail` EXIT=0, `PASS  8/8 self-test rows.`
  - `drift:prove-fail` EXIT=0, `PASS  6/6 self-test rows.`
  - `node tools/rekey-claims.mjs` (dry run) EXIT=0, `ledger 664 claims, references now carry 664
    tagged lines`, `unchanged 664`, `moved 0`, **`vanished 0`**, **`new 0`**,
    `dry run. Re-run with --write to apply.`
  - `node tools/claim-drift.mjs` EXIT=0, `PASS  664 claim(s) match their full-text hash, not just
    the stored prefix.`

- **4b. Test rows F271 to F276** -> PASS. All six exist, category `factual`, `source_file` is the
  subagents reference. Each `answer_key` compiled as a case-insensitive RegExp matches the live
  file, and each matches **exactly once** (checked with a global regex), so none can be propped
  up by an unrelated passage and none needs an ambiguity exemption. `test:prove-fail` names F276
  in its red list, and 286/286 positive rows went red. `tests/questions.jsonl` gained **6 lines
  and deleted 0**.

- **5. Scope** -> PASS. `git diff --name-status main...HEAD` lists **nine paths and nothing
  else**: `A .md/20260818-fail-closed_review.md`, `A .md/20260818-return-contract_review-r2.md`,
  `A .md/20260818-return-contract_review.md`, `A .md/20260818-return-contract_verify.md`,
  `M docs/RESULTS.md`, `M evidence/claims.jsonl`,
  `M skills/claude-code-extension-engineering/references/subagents.md`,
  `M tests/questions.jsonl`, `M tools/coverage-report.mjs`. Four under `.md/`, five in the
  permitted set, nothing outside it. Numstat: RESULTS.md 8/6, claims.jsonl 14/7, subagents.md
  **17/0**, questions.jsonl **6/0**, coverage-report.mjs 2/2. `subagents.md` and
  `questions.jsonl` delete nothing at all. One commit on the branch.

- **6. Housekeeping** -> PASS. Banned dash characters (U+2010 to U+2015, U+2212) in all five
  changed content files: **0**, by codepoint scan. The only non-ASCII present is pre-existing:
  U+2192 x2 in `subagents.md`, and U+2192 x5 / U+2190 / U+3068 / U+306F inside claim text in the
  ledger. Final `git status --porcelain` **empty**; `git worktree list` shows only the main
  checkout, so no worktree was created or left behind.

## Issues found

- **None blocking.** Both items round 3 was convened to check are genuinely fixed, and I verified
  the fixes rather than the fix descriptions.

- **Cosmetic, new with this edit, not damage.** `docs/RESULTS.md` line 18 is **50 characters**
  (`2026-08-18: three for Stop-hook mechanics measured`) sitting mid-paragraph among lines of
  80 to 92. The paragraph was re-wrapped, which fixed round 2's 137-character line, but the
  re-wrap left one visibly short line where the old sentence boundary used to be. It reads
  slightly ragged rendered as source. It changes no content and no gate, and it is strictly an
  improvement on what round 2 measured, so I record it rather than hold on it.

- **Nit, unresolved from round 2, in the ledger note.** The repair note carried by all seven new
  claims says "All nine now name the file and describe the content". I counted the bullets: **six
  carry a markdown file link** (`workflows.md` x3, `agent-teams.md` x2, `context-modes.md` x1)
  and **three name a SECTION of this same file** ("Isolation testing asks for a summary", "the
  anti-pattern list names too thin", "under Isolation testing already treats"). Six plus three is
  the nine. Naming a section is the right treatment for an intra-file reference and better than a
  link, so the documentation is correct and only the note's wording is imprecise. No gate reads
  the note.

- **Observation, PRE-EXISTING on `main`, out of scope, re-verified independently because the new
  section leans on the line in question.** `subagents.md:3` states "this file carries NO verbatim
  quotes, so the quote gate says nothing about it". That is false. I imported `collectQuotes()`
  from `tools/quote-check.mjs` and ran it: the gate collects **1 quote from `subagents.md`**, at
  **line 143**, `the verbose output stays in the subagent's context while only the relevant
  summary returns to your main conversation`, out of 44 across 8 files. Line 143 is the
  `[OFFICIAL] [v2.1.220]` claim the new section's opening cites as "the mechanism under Detail",
  and the source of test row F268. The branch deletes **0** lines from `subagents.md`, so line 3
  is byte-identical to `main` and this branch neither introduced nor worsened it. Worth a
  separate fix.

## Verdict: PASS

The round 2 residue is closed. Across the whole ledger, all **657** claims whose `text` is
byte-identical to a claim on `main` match on `source` **and** `note` with an empty string counted
as different from an absent key, and they match on every other field and on key order too: a full
deep equality with only `id` and `line` removed returns **657 of 657 identical, 0 differing**.
`CLM-subagents-144` no longer carries a `note` key, there is **not one empty-string note among
the 664 records** (0 by census and 0 by raw byte sweep), **nothing on `main` vanished**, and the
seven return-contract claims all carry `SRC_EXTINDEX_SURVEY`.

`docs/RESULTS.md` survived four rounds of faulty line-index splicing without collateral damage.
Three independent accountings agree that exactly **6 lines were removed and 8 added**, in the two
intended regions and nowhere else: an exact LCS line diff, a multiset census that would expose a
duplicate an LCS could absorb, and a word-level LCS over all 3725 words that would expose a
dropped fragment a line diff could not. All 29 differing words are explained by the intended
rewrite. I proved those three checks can fire by planting a dropped fragment, a duplicated blank
line, a duplicated content line and a truncated line into copies far from the edits, and watching
each move the numbers. The enumeration now sums to **sixteen** (3 + 2 + 5 + 6) under a headline
of Sixteen, the `claude mcp add` sentence is intact across its wrap and appears exactly once, and
the doc's 301 and 286 match counts I derived from the live suite and its prove-fail run rather
than read off the page.

The regressions hold. Zero bare `file.md:NN` and zero bare `:NN` tokens in `subagents.md`,
against a baseline of seven at `ab653d9` proving the scan works, and zero library-wide across 30
files. Every factual claim in the section opening resolves to the `## Definition of Done` and
`## Isolation testing` blocks it names. Reverting only the FACTS scan to per-line turns
`numbers:prove-fail` red at exit 1 naming both FACTS mutants and no others, the restore is
byte-identical by sha256 and `Buffer.compare`, and the harness itself fails any mutant whose
anchor stops matching, so the re-anchoring to 286 and 301 is self-guarding rather than weakened.
Eleven gates plus the rekey dry run (`vanished 0`, `new 0`) and `claim-drift` all green, run
fresh. Scope is nine paths, all permitted. Tree clean, no worktrees left behind.
