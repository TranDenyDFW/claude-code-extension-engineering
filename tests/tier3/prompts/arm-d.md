# Arm D: docs + skill, staged procedure

The arm under test, and the behaviour that ships as `/architecture-review` if the
pre-committed decision rule is met. It combines the reference's decision model, which leads
on the comparative fields, with documentation lookup, which leads on the factual ones.

Everything below is identical to `arm-b-plus.md` except the Resource section and step 1 of the
procedure. That is the whole experimental difference, and the diff between the two files
should show nothing else.

## Resource

You have a LOCAL MIRROR of the official Claude Code documentation: the *.md files in the
docs/ directory beside your scenarios, 20 pages fetched raw from code.claude.com today,
byte-identical for every arm. Read them as much or as little as you judge useful. You have
NO web access; the mirror is the documentation.

You ALSO have the `claude-code-extension-engineering` reference files, at
`skills/claude-code-extension-engineering/`. `references/selection.md` carries the decision
axes, `references/composition-cards.md` carries the mechanism pairings and their failure
paths, and there is one reference per mechanism.

## Procedure

Work these three steps in order, for each scenario. The order is the point: decide the
structure before you look anything up, so that lookup verifies the decision rather than
suggesting it.

**Step 1, decide before you look.** Choose the primary mechanism and name the nearest
alternative you are rejecting, and write down why it loses for THIS need. Work the decision
axes in `references/selection.md` in order and record which axis settled it, then check
`references/composition-cards.md` for the pairing when the need spans two mechanisms. Do this
from the reference, before fetching anything.

**Step 2, pin the facts against the documentation.** Now fetch. For each of
`enforcement_owner`, `lifecycle`, `failure_mode` and `version_caveat`, verify your answer
against the mirror and record the PAGE FILENAME (e.g. hooks.md) plus a SHORT VERBATIM QUOTE (15 to 200 characters, copied exactly) that supports it. The quote is machine-checked against the page; a paraphrase counts as unverified. These
four are lookup answers, not reasoning answers.

If step 2 contradicts step 1, change your answer. Say so in the field rather than hiding it.

**Step 3, emit all seven fields.** A factual field you could not confirm against the
documentation is reported as `unknown`, with no citation. Do not guess a version number, a
flag name, or a failure semantic. An honest `unknown` and a wrong specific both score zero,
and the wrong specific also misleads.

## Task

For each scenario you are given, decide how the need should be built with Claude Code
extension mechanisms, and report the seven fields defined below.

Answer every scenario. If you are unsure, give your best answer rather than skipping it.

## Output contract

Return one object per scenario with exactly these fields:

- **primary**: the mechanism that should own this behaviour, and the shape it takes. Name the
  mechanism explicitly (skill, hook, subagent, dynamic workflow, agent team, MCP server,
  plugin, output style, CLAUDE.md or rules, LSP, Agent SDK, GitHub Action).
- **rejected_alternative**: the nearest mechanism you considered and did not choose. Name one,
  not a list.
- **enforcement_owner**: who owns the outcome, the model or the harness.
- **context_boundary**: which context window the work runs in, and what crosses the boundary.
- **lifecycle**: what causes this to run, and when it stops applying.
- **failure_mode**: what goes wrong in practice with this choice in this situation, including
  whether it fails open, fails closed, or is advisory.
- **version_caveat**: any version gate, experimental status, plan restriction, or enabling
  flag that applies.

Each field is prose, one to three sentences. Do not include the scenario text back in your
answer. Do not add commentary outside the fields.

Also return a `citations` object mapping each of the four factual field names to
`{"page": "<mirror filename>", "quote": "<verbatim supporting quote>"}`. Omit a field from
`citations` when you reported it as `unknown`. Quotes are machine-verified against the
mirror bytes, so copy exactly; do not tidy whitespace inside the quoted span.
