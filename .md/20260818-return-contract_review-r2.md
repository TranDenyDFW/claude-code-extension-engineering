# Review round 2: the return-contract section in subagents.md
Reviewer: independent subagent

Run from `P:\ClaudeExt\ccx-engineering-work`, branch `return-contract-section` at `0a7760a`
(round 1 reviewed `ab653d9`, which the reflog shows was amended into `0a7760a`), compared
against `main` at `3e6580d`. Every command below was run fresh by me. I re-ran everything
rather than trusting round 1. Tree was clean before and after; no worktree was created.

Environment notes I confirmed rather than assumed: `subagents.md`, `docs/RESULTS.md` and
`tools/coverage-report.mjs` are all LF on disk, not CRLF, so my matching was done against the
actual bytes. `core.autocrlf` is `true` and git warned that a checkout would rewrite
`coverage-report.mjs` to CRLF, so I restored that file by reversing my own edits and
byte-comparing, never by `git checkout`.

## Checks executed

- **1a. Zero bare line citations in `references/subagents.md`** -> PASS: scanned the file in
  Node (no `grep -P`) for `[A-Za-z0-9_.-]+\.md:\d+` and, separately, for `:\d+` anywhere on any
  line. Both counts are **0** over all 144 lines / 14830 bytes. I widened the same scan to every
  `.md` under `skills/` and got **0 bare `file.md:NN` tokens library-wide**, which also
  substantiates the fix's own premise: 10 files carry markdown-link cross-references
  (`INDEX.md` 119, `SKILL.md` 31, `subagents.md` 7, and 7 others), and none carries a line
  citation. For an independent baseline I extracted `ab653d9:...subagents.md` and ran the same
  scan: exactly **nine** tokens, on lines 55 to 61 - `workflows.md:102`, `agent-teams.md:34`,
  `:43`, `:104`, `context-modes.md:46`, `agent-teams.md:36`, `workflows.md:100`,
  `workflows.md:32`, `subagents.md:46`. Nine before, zero after. `git diff --stat main ab653d9`
  on that file also confirms the "15-line insertion" the repair note describes.

- **1b. Every converted reference is TRUE of its target** -> PASS: I resolved all nine
  descriptions against the live files rather than against the old line numbers.
  - `[workflows.md]` "gives the better answer ... put the requirement in the output SCHEMA so it
    is enforced at the tool-call layer and retried" -> `workflows.md:102` says exactly that.
  - `[agent-teams.md]` "names an output contract as a field every task carries and never says
    what one contains" -> `agent-teams.md:34`, and `output contract` occurs **once** in the whole
    file; I read all 73 lines and nothing elaborates its contents. Both halves hold.
  - "Isolation testing asks for a summary that is neither too little nor a dump" -> line 43,
    inside `## Isolation testing` (39 to 46). True.
  - "the anti-pattern list names too thin as a failure" -> line 121,
    `- Summary too thin to be actionable, so the caller has to redo the work.`, inside
    `## Common failure modes / anti-patterns`. **This is the exact content the stale `:104`
    was written for**, and naming the list instead of a line number is what makes it
    insertion-proof. The round 1 blocker is genuinely repaired, not renumbered.
  - `[context-modes.md]` "records that an isolated worker which never received what it needed
    still returns a confident summary the caller cannot distinguish from a well-informed one"
    -> `context-modes.md:46`, near verbatim.
  - `[agent-teams.md]` "states the expectation, that teammates report blockers explicitly, and
    not the permission" -> `agent-teams.md:36`; I read the whole file and it never grants
    permission to stop, so the "and not the permission" half also holds.
  - `[workflows.md]` "where `agent()` resolves to null because the worker died" ->
    `workflows.md:32`, `:100`, `:113`. Upstream says "skipped or dies after retries", so the
    section narrows to one of two documented causes; accurate, not drift.
  - `[workflows.md]` "states the mechanism for the workflow API, that `agent()` returns the
    subagent's FINAL TEXT" -> `workflows.md:32`. True, and the "for the workflow API" scoping is
    intact.
  - "The untrusted-content entry under Isolation testing ... in the SECURITY sense" -> line 46,
    inside `## Isolation testing`. True.
  - Supporting claims also checked: "A plain subagent has no schema layer" against the Supported
    fields table (lines 67 to 79, eleven fields, no `schema`); "SKILL.md, where untagged means
    official documentation" against `SKILL.md:200`. Citing `SKILL.md` as bare text rather than a
    link matches the library (INDEX.md, composition-cards.md, skills.md, selection.md all do the
    same), so that is convention, not an omission.
  - All three link targets exist in `references/`.

