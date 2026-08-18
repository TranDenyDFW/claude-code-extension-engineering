# Verification spec: three facts adopted from resolving the 14 contradictions

Run from `P:\ClaudeExt\ccx-engineering-work`, branch `contradiction-resolutions`, compare against
`main`. Every threshold below was observed on a real run before this spec was written.

## Checks (run each FRESH)

1. All nine gates: `npm run verify`, `test`, `quotes`, `numbers`, `facts`, `verify:prove-fail`,
   `test:prove-fail`, `numbers:prove-fail`, `facts:prove-fail`.
   - PASS if: every one exits 0, and `npm run test` reports `PASS: 290 of 290 rows passed.`
   - FAIL if: any non-zero exit or a different row count

2. `node tools/rekey-claims.mjs` (DRY RUN, no `--write`)
   - PASS if: `extracted 653`, `unchanged 653`, `vanished 0`, `new 0`
   - FAIL if: any non-zero `vanished` or `new`

3. Attribution. Confirm `CLM-hooks-134` and `CLM-hooks-135` exist in `evidence/claims.jsonl` with
   source `LOCAL_ENV`, status `attributed`, tag `ENGINEERING`, version `2.1.229`.
   - FAIL if: any is missing or differently tagged

4. Test rows F264 and F265 exist in `tests/questions.jsonl` and each `answer_key`, compiled as a
   case-insensitive regex, matches the raw text of `references/hooks.md`.
   - FAIL if: either is absent or fails to match

5. **The OFFICIAL claim.** `subagents.md` now states that a tool named in BOTH `tools` and
   `disallowedTools` is REMOVED. Verify that against the documentation mirror at
   `P:\ClaudeExt\CCX-Extension-Research\sources\docs\md\sub-agents.md`.
   - PASS if: the mirror states it (expected near line 373) and our wording does not overstate it
   - FAIL if: the mirror says something different, or says nothing and the claim is tagged OFFICIAL

6. **The two ENGINEERING claims are NOT official.** Search the same mirror for whether it documents
   (a) a top-level `additional_context` field on hook output, or (b) any environment variable
   carrying the hook lifecycle event name.
   - PASS if: neither is documented, so `ENGINEERING` is the correct tag
   - FAIL if: either IS documented, which would make the tag wrong

7. **Scope.** `git diff --stat main...HEAD`
   - PASS if: only `docs/RESULTS.md`, `evidence/claims.jsonl`, `tests/questions.jsonl`,
     `references/hooks.md`, `references/subagents.md`, and `.md/20260817-contradictions_verify.md` changed (six files)
   - FAIL if: anything else appears. Note `evidence/claims.jsonl` shows a whole-file diff from the
     rekey rewriting line endings; check 2's `vanished 0` is the real assurance nothing was lost.

## Notes for the reviewer

- The Bash tool resets its working directory between calls; use absolute paths.
- Do NOT use `/tmp` here: Git Bash and Node resolve it to different directories. Use `tmp/`.
- Never assert absence from truncated output. Do not use `cut`, and do not pipe through `head`
  AFTER `fold`, which truncates by display line and hides matches. Count matches first, then read.
- A crashed command is a check that COULD NOT RUN, which is a failure of the check, not a finding.
