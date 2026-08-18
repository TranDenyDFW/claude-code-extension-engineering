# Review round 2: three Stop-hook guard mechanics added to references/hooks.md
Reviewer: independent subagent

Run fresh on 2026-08-18 (local clock) in `P:\ClaudeExt\ccx-engineering-work`, branch
`hooks-stop-guard-mechanics` at `c388461`, working tree clean (`git status --porcelain` empty).
I did not perform round 1. I read `.md/20260817-stop-guard_review.md` for context only and
re-executed every check, including 12b, from scratch. Scratch scripts are under
`P:\ClaudeExt\ccx-engineering-work\tmp\` (gitignored via `.gitignore:32`).

## Checks executed

- `git rev-parse --abbrev-ref HEAD` and `git status --porcelain` -> PASS: `hooks-stop-guard-mechanics`, empty status, HEAD `c388461 Add Stop-hook guard mechanics to hooks.md`.

- `npm run verify` -> PASS: exit 0. `sources=44 claims=651 (attributed=651, unattributed=0) tagged-lines=651`, then `PASS: evidence ledger is internally consistent`.

- `npm run test` -> PASS: exit 0. Final line reads exactly `PASS: 288 of 288 rows passed.`; table `TOTAL 288 288 0 100%` (anti-hallucination 25, factual 206, navigation 22, routing-negative 15, routing-positive 20).

- `npm run quotes` -> PASS: exit 0. `quote-check: 39 verbatim quote(s) from 7 reference file(s)` against `191 mirrored page(s)`, then `PASS every verbatim quote still appears upstream.` The run self-reports PARTIAL COVERAGE on one pre-existing abridged quote (`permissions.md:30`, dropped `["instead."]`), which is outside the changed content and does not affect exit status. No prose punctuation in the three new bullets was read as a citation.

- `npm run numbers` -> PASS: exit 0. Live re-derivation printed `suite rows 288` and `ledger claims 651`; the section `Documentation statements that disagree:` reads `none`.

- `npm run verify:prove-fail` -> PASS: exit 0. `EVIDENCE LEDGER GATE CAN FAIL: all 6 mutants were rejected by the gate that names them.`

- `npm run test:prove-fail` -> PASS: exit 0. `prove-fail: 273/273 positive assertions correctly went RED.` and `PASS: the suite is not self-certifying.`

- `npm run numbers:prove-fail` -> PASS: exit 0. `GATE CAN FAIL: every known-bad source was rejected.`

- `node tools/rekey-claims.mjs` (DRY RUN, no `--write`) -> PASS: exit 0. `extracted 651 tagged claims`, `ledger 651 claims, references now carry 651 tagged lines`, `unchanged 651`, `moved 0`, `vanished 0`, `new 0`. Zero `new` means no tagged reference line lacks an attribution record.

- Check 9, attribution records (`node tmp/r2-check9.mjs`, the spec's snippet written to a file so shell quoting could not damage it) -> PASS: exactly three lines, `MATCHED=3`. First line: `CLM-hooks-194 LOCAL_ENV attributed ["ENGINEERING"] | file=skills/claude-code-extension-engineering/references/hooks.md line=194`, and the same shape for 195 and 196. Source `LOCAL_ENV`, status `attributed`, tags containing `ENGINEERING` on all three.

- Check 10, answer keys actually match the file (`node tmp/r2-check10.mjs`) -> PASS: `ROWS=3`, every line ends `true`:
  `F261 true || key: ESCAPE SENTINEL is a literal line the handler greps for in the reply`
  F262 true, key: stop_hook_active is not a loop cap you can build on
  `F263 true || key: 160,316 records of type user carried only 13,598 real user turns`

- Check 11, banned dash code points U+2011, U+2012, U+2013, U+2014, U+2015, U+2212 (`node tmp/r2-check11.mjs`) -> PASS: `hooks.md 0`, `evidence/claims.jsonl 0`, `tests/questions.jsonl 0`, `docs/RESULTS.md 0`.

- Bullet placement (`grep -n` over `hooks.md`) -> PASS: line 193 is the existing `- Before diagnosing a Stop hook as broken` bullet; the three new bullets are lines 194, 195, 196, matching the claim ids and the `line` field on each record.

### Check 12, substantive support, read in `P:\ClaudeExt\QuestionExtension\`

PASS on every stated criterion. I read `ask-question-guard.mjs` (145 lines), `lib\state.mjs` (82),
`lib\transcript.mjs` (151) and `lib\detect.mjs` (179), which the guard imports and which holds the
sentinel logic. I also confirmed the handler really is wired to the Stop event: parsing
`C:\Users\Shake\.claude\settings.json` yields exactly one registration,
`Stop | matcher None | node "P:\ClaudeExt\QuestionExtension\ask-question-guard.mjs"`.

- **Bullet 194, an escape sentinel exists and is a literal string matched against the reply.** SUPPORTED. `lib\detect.mjs:82`:
  `if (lastText.includes('ASKGUARD-DISMISS')) return { blocked: false, exempt: 'dismissed' };`
  That is a literal `String.includes` over the last assistant text, and `ask-question-guard.mjs:109` turns it into a non-block:
  `if (!hit.blocked) return pass(hit.exempt ? 'exempt:' + hit.exempt : 'clean');`
  so the turn ends with no human present. The two-way contract is the block reason itself, `lib\detect.mjs:162` to `:165`:
  `'If AskUserQuestion is genuinely the wrong mechanism here (for example plan ' + 'approval, which belongs to ExitPlanMode), reply with exactly one line:\n' + 'ASKGUARD-DISMISS: <one sentence saying why>\n' + 'and end the turn.'`
  The log-every-bypass half is `ask-question-guard.mjs:85` to `:97`, which sets `verdict` to `'dismissed'` when `(turn.lastText || '').includes('ASKGUARD-DISMISS')` and writes it through `appendLog({ ... event: 'resolve', ... verdict })`.
  The bullet's second shape, an OVERRIDE FILE the user creates, is beyond the spec criterion but is also real on this machine: `P:\ClaudeExt\EmDash\dash-guard.mjs:61` reads `const MARKER = HOME + '/.claude/hooks/.allow-dash';` and `:273` logs `dash-guard: .allow-dash present, permitting ...`. Both shapes and the logging rule are sourced, not invented.

- **Bullet 195, per-session block state keyed by the stdin session id, errors swallowed.** SUPPORTED. `ask-question-guard.mjs:79`: `const sessionId = input.session_id;` and `lib\state.mjs:28` to `:30`:
  `export function stateFile(sessionId) { return join(guardHome(), STATE_DIRNAME, safeId(sessionId) + '.json'); }`
  Sanitisation is `lib\state.mjs:25`: `return String(id || 'nosession').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);`
  The swallow rule is stated at `lib\state.mjs:8` to `:9`: `Every function here swallows its own errors. A guard that throws on an unwritable directory would block a session over a bookkeeping failure.` and it is implemented, not merely asserted: `readState` catches to `null`, `writeState` to `false`, `pruneState` and `appendLog` both swallow. The bullet's premise that `stop_hook_active` cannot express a once-per-session cap is matched by `lib\state.mjs:4` to `:6` (`State is the real loop cap. stop_hook_active is checked too, but ... never depended on alone.`) and by the ordering in the handler: the state check is labelled `Loop cap, guard 1 of 2` at line 81, the flag is `guard 2 of 2` at line 103 and is consulted only afterwards at `:106`.

- **Bullet 196, bounded tail, fragment first line, tool results as user records.** SUPPORTED, and reproduced by me rather than read. Source: `lib\transcript.mjs:5` to `:6`: `Reads are BOUNDED (openSync/readSync from an offset) so a multi-hundred-MB transcript never lands in RAM. Never use readFileSync on a transcript.`, implemented at `:38` to `:42` (`const start = size > maxBytes ? size - maxBytes : 0; ... readSync(fd, buf, 0, len, start);`) and called with `config.tailBytes || 1048576` at `ask-question-guard.mjs:75`. The fragment claim is `lib\transcript.mjs:51`: `Parse JSONL leniently. The first line of a tail read is usually a fragment.` The turn-boundary trap is `lib\transcript.mjs:16`: `TURN BOUNDARY TRAP: tool results come back wrapped in type:"user" records.` with the filter at `:81` to `:87` (`isRealUserRecord`). The version tag is `lib\transcript.mjs:8`: `Record shapes, verified against a live 2.1.219 transcript`.

- **Check 12, my own empirical probe of the mechanism** (`node tmp/r2-probe-tail.mjs`, importing the real `readTail`, `parseRecords` and `isRealUserRecord` and running them over the eight largest transcripts on disk) -> PASS. Every line reports `firstLineIsFragment=true`, every `tool_result` block sits in a user record and none in an assistant record, and real user turns are a small minority of user records:
  `size=74517625  firstLineIsFragment=true  userRecs=41  realUserTurns=3  tool_result(inUser)=32  tool_result(inAssistant)=0`
  `size=48507428  firstLineIsFragment=true  userRecs=24  realUserTurns=0  tool_result(inUser)=24  tool_result(inAssistant)=0`
  `size=42352180  firstLineIsFragment=true  userRecs=88  realUserTurns=7  tool_result(inUser)=80  tool_result(inAssistant)=0`
  The 74 MB file was never buffered; `readTail` took only its last 1 MiB.

### Check 12b, reproduce the measurement (the important one)

PASS. I streamed every `.jsonl` under `C:\Users\Shake\.claude\projects\` line by line with
`readline` (`node --max-old-space-size=512 tmp/r2-check12b.mjs`, exit 0), never reading a file
whole. Corpus: 10,297,597,265 bytes, 9.59 GB, largest single file 74,517,625 bytes. Full output:

```
FILES                             5902
BYTES                             10297597265  (9.59 GB)
type=user RECORDS                 160356
tool_result BLOCKS in user recs   146741
REAL user turns (isMeta excluded) 10669
REAL user turns (isMeta ignored)  13600
REAL share (isMeta excluded)      6.65 percent
REAL share (isMeta ignored)       8.48 percent
max tool_result blocks in 1 rec   1
records with >1 tool_result block 0
FILES where blocks > user recs    0
json parse errors                 0
```

Against the bullet's figures, using the bullet's own stated definition of a real user turn
(`A real user turn is a user record carrying NO tool_result block and some actual text`, which is
the `isMeta ignored` row):

| quantity | bullet 196 | my run | delta |
| --- | --- | --- | --- |
| transcripts | 5,901 | 5,902 | +1 |
| type user records | 160,316 | 160,356 | +0.025 percent |
| real user turns | 13,598 | 13,600 | +0.015 percent |
| real share | 8.5 percent | 8.48 percent | matches |
| files with blocks outnumbering user records | none implied | 0 | matches |

The upward drift is the corpus growing while I measured, not a disagreement.
`node tmp/r2-delta.mjs` shows 117 of the 5,902 files were written on or after 2026-08-17, holding
5,987 user records between them, and the newest is this review session's own transcript
(`...\d8ff1ec6-...jsonl  mtime=2026-08-18T01:59:34Z`). Both counts moved by well under a tenth of a
percent and the ratio is identical to two decimal places.

The retracted figure is also affirmatively refuted, not merely unreproduced: no record anywhere in
the 5,902 files carried more than one `tool_result` block (`max tool_result blocks in 1 rec 1`,
`records with >1 tool_result block 0`), so blocks cannot outnumber user records in any file, which
is exactly what "19 user records against 21 tool_result blocks" required. `FILES where blocks > user
recs 0` confirms it directly. `json parse errors 0` confirms the sweep read every line it counted.

**The three post-round-1 edits, confirmed by diffing the pre-review commit against HEAD.**
`git reflog` still holds `1661a12`, the commit as it stood when round 1 reviewed it, so I compared
bytes rather than taking anyone's word: `git --no-pager diff 1661a12 HEAD -- .../hooks.md` reports
2 insertions and 2 deletions, both in the Stop section. (Note for anyone repeating this: a naive
`grep -v '^[-+][-+]'` filter silently hides these lines, because a changed markdown bullet renders
as `+- ` or `-- `. I hit that, noticed the empty output contradicted `--stat`, and re-ran a
different way rather than concluding the diff was empty.)

1. Bullet 196 dropped `a sampled live transcript held 19 user records against 21 tool_result blocks, so walking back to the nearest user record lands mid-turn` and now reads `MEASURED over all 5,901 transcripts on one machine: 160,316 records of type user carried only 13,598 real user turns, 8.5 percent, so a walk back to the nearest user record lands on a tool result roughly eleven times in twelve.` That measurement reproduces per the table above, and the ratio checks out (1 minus 0.0848 is 0.915, against 11/12 = 0.917). Test row F263 now keys on `160,316 records of type user carried only 13,598 real user turns`, so the suite pins the figure I reproduced rather than the one that did not. The string `19 user records` survives in the repo only inside the correction note on the three claim records and in the round-1 review file; it is gone from `hooks.md` and from `tests/questions.jsonl`. The upstream source comment was corrected too: `lib\transcript.mjs:25` to `:28` now reads `An earlier version of this comment claimed "19 user records against 21 tool_result blocks". That does not reproduce: blocks NEVER outnumbered user records in any of the 5,901 files. ... The trap is real; that number was not. Do not cite it.`
2. Bullet 194 dropped the clause "or stop_hook_active and the 8-block cap are the only things that ever end the turn and the guard is noise for 8 turns" and now reads `or the 8-block cap is what ends the turn instead, after the guard has been noise for eight of them`. `grep -c "are the only things that ever end the turn"` over `hooks.md` returns `0`. The overclaim is gone: the sentence no longer asserts an exhaustive list, so it no longer excludes a handler's own state cap, which bullet 195 supplies immediately afterwards and which `ask-question-guard.mjs:100` implements (`return pass('turn cap (already blocked this turn)')`).
3. Bullet 196 changed "the documented alternative to stop_hook_active," into "the documented alternative to stop_hook_active and to the last_assistant_message field above". The referent exists above it: `hooks.md:188` is the OFFICIAL bullet reading `Stop hooks receive stop_hook_active alongside last_assistant_message, background_tasks and session_crons.` Those are the only two occurrences of `last_assistant_message` in the file, lines 188 and 196, so "above" resolves correctly.

### Check 13, provenance against the docs mirror

PASS: none of the three is documented at `P:\ClaudeExt\CCX-Extension-Research\sources\docs\md\`
(191 pages), so `ENGINEERING` is the correct tag on all three.

- **(a) A way for the MODEL to satisfy a blocking Stop hook: NOT documented.** I read the mirror's whole Stop section (`hooks.md:2355` to `:2460`). Every turn-ending mechanism it names belongs to the harness. `hooks.md:2365`: `The stop_hook_active field is true when Claude Code is already continuing as a result of a stop hook. Check this value or process the transcript to avoid blocking on a condition that will never resolve. Claude Code overrides the hook and ends the turn after 8 consecutive blocks.` The Stop decision-control table offers only `decision`, `reason` and `hookSpecificOutput.additionalContext`, and `hooks.md:2444` says `additionalContext` passes through `the same loop protections as decision: "block", namely the stop_hook_active input and the 8-consecutive-continuation cap`. `hooks-guide.md:981` repeats the cap and offers only exiting early when the flag is true. All 17 `stop_hook_active` occurrences in the mirror are payload samples, SDK type definitions, or re-entry-guard shell snippets (`self-hosted-environments-configuration.md:288`: `case "$in" in *'"stop_hook_active":true'*) exit 0 ;; esac`). A case-insensitive sweep for `sentinel|escape hatch|magic string|opt-out marker|bypass token|dismiss` returned 74 lines, every one about sandbox credential masking, UI dismissal keybindings, or the `dangerouslyDisableSandbox` escape hatch. Nothing describes a string the model can emit to release a Stop block.
- **(b) Transcript JSONL record shapes: NOT documented, and explicitly declined.** `sessions.md:184` reads `Each line is a JSON object for a message, tool use, or metadata entry. The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release.` `hooks.md:706` calls `transcript_path` a `Path to conversation JSON` with a write-lag warning; `how-claude-code-works.md:99` and `agent-sdk__session-storage.md:93` describe the file's existence and its one-object-per-line shape only. A sweep for `parentUuid|isSidechain|isMeta|leafUuid|toolUseResult` found `isSidechain 0`, `isMeta 0`, `leafUuid 0`, `toolUseResult 0`, and 4 `parentUuid` hits, all incidental (two changelog bug fixes, `monitoring-usage.md:580` and `:625` on message uuids, and a VS Code `macOptionIsMeta` setting). No page gives a per-line schema, mentions a bounded tail read, or warns about a fragment first line.
- **(c) Tool results carried as user-type records: NOT documented for the transcript.** All 30 `tool_result` occurrences concern the SDK message stream, OTel events, or API errors. The set intersection is empty: `comm -12` between the files containing a literal `"type": "user"` and the files containing `tool_result` returned nothing, so no `"type": "user"` JSON sample in the mirror carries a tool result. The eight `"type": "user"` literals (`agent-sdk__python.md:541`, `:546`, `:551`, `:3575`, `agent-sdk__streaming-vs-single-mode.md:146`, `:161`, `agent-sdk__user-input.md:128`, `:738`) are SDK streaming-input prompt messages. See Issues item 2 for the one near neighbour I found, which does not change the verdict.

### Check 14, scope

- `git diff --name-only main...HEAD` -> PASS: `COUNT=6`, exactly the six paths the spec names: `.md/20260817-stop-guard_review.md`, `.md/20260817-stop-guard_verify.md`, `docs/RESULTS.md`, `evidence/claims.jsonl`, `skills/claude-code-extension-engineering/references/hooks.md`, `tests/questions.jsonl`. No other file appears. `git diff --stat main...HEAD` reports `6 files changed, 878 insertions(+), 649 deletions(-)`, with 1299 lines touched in `evidence/claims.jsonl` (652 plus lines against 649 minus lines).
- Record-level truth of the ledger churn (`node tmp/r2-ledger-compare.mjs`, comparing `git show main:evidence/claims.jsonl` against HEAD by claim TEXT rather than by line) -> PASS: `main records 648   head records 651`, `texts in main but NOT in head: 0`, `texts new in head: 3` (exactly CLM-hooks-194, 195, 196), `shared texts whose id changed: 14`, `shared texts with other field changes: 0`. The 649-deletion line diff is a whole-file line-ending rewrite exactly as the spec predicted; no claim text, source, status, tag or note was lost or altered.
- `docs/RESULTS.md` diff -> PASS: one line, `285 questions (set v2), 100% pass.` becoming `288 questions (set v2), 100% pass.`, consistent with the live suite size and with `npm run numbers` reporting no disagreement.

## Issues found

1. **Minor, a reader who copies the implementation will not reproduce 8.5 percent.** Bullet 196 defines a real user turn as `a user record carrying NO tool_result block and some actual text`, and under exactly that definition I measured 13,600 of 160,356, or 8.48 percent, matching the cited 13,598 and 8.5 percent. But the reference implementation's predicate is one clause stricter: `lib\transcript.mjs:83` also rejects meta records (`if (rec.isMeta) return false;`). Applying `isRealUserRecord` verbatim over the same population gives 10,669 real turns, 6.65 percent. The bullet is internally consistent, because it states its own definition and its number matches it; the note is only that a reader implementing the sentence literally lands on a different figure than a reader importing the function. Adding "and not marked as meta" would close the gap. Not a correctness failure and not a check failure.

2. **Minor, a near neighbour in the mirror that round 1 did not surface, recorded so nobody rediscovers it as a defect.** `agent-sdk__typescript.md:1143` defines `SDKUserMessage` as `type: "user"`, and `:1158` says `On a message that carries a tool_result block, tool_use_result is the tool's structured output object rather than the text sent to the model.` So the mirror does document, for the SDK message stream, that a type-user message can carry a `tool_result` block. That is a different surface from the claim: bullet 196 is about the append-only JSONL at `transcript_path`, whose entry format `sessions.md:184` explicitly declines to document and warns `changes between versions`, and whose records carry `uuid`/`parentUuid`/`isMeta` rather than `SDKUserMessage`'s `parent_tool_use_id`/`isSynthetic`. `ENGINEERING` therefore remains correct and check 13 passes. If the section is revised for other reasons, a pointer to the SDK type is a cheap strengthener.

