# Known gaps

Open items, ranked by whether they block use, block discovery, or are cosmetic. Each one
names a file and line where it applies so it can be checked rather than taken on trust.
Resolved items keep their entry, struck through, so the history stays auditable.

Last reviewed 2026-08-05 against Claude Code 2.1.220, the build in `evidence/VERIFIED_VERSION`.
That pass reconciled items 20 to 23, 25 and 27 against their own artifacts and re-ran their
gates. It did no new version check, so the verified build is unchanged from the 2026-08-04
review.

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
comparison among those three survives dropping a single grader's batch. Those three figures
are the V1 tables, frozen as published; the repaired v2 instrument re-asked the same question
and returned the same verdict on different numbers, 88, 88 and 87, with combined versus docs
alone a 20-to-20 dead heat at p=1.000. See item 25. So item 15 is no
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

**20. ~~Twenty-seven expected-key defect records covering at least 36 of the 60 Tier 3
scenarios.~~ RESOLVED 2026-08-02 in the v2 set; see item 25. Gates re-verified 2026-08-05.**
Graders in the 2026-08-02 run were required to grade to the key and record
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

That decision was taken the same day and went the honest way: v1 stays frozen and published,
v2 carries the repaired keys, and both are published side by side rather than one quietly
replacing the other. `tools/tier3-keys-lint.mjs` is the gate. Re-run 2026-08-05: `--set v1`
reports 15 errors and 51 warnings, `--set v2` reports 0 errors and 43 warnings, so the frozen
set is RED under the same lint the shipped set passes. The schema hole named above, no rule
forcing one scenario id per defect record, is closed too: `--defects` reports
`key-defects.jsonl schema clean`, and the linter's `--self-test` includes the known-bad case
"defect record with a range id is an ERROR", so the check is observed failing on bad input
rather than assumed.

**21. ~~Documentation access was unequal across the Tier 3 docs arms.~~ RESOLVED 2026-08-02
by construction in the v2 run; see item 25.**
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

Fixed by removing the fetch path rather than instrumenting it. The v2 run staged a local
mirror: pages fetched once as raw markdown, sha256 per page, byte-identical into every docs
arm, no web access at answering time. `tests/tier3/docs-manifest.json` records 20 pages
fetched 2026-08-02, each with its sha256, which makes the mirror reproducible without
committing copyrighted content. With no per-arm fetching there is no per-arm degradation and
no self-report left to reconcile.

**22. ~~One grader per batch confounds grader effect with scenario focus, and it produced a
published claim that was wrong.~~ RESOLVED 2026-08-02: detector shipped, then the design
itself was replaced in the v2 run; see item 25.** Each of the six Tier 3 graders scored ten
consecutive
scenarios alone, and each batch is exactly one focus area, so grader strictness and topic
difficulty cannot be separated. Batch 6 rated B+ fifteen points above B while the other five
batches ranged from -1.4 to +2.9. That single batch produced the entire apparent effect, and
the first published version of `results-tier3.md` reported it as a finding about the arms.
An independent review caught it.

Fixed mechanically: `tier3-score.mjs` now recomputes every paired comparison with each batch
removed in turn and labels any comparison whose significance depends on one batch as
RESTS ON ONE GRADER. It has a self-test with both a fragile fixture and a robust one.

Not fixed at the time of writing: the design itself. Two or three graders per batch, or
rotating graders across scenarios instead of assigning whole batches, is the real answer and
costs proportionally more grading.

The v2 run paid that cost and the design is now fixed: seeded-shuffle batches that mix focus
areas, TWO independent graders per cell, blind adjudication of full-point splits, and a
completeness gate that refuses to score unless every cell carries exactly two base grades
from different graders. `tests/results-tier3.md` reports the first reliability number this
benchmark has ever had: 1,680 double-graded cells, 92 percent exact agreement, 99 percent
within half a point, 137 disagreements of any size and 9 full-point splits needing
adjudication. The leave-one-batch-out detector stays in place as the tripwire; on the v2
numbers no comparison among the docs arms was significant to begin with, so none of them
rests on one grader.

