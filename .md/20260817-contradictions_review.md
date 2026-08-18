# Review: three facts adopted from resolving the 14 contradictions
Reviewer: independent subagent

## Checks executed

Check 1, all nine gates, each run fresh with the exit code captured via `echo "EXIT=${PIPESTATUS[0]}"`:

- `npm run verify` -> PASS: EXIT=0, `sources=44 claims=653 (attributed=653, unattributed=0) tagged-lines=653`, `PASS: evidence ledger is internally consistent`
- `npm run test` -> PASS: EXIT=0, `TOTAL 290 290 0 100%`, final line `PASS: 290 of 290 rows passed.` Category split: anti-hallucination 25, factual 208, navigation 22, routing-negative 15, routing-positive 20
- `npm run quotes` -> PASS: EXIT=0, `39 verbatim quote(s) from 7 reference file(s) against 191 mirrored page(s) at P:/ClaudeExt/CCX-Extension-Research/sources/docs/md`, `PASS every verbatim quote still appears upstream.` The tool also reports one PARTIAL COVERAGE row, `permissions.md:30 dropped ["instead."]`, which it surfaces by design and which does not change the exit code.
- `npm run facts` -> PASS: EXIT=0, `PASS  1 fact(s) consistent across 5 artifact reads.`
- `npm run numbers` -> PASS: EXIT=0, `Documentation statements that disagree: none`
- `npm run verify:prove-fail` -> PASS: EXIT=0, `EVIDENCE LEDGER GATE CAN FAIL: all 6 mutants were rejected by the gate that names them.`
- `npm run test:prove-fail` -> PASS: EXIT=0, `prove-fail: 275/275 positive assertions correctly went RED.` and `PASS: the suite is not self-certifying.` The 15 routing-negative rows correctly stay green, which is the expected shape.
- `npm run numbers:prove-fail` -> PASS: EXIT=0, `GATE CAN FAIL: every known-bad source was rejected.`
- `npm run facts:prove-fail` -> PASS: EXIT=0, `PASS  8/8 self-test rows.`

Remaining checks:

- Check 2, `node tools/rekey-claims.mjs` with no `--write` -> PASS: EXIT=0, `extracted 653 tagged claims`, `unchanged 653`, `moved 0`, `vanished 0`, `new 0`, ending with `dry run. Re-run with --write to apply.` so nothing was written. `git status --short` after the gate runs and again at the end returned empty, so the prove-fail mutators restored the tree.
- Check 3, `grep -n 'CLM-hooks-13[45]' evidence/claims.jsonl` -> PASS: exactly 2 rows, at ledger lines 652 and 653. Both carry `"file":"skills/claude-code-extension-engineering/references/hooks.md"`, `"tags":["ENGINEERING"]`, `"versions":["2.1.229"]`, `"source":"LOCAL_ENV"`, `"status":"attributed"`. CLM-hooks-134 records hooks.md line 134, CLM-hooks-135 line 135, and check 2's `moved 0` confirms those line numbers are current rather than stale.
- Check 4, ran `node tmp/check4.mjs`, a script that loads each row from `tests/questions.jsonl`, compiles its `answer_key` with `new RegExp(key, 'i')`, and matches it against the raw bytes of that row's own `source_file` -> PASS: EXIT=0, `CHECK4=PASS`. F264 key `"the top-level spelling is read by nothing"` matched at index 7997, hooks.md line 134. F265 key `"The event name is NOT in the environment"` matched at index 8247, hooks.md line 135. Both rows name `skills/claude-code-extension-engineering/references/hooks.md` as `source_file`.

- Check 5, the OFFICIAL claim, verified against the mirror -> PASS. `grep -n 'disallowedTools' sub-agents.md` in the mirror returned 12 lines. Line 373 reads, byte-verified with `sed -n '373p' | od -c`:

  > If both are set, `disallowedTools` is applied first, then `tools` is resolved against the remaining pool. A tool listed in both is removed.

  Our row in `skills/claude-code-extension-engineering/references/subagents.md` reads:

  > | disallowedTools | subtract from inherited tools. Applied FIRST, then tools resolves against what remains, and a tool named in BOTH lists is REMOVED rather than rejected as a conflict |

  Both halves are present in the mirror: the ordering (`disallowedTools` applied first, `tools` resolved against the remainder) and the outcome (a tool in both is removed). The trailing clause "rather than rejected as a conflict" adds no behaviour the mirror denies; it is the contrast already implied by "is removed", and the mirror's only nearby refusal case is a different condition, at line 375, where a subagent whose entire `tools` list resolves to nothing does error. Not an overstatement. On the tag: the row carries no bracket marker, and `README.md` line 147 gives the legend as "untagged is official documentation", so the row is presented as official. The mirror does state the fact, so the spec's FAIL branch, "says nothing and the claim is tagged OFFICIAL", does not apply.

