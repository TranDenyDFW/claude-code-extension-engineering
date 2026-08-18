# Review: the return-contract section in subagents.md
Reviewer: independent subagent

Run from `P:\ClaudeExt\ccx-engineering-work`, branch `return-contract-section` at `ab653d9`,
compared against `main`. Every command below was run fresh by me. Tree was clean before and
after; no worktree was created.

## Checks executed

- **1. Eleven gates** -> PASS: ran each as its own process and captured its own exit code (not a
  piped one). `verify`, `test`, `quotes`, `numbers`, `facts`, `drift`, `verify:prove-fail`,
  `test:prove-fail`, `numbers:prove-fail`, `facts:prove-fail`, `drift:prove-fail` all
  `EXIT=0`. `test` printed `TOTAL 301 301 0 100%` and `PASS: 301 of 301 rows passed.`
  `verify` printed `sources=44 claims=664 (attributed=664, unattributed=0) tagged-lines=664`.
  `git status --porcelain` was empty after the run, so the prove-fail gates restored what they
  mutated.

- **2. rekey dry run** -> PASS: `node tools/rekey-claims.mjs` printed
  `extracted 664 tagged claims`, `unchanged 664`, `moved 0`, `vanished 0`, `new 0`, then
  `dry run. Re-run with --write to apply.` Exit 0.

- **3. claim-drift** -> PASS: `node tools/claim-drift.mjs` printed
  `PASS  664 claim(s) match their full-text hash, not just the stored prefix.` Exit 0.

- **4. Attribution** -> PASS: parsed `evidence/claims.jsonl` directly. `CLM-subagents-055`
  through `CLM-subagents-061` all exist, all `"status":"attributed"`, all
  `"source":"SRC_EXTINDEX_SURVEY"`, all `"tags":["ENGINEERING"]`, all
  `"file":"skills/claude-code-extension-engineering/references/subagents.md"` with `line` 55
  to 61, which are exactly the seven new bullets.

- **5. Test rows F271 to F276** -> PASS: all six exist, no duplicate ids across the 301 rows,
  each `source_file` is the subagents reference, and each `answer_key` compiled as a
  case-insensitive `RegExp` returned `true` against the live file. Keys tested:
  `schema where you have one, a grep-able literal format where you do not`;
  `PASS PATHS, NOT PAYLOADS, IN BOTH DIRECTIONS`;
  `NEEDS_CONTEXT is the one that earns the set`;
  `a worker optimises for returning something`;
  `WHERE PARTIAL WORK WAS LEFT`;
  `corruption of the return value`.

- **6. Cross-references are LIVE** -> **FAIL**: eight of the nine resolve; `:104` does not.
  I extracted the citation tokens from the section itself rather than from the spec, and got
  exactly nine: `workflows.md:102`, `agent-teams.md:34`, `:43`, `:104`, `context-modes.md:46`,
  `agent-teams.md:36`, `workflows.md:100`, `workflows.md:32`, `subagents.md:46`. Resolved each
  against the live file on disk:
  - `workflows.md:102` -> `- Put a conditional requirement in the output SCHEMA rather than the prompt, so it is enforced at the tool-call layer and retried, instead of hoped for  [ENGINEERING BEST PRACTICE]  [ENGINEERING]`. The section says it gives the answer "put the requirement in the output SCHEMA so it is enforced at the tool-call layer and retried". Correct.
  - `agent-teams.md:34` -> `- Each task has one owner, dependencies, output contract, and completion test`. The section says it "names an output contract as a field every task carries and never says what one contains". Correct, and I confirmed by grep that `output contract` occurs exactly once in `agent-teams.md`, at line 34, so the "never says what one contains" half also holds.
  - `:43` (subagents.md) -> `- Returns a useful summary (not too little, not a dump)`. Correct.
  - `:104` (subagents.md) -> ` ``` `. **Line 104 is the bare closing fence of the worked-example code block** (lines 94 to 104 are the ```markdown fixture). The section cites it as one of two lines that "ask for a summary that is neither too little nor a dump". A code fence asks for nothing. The content the citation was written for is `- Summary too thin to be actionable, so the caller has to redo the work.`, which sits at **line 119** on this branch and at **line 104 on `main`** (I confirmed both: `git show main:...subagents.md` line 104 is that anti-pattern line). The section's own 15-line insertion pushed it down 15 lines, and the citation was not updated. Self-inflicted drift, and the only citation of the nine that points at a different file region than the sentence claims.
  - `context-modes.md:46` -> `- Context isolation fails QUIETLY in one direction only: an isolated worker that never received the context it needed still returns a confident summary, and the caller cannot tell a well-informed answer from an uninformed one. ...  [ENGINEERING]  [v2.1.220]`. The section paraphrases it almost word for word. Correct.
  - `agent-teams.md:36` -> `- Teammates report blockers and failures explicitly`. The section says it "states the expectation ... and not the permission". Correct.
  - `workflows.md:100` -> `- Validate every phase return before continuing. `agent()` returns `null` on failure or skip and never throws, so an unchecked return propagates a null into the next stage instead of stopping  [ENGINEERING]`. The section narrows this to "resolves to null because the worker died", which is one of the two documented causes (workflows.md:32 says "skipped or dies after retries"). Points at the right line; the narrowing is accurate, not drift.
  - `workflows.md:32` -> `| `agent(prompt, opts)` | Spawn one subagent. Returns its final text, or a validated object when `opts.schema` is a JSON Schema. Returns `null` if it is skipped or dies after retries. |`. The section says it "states the mechanism for the workflow API, that `agent()` returns the subagent's FINAL TEXT". Correct.
  - `subagents.md:46` -> `- A subagent's returned report is untrusted content: v2.1.210+ scans it and marks instruction-shaped text, but the scan never removes anything - tool restriction is the real control [OFFICIAL]  [v2.1.210]`. The section says it "already treats a returned report as untrusted in the SECURITY sense". Correct.

