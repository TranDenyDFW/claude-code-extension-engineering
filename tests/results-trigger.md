# Trigger benchmark: live skill discovery

Prompt set v1 ([trigger-benchmark.jsonl](trigger-benchmark.jsonl)): 25 should-trigger
prompts and 25 should-NOT-trigger near-misses, negatives built per the Anthropic Skill
Creator method (genuinely tricky, not obviously irrelevant: "write a hook" for React,
"explain MCP" conceptually, git hooks, VS Code extensions, WordPress plugins).

Every run is LIVE: real headless `claude -p` sessions with the plugin loaded via
`--plugin-dir`, a trigger being an assistant `tool_use` of the Skill tool naming this
skill, parsed from retained stream-json transcripts.

## Headline result

**Clean profile, 3 passes per prompt, majority scoring (2 of 3), 2026-07-31, CLI 2.1.219:**

| | Triggered | Did not |
|---|---|---|
| Should trigger (25) | 24 | 1 |
| Should NOT trigger (25) | 0 | 25 |

**Recall 96%. Precision 100%. False-positive rate 0%.** The one miss is T11 ("What version
of Claude Code introduced workflows, and are they stable?"), which the model consistently
answers from its own knowledge without loading anything.

Clean profile means a temporary `CLAUDE_CONFIG_DIR` carrying only credentials: 18 bundled
skills instead of 1,786, no plugins, no user hooks. 150 sessions, fixed 4-worker pool.

## The three-run history, and what actually moved the number

| Run | Date | Environment | Description state | Recall | Precision |
|---|---|---|---|---|---|
| 1 (invalidated) | 2026-07-30 | dirty, marketplace install | unparseable frontmatter, skill absent from listings | 0% | n/a |
| 2 | 2026-07-30 | dirty (1,786 skills), --plugin-dir | unparseable frontmatter: EMPTY description, name-only discovery | 16% | 100% |
| 3 (headline) | 2026-07-31 | clean profile, --plugin-dir | frontmatter fixed, description visible | 96% | 100% |

The 16-to-96 jump conflates two changes (frontmatter fix and environment), deliberately
run in this order because run 2's defect was only discovered when the CI validation gate
was armed: the skill's description contained an unquoted colon-space, the YAML failed to
parse, and the skill ran with EMPTY metadata from the day it was authored. Run 2 therefore
measured name-only discovery in a crowded environment, a floor, not a description
measurement. The gotcha is documented in `references/skills.md` and recorded in
IMPROVEMENTS item 19.

## The description optimization loop, and why the description did not change

Per the Skill Creator method, three description candidates (the current one plus two
rewrites) went through a 60/40 train/test eval with three independent simulated judges per
prompt. All three candidates scored 100% recall and 100% precision on train AND held-out
test. The eval has a ceiling: when a judge is explicitly asked "would you invoke, given
this listing," any reasonable description of this skill matches these prompts. The
discriminators in practice were VISIBILITY (the frontmatter defect) and in-flight
invocation reluctance (the model answering directly), neither of which description wording
fixes. Per the pre-registered rule, the description changes only if a rewrite wins;
none did, so the original wording stands, now actually parseable.

## Honest limits

- The clean profile isolates the description's own pull; it does not predict discovery on
  a machine carrying 1,786 competing skills. Run 2's 16% at least bounds that from below
  under the WORST description state (empty); the fixed-description dirty-environment
  number is unmeasured and tracked in IMPROVEMENTS.
- Majority-of-3 scoring; per-prompt outcomes still vary run to run.
- One build (2.1.219 CLI), one model (claude-opus-5).
- The invalidated run 1 also exposed that a marketplace-installed plugin's skill never
  appeared in session listings on this machine while --plugin-dir listed it; probable root
  cause is the same frontmatter defect, unresolvable until a marketplace path exists
  again. See `evidence/observations/marketplace-install-skill-invisible-2.1.219.json`.