3. **Minor, the absolute counts are an undated snapshot inside a version-dated bullet.** Bullet 196 carries `[v2.1.219]` but no measurement date, and the population it counts grows every session: one day on, the tree is already 5,902 files and 160,356 user records. The ratio is the durable part and it held exactly; the three absolute numbers will read as stale within weeks. The date does exist upstream in both places (`Added 2026-08-17` in the claim note, `MEASURED 2026-08-17` at `lib\transcript.mjs:17`), just not in the sentence a reader sees. Wording the bullet around the ratio, with the absolutes as a dated parenthetical, would age better. No action required for this change to land.

Nothing else. No check failed, no scope creep, no banned dash characters, no lost ledger records,
and the round-1 finding is resolved at the upstream source as well as in the reference.

## Verdict: PASS

All 14 spec checks plus 12b passed when I ran them, on evidence I produced myself. The finding that
made round 1 PARTIAL is fixed, and I confirmed the fix the hard way: I streamed all 5,902
transcripts, 9.59 GB, and landed on 160,356 user records and 13,600 real user turns against the
cited 160,316 and 13,598, a drift under 0.03 percent that is fully explained by 117 files written
after the author measured. I also affirmatively refuted the retracted figure rather than merely
failing to reproduce it: no record in the entire population carries more than one `tool_result`
block, so blocks can never outnumber user records, and zero files show that relation. Bullet 194 no
longer claims `stop_hook_active` and the 8-block cap are the only things that end the turn, and
bullet 196 now names `last_assistant_message` as the alternative its preceding bullet introduces;
both confirmed by diffing the pre-review commit `1661a12` against HEAD. Each of the three claims
traces to a quotable line in `P:\ClaudeExt\QuestionExtension\`, none of the three is documented in
the 191-page mirror, and the three issues above are wording refinements, not defects.
