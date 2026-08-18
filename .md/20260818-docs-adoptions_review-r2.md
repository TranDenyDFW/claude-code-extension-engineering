# Review round 2: docs-check adoptions plus the claim-drift gate
Reviewer: independent subagent

Run fresh from `P:\ClaudeExt\ccx-engineering-work`, branch `docs-check-adoptions`, head `4d38f94`
("Add claim-drift gate: the ledger only ever certified 400 characters"), parent `cbec5e6`
("Adopt five findings from the docs checks"). Node v24.14.1. Mirror read at
`P:\ClaudeExt\CCX-Extension-Research\sources\docs\md`, 191 pages counted. `git status --porcelain`
was empty before the first check and empty after the last, and I re-ran all eleven gates on the
clean tree at the end to confirm my own experiments left nothing behind. I inherited no conclusion
from round 1: every mirror line below was re-read and every command below was executed by me.

## Checks executed

- **1. The overstatement (correction 1)** -> PASS. `references/subagents.md:125` now ends:

  > ... and a blocked value is SUBSTITUTED rather than refused: a blocked family alias runs on the
  > newest permitted version of that family, and anything else falls back to the inherited model.
  > The substitution IS announced, but only where someone is watching: in interactive sessions
  > Claude Code warns naming both the requested model and the one the subagent actually runs on

  The clause round 1 failed on is gone. `grep -rn "fails quietly" skills/ docs/ evidence/ tests/`
  returns no hit in any reference file: the only surviving occurrences are the ledger `note` on
  `CLM-subagents-125`, which deliberately records the correction, and four tier-3 fixtures about
  CLAUDE.md and fork isolation, which are unrelated subjects.

  Mirror `sub-agents.md` line 325, which the old clause contradicted and the new one now restates:

  > In interactive sessions, Claude Code shows a warning naming the requested model and the model
  > the subagent runs on, for either substitution.

  The scope qualifier survives the edit intact. Our sentence keeps the page's own qualifier, "in
  interactive sessions", rather than generalising the warning to every run; the gloss "only where
  someone is watching" is a reading of that qualifier, not an addition on top of it, and it is the
  reading `model-config.md` line 181 also takes:

  > **Subagent or teammate override**: Claude Code falls back to the subagent's inherited model or
  > the default teammate model rather than failing the request. In interactive sessions, Claude Code
  > warns you when it substitutes a subagent's model, by this fallback or by the
  > newest-permitted-version substitution above, naming the requested and substituted models; it
  > doesn't report a teammate's fallback.

  I re-ran the silence-vocabulary scan in Node rather than inheriting it. Matching
  `silent|silently|quiet|quietly|without a warning|no warning|unannounced` case-insensitively:
  `sub-agents.md` has exactly one hit, line 1045, about typing `/model` in a fork view;
  `model-config.md` has exactly one, line 330, about an admin effort cap. Neither is this
  substitution, and no mirror line anywhere says it goes unannounced. The rest of the bullet
  matches the page clause for clause: the four-source order at lines 311 and 313 to 316 (source 4
  is "The main conversation's model"), the v2.1.196 inversion at line 318, the three checked
  sources at line 320, and the two substitution branches at lines 322 and 323.

