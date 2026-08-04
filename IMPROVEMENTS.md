# Known gaps

Open items, ranked by whether they block use, block discovery, or are cosmetic. Each one
names a file and line where it applies so it can be checked rather than taken on trust.
Resolved items keep their entry, struck through, so the history stays auditable.

Last reviewed 2026-08-04 against Claude Code 2.1.220.

---

## Blocks use

**1. ~~Fifteen of nineteen source rows are unverified.~~ RESOLVED 2026-07-29.**
All 15 external sources were fetched live, spot-checked against 2 or 3 claims each, and
dated. The ledger is now `evidence/sources.json` (machine-readable, with spot-check
records) plus the regenerated `references/sources.md`. Two upstream page titles drifted
without their URLs changing (the memory page, the hooks guide); recorded in the ledger.
The verification pass also caught and fixed a wrong claim in `hooks.md` (over-cap hook
output is file-saved with a preview, not truncated).

**2. ~~No staleness signal and no CI.~~ RESOLVED 2026-07-29; validation gate hardened 2026-07-30.**
`.github/workflows/freshness.yml` runs daily, on push, and on demand: compares
`evidence/VERIFIED_VERSION` against the latest npm release, runs the deterministic suite,
the prove-fail inversion, and the evidence-ledger gate, and opens an idempotent
"verification required" issue with the changelog entry when Claude Code moves ahead. The
README badge reads `evidence/status.json`.
An external audit found the original plugin-validation step was not a gate: it carried
`continue-on-error: true`, and its warning check was a backwards boolean that accepted an
unexpected warning arriving alongside the known version advisory. Both fixed 2026-07-30:
the logic moved to `tools/check-validate-output.mjs` (set subtraction, fail-closed on
unclassifiable output) with a `--self-test` of nine fixtures, grown from six as the gate met
real failures (the must-fail counterexample, then Linux glyph rendering, then the
substring-match hole an independent review found), run in CI before use, and
`continue-on-error` removed. The armed gate
immediately caught a real defect: the skill's own frontmatter had been unparseable since
authoring (unquoted colon in the description), meaning the skill ran with empty metadata;
see item 19.

**3. ~~Two claims are self-declared as unverified and stay that way.~~ RESOLVED 2026-07-31.**
Both measured on 2.1.219 with observation records carrying reproductions.
`additionalContext` on `PostToolUseFailure`: honoured, 3 of 3 headless runs delivered the
marker as a system-reminder attached to the failed tool result, with the bonus finding
that a permission denial does not fire the event at all
(`evidence/observations/ptuf-additionalcontext-2.1.219.json`). Nesting ceiling: depth 3,
enforced structurally, the third-level agent simply has no Agent tool
(`evidence/observations/subagent-nesting-ceiling-2.1.219.json`). Both reference files now
state the measured behaviour; suite rows A002 and A004 updated to match. Still open from
the same family: `continueOnBlock` outside PostToolUse remains unmeasured.

**4. ~~Nine claims are explicitly unattributed in the evidence ledger.~~ RESOLVED 2026-07-31.**
Added `SRC_AGENT_SDK` (the Agent SDK docs, reached through a three-hop redirect chain from
the old /docs/en/sdk URL) and `SRC_OUTPUT_STYLES` (which also verified the nested
closest-wins plugin claim), both fetched live with spot checks recorded in
`evidence/sources.json`. All 255 claims now carry an attributed source. Unattributed
remains a legal status in the ledger for honest future gaps; it is simply empty today.

---

## Blocks discovery

**5. ~~No `.claude-plugin/marketplace.json`.~~ SUPERSEDED by item 9.**
Resolved 2026-07-29 (both manifests shipped, installable via `/plugin marketplace add`),
then deliberately reverted 2026-07-30: `marketplace.json` was removed while the community
submission is in review, so this entry's resolved state no longer describes the repo. The
skill still lives under `skills/claude-code-extension-engineering/` for component
auto-discovery; current install paths are in item 9 and the README.

