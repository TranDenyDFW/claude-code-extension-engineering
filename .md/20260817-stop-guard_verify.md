# Verification spec: three Stop-hook guard mechanics added to references/hooks.md

Run everything from `P:\ClaudeExt\ccx-engineering-work`. Branch under review is
`hooks-stop-guard-mechanics`; compare against `main` where a check says so.

Every numeric threshold below was observed on a real run before this spec was written. If your run
disagrees with a stated number, that is a FAIL, not a spec error to be worked around.

## Changes to verify (independently)

- `skills/claude-code-extension-engineering/references/hooks.md` gained three bullets in the Stop
  section, concerning how a blocked Stop hook can be satisfied, what `stop_hook_active` can and
  cannot express, and what reading the transcript involves.
- `evidence/claims.jsonl` gained three attribution records.
- `tests/questions.jsonl` gained three rows.
- `docs/RESULTS.md` suite count changed.

## Checks (run each FRESH; do not trust prior output)

1. `npm run verify`
   - PASS if: exit code 0
   - FAIL if: any non-zero exit

2. `npm run test`
   - PASS if: exit 0 AND the final line reads `PASS: 288 of 288 rows passed.`
   - FAIL if: non-zero exit, or any row count other than 288 of 288

3. `npm run quotes`
   - PASS if: exit 0
   - FAIL if: non-zero exit. Note this gate treats a double-quoted span as a verbatim quotation that
     must trace to a source, so a failure here means prose punctuation was read as a citation.

4. `npm run numbers`
   - PASS if: exit 0
   - FAIL if: non-zero exit, in particular any reported disagreement between `docs/RESULTS.md` prose
     and the live suite size

5. `npm run verify:prove-fail`
   - PASS if: exit 0
   - FAIL if: non-zero exit

6. `npm run test:prove-fail`
   - PASS if: exit 0
   - FAIL if: non-zero exit

7. `npm run numbers:prove-fail`
   - PASS if: exit 0
   - FAIL if: non-zero exit

8. `node tools/rekey-claims.mjs` (DRY RUN, no `--write`)
   - PASS if: it reports `extracted 651 tagged claims`, `unchanged 651`, `vanished 0`, `new 0`
   - FAIL if: any non-zero value for `vanished` or `new`, or a different extracted total.
     A non-zero `new` means a tagged line in the references has no attribution record.

9. Attribution records. Run:
   `node -e "const fs=require('fs');const ids=new Set(['CLM-hooks-194','CLM-hooks-195','CLM-hooks-196']);for(const l of fs.readFileSync('evidence/claims.jsonl','utf8').split('\n')){if(!l.trim())continue;const r=JSON.parse(l);if(ids.has(r.id))console.log(r.id,r.source,r.status,JSON.stringify(r.tags));}"`
   - PASS if: exactly three lines print, each with source `LOCAL_ENV`, status `attributed`, and tags
     containing `ENGINEERING`
   - FAIL if: fewer than three, or any other source, status, or tag set

10. Test rows exist and their answer keys actually match. Run:
    `node -e "const fs=require('fs');const rows=fs.readFileSync('tests/questions.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>['F261','F262','F263'].includes(r.id));const body=fs.readFileSync('skills/claude-code-extension-engineering/references/hooks.md','utf8');for(const r of rows)console.log(r.id, new RegExp(r.answer_key,'i').test(body));"`
    - PASS if: three lines print and every one ends in `true`
    - FAIL if: fewer than three rows, or any `false`. A `false` means the test row asserts text that
      is not in the file, so the row would pass or fail for the wrong reason.

11. Banned dash characters in the changed files. Run:
    `node -e "const fs=require('fs');const bad=[0x2011,0x2012,0x2013,0x2014,0x2015,0x2212];for(const f of ['skills/claude-code-extension-engineering/references/hooks.md','evidence/claims.jsonl','tests/questions.jsonl','docs/RESULTS.md']){const s=fs.readFileSync(f,'utf8');console.log(f,[...s].filter(c=>bad.includes(c.codePointAt(0))).length);}"`
    - PASS if: every line reports `0`
    - FAIL if: any non-zero count

