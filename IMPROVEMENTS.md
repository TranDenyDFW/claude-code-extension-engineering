# Known gaps

Open items, ranked by whether they block use, block discovery, or are cosmetic. Each one
names a file and line where it applies so it can be checked rather than taken on trust.
Resolved items keep their entry, struck through, so the history stays auditable.

Last reviewed 2026-07-29 against Claude Code 2.1.220.

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
unclassifiable output) with a `--self-test` of six fixtures including the must-fail
counterexample, run in CI before use, and `continue-on-error` removed. The armed gate
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

**10. Duplicate-title sections.**
`references/mcp.md` has a `## Model Context Protocol (MCP)` section inside `mcp.md`;
`references/lsp.md` has `## LSP / Code Intelligence`; `references/agent-teams.md` has
`## Agent Teams`. Leftovers of the generation pass; the content under them is testing
guidance and belongs under a heading that says so.

**11. HTML entities in the metadata line.**
Every reference uses `&middot;` in its `**Layer:** ...` line. Renders fine on GitHub, but
a plain separator would be simpler for the model-reading case.

**12. Two answer keys in question set v1 test half their question.**
`F048` keys only on `20 concurrent`; `F057` keys only on `MAX_MCP_OUTPUT_TOKENS`. Split
each into two rows in v2; not retuned in place because editing a key after the run would
invalidate the published numbers.

**13. Tier 1 matches file-wide, not line-wide.**
A key is asserted to appear somewhere in its file rather than in the passage it guards.
`F104` and `F078` are the known instances. Scoping keys to a section would close this.

**14. `references/compatibility.md` mixes two things.**
Profile-contract schema plus the per-feature version gates. Readers want the second;
reorder to put the version table first.

**15. Tier 3 exposed two content weaknesses.**
Arm C trailed the docs arm most on failure_mode (61% vs 75%) and version_caveat (72% vs
80%). Failure paths live mostly in composition cards rather than beside each mechanism,
and version gates live in one compatibility file rather than at each decision point.
Both are content moves, not test changes. See `tests/results-tier3.md`.

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
The 254 source assignments in `claims.jsonl` were made by subagents with stated rules,
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

---

## Deliberately not doing

- **Expanding the Definition-of-Done and testing-matrix checklists into prose.** They are
  scannable checkboxes and terse is correct for them.
- **Adding worked examples to every reference.** Four files carry one already; padding
  the short files adds no non-derivable information, which is the standard set in
  `references/composition-cards.md`.
- **A CHANGELOG.** Commit-SHA versioning makes the git log the changelog.