**6. ~~Pinned 1.0.0 version blocking updates.~~ RESOLVED 2026-07-29.**
Version removed from both manifests; the commit SHA is now the effective version, so
pushes reach installed users. Known catch, documented in `plugins.md`: this model cannot
pass `validate --strict`, so CI gates on plain validate plus an assertion that the
version advisory is the only warning.

**7. ~~Zero GitHub topics, no homepage.~~ RESOLVED 2026-07-29.**
Eight topics set, homepage set.
Note for anyone reproducing this: the `gh repo view` JSON field is `repositoryTopics`,
not `topics`, on gh 2.88.1.

**8. ~~README leads with the index instead of the payoff.~~ RESOLVED 2026-07-29.**
Restructured: value proposition, five concrete traps, the plugin-dev comparison, the
30-second decision guide, measured results, then install and index.

**9. Community-marketplace listing pending review.**
Submitted 2026-07-30 via the in-app form. The self-hosted `.claude-plugin/marketplace.json`
was removed the same day, deliberately, until the review lands, so the interim install
paths are `--plugin-dir` or the plain-skill copy (both in the README). Approval shows up
as the plugin name appearing in the `anthropics/claude-plugins-community` catalog, which
syncs nightly, so approval and installability are not the same moment. Restoring the
self-marketplace later is a one-commit revert if ever wanted.

---

## Cosmetic or structural

**10. ~~Duplicate-title sections.~~ RESOLVED 2026-08-02.**
All three renamed to describe their actual content: `mcp.md` and `lsp.md` became testing
headings, and `agent-teams.md` became `## Choosing a team over subagents` because its
content is selection guidance, not testing. This item's own wording was wrong on that
third case, and the rename followed the content rather than the description. No anchor
link or answer key targeted the old heading text; both were checked first.

**11. ~~HTML entities in the metadata line.~~ RESOLVED 2026-08-02.**
All 39 occurrences across 17 of the 21 reference files replaced with a plain pipe
separator. Zero remain. The main consumer of these files is a model reading raw text, so
the markup bought nothing.

**12. ~~Two answer keys in question set v1 test half their question.~~ RESOLVED 2026-07-31 in set v2.**
`F048` keyed only on `20 concurrent`; `F057` only on `MAX_MCP_OUTPUT_TOKENS`. In v2 both
ids were retired (not renumbered, so historical tables stay accurate) and F172 to F175
carry the four facts as separate rows. Keys were never retuned in place, preserving the
published v1 numbers.

**13. ~~Tier 1 matches file-wide, not line-wide.~~ CLOSED 2026-08-02, with a named residue.**
A key is asserted to appear somewhere in its file rather than in the passage it guards, so
a row could survive deletion of what it protects. Measured rather than assumed: 41 of 174
keys matched more than once; 133 were already unique. All 30 genuinely ambiguous keys were
rescoped to phrases verified unique in their file before committing, joining `F104` and
`F078` from v2. Five were gut-tested by deleting only the guarded passage: each turned
exactly its own row red and nothing else.

The residue is **2 rows**, and the path to that number is worth recording because the first
answer was wrong. It was initially claimed as 11 "intentional" rows. An independent review
rejected that on two counts, correctly:

- The count was stale. Item 15's own content additions in the same commit added a second
  occurrence of `PURE LITERAL` to `workflows.md`, silently reopening `F063` and making the
  true count 12. One fix quietly broke another, and only a human reader caught it.
- Nine of the eleven were a scoping defect wearing an intention's clothes. The `R` routing
  rows were said to test the SKILL.md frontmatter description, but because matching is
  file-wide they also hit the body router table, so **all nine would have passed against
  an empty description**, the exact failure this repo already suffered in items 16 and 19.

All ten were rescoped. The `R` rows now key on comma-sequences that exist only in the
description, verified by emptying the description in a temp copy: all 15 routing rows go
red, where nine previously survived. Genuinely intentional and remaining: `A015`
(`Proprietary`, 13 hits) and `A001` (`experimental`, 7 hits), where the plurality IS the
answer to the question asked, so narrowing them would make the test wrong.