- **2. Caller versus main conversation (correction 2)** -> PASS, and the change is substantive.
  `references/subagents.md:56` now reads:

  > | model | `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit`. It DEFAULTS TO
  > `inherit`, so omitting the field is a decision to run on the main conversation's model rather
  > than the absence of one |

  Mirror `sub-agents.md` line 289:

  > | `model` | No | [Model](#choose-a-model) to use: `sonnet`, `opus`, `haiku`, `fable`, a full
  > model ID (for example, `claude-opus-5`), or `inherit`. Defaults to `inherit` |

  Mirror line 309:

  > * **Omitted**: defaults to `inherit` and uses the same model as the main conversation

  So "the main conversation's model" is now the page's own wording, not a synonym for it. That it
  is not cosmetic rests on two mirror lines. Line 316 makes the fourth resolution source "The main
  conversation's model", not the immediate parent's. Line 885 establishes that a nested subagent is
  the normal case rather than a hypothetical:

  > By default, a subagent can spawn subagents of its own, up to three layers below the main
  > conversation.

  For a subagent at depth 2 or 3 the caller IS another subagent, so "caller's model" and "main
  conversation's model" name different values, and only the second is what the page documents.
  Two uses of "caller" survive in the file, at lines 104 and 126, but neither is a model-resolution
  claim: both are about who pays for the returned payload, and line 126 quotes the mirror's own
  "returns to your main conversation" in the same sentence.

- **3. The hooks reattribution (correction 3)** -> PASS on the reframing, the source, and all three
  new presence assertions, each against its own mirror line.

  The old framing is gone: `grep -n "SDK reference documents"` and `grep -n "sit outside"` both
  return nothing in `references/hooks.md`. The intro at lines 142 to 145 now reads:

  > Every handler receives one JSON object on **stdin**. Common fields on every event:
  > `session_id`, `transcript_path` (JSONL), `cwd`, `hook_event_name`, plus `agent_id` and
  > `agent_type` inside a subagent. Also common, each with a presence condition: `permission_mode`,
  > `effort` (an object with a `level`) and `prompt_id`. See the Detail entry below for when each
  > is absent.

  That is the correct relationship to the CLI page, which carries `permission_mode`, `effort` and
  `prompt_id` inside the table headed "### Common input fields" at mirror `hooks.md` lines 698 to
  710. The ledger record is reattributed: `CLM-hooks-249` now has `"source":"SRC_HOOKS"`
  (`https://code.claude.com/docs/en/hooks`), where round 1 found `SRC_AGENT_SDK`, and its note
  states why. The reattribution is also now the only defensible one, because I confirmed every span
  the bullet asserts is present on `hooks.md` itself.

  Each new assertion against its own mirror line, all four verified by unnormalised
  `String.prototype.includes` across all 191 pages, no whitespace collapsing and no quote folding:

  `permission_mode` is not on every event. Mirror `hooks.md` line 708:

  > | `permission_mode` | Current [permission mode](/docs/en/permissions#permission-modes):
  > `"default"`, `"plan"`, `"acceptEdits"`, `"auto"`, `"dontAsk"`, or `"bypassPermissions"`. The
  > mode labeled **Manual** arrives as `"default"`, never as `"manual"`, so scripts that match
  > `"default"` keep working. Not all events receive this field. Check the JSON example in each
  > [hook event](#hook-events) section |

  The quoted span "Not all events receive this field" resolves to `hooks.md:708` and to no other
  page in the mirror.

  `effort` fires only in a tool-use context and reports a downgraded level. Mirror `hooks.md`
  line 709:

  > | `effort` | Object with a `level` field holding the active effort level for the turn: `"low"`,
  > `"medium"`, `"high"`, `"xhigh"`, or `"max"`. If the requested model effort exceeds what the
  > current model supports, this is the downgraded level the model actually used. Ultracode is not
  > a distinct level and reports as `"xhigh"`. The object matches the status line `effort` field.
  > Present for events that fire within a tool-use context, such as `PreToolUse`, `PostToolUse`,
  > `Stop`, and `SubagentStop`, when the current model supports the effort parameter. The level is
  > also available to hook commands and the Bash tool as the `$CLAUDE_EFFORT` environment
  > variable. |

  All three of our clauses land on that one line: the tool-use scope with the same four example
  events, the downgraded-level report, and `$CLAUDE_EFFORT`. Our "present only for" is narrower
  than the page's "Present for ... when ...", so it understates rather than overstates: it drops
  the page's second condition (that the model supports the effort parameter) instead of dropping a
  restriction.

  `agent_type` is present with `--agent` as well as inside a subagent. Mirror `hooks.md` line 712
  introduces the second table, and line 717 is the field itself:

  > When running with `--agent` or inside a subagent, two additional fields are included:

  > | `agent_type` | Agent name (for example, `"Explore"` or `"security-reviewer"`). Present when
  > the session uses `--agent` or the hook fires inside a subagent. For subagents, the subagent's
  > type takes precedence over the session's `--agent` value. ... |

  Our "not only the latter" is exactly what that line adds over `agent_id` on line 716, which says
  "Present only when the hook fires inside a subagent".

  The `prompt_id` clauses, mirror `hooks.md` line 705:

  > | `prompt_id` | UUID identifying the user prompt currently being processed. Matches the
  > [`prompt.id` attribute on OpenTelemetry events](/docs/en/monitoring-usage#event-correlation-attributes),
  > so you can correlate hook output with telemetry for a single prompt. Absent until the first
  > user input. Requires Claude Code v2.1.196 or later |

  Both quoted spans, "UUID identifying the user prompt currently being processed" and "Absent until
  the first user input", are character-exact substrings of that line. Note that the first now also
  resolves to `hooks.md:705`, not only to `agent-sdk__typescript.md:1623`, which is precisely why
  `SRC_HOOKS` is now a valid source for it.

  Method control, so a pass from the quote comparison means something: I mutated the newly added
  quote to `"Not all events receive this flag"` and ran `npm run quotes`, which went red with
  `NO LONGER FOUND UPSTREAM: hooks.md:249` and exit 1, then restored the file. The two new quotes
  are genuinely gated, not merely present. The gate's own count moved from round 1's 42 to 44,
  matching the two spans added.

- **4. RESULTS.md prose (correction 4)** -> PASS. `docs/RESULTS.md` now reads:

  > **295 questions (set v2), 100% pass.** ... Sixteen rows were added on 2026-08-13 alongside the
  > out-of-scope boundary table. Ten more were added on 2026-08-18, covering three Stop-hook
  > mechanics measured against a live production hook, two facts a refuted probe uncovered on the
  > way past, and five findings confirmed against the documentation mirror while resolving flagged
  > claims. Twenty-two were added on 2026-08-17 ...

  The internal arithmetic holds (3 + 2 + 5 = 10) and the rows exist. `tests/questions.jsonl` has
  295 lines on HEAD and 290 on `main`. The last ten ids and their subjects match the prose one for
  one: F261 (a wedged Stop hook), F262 (`stop_hook_active`), F263 (the transcript walk to a real
  user turn) are the three Stop-hook mechanics; F264 (top-level `additional_context`) and F265 (the
  event name is not in the environment) are the two facts from the refuted probe; F266 to F270 are
  the five mirror-confirmed findings that this branch adds. So the five rows round 1 found
  unaccounted for are now named, and the other five in that sentence are the ones already on `main`.
  The `numbers` gate re-derives `suite rows 295` live from the artifact and reports no disagreement.

- **5. Reproducing the blind spot (Half B premise)** -> PASS: rekey misses it AND claim-drift
  catches it. Target: `CLM-subagents-125`, a real claim whose transformed text is 978 characters.
  I replaced the phrase at offset 772, well past 400, reversing its meaning:

  before: `The substitution IS announced, but only where someone is watching: in interactive
  sessions Claude Code warns naming both the requested model and the one the subagent actually runs
  on`

  after: `The substitution is NEVER announced anywhere, and Claude Code shows no warning in any
  session naming the requested model or the one the subagent actually runs on`

  The script confirmed `first 400 chars IDENTICAL before/after: true`. Then:

  ```
  ===== REKEY DRY RUN =====
  extracted 657 tagged claims
  ledger 657 claims, references now carry 657 tagged lines
    unchanged 657
    moved     0   (line and id updated, source and note preserved)
    vanished  0   (text no longer in the file; NOT written, decide by hand)
    new       0   (tagged line with no attribution; add by hand)

  dry run. Re-run with --write to apply.
  rekey exit=0
  ===== CLAIM-DRIFT =====
  FAIL  CLM-subagents-125  skills/claude-code-extension-engineering/references/subagents.md:125
        claim text changed beyond the stored 400-char prefix
          stored 185dc6523b01... actual f3380d2ba110... (full length 957)

  1 claim(s) drifted. The ledger text pairing cannot see these.
  drift exit=1
  ```

  I also ran `npm run verify` while dirty: `PASS: evidence ledger is internally consistent`,
  exit 0. So a meaning-reversing edit to an OFFICIAL claim was invisible to BOTH the reconciliation
  and the ledger gate, and visible only to the new one. The blind spot is real and the gate closes
  it. After `git checkout -- skills/.../subagents.md`, `git status --porcelain` was empty and
  `node tools/claim-drift.mjs` printed `PASS  657 claim(s) match their full-text hash, not just the
  stored prefix.` at exit 0.

  Population, measured rather than quoted: 61 of 657 claims exceed 400 transformed characters,
  hiding 9,129 characters in total, mean 149.7 each. The longest is `CLM-compatibility-065` at
  1,177 characters.

- **6. The hash covers what it claims** -> PASS, proved by identity rather than by reading.
  `extract-claims.mjs` stores `line.trim().replace(/^[-|*\d.\s]+/, '').slice(0, 400)`;
  `claim-drift.mjs` exports `fullClaimText(line) { return line.trim().replace(/^[-|*\d.\s]+/, ''); }`
  which is the same expression with the slice removed. I verified that empirically over the whole
  ledger rather than by eye: for all 657 records, importing `fullClaimText` and `sha` from the
  module and re-running `extract()` from the extractor,

  ```
  ledger rows: 657 extracted: 657
  prefix transform mismatches (fullClaimText().slice(0,400) vs extractor text AND vs stored text): 0
  hash mismatches (sha(fullClaimText(raw)) vs stored text_sha256): 0
  ```

  So `fullClaimText(raw).slice(0, 400)` reproduces the extractor's stored text exactly for every
  record, which is what makes the hash a hash of the same string the ledger already pairs on,
  extended to its full length, and not some other string. One difference exists and is harmless:
  the extractor splits on `/\r?\n/` while `claim-drift` splits on `'\n'`, so on a CRLF file
  `claim-drift` sees a trailing `\r`; `.trim()` removes it before hashing, which is why the 657
  prefix comparisons above all match.

  I also confirmed the hash is anchored to unchanged content rather than to whatever happened to be
  on disk at backfill time. A full-text (not prefix) diff of every tagged claim line in the three
  touched reference files, `main` versus HEAD, shows four lines added and ZERO lines modified or
  removed. So no pre-existing claim had already drifted past character 400 before the hashes were
  minted.

- **7. Self-test integrity** -> PASS, and I checked the two named cases at the CLI level as well as
  in the self-test, because the self-test only asserts the counts. `node tools/claim-drift.mjs
  --self-test` prints 6 rows, all ok, exit 0, including:

  ```
    ok   a record with no stored hash is reported MISSING, not silently passed  (drift 0/0, missing 1/1)
    ok   an unreadable file is a FAILURE, not a pass  (drift 1/1, missing 0/0)
    ...
  PASS  6/6 self-test rows.
  ```

  That both are FAILURES and not passes is decided by `run()`, not by the self-test, so I forced
  each through the real entry point. Deleting `text_sha256` from `CLM-hooks-249` and running
  `npm run drift`:

  ```
  FAIL  1 record(s) carry no text_sha256, so drift past the stored
        prefix cannot be detected for them. Run --backfill.
          CLM-hooks-249
  exit=1
  ```

  Repointing the same record at a nonexistent file:

  ```
  FAIL  CLM-hooks-249  skills/claude-code-extension-engineering/references/does-not-exist.md:?  file in the ledger could not be read

  1 claim(s) drifted. The ledger text pairing cannot see these.
  exit=1
  ```

  `git checkout -- evidence/claims.jsonl` after each; tree empty; `npm run drift` green again. The
  other four self-test rows also behave: an unchanged claim passes, an edit beyond the prefix is
  caught, an edit inside the prefix is caught, and a vanished line is drift rather than a pass.

- **8. Every record has a hash** -> PASS. Parsing `evidence/claims.jsonl` in Node: 657 rows,
  `records missing text_sha256: 0`, and the key list on a row is
  `id,file,line,text,tags,versions,source,status,note,text_sha256`. On the clean tree
  `npm run drift` prints `PASS  657 claim(s) match their full-text hash, not just the stored
  prefix.` and exits 0. `main` carries 653 rows and 0 of them have the field, so the backfill
  covered the whole ledger in one pass.

- **9. All eleven gates** -> PASS. Every one exited 0, twice: once at the start and once again on
  the clean tree after all my mutation experiments, with `git status --porcelain` empty on both
  sides of the second run.

  ```
  verify exit=0            verify:prove-fail exit=0
  test exit=0              test:prove-fail exit=0
  quotes exit=0            numbers:prove-fail exit=0
  numbers exit=0           facts:prove-fail exit=0
  facts exit=0             drift:prove-fail exit=0
  drift exit=0
  ```

  Key lines. `verify`: `sources=44 claims=657 (attributed=657, unattributed=0) tagged-lines=657`
  then `PASS: evidence ledger is internally consistent`. `test`: `TOTAL 295 295 0 100%` and
  `PASS: 295 of 295 rows passed.`, which is the 295 the check asks for. `quotes`:
  `44 verbatim quote(s) from 8 reference file(s)` against `191 mirrored page(s)` then
  `PASS every verbatim quote still appears upstream.` `numbers`: `Documentation statements that
  disagree: none`. `facts`: `PASS  1 fact(s) consistent across 5 artifact reads.` `drift`:
  `PASS  657 claim(s) match their full-text hash, not just the stored prefix.` The five prove-fail
  counterparts each reported their must-fail set rejected: `EVIDENCE LEDGER GATE CAN FAIL: all 6
  mutants were rejected by the gate that names them.`, `prove-fail: 280/280 positive assertions
  correctly went RED.`, `GATE CAN FAIL: every known-bad source was rejected.`, `PASS  8/8 self-test
  rows.`, `PASS  6/6 self-test rows.` Logs kept at `tmp/r2/gate_*.log`.

- **10. rekey dry run** -> PASS. `node tools/rekey-claims.mjs` with no `--write`:
  `extracted 657 tagged claims`, `unchanged 657`, `moved 0`, `vanished 0`, `new 0`,
  `dry run. Re-run with --write to apply.`, exit 0. `git status --porcelain` empty afterwards, so
  the dry run wrote nothing.

- **11. Scope** -> PASS. `git diff --name-only main...HEAD` returns exactly eleven paths and no
  others: `.md/20260818-docs-adoptions_review.md`, `.md/20260818-docs-adoptions_verify.md`,
  `.md/20260818-quote-completion_review.md`, `docs/RESULTS.md`, `evidence/claims.jsonl`,
  `package.json`, `skills/claude-code-extension-engineering/references/hooks.md`, the same
  directory's `permissions.md` and `subagents.md`, `tests/questions.jsonl`, and
  `tools/claim-drift.mjs`. That is the permitted set: the three references, `docs/RESULTS.md`,
  `evidence/claims.jsonl`, `tests/questions.jsonl`, `package.json`, `tools/claim-drift.mjs`, and
  three files under `.md/`. `package.json` adds only the two `drift` scripts. My own scratch files
  live under `tmp/r2/`, which is ignored by `tmp/.gitignore` containing `*`, and they are not in
  the diff.

  Beyond the spec, so the 1,310 changed lines in `claims.jsonl` cannot hide anything: a semantic
  diff of the ledger keyed on text plus source plus status plus file gives `semantically removed:
  0  semantically added: 4`, the four being the new `SRC_HOOKS`, `SRC_PERMISSIONS` and two
  `SRC_SUBAGENTS` records. The rest of the churn is the `text_sha256` field arriving on every row.

## Issues found

1. **Real, pre-existing, NOT introduced by this branch, and outside the eleven checks.**
   `docs/RESULTS.md` publishes a stale number that the `numbers` gate cannot see, for the same
   structural reason Half B just fixed elsewhere: the gate scans line by line, and the claim is
   split across a hard wrap. Lines 55 and 56 read

   > ... which guts every source file and confirms all
   > 247 positive assertions go red.

   while the live value is 280, printed by the gate itself (`positive assertions  280`) and by
   `test:prove-fail` (`prove-fail: 280/280 positive assertions correctly went RED.`). The rule at
   `tools/coverage-report.mjs:404` is `/all\s+(\d+)\s+positive assertions/gi` and `\s+` matches the
   newline, but the scan at line 727 is `lines.forEach(...)`, so the regex is never offered a
   string containing both halves. I proved the mechanism rather than inferring it: joining those
   two lines into one, with the value untouched at 247, makes the gate report
   `docs/RESULTS.md:55  positive assertions: doc says 247, live is 280` and exit 1. File restored;
   tree clean.

   I then ran this over the full population rather than a sample. I built a dewrapped mirror of all
   41 files the gate scans, ran it with `COVERAGE_DOC_ROOT` pointed at the mirror, and got exactly
   one disagreement: this one. So the exposure is bounded at a single stale number, but the hole is
   general, and it is the same defect class the branch just closed for claims (a gate that silently
   certifies only part of what it appears to cover). The gate's own comment at line 400 says this
   phrasing "can only be a claim about CURRENT state", so it is not a historical quote. Suggested
   fix: correct 247 to 280, and flatten each file's whitespace per paragraph before applying the
   FACTS regexes, the way the allowlist logic at line 635 already does.

2. **Minor, a comment nit inside the new tool.** The header of `tools/claim-drift.mjs` says
   "MEASURED 2026-08-18: 62 of 657 claims are stored truncated, hiding 9,129 characters, mean 149
   per affected claim." I measure 61 claims longer than 400 transformed characters, hiding 9,129
   characters, mean 149.7. The character total and the mean both match 61, so the count is the odd
   one out: 62 is the number of rows whose stored `text` is exactly 400 characters long, one of
   which is exactly 400 and therefore not truncated. Nothing downstream reads the number; it is
   worth a one-character fix because it sits in the file that exists to stop numbers rotting.

3. **Minor, non-blocking, an inference not covered by the three assertions I was asked to check.**
   `references/hooks.md:249` says `prompt_id` is absent until the first user input "so a
   SessionStart handler never sees it". The mirror supports the premise (line 705) and its
   SessionStart JSON example at lines 1075 to 1082 omits `prompt_id`, which corroborates it. But
   "never" is ours: mirror line 1065 says SessionStart receives the common input fields plus its
   own four and excludes nothing, and the SessionStart matcher table at lines 1053 to 1059 includes
   `compact`, which fires mid-session after user input has occurred. This is materially weaker than
   the round-1 failure, since nothing on the page contradicts it, but it is an absolute derived from
   a relative statement, carried under an `[OFFICIAL]` tag.

4. **Minor, non-blocking, framing.** The same bullet opens "Four common stdin fields carry a
   PRESENCE CONDITION". Three of them are in the mirror's "Common input fields" table; `agent_type`
   is in a separate table introduced at line 712 as "two additional fields". Read against our own
   flat list in the paragraph above, which does include `agent_type`, the sentence is accurate; read
   as a claim about the CLI page's structure it is one field too generous. It does not assert the
   page's table membership, so I did not fail it.

## Verdict: PASS

All eleven checks passed against evidence I produced myself. The four corrections are real fixes
rather than rewordings: the "fails quietly" clause is gone and replaced with the page's own
interactive-sessions sentence, the model row now uses the mirror's "main conversation" wording,
which differs from "caller" for the nested subagents the mirror documents at three layers deep, the
hooks bullet is reframed to sit inside the common set and reattributed to `SRC_HOOKS` with each of
its three new presence conditions landing on its own mirror line, and the RESULTS.md prose now names
all ten rows dated 2026-08-18. The claim-drift gate is not a gate that cannot fail: I reproduced the
blind spot with a meaning-reversing edit at offset 772 of a 978-character claim, watched both
`rekey-claims` and `verify` pass it, watched `claim-drift` catch it, and forced its missing-hash and
unreadable-file branches through the real CLI to confirm both exit non-zero. `fullClaimText` is the
extractor's transform minus the slice, verified by reproducing the stored 400-character text from it
for all 657 records.

The one finding worth acting on is not in this branch's diff: `docs/RESULTS.md` still publishes 247
positive assertions against a live 280, and the `numbers` gate misses it only because the sentence
wraps. It is the same shape of hole this branch just closed for claim text, still open one artifact
over.
