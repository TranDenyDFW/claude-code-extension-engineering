# Verification spec: five OFFICIAL findings adopted from the docs checks

Run from `P:\ClaudeExt\ccx-engineering-work`, branch `docs-check-adoptions`, compare against `main`.
Every threshold below was observed before this spec was written.

The point of these five is TAG CORRECTNESS. Each is marked OFFICIAL, which asserts the mirror
documents it. Checks 5 to 9 are what actually decide the change; the gates only decide consistency.

## Checks (run each FRESH)

1. Nine gates: `npm run verify`, `test`, `quotes`, `numbers`, `facts`, `verify:prove-fail`,
   `test:prove-fail`, `numbers:prove-fail`, `facts:prove-fail`.
   - PASS if: all exit 0 and `test` reports `PASS: 295 of 295 rows passed.`

2. `node tools/rekey-claims.mjs` DRY RUN (no `--write`)
   - PASS if: `extracted 657`, `unchanged 657`, `vanished 0`, `new 0`

3. Attribution. `CLM-subagents-125`, `CLM-subagents-126`, `CLM-hooks-249`, `CLM-permissions-032`
   exist in `evidence/claims.jsonl`, all `status` `attributed`, sources respectively
   `SRC_SUBAGENTS`, `SRC_SUBAGENTS`, `SRC_AGENT_SDK`, `SRC_PERMISSIONS`.

4. Test rows F266 to F270 exist and each `answer_key`, as a case-insensitive regex, matches the raw
   text of that row's own `source_file`.

5. **model default.** Mirror `sub-agents.md` line 289. PASS if it states the `model` field defaults
   to `inherit` and lists the accepted values, and our table row does not overstate it.

6. **Resolution order.** Mirror `sub-agents.md` around lines 310 to 325. PASS if it documents the
   order (environment variable, per-invocation parameter, frontmatter, main conversation), the
   v2.1.196 change in what `inherit` means in `CLAUDE_CODE_SUBAGENT_MODEL`, and that a value blocked
   by an `availableModels` allowlist is substituted. FAIL if our bullet claims more than the page.

7. **Result returns to the caller.** Our bullet quotes a sentence verbatim. Confirm it is a
   character-exact substring of mirror `sub-agents.md` (near line 834). Compare programmatically.

8. **stdin fields.** Mirror `agent-sdk__typescript.md`, the `BaseHookInput` type (near line 1611)
   and the `prompt_id` paragraph after it. PASS if `permission_mode`, `effort`, `prompt_id`,
   `agent_id` and `agent_type` are all in that type, and if the page supports our three specific
   claims about `prompt_id`: it matches the OpenTelemetry `prompt.id` attribute, it is absent until
   the first user input, and it needs v2.1.196 or later.

9. **Parameter matching.** Mirror `permissions.md` near line 110. Our bullet quotes a fragment
   verbatim. PASS if character-exact and if the page also supports the one-parameter-per-rule point.

10. **Scope.** `git diff --stat main...HEAD`. PASS if the only changed files are `docs/RESULTS.md`,
    `evidence/claims.jsonl`, `tests/questions.jsonl`, the three references
    (`subagents.md`, `hooks.md`, `permissions.md`) and files under `.md/`.

## Notes for the reviewer

- The Bash tool resets its working directory between calls; use absolute paths.
- Do NOT use `/tmp`: Git Bash and Node resolve it differently here. Use `tmp/`.
- `grep -P` aborts on this machine with a locale error; do character-class work in Node.
- Do not assert an absence from truncated output. Do not use `cut`, and do not pipe through `head`
  AFTER `fold`, which truncates by display line and hides matches. Count matches, then read them.
- A crashed command is a check that COULD NOT RUN, which is a failure of the check, not a finding.