Closed by CONSTRUCTION, not assertion: `tools/coverage-report.mjs --doc-numbers` now fails
on any answer key matching more than once in its source file, with `A001` and `A015` as a
named exempt list. Proven by re-introducing the exact `F063` regression, which the gate
catches and exits 1 on. The reviewer's sharpest point was that item 13 had been closed by
assertion with nothing able to detect the drift class; that is what this gate answers.

**14. ~~`references/compatibility.md` mixes two things.~~ RESOLVED 2026-08-02.**
Reordered into three sections: feature introduction versions first (what readers actually
come for), then current support states, then the profile contract that governs how entries
are written. A pure move, verified by accounting rather than assertion: 38 bullets and 37
evidence tags before and after, zero lost, zero added.

**15. Tier 3 content weaknesses: fix ATTEMPTED and MEASURED as ineffective, 2026-08-02.**
Arm C trailed the docs arm most on failure_mode (61% vs 75%) and version_caveat (72% vs
80%). The diagnosis was that failure paths lived only in composition cards and version
gates only in `compatibility.md`, so both were moved: six references gained an explicit
Failure posture section, and three decision lines gained their version gate inline.

Arm C was then re-run against the same 60 scenarios. It did not work. failure_mode stayed
at 61 percent, version_caveat fell to 68, overall went 79 to 77. The content additions are
kept because they are correct and independently useful, and seven suite rows now guard
them, but they did not buy what they were meant to buy.

Working hypothesis for the next attempt, untested: the scenarios ask for the failure mode
of a specific architecture choice, which a general per-mechanism posture paragraph does not
answer. If so, the fix is per-pairing failure paths, a larger change than this one. Do not
retry until the hypothesis is checked.

**Superseded in scope by the 2026-08-02 four-arm run, which asked a larger question and could
not answer it.** The idea was that the reference and the docs solve different halves of the
rubric, so combining them should beat docs alone. The run does not support that: docs 90
percent, docs plus a staged procedure 93, docs plus procedure plus this reference 92, and no
comparison among those three survives dropping a single grader's batch. So item 15 is no
longer "which content moves failure_mode". Nothing in this reference showed a measurable
effect once the documentation was present, and nothing showed harm either; the instrument
cannot resolve differences that small. A further content push would be answering a question
this benchmark has not been shown able to grade. Details in `tests/results-tier3.md`.

**S055 is closed as a class of defect.** It went ungraded because a grader returned 9 records
of 10 and nothing counted them, so the re-run percentages are over 59 scenarios. The harness
now refuses to score until every scenario, sheet and field is graded exactly once, checks the
total record count independently of the per-cell sweep, and has a self-test that plants each
of those failures and requires the gate to reject them. The historical 59-scenario figure is
left as published rather than backfilled.

**20. Twenty-seven expected-key defect records covering at least 36 of the 60 Tier 3
scenarios.** Graders in the 2026-08-02 run were required to grade to the key and record
disagreements rather than adjust scores. They reported 27 records, listed in
`tests/tier3/key-defects.jsonl`: `rejected_alternative` 9, `version_caveat` 8,
`enforcement_owner` 4, `context_boundary` 3, `failure_mode` 2, `lifecycle` 1.

This entry first said 26 scenarios, counting each record's `scenario` string as a single id.
Two records name ranges instead ("all ten (S041 through S050)" and a nine-scenario list), so
coverage is at least 36. The artifact has no schema forcing one id per record and no gate
checking it, which is the actual defect; the miscount was the symptom.

One pattern repeats and is mechanical enough to fix: a key asserts `version_caveat` is "none"
while another field of the SAME key concedes a version-gated fact. S037's key says no version
caveat applies while its own `failure_mode` says project-level frontmatter hooks require
workspace trust on v2.1.218 or later. S003 and S016 have the same internal contradiction.
Others are judgment calls worth arguing (S022's rejected alternative is the same mechanism as
its primary, differing only in provenance).