**25. Items 20 to 23 are FIXED and re-measured, 2026-08-02 (v2 run).**
Those four entries are struck above and point here. What stays OPEN from that work is the
residue list at the end of this item, not the four defects themselves.
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
- ~~**Single replicate.** Answer-agent nondeterminism is unmeasured.~~ **RESOLVED 2026-08-05.**
  Replicates 2 and 3 ran under hash-pinned prompts, arm D skill tree and docs revision, with
  sheet order re-salted per pass (60 of 60 reordered pairwise) and grading-batch membership
  held identical. Pooled by the pre-committed `REPLICATE_RULE`: 23W 30L over n=60 scenario-mean
  deltas, p=0.410, margin 0, verdict NEGATIVE, all three passes individually null.
  **The measurement is worse news than the caveat was.** A single arm moves 4 to 5 points
  between identical passes, against a D-versus-B gap of 0, -1 and 0 points, so the noise is
  several times the effect and the variance enters at ANSWERING, upstream of anything the
  grading design controls. The claim is now falsifiable: no effect larger than roughly 4 points
  is detectable, and the observed difference sits well inside that band. Resolving anything
  smaller requires more answering passes per arm, not stricter grading.
- **S040's key is still wrong and costs every arm equally.** Its primary is an advisory
  remedy while its own `failure_mode` concedes a hard guarantee needs a different mechanism;
  all four arms chose the deny rule and score zero on five of seven fields. The lint rule
  called "the next addition" here has since shipped: `tier3-keys-lint.mjs` now flags the class
  where a key's own `failure_mode` or `rejection_reason` names a harness-owned mechanism the
  primary does not, while `enforcement_owner` calls that primary advisory or model-owned.
  Re-run 2026-08-05: it fires on S040 and on no other key, one hit in each of the 60-key v1
  and v2 sets, and its `--self-test` carries both the must-fire shape and four must-stay-silent
  shapes so the selectivity is observed rather than assumed. It fires as a WARN, and the KEY
  itself is still unrepaired under the same freeze-for-comparability decision as item 20. So
  the residue is now a known-bad key the linter can see, not a defect class nothing can detect.
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

**23. ~~The Tier 3 citation rate measures format, not verification.~~ RESOLVED 2026-08-02 in
the v2 run; see item 25.** It reported the share of
factual fields carrying a well-formed URL, and both staged arms hit 100 percent. Cross-checked
against the run's own fetch-failure reports, 27 percent of B+ citations and 20 percent of D
citations point at pages those same arms reported as returning unusable dumps. The arms say
they re-sourced the facts from smaller sibling pages while citing the canonical page, which is
defensible and unverifiable from the artifacts. Either the metric should be renamed to what it
measures, or citations should be checked against what the arm actually fetched.

The second option was taken. In v2 the metric is the share of the four factual fields whose
citation carries a quote appearing VERBATIM in the cited mirror page, checked mechanically
against the staged bytes, and a field with NO citation counts against the rate rather than
being skipped, which is what turns it from a formatting check into a verification check.
`tests/tier3/verified-quote-rates-v2.json` records 98 for B+ and 99 for D, with zero
non-verifying quotes among those supplied. Arms A and B were not asked for citations, so they
carry no rate.

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
The 444 source assignments in `claims.jsonl` were made by subagents with stated rules,
not independently double-checked. The integrity gate catches structural drift, not a
wrong-but-plausible source id. A second blind attribution pass with disagreement
reporting would harden it. The 2026-08-05 monitors and channels pass is a worked example
of the risk and of one cheap mitigation: 117 claims needed attribution, and checking each
one against the page it named turned up a claim whose source page was not in the ledger
at all (the plugin context-cost model, which traces to `discover-plugins`, added as
`SRC_DISCOVER_PLUGINS`). A wrong-but-plausible id would have passed the gate silently.

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

**27. ~~`extension-prove` has no fidelity calibration, and that is its load-bearing limit.~~
RESOLVED 2026-08-04/05 at n = 10 per class.**
The limit was real: the prover asserted conformance to OUR READING of `references/hooks.md`
and the official permissions page, so a misreading of the contract would have been invisible.
It has now been measured against the product. Fifteen behaviour classes, each computed twice,
once by the simulator and once by a real `claude -p` session, ten passes per class: 150 live
sessions against Claude Code 2.1.219. The observable is ground truth on disk, whether the
target file exists and whether the handler's marker appeared, never the model's narration.
Consolidated record in `tests/tier4/fidelity-n10-final.json`: `modelled` 13 classes with 13
fully agreeing, `unmodelled` 2 classes measured consistently, `nondeterministic: []`. Every
class is 10 of 10 and nothing flipped across ten passes, which is the result ten passes exists
to be able to state.