- **2. The opening** -> PASS: current text is lines 50 to 55. Checked claim by claim against the
  two blocks named.
  - "The Definition of Done below asks for `Summary quality verified`": `## Definition of Done`
    is at line 125, which IS below line 48, and line 131 is `- Summary quality verified`, an
    exact match. Round 1's first falsity (wrong section) is gone.
  - "nothing in this file said what a good summary is, so that item passed by default": all six
    DoD items (127 to 132) carry no criterion, threshold or parenthetical. No uniqueness claim is
    made anywhere in the new opening, so round 1's second falsity is gone.
  - "`Returns a useful summary (not too little, not a dump)` under Isolation testing": line 43,
    under `## Isolation testing` at 39. Byte-exact including the parenthetical, and correctly
    attributed to Isolation testing rather than to the DoD. Round 1's third falsity is gone.
  - "gives a direction and still no way to decide": consistent with the text, and it is the
    sentence that keeps the preceding "nothing ... said what a good summary is" from
    overreaching, since the parenthetical states a direction and not a decidable criterion.
  - "the mechanism under Detail: the RESULT is charged to the CALLER, so the return is the only
    part of a delegation the caller pays for": `## Detail` at 134, line 143 states exactly this
    and is tagged `[OFFICIAL] [v2.1.220]`. True.

- **3. Attribution, whole ledger, keyed on TEXT** -> **FAIL on one record**. I parsed
  `git show main:evidence/claims.jsonl` (657 rows) and the live `evidence/claims.jsonl` (664
  rows) and paired every row by byte-identical `text`. No text appears twice on either side, so
  the pairing is unambiguous.
  - **657 of 657** main texts are present on the branch. **0 vanished.** 7 texts are new.
  - For every one of those 657 pairs I compared `source`, `note`, `status`, `tags`, `versions`,
    `file` AND key order, ignoring only `id` and `line` (which renumber by design).
  - **`source` is identical in all 657.** The swap repair is complete on the field that matters,
    and I confirmed it independently of the repairer's method.
  - **656 of 657 are identical on every compared field. One differs:**
    `CLM-subagents-144` (main `CLM-subagents-127`, the `Built-in subagents ship by default ...`
    claim) carries `"note":""` on the branch where main has **no `note` key at all**. Its
    `source` is `SRC_SUBAGENTS` on both, so the attribution is correct; the empty note is a
    residue. It is the **only** empty-string note among all 664 records (main: 164 absent, 0
    empty, 493 non-empty. branch: 163 absent, **1 empty**, 500 non-empty), so it is not a house
    style, it is a leftover. Detail in Issues below.
  - Same comparison run against the pre-amend commit `ab653d9`: **657 of 657 identical, 0
    differing.** So the empty note was introduced by the repair pass itself, between `ab653d9`
    and `0a7760a`, and is not inherited.
  - The **seven** new claims are `CLM-subagents-057` through `CLM-subagents-063`, one per bullet
    at lines 57 to 63, and **all seven carry `"source":"SRC_EXTINDEX_SURVEY"`**,
    `"status":"attributed"`, `"tags":["ENGINEERING"]` and the same repair note. Note the ids
    shifted by 2 from round 1's `055` to `061`, which is the renumbering the brief warned about.
  - Structural checks on the branch ledger: 0 duplicate ids, and the trailing number of every one
    of the 664 ids equals its own `line` field.