Keys stayed frozen for comparability. Repairing them is its own task with its own before and
after, and it would break comparability with every table published so far, so it needs a
deliberate decision rather than a quiet edit.

**21. Documentation access was unequal across the Tier 3 docs arms.**
WebFetch returned an unusable oversized page dump instead of an answer for the largest doc
pages, and anchors did not reduce the payload. Failures per arm: B 11, B+ 22, D 18. B+ is
the control that decides whether a gain is attributed to the reference or to the procedure,
and it was the most degraded arm. Agents also recovered inconsistently, most declining to
open the persisted dumps on isolation grounds while one read them.

This did not decide the outcome, since no comparison among the docs arms survived the
leave-one-batch-out check anyway, but it is a real capability difference and it would have to
be fixed before any rerun could claim a small difference between them. A rerun needs a fetch
path that returns usable content for pages over about 50 KB.

The two columns are also agent self-reports with no artifact behind them, and an independent
reviewer found the URL counts do not reconcile with the citations present in the answers.
Instrumenting the fetch path so failures are recorded rather than narrated is part of the
same fix.

**22. One grader per batch confounds grader effect with scenario focus, and it produced a
published claim that was wrong.** Each of the six Tier 3 graders scored ten consecutive
scenarios alone, and each batch is exactly one focus area, so grader strictness and topic
difficulty cannot be separated. Batch 6 rated B+ fifteen points above B while the other five
batches ranged from -1.4 to +2.9. That single batch produced the entire apparent effect, and
the first published version of `results-tier3.md` reported it as a finding about the arms.
An independent review caught it.

Fixed mechanically: `tier3-score.mjs` now recomputes every paired comparison with each batch
removed in turn and labels any comparison whose significance depends on one batch as
RESTS ON ONE GRADER. It has a self-test with both a fragile fixture and a robust one.

Not fixed: the design itself. Two or three graders per batch, or rotating graders across
scenarios instead of assigning whole batches, is the real answer and costs proportionally
more grading. Until then this benchmark cannot resolve differences of a few points, which is
exactly the size of the differences it was built to detect.

**25. Items 20 to 23 are FIXED and re-measured, 2026-08-02 (v2 run).**
All four Tier 3 instrument defects were repaired and the four-arm question re-asked on the
repaired instrument. Results in `tests/results-tier3.md`; every fix carries its own gate:

- **Item 20, broken keys: FIXED.** `tools/tier3-keys-lint.mjs` makes key quality mechanical
  (ERROR on ungradeable placeholder fields and on a key contradicting itself about version
  gates). The frozen v1 set lints RED at 15 errors; `architecture-scenarios-v2.jsonl` lints
  GREEN at 0. 42 patches applied blind and quote-verified against the docs mirror, plus 14
  context_boundary keys re-derived unseeded after an independent review found the first
  repair prompt pre-stated the answer shape. Both versions published side by side.
- **Item 21, unequal documentation: FIXED by construction.** 20 pages fetched once as raw
  markdown, sha256-manifested, staged byte-identical into every docs arm, no web access
  during answering. The three pages WebFetch could never deliver are now complete.
- **Item 22, one grader per batch: FIXED.** Seeded-shuffle batches mixing focus areas, two
  independent graders per cell, blind adjudication of full-point splits. First reliability
  number this benchmark has ever had: 92% exact agreement across 1,680 double-graded cells,
  99% within half a point, 9 full-point splits.
- **Item 23, citation rate measured format: FIXED.** Citations now carry a verbatim quote
  checked against mirror bytes; 98% and 99% verified with ZERO non-verifying quotes among
  those supplied.

Residues, open:
- **Single replicate.** Answer-agent nondeterminism is unmeasured. The pooled multi-replicate
  endpoint (`pooledVerdict`, `REPLICATE_RULE`) is committed in the scorer, written before any
  replicate data existed, so replicates 2 and 3 can be added and pooled without touching the
  rule. Deferred for budget.
