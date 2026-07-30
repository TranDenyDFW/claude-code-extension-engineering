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

**2. ~~No staleness signal and no CI.~~ RESOLVED 2026-07-29.**
`.github/workflows/freshness.yml` runs daily, on push, and on demand: compares
`evidence/VERIFIED_VERSION` against the latest npm release, runs the deterministic suite,
the prove-fail inversion, and the evidence-ledger gate, and opens an idempotent
"verification required" issue with the changelog entry when Claude Code moves ahead. The
README badge reads `evidence/status.json`. Caveat until the first green run on GitHub:
the workflow is untested in CI itself.

**3. Two claims are self-declared as unverified and stay that way.**
`references/hooks.md` marks the `additionalContext` behaviour on `PostToolUseFailure` as
`INFERENCE, not documented`, and `references/subagents.md` records that the two official
sources disagree on the subagent nesting default. Both are honest, and both are exactly
the kind of thing a reader comes here to have settled. Each needs one measurement on a
real build. (The nesting depth-2 case has an observation record; the ceiling and the
PostToolUseFailure case remain unmeasured.)

**4. Nine claims are explicitly unattributed in the evidence ledger.**
`evidence/claims.jsonl` carries `status: "unattributed"` on 9 of 254 records, mostly
Agent SDK details whose true upstream (the SDK documentation) is not yet a ledger source,
plus a few structural claims. Honest gaps rather than guessed provenance. Fix: add an
`SRC_AGENT_SDK` source row and re-attribute.

---

## Blocks discovery

**5. ~~No `.claude-plugin/marketplace.json`.~~ RESOLVED 2026-07-29.**
Ships both manifests; installs via `/plugin marketplace add`. The skill lives under
`skills/claude-code-extension-engineering/` for component auto-discovery.

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

**9. Not listed in a public marketplace.**
The repo is its own single-plugin marketplace, installable by name, but appears in
neither `claude-plugins-official` (no application process; Anthropic's discretion) nor
`anthropics/claude-plugins-community` (submission via the authenticated in-app form;
individual authors use platform.claude.com/plugins/submit). Paste-ready submission text:
`docs/SUBMISSION.md`. This is a user action; it cannot be automated from here.

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

**15. Evidence attribution is one model's judgment.**
The 254 source assignments in `claims.jsonl` were made by subagents with stated rules,
not independently double-checked. The integrity gate catches structural drift, not a
wrong-but-plausible source id. A second blind attribution pass with disagreement
reporting would harden it.

---

## Deliberately not doing

- **Expanding the Definition-of-Done and testing-matrix checklists into prose.** They are
  scannable checkboxes and terse is correct for them.
- **Adding worked examples to every reference.** Four files carry one already; padding
  the short files adds no non-derivable information, which is the standard set in
  `references/composition-cards.md`.
- **A CHANGELOG.** Commit-SHA versioning makes the git log the changelog.