12. **Substantive check, the important one.** The three bullets claim things about how a real Stop
    hook works. Read the actual implementation, which is a DIFFERENT repository:
    - `P:\ClaudeExt\QuestionExtension\ask-question-guard.mjs`
    - `P:\ClaudeExt\QuestionExtension\lib\state.mjs`
    - `P:\ClaudeExt\QuestionExtension\lib\transcript.mjs`

    Then read the three new bullets in the Stop section of
    `skills/claude-code-extension-engineering/references/hooks.md` (they follow the bullet beginning
    `- Before diagnosing a Stop hook as broken`).
    - PASS if: each of the three claims is supported by something you can point to in that source.
      Specifically: that an escape sentinel exists and is a literal string matched against the
      reply; that per-session block state is keyed by the session id from stdin and its errors are
      swallowed; that the transcript is read as a bounded tail rather than whole, and that tool
      results appear as user-type records so a naive walk back to the nearest user record lands
      mid-turn.
    - FAIL if: any claim has no support in the source, or the source contradicts it. Quote the line
      you relied on for each.

12b. **Reproduce the measurement, do not accept it.** Bullet 196 states a measured figure: over all
    5,902 transcripts on this machine, 160,388 records of type user yielded only 10,670 real user
    turns, 6.7 percent. Reproduce it yourself by streaming every `.jsonl` under
    `C:\Users\Shake\.claude\projects\` (stream line by line; some files exceed 40 MB and the tree is
    multi-GB, so never read one whole into memory). Count records with `type == "user"`, count
    `tool_result` blocks inside them, and count REAL user turns, being user records with no
    tool_result block, NO isMeta flag, and some non-empty text. The isMeta test is part of the
    predicate; omitting it overcounts turns by about a quarter (13,598 instead of 10,670).
    - PASS if: your user-record and real-turn counts land within a few percent of 160,388 and
      10,670, the real-turn share is near 6.7 percent, and NO file has tool_result blocks
      outnumbering user records
    - FAIL if: the ratio is materially different, or any file has blocks outnumbering user records
    - CONTEXT, so you know why this check exists: the FIRST version of this bullet cited 19 user
      records against 21 tool_result blocks. That was transcribed from a source comment rather than
      measured, it requires blocks to outnumber user records, and it does not reproduce in ANY file:
      no record anywhere carries more than one tool_result block, which makes that relation
      structurally impossible rather than merely unobserved. An independent review caught it by trying to reproduce it. Do the same here
      rather than reading the sentence and agreeing with it.

13. **Provenance check.** The three claims are tagged `ENGINEERING`, meaning observed here rather
    than documented by Anthropic. Confirm they are not in fact official. Search the docs mirror at
    `P:\ClaudeExt\CCX-Extension-Research\sources\docs\md\` for whether it documents (a) any way for
    the model to satisfy a blocking Stop hook, (b) transcript JSONL record shapes, (c) tool results
    being carried as user-type records.
    - PASS if: none of the three is documented there, so `ENGINEERING` is the correct tag
    - FAIL if: any of them IS documented, which would mean the tag should be `OFFICIAL` and the
      claim should cite the page

14. **Scope check.** Confirm the change did not touch anything outside its stated scope:
    `git diff --stat main...HEAD`
    - PASS if: exactly six files changed, being `docs/RESULTS.md`, `evidence/claims.jsonl`,
      `skills/claude-code-extension-engineering/references/hooks.md`, `tests/questions.jsonl`,
      and the two review artifacts `.md/20260817-stop-guard_verify.md` and
      `.md/20260817-stop-guard_review.md`
    - FAIL if: any other file appears
    - OBSERVED, so you do not misread it as scope creep: `evidence/claims.jsonl` reports roughly
      649 deletions against 658 insertions on a 651-line file, i.e. the whole file. That is
      `tools/rekey-claims.mjs` rewriting the ledger with normalised line endings, not 649 edited
      records. The substantive change there is three added records plus 14 renumbered ids. Verify
      that claim with `git diff main...HEAD -- evidence/claims.jsonl | grep -c '^+'` against the
      content, or more directly by trusting check 8, which reports `vanished 0`: no claim text was
      lost. If you want the record-level truth, compare the id-and-text pairs on both sides rather
      than reading the line diff.

## Notes for the reviewer

- Run in `P:\ClaudeExt\ccx-engineering-work`. Node and npm are on PATH.
- The Bash tool resets its working directory between calls, so use absolute paths or re-`cd` in each
  command. A relative path that worked in one call is not guaranteed in the next.
- Do NOT write output to `/tmp`. On this machine Git Bash and Node resolve `/tmp` to different
  directories, and a write there can silently land somewhere the read never looks. Use
  `P:\ClaudeExt\ccx-engineering-work\tmp\` if you need a scratch file.
- Do not assume any check passes; observe actual output and exit codes.
- Check 12 is the one that decides whether this content is TRUE, as opposed to merely consistent.
  Weight it accordingly, and do not let seven green gates substitute for it.
