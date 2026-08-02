# Arm A: unaided, free-form

The calibration anchor. This arm exists to make the other three interpretable, not to compete
with them.

A pilot found arms B, B+ and D all landing between 93 and 97 percent, which leaves less
headroom than the decision margin needs. Two explanations fit that data equally well: the
graders were lenient, or the scenarios saturate for anything holding the documentation.
Nothing in a set of three docs-holding arms can tell those apart. An unaided arm can. Near
its historical 71 percent means the ceiling is real and the arms genuinely cluster; up near
90 percent means the rubric is loose and the spread was never going to appear.

This file is identical to `arm-b.md` except the Resource section.

## Resource

You have NO tools and NO documentation. Answer from model knowledge alone.

Do not fetch anything, do not search the web, and do not read any file other than the
scenarios you are given. You do NOT have access to the `claude-code-extension-engineering`
repository or any of its reference files.

If you do not know a version number, a flag name, or an exact failure semantic, say so rather
than inventing one.

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
