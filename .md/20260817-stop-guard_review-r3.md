# Review round 3 (delta): corrected isMeta predicate and republished figure
Reviewer: independent subagent

Run fresh on 2026-08-17/18 (local clock) in `P:\ClaudeExt\ccx-engineering-work`, branch
`hooks-stop-guard-mechanics` at `9d01ae2`, working tree clean (`git status --porcelain` empty).
I did not write the content and did not perform rounds 1 or 2. Targeted delta only: the four
checks in the round-3 spec. Scratch script under `P:\ClaudeExt\ccx-engineering-work\tmp\`.

## Checks executed

- `sed -n '78,90p' P:\ClaudeExt\QuestionExtension\lib\transcript.mjs` (derive the predicate from the code before counting anything) -> PASS: `isRealUserRecord` at lines 83 to 89 applies exactly four tests, in this order: `rec.type !== 'user'` rejects, `rec.isMeta` rejects (a truthy test, not a key-presence test), any block with `type === 'tool_result'` rejects, and `blockText(blocks).length > 0` is required. `contentBlocks` reads `rec.message.content` or `rec.content`, treats an array as blocks and a bare string as a single text block. My recount imports this function itself rather than restating it, so a transcription error is not possible.

- `node --max-old-space-size=512 P:\ClaudeExt\ccx-engineering-work\tmp\r3-count.mjs` (recursive walk of `C:\Users\Shake\.claude\projects\`, then `createReadStream` plus `readline` per file, one line at a time, no file ever read whole) -> PASS, exit 0. Full output:

```
FILES                              5903
BYTES                              10298320145  (10.30 GB)
LARGEST FILE BYTES                 74517625
LINES                              587779
json parse errors                  0
type=user RECORDS                  160409
tool_result BLOCKS in user recs    146791
tool_result BLOCKS anywhere        146791
records with truthy isMeta (all)   2933
records with truthy isMeta (user)  2933
REAL user turns (isRealUserRecord) 10671
REAL user turns (isMeta ignored)   13603
REAL share (strict)                6.65 percent
REAL share (isMeta ignored)        8.48 percent
max tool_result blocks in 1 rec    1
records with >1 tool_result block  0
FILES where trBlocks > userRecs    0
```

  Against the published figures:

  | quantity | published | my run | delta |
  | --- | --- | --- | --- |
  | transcripts | 5,902 | 5,903 | +1 |
  | type user records | 160,388 | 160,409 | +0.013 percent |
  | tool_result blocks in user records | 146,772 | 146,791 | +0.013 percent |
  | isMeta records | 2,932 | 2,933 | +1 |
  | REAL user turns | 10,670 | 10,671 | +0.009 percent |
  | REAL share | 6.7 percent | 6.65 percent | matches at the stated precision |
  | files with tool_result blocks outnumbering user records | none | 0 | matches |

  Every count lands inside a hundredth of a percent of the published one, far inside "a few percent", and the drift is upward exactly as the spec predicted (the corpus grew while I measured; one of the 5,903 files is this review session's own transcript). `json parse errors 0` confirms the sweep read every line it counted, so these are full-population counts and not a sample. Two corroborating results: no record anywhere carries more than one `tool_result` block (`max tool_result blocks in 1 rec 1`, `records with >1 tool_result block 0`), so blocks structurally cannot outnumber user records in any file, and `tool_result BLOCKS anywhere` equals `tool_result BLOCKS in user recs`, so no assistant record carries one either. The published ratio also holds: 1 minus 0.0665 is 0.9335 against 14/15 = 0.9333, matching "about fourteen times in fifteen".

- Same run, the looser predicate (`realIgnoringIsMeta`, byte-identical to `isRealUserRecord` minus the isMeta clause): `REAL user turns (isMeta ignored) 13603`, `8.48 percent` -> PASS: this reproduces the retracted 13,598 and 8.5 percent as exactly the value the isMeta-free predicate yields, which confirms the round-2 diagnosis and confirms that 10,670 is the stricter and correct number. The overstatement is 13,603/10,671 = 1.275, so "overstating turns by about a quarter" is accurate.

- `grep -n "Processing the transcript" skills/claude-code-extension-engineering/references/hooks.md` -> PASS: line 196 carries the corrected figure and the full three-part predicate: `A real user turn is a user record with NO tool_result block, NO isMeta flag, and some actual text; all three tests are needed, and dropping the isMeta one overcounts turns by about a quarter. MEASURED 2026-08-17 across all 5,902 transcripts on one machine: 160,388 records of type user yielded only 10,670 real user turns, 6.7 percent`.

- `grep -n "F263" tests/questions.jsonl` -> PASS: line 288 reads `"answer_key": "160,388 records of type user yielded only 10,670 real user turns"` with `"notes": "hooks.md Stop: real user turn needs no tool_result, no isMeta, and text; measured 6.7 percent"`. Corrected figure present, all three predicate parts present.

- `grep -n "160,388\|10,670\|6\.7 percent" P:\ClaudeExt\QuestionExtension\lib\transcript.mjs` -> PASS on the figure: line 18 reads `applying isRealUserRecord's own predicate below: 160,388 type:"user" records,` and line 20 reads `10,670 REAL user turns, i.e. 6.7 percent.` The header also carries `146,772 tool_result blocks` and `2,932 isMeta records` at line 19, both of which I reproduced. The three-part predicate is present in the file, at line 22 (`Counting without the isMeta test gives 13,598, overstating turns by about a quarter.`) and stated in full at line 79, the `isRealUserRecord` docstring: `A real user turn: type "user", not meta, carries no tool_result, has text.` See Issues item 1 for the one sentence in the same header block that was not updated.