The calibration earned its cost by finding a defect that outcome agreement alone HID. Claude
Code hands a hook an absolute path with native separators; every conformance case had been
feeding a relative POSIX path, and the eight round-1 outcomes still agreed only because the
guard normalised both shapes. The bench's own control handler did not: given the real shape it
ALLOWED the write. A handler could have passed this bench and been dead in production, which
is precisely the failure class the project exists to catch, sitting inside its own instrument.
`extension-prove` now absolutises `file_path` against the temp project the way the product
does, and matches permission rules against the project-relative form, because a rule is written
`Edit(infra/**)`. Three harness bugs in the n = 10 sweep (a marker-filename mismatch, a
hardcoded target, and a temporal dead zone that discarded 40 completed live sessions) were
caught by the 0-of-10-with-deterministic-yes signature; four classes whose original numbers
were RIGHT were re-measured anyway, because a pass obtained from a known-broken observer is
not evidence. Only fixed-observer results are admitted to the record.

Open residue, and it is the reason this is not a general fidelity guarantee: one CLI build on
one platform (2.1.219, Windows), and only the fifteen classes with a disk-visible outcome.
PostToolUse exit 2, SessionStart `additionalContext`, managed-settings precedence, PreCompact,
SubagentStop and Stop remain a reading of the docs, each listed with its reason in
`tests/results-prove-bench.md` so an unlisted gap cannot read as covered.

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

**31. All three mechanisms `extension-scaffold` could select emitted a bundle that failed its
own acceptance test. The hook is no longer selectable.** Found 2026-08-05 while reproducing an
external reviewer's charge that the scaffold's acceptance test is materially narrower than the
requirement it claims to satisfy. That charge is true, and chasing it surfaced four more defects
nobody had reported:

- The hook bundle had been failing its own spec since commit `63a3ecc`, which made the prover
  feed ABSOLUTE paths and updated the six prove-bench fixtures but not the scaffold's handler
  template. `5 cases: 2 passed, 3 failed`, exit 1.
- `extractTarget` swallowed a sentence-final period, so "Prevent any change to a file under
  infra/." emitted `Edit(infra/./**)`. `permissionDecision` returns null for that glob, which
  broke the permission-deny path too, not only the hook: 5 of 7 probes red.
- The permission-deny bundle SHIPPED the hook its own README names as the rejected alternative,
  because the emit branch was `hook || permission-deny` rather than a choice.
- Advisory bundles emitted `enforce` cases expecting `deny` against a `settings.json` of `{}`.

Fixed by deleting the hook as a selectable mechanism for this family rather than repairing its
template. There is no path-protection requirement where a command hook is right and a deny rule
is wrong: the hook fails open, covers a strict subset of the vectors, and is deletable. Its one
real advantage, carrying a conditional exemption, belongs to the family item 30 already records
as unsatisfiable. This REVERSES behaviour that two self-test rows previously gated, which is why
it is recorded here rather than edited in silently. The new invariant is the one the third
defect violated: **the rejected alternative must not be a file in the bundle.**

Advisory bundles now emit a `residual` case asserting NON-enforcement, so adding a deny rule
later turns the spec red and forces the conversation instead of silently upgrading the claim.
Enforcing bundles get a `tamper` case (`add-allow-rule`) in place of `fail-posture`: with no
handler shipped, `delete-handler` would make that case byte-identical to the live one, which is
a check that cannot fail.

**32. The gate that would have caught item 31 did not exist, and that is the real defect.**
CI ran `extension-scaffold --self-test`, which exercises `analyse()` and `conformanceFor()` as
functions and never once GENERATES a bundle and PROVES it. Four defects rode a green build
because the only end-to-end path was a human running the CLI by hand. Now `--gate` runs seven
frozen probe requirements through analyse, buildBundle and proveBundle in process, asserting the
result equals a frozen case-id-to-verdict map AND file list. Not "all green": advisory must NOT
be green on enforce cases, and a `residual` case is green by expecting `allow`, so a pass count
alone would have hidden the fourth defect. `--gate --prove-gate-can-fail` applies four in-memory
injections (`stale-handler`, `period-glob`, `both-mechanisms`, `advisory-enforce`) and requires
every one to redden the gate; it is what would have gone red on `63a3ecc`. Both are CI steps.

Residue: seven probes is a frozen set chosen by the same person who wrote the analyser, so it
carries item 28's limit. It catches regressions against known phrasings, not phrasings nobody
has tried yet, which is item 29.


**33. The enforcement layer had no reference of its own, and its edge is not readable.**
Two reviews noted that permission rules and sandboxing were discussed inside `hooks.md` and
`selection.md` and had no page. Fixed 2026-08-05 with `references/permissions.md` and
`references/sandboxing.md`, one file per mechanism as the house invariant requires; a
combined `enforcement-layers.md` would have been the only reference covering two, which is a
milder form of the exact defect being reported.