- **4. Gate blind spot** -> PASS, confirmed by reading the code. `tools/verify-evidence.mjs:162`
  is the whole of the source check: `if (!sourceIds.has(c.source)) errors.push(...)`. It is set
  membership against `sources.json` and nothing else. `note` is never read by any gate.
  The drift block below it (lines 168 to 200) compares `file`, `line` and `text` against a fresh
  extraction, deliberately and with a long comment about why, but `source` and `note` are not in
  that comparison. `verify:prove-fail`'s own mutant list confirms the shape of the hole: its
  source mutant is `v[0].source = 'SRC_DOES_NOT_EXIST'`, an UNRESOLVABLE id, never a resolvable
  but wrong one. `claim-drift.mjs` hashes `text` only. `rekey-claims.mjs` is not a gate but is
  the tool that would have been safe: it pairs by text and preserves source and note by
  construction, with a self-test row asserting exactly that. So a wrong-but-resolvable source
  passes all eleven gates, exactly as stated.
  **Cheap mechanical check that would have caught it** (not implemented, as instructed): every
  record already stores `text_sha256`. Load the merge-base ledger
  (`git show $(git merge-base HEAD main):evidence/claims.jsonl`), key both sides by
  `text_sha256`, and fail on any claim whose hash is unchanged while `source` or `note` changed,
  with the message "unchanged text, changed attribution". One `git show` and one Map lookup per
  claim, no new data, no new file format. It is precisely the audit I ran by hand for check 3
  above, so I know it terminates in one pass over 664 rows and I know it fires: it would have
  named all seven swapped attributions AND the `"note":""` residue. Worth pairing with a
  history-free companion assertion, `note` is absent or non-empty, which catches the residue
  class with no git access at all.

- **5. Eleven gates** -> PASS: each run as its own process with its own exit code, never a piped
  one. `verify` EXIT=0 `sources=44 claims=664 (attributed=664, unattributed=0) tagged-lines=664`.
  `test` EXIT=0 `TOTAL 301 301 0 100%` and `PASS: 301 of 301 rows passed.` (**301 rows, as
  required**). `quotes` EXIT=0, 44 quotes over 191 mirrored pages. `numbers` EXIT=0,
  `Documentation statements that disagree: none`, with `suite rows 301` and
  `positive assertions 286` among the re-derived values. `facts` EXIT=0. `drift` EXIT=0
  `PASS 664 claim(s) match their full-text hash`. `verify:prove-fail` EXIT=0, 6 mutants rejected.
  `test:prove-fail` EXIT=0, `TOTAL 301 15 286 5%` and `286/286 positive assertions correctly went
  RED` (the 15 survivors are the routing-negative must-not-match rows), with F271 to F276 each
  named in the red list. `numbers:prove-fail` EXIT=0, `GATE CAN FAIL`. `facts:prove-fail` EXIT=0,
  8/8. `drift:prove-fail` EXIT=0, 6/6. `git status --porcelain` empty afterwards, so the
  prove-fail gates restored what they mutated.

- **5b. rekey dry run** -> PASS: `node tools/rekey-claims.mjs` EXIT=0,
  `extracted 664 tagged claims`, `unchanged 664`, `moved 0`, **`vanished 0`**, **`new 0`**,
  `dry run. Re-run with --write to apply.`

- **5c. claim-drift** -> PASS: `node tools/claim-drift.mjs` EXIT=0,
  `PASS  664 claim(s) match their full-text hash, not just the stored prefix.`