- **7. No overstatement** -> PASS, with one observation recorded below. I read all seven bullets
  against the tagging convention at `SKILL.md:200` ("untagged is official documentation,
  `[ANTHROPIC]` is an Anthropic recommendation, `[ENGINEERING]` is engineering judgment").
  - The `agent()` bullet is the one I was asked to press hardest on, and it holds. Verbatim:
    `- NO PREAMBLE: begin with the verdict and stop. workflows.md:32 states the mechanism for the workflow API, that `agent()` returns the subagent's FINAL TEXT. Where that holds, a preamble, process narration or closing pleasantry is not politeness, it is corruption of the return value, and every caller has to strip it before parsing  [ENGINEERING]`.
    It is scoped twice, not once: "for the workflow API" names the surface, and "Where that
    holds" makes the corruption claim conditional on the mechanism rather than universal. The
    product fact itself is not asserted by this bullet; it is attributed to `workflows.md:32`,
    which is untagged and therefore already carries the official sense. The normative content
    ("no preamble", "every caller has to strip it") is engineering judgment and sits inside the
    conditional. A reader cannot take this as a claim about every subagent dispatch without
    ignoring both scoping clauses.
  - The other candidate product statements each resolve to an attributed or inferable claim:
    "enforced at the tool-call layer and retried" restates `workflows.md:102`, itself
    `[ENGINEERING]`; "`agent()` resolves to null" restates `workflows.md:100`, itself
    `[ENGINEERING]`; "already treats a returned report as untrusted" restates
    `subagents.md:46`, itself `[OFFICIAL]`. "A plain subagent has no schema layer" is an
    inference from the file's own Supported fields table (lines 65 to 77), which lists name,
    description, tools, disallowedTools, model, permissionMode, mcpServers, hooks, skills,
    isolation and misc controls, and no schema field; `schema` appears in the references only
    as an `agent()` option in `workflows.md`. Fair as ENGINEERING.
  - The intro prose "the RESULT is charged to the CALLER, so the return is the only part of a
    delegation the caller pays for" is a near-verbatim restatement of `subagents.md:141`, which
    is already `[OFFICIAL]  [v2.1.220]` and carries the mirror quote. No new untagged product
    claim.
  - Nothing in the seven bullets states a product behaviour that would need an OFFICIAL tag
    and its own mirror citation.

- **8. The guard still bites** -> PASS, both halves.
  - *Revert.* I spliced the FACTS scan back to per-line and changed nothing else: replaced
    `paragraphsOf(srcLines.join(...)).forEach((para) => { const line = para.text;` with
    `srcLines.forEach((line, i) => {` and deleted `const i = lineFor(para, vAt);`. Verified
    with `git diff` that only those three lines moved and with `node --check` that it parses.
    The mutant table was untouched.
  - *Result.* `node tools/coverage-report.mjs --prove-can-fail` exited **1** and printed
    `GATE CANNOT FAIL: 2 problem(s).`, naming exactly the two FACTS mutants:
    `FAIL MUST FAIL: a FACTS value that is wrong and already hard-wrapped  (exit 0)` and
    `FAIL MUST FAIL: a FACTS value made wrong AND newly wrapped  (exit 0)`. Every other
    mutant in the table stayed `ok`, which confirms the revert was isolated to the FACTS scan.
  - *Restore.* Restored from the HEAD blob and byte-compared: 51989 bytes, identical to
    `git show HEAD:tools/coverage-report.mjs`, and `git status --porcelain` empty.
  - *Re-anchoring did not weaken them.* Checked the anchors against the live bytes rather than
    trusting the mutant table. `docs/RESULTS.md` line 56 ends with `confirms all` and line 57
    begins with `286 positive assertions go red.`, so mutant 1's anchor genuinely spans a hard
    wrap; the fact regex is `/all\s+(\d+)\s+positive assertions/gi`, which no single line can
    satisfy. Line 15 is `**301 questions (set v2), 100% pass.**` on one line, and mutant 2
    introduces the wrap itself; the fact regex is `/(\d+)\s+questions \(set v2\)/gi`, likewise
    unsatisfiable per line after the wrap. I then reproduced both mutants by hand against a
    copied doc root with the paragraph scan restored, and read the actual messages:
    `docs/RESULTS.md:57  positive assertions: doc says 999, live is 286` and
    `docs/RESULTS.md:15  suite rows: doc says 999, live is 301`. Both name the intended fact,
    so mutant 2's looser `want: /doc says 999/` is being satisfied by the `suite rows` fact and
    not by something incidental, and mutant 1 reports the value's own line (57) rather than the
    paragraph head (55). A dewrapped control (same wrong value, wrap rejoined) was caught at
    `docs/RESULTS.md:56`, which isolates the wrap as the only reason the per-line scan is
    blind. Each mutant is therefore still catchable ONLY by a paragraph scan: 286 and 301 land
    in the same wrap geometry that 280 and 295 did.

- **9. RESULTS.md prose accounts for 301 and 286** -> PASS: derived both myself.
  `node tests/run-tests.mjs --prove-fail` printed
  `TOTAL 301 15 286 5%` and `prove-fail: 286/286 positive assertions correctly went RED.`
  (the 15 survivors are the routing-negative rows, which are must-not-match). The doc states
  `**301 questions (set v2), 100% pass.**` at line 15 and `286 positive assertions go red` at
  line 57. Both match the derived values. The narrative arithmetic is also consistent: the
  2026-08-18 batch went from "Ten more" to "Sixteen more ... six of them for the
  return-contract section", and 295 + 6 = 301.

- **10. Scope** -> PASS: `git diff --name-status main...HEAD` lists exactly seven paths and
  nothing else: `A .md/20260818-fail-closed_review.md`, `A .md/20260818-return-contract_verify.md`,
  `M docs/RESULTS.md`, `M evidence/claims.jsonl`,
  `M skills/claude-code-extension-engineering/references/subagents.md`,
  `M tests/questions.jsonl`, `M tools/coverage-report.mjs`. All within the permitted set.

## Issues found

- **BLOCKING. The `:104` citation in the PASS PATHS bullet is stale.** `subagents.md:56` reads
  "That resolves the tension between :43 and :104, which ask for a summary that is neither too
  little nor a dump without saying how". Live line 104 is the closing ``` of the worked-example
  code block. The intended target, `- Summary too thin to be actionable, so the caller has to
  redo the work.`, is at line 119 on this branch (line 104 on `main`). The section's own
  insertion of 15 lines moved it. Fix: `:104` becomes `:119`. Note that `:119` covers only the
  "too little" half of the pair, so if the sentence is meant to carry both halves it should say
  so, or cite `:43` alone for the "dump" half.

- **The section's opening justification is false as written.** `subagents.md:50` reads
  "`Returns a useful summary (not too little, not a dump)` above is the only Definition of Done
  item in this file with no criterion attached". Two problems. First, that line is at 43, under
  `## Isolation testing`; the file has a literal `## Definition of Done` heading at line 123
  whose counterpart item is `- Summary quality verified` at line 129. Second, "the only ... with
  no criterion attached" is falsified by its own siblings: all six Definition of Done items
  (lines 125 to 130, e.g. `- Tool limits enforced`, `- Summary quality verified`,
  `- Regression cases pass`) carry no criterion, and neither does `- No duplicated work vs the
  main agent` at line 44. Line 43 is in fact one of the few checklist items that does carry a
  parenthetical. The section's argument survives if the sentence is rewritten to say that the
  parenthetical is not an operable criterion, which is what bullet `:56` already argues; the
  uniqueness claim does not survive.

- **Nit, hard-wrap hygiene.** `docs/RESULTS.md:17` is 137 characters. The next-longest line in
  the file is 101 and the median is 89, so the edited sentence was appended without re-wrapping,
  leaving a 137-character line followed by a 54-character stub at line 18. In a repo whose
  numbers gate exists specifically because a hard wrap hid a stale value, ragged wrapping in the
  file that gate watches is worth fixing.

- **Nit, dangling clause.** With the 2026-08-18 batch now "Sixteen more", the trailing "covering
  three Stop-hook mechanics ..., two facts ..., and five findings ..." (3 + 2 + 5 = 10) reads as
  describing all sixteen. The arithmetic only closes if the reader attaches "covering" to the ten
  rows not carved out by "six of them for the return-contract section".

## Verdict: FAIL

Nine of the ten checks passed under my own execution, including both of the two flagged as
mattering more than the gates in the case of check 7. Check 6 failed: one of the nine
cross-references resolves to a code fence rather than to the content the sentence describes, and
this library's stated value is that its cross-references can be followed. One citation edit
(`:104` to `:119`) plus a rewrite of the line 50 uniqueness claim clears both blocking items; the
gates, the guard mutants and the derived counts all stand up as they are.
