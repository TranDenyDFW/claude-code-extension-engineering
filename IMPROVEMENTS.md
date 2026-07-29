# Known gaps

Open items, ranked by whether they block use, block discovery, or are cosmetic. Each one
names a file and line where it applies so it can be checked rather than taken on trust.

Last reviewed 2026-07-28 against Claude Code 2.1.219.

---

## Blocks use

**1. Eleven of nineteen source rows are unverified.**
`references/sources.md` carries `not recorded` in the Verified column for `SRC_AGENT_TEAMS`,
`SRC_CHANGELOG`, `SRC_FEATURES`, `SRC_HOOKS`, `SRC_HOOK_GUIDE`, `SRC_MCP`, `SRC_MCP_SECURITY`,
`SRC_MCP_SPEC`, `SRC_MEMORY`, `SRC_PLUGINS`, `SRC_PLUGIN_REF`, `SRC_SKILLS`,
`SRC_SKILL_CREATOR`, `SRC_SUBAGENTS` and `SRC_SUPERPOWERS`. The whole document is built on an
evidence-tagging system, so a blank verification date on more than half the sources undercuts
every `[OFFICIAL]` tag that derives from them. Either date them or state why they cannot be.

**2. No staleness signal and no CI.**
Every reference opens with `Claude Code 2.1.219, verified 2026-07-26`. There is nothing that
fails when that date goes stale. Claude Code ships frequently, and
`references/compatibility.md` explicitly warns that hook events and plugin components change
between releases. A scheduled workflow that compares the pinned build against the current
release and opens an issue would close this.

**3. Two claims are self-declared as unverified and stay that way.**
`references/hooks.md` marks the `additionalContext` behaviour on `PostToolUseFailure` as
`INFERENCE, not documented`, and `references/subagents.md` records that the two official
sources disagree on the subagent nesting default. Both are honest, and both are exactly the
kind of thing a reader comes here to have settled. Each needs one measurement on a real build.

---

## Blocks discovery

**4. No `.claude-plugin/marketplace.json`.**
The repo cannot be installed with `/plugin marketplace add TranDenyDFW/claude-code-extension-engineering`.
Install currently requires knowing where `~/.claude/skills` lives and cloning to an exact
destination. Every comparable repo with meaningful traction ships this manifest. Highest
leverage item on this list.

**5. Zero GitHub topics, no homepage, no release.**
`gh repo view --json topics` returns `[]`. Topic pages are how this category gets browsed.
Candidates: `claude-code`, `claude-code-skills`, `agent-skills`, `anthropic`, `claude`,
`hooks`, `mcp`, `developer-tools`.

**6. The README leads with the index instead of the payoff.**
`README.md` opens with the 21-row routing table. The material that justifies the repo is
buried: `references/hooks.md` on the Windows `${CLAUDE_PROJECT_DIR}` parsing trap, the fact
that `--debug` writes to a file and prints nothing, `disableAllHooks` having no per-hook
equivalent, `references/plugins.md` on custom path keys silently replacing default folders and
on `${CLAUDE_PLUGIN_ROOT}` changing across updates. Lead with five of those.

---

## Cosmetic or structural

**7. Duplicate-title sections.**
`references/mcp.md` has a `## Model Context Protocol (MCP)` section inside `mcp.md`;
`references/lsp.md` has `## LSP / Code Intelligence`; `references/agent-teams.md` has
`## Agent Teams`. Each repeats the file title as an interior heading, which is a leftover of
the generation pass rather than a deliberate structure. The content under them is testing
guidance and belongs under a heading that says so.

**8. HTML entities in the metadata line.**
Every reference uses `&middot;` in its `**Layer:** ... **Classification:** ...` line. Renders
correctly on GitHub, but it is markup in a file whose main consumer is a model reading raw
text. A plain separator would be simpler.

**9. `references/compatibility.md` mixes two things.**
It holds both the profile-contract schema and the actual per-feature version gates. Readers
almost always want the second. Splitting or reordering would put the version table first.

---

## Deliberately not doing

- **Expanding the Definition-of-Done and testing-matrix checklists into prose.** They are
  scannable checkboxes and terse is correct for them. See `references/hooks.md` Definition of
  Done and `references/subagents.md` Delegation testing.
- **Adding worked examples to every reference.** Four files carry one already
  (`skills.md`, `hooks.md`, `plugins.md`, `subagents.md`). Adding more to the short files
  would pad them without adding non-derivable information, which is the standard set in
  `references/composition-cards.md`.