- **6. The guard still bites** -> PASS, all three halves.
  - *Revert.* Spliced the FACTS scan back to per-line and changed nothing else: replaced
    `paragraphsOf(srcLines.join('\n')).forEach((para) => {` plus `const line = para.text;` with
    `srcLines.forEach((line, i) => {`, and deleted `const i = lineFor(para, vAt);`. `git diff`
    showed exactly those three lines moving, in two hunks, and `node --check` parsed clean. The
    mutant table was untouched, so both FACTS mutants still carry the live values 286 and 301.
  - *Result.* `node tools/coverage-report.mjs --prove-can-fail` exited **1** and printed
    `GATE CANNOT FAIL: 2 problem(s).`, naming exactly the two FACTS mutants:
    `FAIL MUST FAIL: a FACTS value that is wrong and already hard-wrapped  (exit 0)` and
    `FAIL MUST FAIL: a FACTS value made wrong AND newly wrapped  (exit 0)`. Every other mutant in
    the table stayed `ok`, including the four retired-total wrap variants, which isolates the
    revert to the FACTS scan.
  - *Restore.* Reversed both edits by hand (not `git checkout`, because `core.autocrlf=true` and
    git had warned it would rewrite the file to CRLF). Byte-compared the result against
    `git show HEAD:tools/coverage-report.mjs`: both **51989 bytes**, both
    sha256 `13d9e1ec04b7ece6a6d4f84ec877f0f234a2ab791b39424dd85e013d9a93ab7d`, `Buffer.compare`
    returns 0. `git status --porcelain` empty, and `numbers:prove-fail` re-run EXIT=0
    `GATE CAN FAIL: every known-bad source was rejected.`

- **7. Scope** -> PASS: `git diff --name-status main...HEAD` lists eight paths and nothing else:
  `A .md/20260818-fail-closed_review.md`, `A .md/20260818-return-contract_review.md`,
  `A .md/20260818-return-contract_verify.md`, `M docs/RESULTS.md`, `M evidence/claims.jsonl`,
  `M skills/claude-code-extension-engineering/references/subagents.md`,
  `M tests/questions.jsonl`, `M tools/coverage-report.mjs`. Three under `.md/`, five in the
  permitted set. Nothing outside it. One commit on the branch.

- **8. Extra checks I ran while hunting for a fourth defect** -> PASS:
  - `tests/questions.jsonl`: 301 rows, valid JSON on every line, **0 duplicate ids**, categories
    219 factual / 25 anti-hallucination / 22 navigation / 20 routing-positive / 15
    routing-negative, summing to 301.
  - Answer-key ambiguity, the failure `coverage-report.mjs` documents at length: each of the six
    new keys F271 to F276 compiled as a case-insensitive global RegExp matches its `source_file`
    **exactly once**. None needs an exemption, and none can be propped up by an unrelated
    passage.
  - Banned dash characters (U+2010 to U+2015, U+2212) in all five changed content files: **0**.
    The only non-ASCII characters present are pre-existing (U+2192 in subagents.md, plus U+2190 /
    U+3068 / U+306F inside claim text in the ledger).
  - `docs/RESULTS.md` arithmetic: main said 295 with "Ten more ... on 2026-08-18"; the branch says
    301 with "Sixteen more", and 295 + 6 = 301, 10 + 6 = 16. `numbers` re-derives 301 and 286
    from the artifacts and finds no disagreement.
  - Repair-note factual spot checks: "the library has ZERO bare line citations anywhere else"
    (verified, 0 across `skills/`), "the section cited nine intra-library file:line references"
    (verified, 9 in `ab653d9`), "15-line insertion" (verified by `git diff --stat main ab653d9`),
    "none of the six DoD items carries a criterion" (verified), "that line is one of the few that
    does carry a parenthetical" (verified: lines 33, 41, 42 and 43 carry parentheticals).

## Issues found

