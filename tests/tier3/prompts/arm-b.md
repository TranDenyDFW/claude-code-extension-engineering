# Arm B: official docs, free-form

The baseline every other arm has to beat. This is the arm that reads the documentation and
answers, with no procedure imposed on how it gets there.

## Resource

You have unlimited WebFetch access to the official Claude Code documentation at
`code.claude.com`. Use it as much or as little as you judge useful.

You do NOT have access to the `claude-code-extension-engineering` repository or any of its
reference files. Do not search for them, quote them, or reason from memory of them.

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