- Check 6, the two ENGINEERING claims are not documented in the mirror -> PASS. Scope first: `find . -type f | wc -l` in the mirror gives 191 files and `find . -mindepth 1 -type d | wc -l` gives 0, so one recursive grep covers the whole corpus, and the repo's own `quotes` gate independently reports the same 191 pages at the same path.

  Positive controls, so that an absence is not merely a broken grep: `grep -rn 'additionalContext' .` returns 74 hits, `grep -rni 'hook_event_name' .` returns 107 hits, and `grep -rnoE 'CLAUDE_[A-Z0-9_]+' . | sort -u` yields 264 distinct variable names. Grep is reading these files.

  (a) Top-level `additional_context`. `grep -rn 'additional_context' . | wc -l` returns 0, and `grep -rnc 'additional_context' . | grep -v ':0$' | wc -l` returns 0 files. Widening to `grep -rniE 'additional[ _-]context' .` returns 17 hits; with the camelCase form excluded, every remaining hit is English prose, for example `features-overview.md:225` "Zero, unless hook returns additional context" and `hooks.md:1007` "inject additional context for Claude", never a field name. The snake_case spelling occurs nowhere in the corpus, so the mirror documents no such field and ENGINEERING is the correct tag.

  (b) An environment variable carrying the lifecycle event name. None exists in the corpus. Of the 264 `CLAUDE_*` names, the only ones matching HOOK or EVENT are `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` and `CLAUDE_PLUGIN_OPTION_WEBHOOK_URL`, none of which carries an event name. Dropping the CLAUDE prefix, `grep -rnoE '\b[A-Z][A-Z0-9]*(_[A-Z0-9]+)*EVENT[A-Z0-9_]*\b' .` returns no matches at all. The only EVENT-shaped shell variable anywhere in the corpus, `$AI_FLOW_EVENT`, is a GitLab CI trigger variable at `gitlab-ci-cd.md:91`, unrelated to hooks; `${event.content_block.name}` at `agent-sdk__streaming-output.md:315` is a JavaScript expression in an SDK example, not an environment variable. All 107 `hook_event_name` mentions are stdin payload references: `grep -rni 'hook_event_name' . | grep -icE 'env|\$'` returns 0. A phrasing sweep, `grep -rniE '(env|environment)[^.]{0,80}(which event|event that fired|lifecycle event|event type)' .`, returns 0.

  Two supporting observations, both consistent with ENGINEERING. The mirror does document negatives of exactly this shape when it knows them, at `hooks.md:719`, "There is no `$CLAUDE_MODEL` environment variable", and it states no equivalent for the event name. And two of the variables our claim reports as measured, `CLAUDE_CODE_HOST_SESSION_ID` and `CLAUDE_CODE_ENTRYPOINT`, have 0 hits in the entire mirror, which is what an observation-not-documentation tag predicts.

- Check 7, `git diff --name-only main...HEAD` -> PASS: exactly 6 paths, matching the spec one for one: `.md/20260817-contradictions_verify.md`, `docs/RESULTS.md`, `evidence/claims.jsonl`, `skills/claude-code-extension-engineering/references/hooks.md`, `skills/claude-code-extension-engineering/references/subagents.md`, `tests/questions.jsonl`. `git diff --stat main...HEAD` shows `6 files changed, 84 insertions(+), 29 deletions(-)`; `evidence/claims.jsonl` shows 56 changed lines rather than a whole-file diff, and check 2's `vanished 0` covers the loss question either way. HEAD is `cb64be5 Adopt three facts surfaced by resolving the 14 contradictions` on branch `contradiction-resolutions`.

## Issues found

- none that fail a check. Two notes for the record, neither blocking:
  - The `disallowedTools` row is untagged rather than carrying an explicit `[OFFICIAL]` marker, and it is therefore not a row in `evidence/claims.jsonl`. That is the library's own convention for official documentation, per README line 147, and 397 ledger rows do use the explicit tag, so the row is consistent with the file it lives in. The "presented as OFFICIAL" framing rests on the untagged default, not on a visible marker.
  - `npm run quotes` reports a PARTIAL COVERAGE row on `permissions.md:30`. It predates this branch, is not among the six changed files, and does not affect the exit code.

## Verdict: PASS