- **The one attribution that still differs from main, and it is the fourth defect.**
  `CLM-subagents-144` carries `"note":""` where `main`'s identically-texted `CLM-subagents-127`
  has no `note` key. Its `text` did not change and its `source` is correct, so by the standard
  this review was given - a claim whose text did not change has no reason for its attribution to
  change - this is an unexplained deviation. It is the sole empty-string note in 664 records, and
  it did not exist at `ab653d9`, so it was introduced by the swap repair itself. Severity is low:
  no gate reads `note`, no published number counts notes, and `rekey-claims.mjs` and
  `split-claims.mjs` both carry it through harmlessly. But it is the same failure class the
  repair was fixing, one record short of complete, and it silently converts "no note was needed"
  into "a note exists and is blank" in the file the whole project rests on. **Fix: delete the
  `note` key from that record so it is byte-identical to main.** That single change makes the
  branch's answer to check 3 a clean 657 of 657.

- **Nit, unresolved from round 1.** `docs/RESULTS.md:17` is still **137 characters**, against a
  next-longest of 101 and a median of 89 across 308 non-empty lines. The 2026-08-18 sentence was
  appended without re-wrapping, and the added clause landed as a 56-character stub on line 18.
  Round 1 flagged this and it is unchanged. It matters more here than it would elsewhere, because
  this is the file whose numbers gate exists specifically because a hard wrap hid a stale value.

- **Nit, unresolved from round 1.** The trailing "covering three Stop-hook mechanics ..., two
  facts ..., and five findings ..." still sums to ten while the sentence now leads with "Sixteen
  more". The arithmetic only closes if the reader attaches "covering" to the ten rows not carved
  out by "six of them for the return-contract section", and the new semicolon before it does not
  make that attachment any clearer.

- **Nit.** The repair note says "All nine now name the file and describe the content". Six of the
  nine name a file. The other three name a SECTION of this same file (Isolation testing, the
  anti-pattern list, Isolation testing again), which is the correct treatment for an intra-file
  reference and better than a link would be. The note's wording undersells what was actually
  done; the documentation itself is right.

- **Observation, PRE-EXISTING on `main`, not caused by this branch, reported because the section
  leans directly on it.** `subagents.md:3` states "this file carries NO verbatim quotes, so the
  quote gate says nothing about it". That is false, and was already false on `main`, where the
  header is byte-identical. I imported `collectQuotes()` from `tools/quote-check.mjs` and ran it:
  the gate collects **1 quote from `subagents.md`**, at line 143 - "the verbose output stays in
  the subagent's context while only the relevant summary returns to your main conversation" - out
  of 44 across 8 files. Line 143 is the `[OFFICIAL] [v2.1.220]` claim that the new section's
  opening paragraph cites as "the mechanism under Detail", and it is also the source of test row
  F268. So the gate does cover this file, on the exact line the return contract is built on. Out
  of scope for this branch, worth a separate fix.

## Verdict: PARTIAL

Round 1's two blockers are genuinely fixed, and I verified the fixes rather than the fix
descriptions. Zero bare line citations remain in `subagents.md` (nine before, confirmed against
`ab653d9`), zero anywhere in the library, and all nine converted references resolve to content
that actually says what the section claims - including the `:104` case, which now names the
anti-pattern list that holds the intended sentence and can no longer be moved by an insertion.
The opening no longer misplaces the line, no longer claims uniqueness, and every remaining
factual claim in it checks out against the `## Definition of Done` and `## Isolation testing`
blocks. Eleven gates green with 301 rows, rekey `vanished 0 / new 0`, claim-drift clean, both
FACTS mutants still bite when the paragraph scan is reverted, the restore is byte-identical, and
the diff stays inside its permitted paths.

The repair of the third defect is 656 of 657 complete. Every `source` in the ledger is right,
which is the load-bearing half, but `CLM-subagents-144` gained a `"note":""` that `main` does not
have and that `ab653d9` did not have, on a claim whose text never changed. Check 3 as written
requires `source` AND `note` to be identical, so I cannot record it as passed. Delete that one
key and this is a PASS.
