# Review: five OFFICIAL findings adopted from the docs checks
Reviewer: independent subagent

Run fresh from `P:\ClaudeExt\ccx-engineering-work`, branch `docs-check-adoptions`, head `8da2d29`.
Working tree clean before and after every check. Mirror read at
`P:\ClaudeExt\CCX-Extension-Research\sources\docs\md` (191 pages).

## Checks executed

- **1. Nine gates** -> PASS: all nine exited 0. `verify` printed
  `sources=44 claims=657 (attributed=657, unattributed=0) tagged-lines=657` and
  `PASS: evidence ledger is internally consistent`. `test` printed `TOTAL 295 295 0 100%` and the
  required line `PASS: 295 of 295 rows passed.` `quotes` printed
  `42 verbatim quote(s) from 8 reference file(s)` against `191 mirrored page(s)` and
  `PASS every verbatim quote still appears upstream.` `numbers` reported no disagreeing
  documentation statements. `facts` printed `PASS  1 fact(s) consistent across 5 artifact reads.`
  The four prove-fail gates each reported their must-fail set rejected:
  `EVIDENCE LEDGER GATE CAN FAIL: all 6 mutants were rejected by the gate that names them.`,
  `prove-fail: 280/280 positive assertions correctly went RED.`,
  `GATE CAN FAIL: every known-bad source was rejected.`, `PASS  8/8 self-test rows.`
  Logs kept at `tmp/review/gate_*.log`.

- **2. rekey dry run** -> PASS: `node tools/rekey-claims.mjs` with no `--write` printed
  `extracted 657 tagged claims`, `unchanged 657`, `moved 0`, `vanished 0`, `new 0`, then
  `dry run. Re-run with --write to apply.` `git status --porcelain` was empty afterwards, so the
  dry run wrote nothing.

- **3. Attribution** -> PASS: all four ids are present in `evidence/claims.jsonl` (657 rows, no
  duplicate ids), each with `status` `attributed` and the required source.
  `CLM-subagents-125` -> `SRC_SUBAGENTS` at subagents.md:125.
  `CLM-subagents-126` -> `SRC_SUBAGENTS` at subagents.md:126.
  `CLM-hooks-249` -> `SRC_AGENT_SDK` at hooks.md:249.
  `CLM-permissions-032` -> `SRC_PERMISSIONS` at permissions.md:32.
  Extra evidence beyond the spec: a semantic diff of the ledger between `main` and `HEAD`, keyed on
  text plus source plus status plus file, shows 0 removed and exactly 4 added. So the 110 changed
  lines in `claims.jsonl` are those 4 additions plus pure line renumbering (22 ids retired, 26
  minted), with no existing claim silently rewritten or dropped.

- **4. Rows F266 to F270** -> PASS: all five exist in a 295-row `tests/questions.jsonl`. Each
  `answer_key`, compiled as a case-insensitive `RegExp` and tested against the raw bytes of that
  row's own `source_file`, matched. F266 matched "It DEFAULTS TO inherit" at index 4489 of
  `references/subagents.md`. F267 matched the resolution-order fragment at index 8739 of the same
  file. F268 matched "only the relevant summary returns to your main conversation" at index 9567.
  F269, whose key carries a literal `\s+`, matched "ABSENT until the first user input" at index
  22298 of `references/hooks.md`. F270 matched "matches the alias opus but not a full model ID" at
  index 4242 of `references/permissions.md`.

- **5. model default, mirror `sub-agents.md` line 289** -> PASS. Mirror line 289, the `model` row of
  the supported-frontmatter table:

  > [Model](#choose-a-model) to use: `sonnet`, `opus`, `haiku`, `fable`, a full model ID (for
  > example, `claude-opus-5`), or `inherit`. Defaults to `inherit`

  Mirror line 309, in the "Choose a model" section:

  > **Omitted**: defaults to `inherit` and uses the same model as the main conversation

  Our row (`references/subagents.md:56`) lists exactly the same accepted values, dropping only the
  parenthetical example, which is a subset and not an addition, and states the `inherit` default.
  The added gloss, that omitting the field is a decision to run on the caller's model rather than
  the absence of one, is supported by line 309. SUPPORTED, and it does not claim more than the
  page. One wording imprecision is filed under issue 2 below; it is not load bearing here.