- **S040's key is still wrong and costs every arm equally.** Its primary is an advisory
  remedy while its own `failure_mode` concedes a hard guarantee needs a different mechanism;
  all four arms chose the deny rule and score zero on five of seven fields. keys-lint does
  not yet catch the class "the key's own failure_mode names a better primary than the key's
  primary". That rule is the next lint addition.
- **More "none" version_caveat collisions** reported by v2 graders (candidates: v2.1.199,
  v2.1.196, v2.1.208). Needs a changelog check before the next run, with the caveat that arms
  sharing a base model can converge on the same fabrication.

**24. The extension doctor ships; the bench that justified it has known limits.**
Added 2026-08-02 after a survey-install-and-test pass over the ecosystem's validators
(directive: wrap an incumbent rather than build from reasoning). The measured gap was real:
of twelve documented silent-failure modes, the best installed competitor (agnix 0.45.0)
caught four, and six were caught by nothing. `tools/extension-doctor.mjs` covers all twelve
with evidence-cited findings, delegates per-file linting to agnix (error-level only) when
present, and shipped per the pre-committed rule in `tests/results-lint-bench.md`.

Still open from that work:
- The doctor's 12 of 12 is by construction (we authored both fixtures and checks); the
  meaningful measurement is the competitor columns and the zero-false-positive discipline,
  and the results doc says so. A third-party fixture set would be the real test.
- KNOWN_TOOLS and HOOK_EVENTS are embedded snapshots of current builds; both will rot as
  Claude Code adds tools and events. The freshness workflow's version-drift issue is the
  tripwire; the doctor needs a row in that update checklist.
- `claude plugin validate` was the only benched tool that WROTE during a run (state under
  the redirected home). Unexplained, recorded in results.json, worth an upstream report.
- cct's health checker validates hook events against a four-event allowlist and its clean
  tree column is machine-sensitive; both were measured, neither reported upstream yet.

**23. The Tier 3 citation rate measures format, not verification.** It reports the share of
factual fields carrying a well-formed URL, and both staged arms hit 100 percent. Cross-checked
against the run's own fetch-failure reports, 27 percent of B+ citations and 20 percent of D
citations point at pages those same arms reported as returning unusable dumps. The arms say
they re-sourced the facts from smaller sibling pages while citing the canonical page, which is
defensible and unverifiable from the artifacts. Either the metric should be renamed to what it
measures, or citations should be checked against what the arm actually fetched.

**16. ~~Trigger recall is 16% in a crowded environment.~~ RESOLVED 2026-07-31, recall 96%.**
The 16% run had measured an EMPTY description (the frontmatter defect, item 19). With the
frontmatter fixed, a clean-profile run of 150 sessions (3 passes per prompt, majority
scoring) scored recall 96% and precision 100%, the single miss being a version question
the model answers directly. The Skill Creator description loop ran as specified and all
three candidates scored perfect on the simulated eval, so per the pre-registered rule the
wording did not change. Still open: the fixed-description recall in the CROWDED
environment (1,786 skills) is unmeasured; run 2's 16% bounds it from below only for the
empty-description case. See `tests/results-trigger.md`.

**17. The marketplace-installed skill was invisible to sessions on this machine.**
Enabled plugin, skill reported by `claude plugin details`, absent from every session's
init listing; the same directory via `--plugin-dir` listed it. Updated 2026-07-30 with a
probable root cause: the skill's frontmatter was unparseable the whole time (item 19), so
the two load paths differed in failure handling, with the marketplace path dropping the
skill entirely and the plugin-dir path listing it by directory name. Cannot be re-tested
against the marketplace path until the self-marketplace returns or the community listing
lands; if the fixed frontmatter also fixes marketplace visibility, this item closes as a
duplicate of 19 rather than an upstream bug.
See `evidence/observations/marketplace-install-skill-invisible-2.1.219.json`.

