# Verification spec: the return-contract section in subagents.md

Run from `P:\ClaudeExt\ccx-engineering-work`, branch `return-contract-section`, compare against
`main`. Every threshold was observed before this spec was written.

This is the FIRST content adopted from the pattern-corpus audit, so the standard is whether the
section says what the recorded judgments concluded, and whether its cross-references are true.

## Checks

1. Eleven gates: `verify`, `test`, `quotes`, `numbers`, `facts`, `drift`, and the five prove-fail
   counterparts. PASS if all exit 0 and `test` reports `PASS: 301 of 301 rows passed.`

2. `node tools/rekey-claims.mjs` DRY RUN. PASS if `extracted 664`, `unchanged 664`, `vanished 0`,
   `new 0`.

3. `node tools/claim-drift.mjs`. PASS if all 664 records match their full-text hash.

4. Attribution: `CLM-subagents-055` through `CLM-subagents-061` exist in `evidence/claims.jsonl`,
   all `status` `attributed`, all `source` `SRC_EXTINDEX_SURVEY`, all tagged `ENGINEERING`.

5. Test rows F271 to F276 exist and each `answer_key`, as a case-insensitive regex, matches
   `references/subagents.md`.

6. **Cross-references are LIVE, not stale.** The section cites `workflows.md:102`, `workflows.md:32`,
   `workflows.md:100`, `agent-teams.md:34`, `agent-teams.md:36`, `context-modes.md:46`,
   `subagents.md:43`, `:104` and `:46`. Check each points at what the section says it does. Today's
   edits moved several line numbers in these files, so a stale citation is the likely defect.

7. **No overstatement.** Every bullet is tagged ENGINEERING, which asserts engineering judgment
   rather than documentation. Confirm none of them states a PRODUCT behaviour that would need an
   OFFICIAL tag and a mirror citation. The bullet about `agent()` returning the final text is the
   one to look at hardest: it is scoped to the workflow API, and it must not be read as a claim
   about every subagent dispatch.

8. **The guard still bites.** Revert only the FACTS scan to per-line, leaving the mutants, and
   confirm `numbers:prove-fail` turns red naming both FACTS mutants. Restore, confirm a clean tree.
   Both mutant anchors were re-anchored in this change (280 to 286, 295 to 301) because they failed
   closed when the counts moved; confirm that re-anchoring did not weaken them.

9. `docs/RESULTS.md` prose accounts for the 301 rows and the live positive-assertion count of 286.
   Derive 286 yourself from `test:prove-fail` rather than reading it off the doc.

10. Scope: `git diff --stat main...HEAD` shows only `references/subagents.md`,
    `tools/coverage-report.mjs`, `docs/RESULTS.md`, `evidence/claims.jsonl`, `tests/questions.jsonl`
    and files under `.md/`.

## Notes for the reviewer

- The Bash tool resets its working directory between calls; use absolute paths.
- Do NOT use `/tmp`: Git Bash and Node resolve it to different directories here. Use `tmp/`.
- Docs are CRLF on disk. A `\n` replacement in a script will not match; check the bytes.
- Beware the Bash heredoc collapsing double backslashes; it corrupted an edit during this work.
- `grep -P` aborts with a locale error here; do character-class work in Node.
- Never assert an absence from truncated output. Do not use `cut`, and do not pipe through `head`
  AFTER `fold`, which truncates by display line.
- A crashed command is a check that COULD NOT RUN, which is a failure of the check, not a finding.