- **6. Resolution order, mirror `sub-agents.md` lines 310 to 325** -> FAIL, on the final clause
  only. Three of the four things the spec asks for are squarely supported.

  Order, mirror lines 311 and 313 to 316:

  > When Claude invokes a subagent, it can also pass a `model` parameter for that specific
  > invocation. Claude Code resolves the subagent's model in this order:
  > 1. The [`CLAUDE_CODE_SUBAGENT_MODEL`](/docs/en/model-config#environment-variables) environment
  > variable, when set to a model alias or model ID
  > 2. The per-invocation `model` parameter
  > 3. The subagent definition's `model` frontmatter
  > 4. The main conversation's model

  The v2.1.196 change, mirror line 318:

  > As of v2.1.196, setting `CLAUDE_CODE_SUBAGENT_MODEL` to `inherit` is the same as leaving it
  > unset: resolution continues with the per-invocation `model` parameter, then the frontmatter. In
  > earlier versions, `inherit` forced subagents onto the main conversation's model and ignored both
  > of those sources.

  Substitution, mirror line 320:

  > Claude Code checks the environment variable, per-invocation parameter, and frontmatter values
  > against your organization's [`availableModels`](/docs/en/model-config#restrict-model-selection)
  > allowlist. For a blocked value, it substitutes another model:

  followed by lines 322 and 323 giving the two substitution branches. So the "three sources" count
  is exact, and "SUBSTITUTED rather than refused" is genuinely documented rather than inferred.

  OVERSTATEMENT: our bullet ends "a blocked value is SUBSTITUTED rather than refused, which fails
  quietly". The page says the opposite for the case it addresses. Mirror `sub-agents.md` line 325:

  > In interactive sessions, Claude Code shows a warning naming the requested model and the model
  > the subagent runs on, for either substitution.

  Corroborated by mirror `model-config.md` line 181:

  > **Subagent or teammate override**: Claude Code falls back to the
  > [subagent's inherited model](/docs/en/sub-agents#choose-a-model) or the default teammate model
  > rather than failing the request. In interactive sessions, Claude Code warns you when it
  > substitutes a subagent's model, by this fallback or by the newest-permitted-version substitution
  > above, naming the requested and substituted models; it doesn't report a teammate's fallback.

  I then scanned both pages in Node (not grep, which aborts here) for silence wording matching
  `silent|quiet|without (a )?(warning|notice)|no warning`. `sub-agents.md` has exactly one hit,
  line 1045, about typing `/model` in a fork view, unrelated. `model-config.md` has exactly one hit,
  line 330, where the docs DO write that an effort clamp "applies silently" outside interactive and
  plain-text runs. So the documentation has a vocabulary for unannounced behaviour, uses it
  elsewhere, and did not use it for this substitution; it stated a warning instead. "Fails quietly"
  is an inference at best and a contradiction of line 325 for interactive sessions, carried under an
  [OFFICIAL] tag. Against this spec's own criterion, "FAIL if our bullet claims more than the page",
  the check fails. Concrete fix: delete "which fails quietly", or replace it with what the page
  says, for example "and in interactive sessions Claude Code warns, naming the requested and
  substituted models".

- **7. Result returns to the caller, mirror `sub-agents.md` near line 834** -> PASS, compared
  PROGRAMMATICALLY rather than by eye. I pulled the double-quoted span out of
  `references/subagents.md:126` and tested it with `String.prototype.includes` against the raw
  mirror text with NO normalisation of any kind: no whitespace collapsing, no smart-quote folding,
  no emphasis stripping. That is deliberately stricter than `tools/quote-check.mjs`, which
  normalises all three. The 116-character span "the verbose output stays in the subagent's context
  while only the relevant summary returns to your main conversation" is a character-exact substring
  of `sub-agents.md` at line 834, and of no other page in the 191-page mirror. A codepoint dump
  confirms every character is ASCII, so the apostrophe question does not arise. Mirror line 834:

  > One of the most effective uses for subagents is isolating operations that produce large amounts
  > of output. Running tests, fetching documentation, or processing log files can consume significant
  > context. By delegating these to a subagent, the verbose output stays in the subagent's context
  > while only the relevant summary returns to your main conversation.

  The surrounding sentence supports the claim built on it: delegation isolates the verbose output
  and the summary is what returns. SUPPORTED, no overstatement.

  Method control: 8 must-fail cases ran alongside and all 8 behaved (`CONTROL PASS`). A one-word
  mutation, a one-character mutation, a stripped backtick, a typographic apostrophe swap and a
  leading-letter case change were each correctly reported as NOT present, while the three real
  quotes were present. The comparison can fail, so a pass from it means something.

- **8. stdin fields, mirror `agent-sdk__typescript.md` `BaseHookInput` near line 1611** -> PASS.
  Mirror lines 1611 to 1620 give the type in full:

  > type BaseHookInput = { session_id: string; transcript_path: string; cwd: string;
  > prompt_id?: string; permission_mode?: string; effort?: { level: string }; agent_id?: string;
  > agent_type?: string; };

  All five fields the spec names are in that type: `permission_mode`, `effort`, `prompt_id`,
  `agent_id`, `agent_type`. `effort` is an object carrying `level`, exactly as our prose says.
  Mirror line 1623 supports all three specific `prompt_id` claims in one sentence:

  > The `prompt_id` field is a UUID identifying the user prompt currently being processed. It
  > matches the [`prompt.id` attribute on OpenTelemetry
  > events](/docs/en/monitoring-usage#event-correlation-attributes) and is absent until the first
  > user input. Requires Claude Code v2.1.196 or later.

  Our quoted span "a UUID identifying the user prompt currently being processed" is a
  character-exact substring of that line under the same unnormalised comparison used in check 7,
  and appears on no other mirror page.

  Scope note the reviewer was asked to test rather than assume. Attribution to `SRC_AGENT_SDK`
  (`https://code.claude.com/docs/en/agent-sdk/overview`) rather than `SRC_HOOKS`
  (`https://code.claude.com/docs/en/hooks`) is correct, and for the quoted fragment it is uniquely
  correct: the CLI hooks page phrases the same fact as "UUID identifying the user prompt currently
  being processed" without the leading "a", which is why the quoted string resolves only to the SDK
  page. The CLI hooks page does NOT contradict the SDK reference on any of the five fields; it
  corroborates them. `hooks.md` line 705 gives `prompt_id` with the same three properties (matches
  the OpenTelemetry `prompt.id` attribute, "Absent until the first user input", "Requires Claude
  Code v2.1.196 or later"). Line 708 gives `permission_mode` and adds "Not all events receive this
  field". Line 709 gives `effort` as an "Object with a `level` field". Line 717 gives `agent_type`.
  No disagreement found. One framing observation is filed as issue 3.

- **9. Parameter matching, mirror `permissions.md` near line 110** -> PASS, compared
  programmatically as in check 7. Our 48-character quoted span, backticks included, is a
  character-exact substring of `permissions.md` at line 110 and of no other mirror page. Mirror
  line 110:

  > * The value is compared against the literal input Claude sends, before any normalization.
  > `Agent(model:opus)` matches the alias `opus` but not a full model ID. Run with
  > [`--verbose`](/docs/en/cli-reference) to see the exact parameter names and values in each tool
  > call

  That one line also supports our closing `--verbose` sentence. The one-parameter-per-rule point is
  mirror line 107:

  > * Each rule names one parameter. To gate on both `model` and `isolation`, write two rules,
  > `Agent(model:opus)` and `Agent(isolation:worktree)`, rather than combining them in one rule

  SUPPORTED, no overstatement. The gloss "a rule written for one form silently fails to match a
  dispatch that used the other" is a restatement of "does not match", and unlike check 6 nothing on
  the page contradicts it.

- **10. Scope** -> PASS: `git diff --name-only main...HEAD` returns exactly eight paths and no
  others: `.md/20260818-docs-adoptions_verify.md`, `.md/20260818-quote-completion_review.md`,
  `docs/RESULTS.md`, `evidence/claims.jsonl`,
  `skills/claude-code-extension-engineering/references/hooks.md`, the same directory's
  `permissions.md` and `subagents.md`, and `tests/questions.jsonl`. The two extra files are both
  under `.md/`, which the spec allows. `git status --porcelain` is empty, and `tmp/.gitignore`
  contains `*`, so my scratch scripts under `tmp/review/` are not in the diff.

## Issues found

1. **BLOCKING, check 6.** `references/subagents.md:125` ends "a blocked value is SUBSTITUTED rather
   than refused, which fails quietly", under [OFFICIAL] [v2.1.196]. Mirror `sub-agents.md:325`
   states the opposite for interactive sessions ("Claude Code shows a warning naming the requested
   model and the model the subagent runs on, for either substitution"), and `model-config.md:181`
   says the same. No page in the mirror says this substitution is unannounced, and
   `model-config.md:330` shows the docs write "applies silently" explicitly when they mean it.
   Everything else in the bullet (the four-source order, the v2.1.196 inversion, the three checked
   sources, substitution rather than refusal) is accurately sourced. Remove or replace the final
   clause, or move it out from under the OFFICIAL tag.

2. **Minor, non-blocking, wording.** `references/subagents.md:56` says omitting `model` runs the
   subagent on "the caller's model", and line 126 says "The RESULT is charged to the CALLER". The
   mirror consistently says "the main conversation" (lines 309, 316, 834). The two coincide for a
   subagent spawned from the main conversation but not for a nested one, where mirror line 316 makes
   the fourth resolution source the main conversation's model rather than the immediate parent's.
   `caller` is house terminology in this file (3 uses), so this is a consistency note, not a factual
   overstatement.

3. **Minor, non-blocking, framing.** `references/hooks.md:144` says "The SDK reference documents
   three more that are easy to miss", and line 249 says the three fields "sit outside the common
   set". On the CLI hooks page all three sit INSIDE a table headed "Common input fields"
   (`hooks.md` lines 702 to 710). The claim is defensible read against our own line 143 list and
   against behaviour, since the page itself qualifies `permission_mode` with "Not all events receive
   this field" and `effort` with "Present for events that fire within a tool-use context". But a
   reader can take "the SDK reference documents three more" to mean SDK only, which the CLI hooks
   page contradicts. Consider naming both surfaces.

4. **Minor, non-blocking, documentation.** `docs/RESULTS.md` moved its headline from 290 to 295 and
   the `numbers` gate is green, but the narrative below still enumerates only the earlier additions
   (sixteen on 2026-08-13, twenty-two on 2026-08-17, then six, then two). The five new rows F266 to
   F270 are not accounted for in that prose. Outside the spec's checks; recorded because that
   paragraph is the repo's own audit trail for the count.

## Verdict: PARTIAL

Nine of ten checks passed against evidence I produced myself. Check 6 fails on the clause "which
fails quietly", which the mirror contradicts for interactive sessions and nowhere supports. That is
exactly the overstatement-under-an-OFFICIAL-tag failure mode these checks exist to catch, and it is
a one-clause fix. Nothing else in the change is unsupported: the verbatim quotations, three of them
counting the `prompt_id` fragment, are character-exact substrings of the named mirror pages under an
unnormalised comparison whose must-fail control passed; the `SRC_AGENT_SDK` attribution for the
hooks claim is correct and uncontradicted by the CLI hooks page; and the diff is in scope with no
silent edits to the existing ledger.
