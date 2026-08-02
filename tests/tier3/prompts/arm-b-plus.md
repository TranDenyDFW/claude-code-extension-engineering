# Arm B+: official docs, staged procedure, no skill

The control that makes arm D interpretable. It runs the same staged procedure as arm D with
the same documentation access, and without the skill. If arm D beats arm B but does not beat
this arm, the gain came from the procedure and not from the reference.

Everything below is identical to `arm-d.md` except the Resource section and step 1 of the
procedure. That is the whole experimental difference, and the diff between the two files
should show nothing else.

## Resource

You have unlimited WebFetch access to the official Claude Code documentation at
`code.claude.com`. Use it as much or as little as you judge useful.

You do NOT have access to the `claude-code-extension-engineering` repository or any of its
reference files. Do not search for them, quote them, or reason from memory of them.

## Procedure

Work these three steps in order, for each scenario. The order is the point: decide the
structure before you look anything up, so that lookup verifies the decision rather than
suggesting it.

**Step 1, decide before you look.** Choose the primary mechanism and name the nearest
alternative you are rejecting, and write down why it loses for THIS need. Work mechanism
selection systematically rather than reaching for the first mechanism that fits. Do this from
reasoning, before fetching anything.

**Step 2, pin the facts against the documentation.** Now fetch. For each of
`enforcement_owner`, `lifecycle`, `failure_mode` and `version_caveat`, verify your answer
against the official documentation and record the URL of the page that supports it. These
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

Also return a `citations` object mapping each of the four factual field names to the
documentation URL that supports it. Omit a field from `citations` when you reported it as
`unknown`.