- `grep -c "13,598\|13598\|8\.5 percent\|19 user records\|19 against 21\|21 tool_result"` run over each of the three artifacts -> PASS: `hooks.md 0`, `tests/questions.jsonl 0`. `transcript.mjs` returns two hits, and I read both rather than reporting a count: line 22, `Counting without the isMeta test gives 13,598, overstating turns by about a quarter.`, and lines 27 to 30, `An earlier version of this comment claimed "19 user records against 21 tool_result blocks". That does not reproduce ... The trap is real; that number was not. Do not cite it.` Neither asserts the old value. The first quantifies the size of the correction, and my run reproduces it at 13,603; the second is the retraction round 1 asked for, ending in an explicit do-not-cite. `8.5 percent` appears in none of the three. No artifact presents a retracted figure as current, and the three do not disagree on any number.

- `node -e` scan for all six banned dash code points (U+2011, U+2012, U+2013, U+2014, U+2015, U+2212) over the three artifacts -> PASS: `hooks.md 0`, `questions.jsonl 0`, `transcript.mjs 0`.

- `npm run verify` -> PASS: exit 0. `sources=44 claims=651 (attributed=651, unattributed=0) tagged-lines=651`, then `PASS: evidence ledger is internally consistent`. This is also what pins `evidence/claims.jsonl:651` (CLM-hooks-196) to the corrected bullet text byte for byte.

- `npm run test` -> PASS: exit 0. `TOTAL 288 288 0 100%` (anti-hallucination 25, factual 206, navigation 22, routing-negative 15, routing-positive 20), final line `PASS: 288 of 288 rows passed.` F263 with its new answer key is inside that 288.

- `npm run quotes` -> PASS: exit 0. `quote-check: 39 verbatim quote(s) from 7 reference file(s)`, then `PASS every verbatim quote still appears upstream.` The one self-reported PARTIAL COVERAGE line is the pre-existing `permissions.md:30` abridged quote (dropped `["instead."]`), unrelated to this change and not affecting exit status.

- `npm run numbers` -> PASS: exit 0. The section `Documentation statements that disagree:` reads `none`.

- `npm run verify:prove-fail` -> PASS: exit 0. `EVIDENCE LEDGER GATE CAN FAIL: all 6 mutants were rejected by the gate that names them.`

- `npm run test:prove-fail` -> PASS: exit 0. `TOTAL 288 15 273 5%`, then `prove-fail: 273/273 positive assertions correctly went RED.` and `PASS: the suite is not self-certifying.`