The substantive finding is that one of the two cannot be written from the documentation at
all. `permissions.md` says a deny rule reaches "file commands Claude Code recognizes in
Bash, such as `cat`, `head`, `tail`, and `sed`". Four examples, no enumeration anywhere on
the page, so there is no reading that tells you whether `cp`, `mv`, `tee` or a shell
redirection is inside the set, and you cannot test your way to it either because a command
that never ran is indistinguishable on disk from one that was denied.

So it is MEASURED. `tools/bash-recognition-run.mjs` runs paired arms, identical but for the
deny rule, and admits a pass only when the rule arm held AND the control arm changed. Both
arms unchanged means the command never ran and the pass is DISCARDED, because scoring that
as a denial measures the model's caution and publishes it as a security property. The frozen
result is `tools/bash-recognition.mjs`, drift-gated against the recorded measurement, and a
shape absent from it is UNDETERMINED rather than allowed.

Three things came out of it that the documentation does not say:

- **PowerShell.** The recognised-file-command sentence names Bash and never PowerShell,
  though PowerShell RULES get full parity a few sections earlier including AST parsing and
  alias canonicalization. Measured: `powershell -Command "Add-Content -LiteralPath
  infra/main.tf ..."` WROTE THE FILE through a live `Edit(infra/**)` deny rule, while a
  `printf ... >>` into the same tree was refused in the same rig. On Windows this matters
  more than the sandbox, which is not weaker there but absent.
- **The V3 residual is now an observation, not a citation.** `node build.mjs` ran through a
  live deny rule and wrote the protected file, paired against a control. The prior plan's own
  risk note said this repo had never observed the subprocess leak and warned against
  upgrading it to a local observation; that warning is now discharged by measurement rather
  than by assertion.
- **Approval and denial are separate gates, and a benchmark can conflate them.** A
  project-scope `permissions.allow` entry granted nothing for an interpreter command in a
  `-p` session: five spellings against `node writer.mjs` all returned "This command requires
  approval", and a `printf` append then ran in a tree with NO allow rules at all. The
  `--allowedTools` CLI flag does grant it. A rig that grants approval the first way silently
  measures "the model declined" and reports it as "the rule denied".

Residue: one platform, one build, ten shapes. The recognised set may differ on macOS or
Linux and nothing here covers that; `compatibility.md` records it as UNVERIFIED rather than
leaving it to be assumed.

**34. Two of this repo's own gates were destroying or disabling evidence, and both were
found by using them.**
Neither was reported by any review. Both are the same shape as the defects this project
exists to name: a check that silently stops checking.

- **Re-running the lint bench DESTROYS the competitor record.** `results.json` is not an
  output, it is the record of a run against seven tools, four of which are installed only on
  the machine that produced it. Re-running here to add the enforcement cohort wrote a file
  with those four columns simply absent. Worse, the capability catalog anchors its crosscheck
  sha at the agnix tool list INSIDE that file, so the catalog failed verification, its load
  failed soft as designed, and every capability name check degraded to UNVERIFIED. One
  command, three layers of evidence gone, no error. The runner now REFUSES to overwrite
  `results.json` when a run would drop a tool the record has data for, and `--out` is where a
  partial run goes. Watched refusing before it shipped.
- **The catalog's integrity gate reported line endings as tampering.** The crosscheck sha was
  taken over raw BYTES, so on any Windows clone with `core.autocrlf` the catalog fails
  verification because git rewrote LF to CRLF, while the content is identical. It fails soft,
  so the only symptom is one header line nobody reads and every name check quietly becoming
  UNVERIFIED. It now hashes LF-normalised text, observed loading under both CRLF and LF on
  disk. An integrity gate that cries wolf on line endings is a gate that gets ignored, which
  is worse than not having one.

**35. Carried forward from the prior plan, still open.**
Stated here rather than silently dropped. The doctor's per-finding confidence field and the
quote-aware tokenizer were carried into this plan's Phase D from the previous one and are
NOT implemented: neither has a definition in this repo, and inventing one to close a
checklist item would be worse than leaving it open. The attested-fixture cohort drawn from
the 81,291-issue corpus is also still open; the corpus is harvested and verified
(`data/gh/`), the cohort is not built.

---

## Deliberately not doing

- **Expanding the Definition-of-Done and testing-matrix checklists into prose.** They are
  scannable checkboxes and terse is correct for them.
- **Adding worked examples to every reference.** Four files carry one already; padding
  the short files adds no non-derivable information, which is the standard set in
  `references/composition-cards.md`.
- **A CHANGELOG.** Commit-SHA versioning makes the git log the changelog.