**18. Evidence attribution is one model's judgment.**
The 268 source assignments in `claims.jsonl` were made by subagents with stated rules,
not independently double-checked. The integrity gate catches structural drift, not a
wrong-but-plausible source id. A second blind attribution pass with disagreement
reporting would harden it.

**19. ~~The skill's own frontmatter was unparseable from birth.~~ RESOLVED 2026-07-30.**
The description contained an unquoted colon-space, so the YAML frontmatter failed to
parse and the skill loaded with EMPTY metadata at runtime, discovery running on the
directory name alone. Found the moment the CI validation gate was armed; confirmed live
(the fixed skill immediately appeared in the session listing with its description, where
it had been absent). Consequence for published numbers: the 16 percent trigger recall was
measured with an empty description, so it is a floor for name-only discovery, not a
measurement of the description. Fixed by quoting the description; the gotcha is now
documented in `references/skills.md` and re-measurement is part of the trigger re-run.

**26. The project shipped a validator but never a prover.**
Every checker in this ecosystem, ours included, asked whether an extension is well FORMED.
None asked whether it BEHAVES as specified. Anthropic's own
`plugin-dev/skills/hook-development/scripts/test-hook.sh` ends with
`if [ $exit_code -eq 0 ] || [ $exit_code -eq 2 ]`, printing success for both, and accepts no
expected outcome; it also never reads `hooks.json`, so the matcher is never evaluated.
**Fixed 2026-08-04** by `tools/extension-prove.mjs` (four case kinds, structural scoring,
`--prove-fail` against empty and inert controls) and `tests/prove-bench/`
(10 of 10 versus 3 of 10, zero false positives on a correct control; see
`tests/results-prove-bench.md`). Five upstream defects filed as
anthropics/claude-code #83800 to #83804.

**27. `extension-prove` has no fidelity calibration, and that is its load-bearing limit.**
It asserts conformance to the documented contract as read in `references/hooks.md` and the
official permissions page. It is NOT Claude Code. No case has been checked against a live
`claude -p` session, so a misreading of the contract would be invisible. Every case kind
carries the citation it was derived from, which makes the reading disputable but not verified.
Until a fidelity number exists this belongs in the headline of any claim, and
`tests/results-prove-bench.md` states it. Fixing this is the precondition for any Tier 4.

**28. prove-bench is 10 of 10 BY CONSTRUCTION, the same limit as item 24.**
We authored both the fixtures and the expected outcomes. The measured content is the
competitor column and the zero false positives on the control, not our own score. A
third-party fixture set would be the real test, and none exists.

**29. `extension-scaffold` covers exactly one requirement family.**
Path protection only. Everything else is refused with a pointer to `create-plugin` rather
than force-fitted. That refusal is asserted by two self-test cases, so the scope cannot widen
silently. Requirement analysis is regex-based and will misread phrasings nobody has tried yet:
independent review already found "Never allow modification of X" refused, and a single-file
target emitting cases the deny rule could not match. Both fixed, both now regression-tested,
but the class is open.

**30. A requirement combining a conditional exemption with a hard guarantee has NO answer.**
"Block writes under `infra/` unless the content carries an approval token, and hold even if the
guard crashes" is unsatisfiable in the current mechanism set: a command hook fails open, a deny
rule cannot carry allowlist exceptions, and both together means deny always wins. Recorded in
`tests/results-prove-bench.md`. Short of OS-level sandboxing there is no composition that
satisfies it, which is worth knowing before promising one.

---

## Deliberately not doing

- **Expanding the Definition-of-Done and testing-matrix checklists into prose.** They are
  scannable checkboxes and terse is correct for them.
- **Adding worked examples to every reference.** Four files carry one already; padding
  the short files adds no non-derivable information, which is the standard set in
  `references/composition-cards.md`.
- **A CHANGELOG.** Commit-SHA versioning makes the git log the changelog.