- `npm run numbers:prove-fail` -> PASS: exit 0. `GATE CAN FAIL: every known-bad source was rejected.`

- `node tools/rekey-claims.mjs` (DRY RUN, no `--write`) -> PASS: exit 0. `extracted 651 tagged claims`, `ledger 651 claims, references now carry 651 tagged lines`, `unchanged 651`, `moved 0`, `vanished 0`, `new 0`. Both spec conditions met: `vanished 0` and `new 0`.

- `node P:\ClaudeExt\QuestionExtension\test\run-tests.mjs` -> PASS: exit 0, final line `PASS  48/48 rows.` Zero failures, zero errors, no stderr. The rows that exercise the edited file's behaviour are all present and green: `turn boundary: tool_result carriers do not end the turn`, `turn boundary: prior turn deferral is not re-blocked`, `partial first line: tail read starts mid-record`, `large transcript: bounded tail read, flat RAM, fast`, `empty transcript: zero-byte file`, `missing file: transcript_path does not exist`.

- Comment-only edit confirmed (`ls -la --time-style=long-iso` plus `wc -l` over the hook tree, cross-referenced against the line numbers round 2 recorded) -> PASS: `lib/transcript.mjs` is the only file with a post-review mtime (2026-08-17 21:14); `ask-question-guard.mjs`, `lib/detect.mjs` and `lib/state.mjs` are all still 2026-07-27, and `test/run-tests.mjs` is still 2026-08-02, so the 48-row suite population itself was not touched and no row could have been silently dropped. The file went from the 151 lines round 2 recorded to 153, and every code line round 2 cited has shifted by exactly +2: the `readTail` body cited at :38 to :42 is now :40 to :44, `Parse JSONL leniently` at :51 is now :53, and the `isRealUserRecord` filter at :81 to :87 is now :83 to :89. A uniform +2 below the header block is what a two-line comment insertion looks like, and nothing else moved.

## Issues found

1. **Minor, and not a number error: the round-2 fix was applied to two of the three artifacts and only half-applied to the third.** `lib\transcript.mjs` lines 23 to 24 still read `A REAL user turn is a type:"user" record carrying no tool_result block and some actual text.` That is the two-part definition, the exact wording round 2 flagged, and it sits two lines below line 22, which says the isMeta test is precisely what separates 10,670 from 13,598. A reader who implements the sentence at :23 literally lands on 13,603 (my measured value for that predicate), not on the 10,670 printed three lines above it. `hooks.md:196` fixed its parallel sentence (`NO tool_result block, NO isMeta flag, and some actual text; all three tests are needed`) and F263's notes fixed theirs (`no tool_result, no isMeta, and text`); the upstream comment's own definitional sentence did not. The file is not wrong on balance, because line 18 points the reader at `isRealUserRecord` explicitly, line 22 names the isMeta test, and the docstring at line 79 states all three parts correctly. It is one internally inconsistent sentence sitting in the source the other two artifacts derive from. The fix is one line, and is what round 2 already suggested: make :23 read `carrying no tool_result block, no isMeta flag, and some actual text`. No gate can catch this, because the number it accompanies is correct.

2. **Informational, no action needed.** The absolute counts in all three artifacts are a snapshot of a population that grows every session: one day on it is already 5,903 files and 160,409 user records. Round 2 and I both measured upward drift under 0.02 percent, and the ratio (6.65 against the published 6.7 percent, and 14/15) is the stable, durable part. `hooks.md` now carries `MEASURED 2026-08-17` inline, which is the mitigation and is already applied, and `transcript.mjs:17` carries the same date. Recorded only so a later reader does not mistake the drift for a discrepancy.

Nothing else. Every figure agrees across the three artifacts, no retracted value is asserted anywhere, all eight gates exit 0, the rekey dry run is clean at `vanished 0` and `new 0`, and the live hook suite is green at 48/48 with the guard's own transcript-boundary rows included.

## Verdict: PARTIAL
