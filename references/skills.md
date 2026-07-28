# Skills

> Claude Code 2.1.219, verified 2026-07-26.


A SKILL.md file holding reusable instructions the model reads when it decides the skill is relevant, or when you invoke it by name. One primitive with several invocation modes: model-invoked, user-invoked with /name, and plugin-shipped. Custom commands were merged into skills, so a .claude/commands/x.md and a .claude/skills/x/SKILL.md both produce /x and behave the same way.

**Layer:** Capability &middot; **Classification:** primitive &middot; **Status:** stable

## Methodology source and risk tier

- Simple/reference Skill → trigger + behavior smoke tests [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Workflow Skill → baseline + positive + negative + regression tests [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Compliance/safety Skill → adversarial + rationalization + failure-path suite [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Trigger-only descriptions are an optional Superpowers method [COMMUNITY PRACTICE]  [COMMUNITY]

## Decide the Skill is correct

- Candidate: a recurring procedure / checklist you keep re-pasting  [ANTHROPIC RECOMMENDATION]  [ANTHROPIC]
- Keep it in CLAUDE.md instead when it is a always-on FACT, not a procedure  [OFFICIAL]
- Make it a Hook instead when it must be ENFORCED every time  [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Make it a Subagent instead when it needs its own context / tools  [ENGINEERING BEST PRACTICE]  [ENGINEERING]

## RED / baseline (before SKILL.md exists)

- Recommended for workflow/compliance Skills; optional for simple references  [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Baseline procedure
- Write a representative task the skill should handle
- Run it in a FRESH session WITHOUT the skill
- Observe the actual behaviour
- YES → reconsider whether the skill is needed at all
- NO → capture the failure
- Record the exact failure (verbatim)
- Record the incorrect reasoning / rationalization (verbatim)
- Classify the failure type
- Design the MINIMUM intervention that fixes it
- Risk-tiered rule: establish a baseline when behavior or compliance risk warrants it  [ENGINEERING BEST PRACTICE]  [ENGINEERING]

## GREEN / minimal skill

- Write the minimal SKILL.md that fixes the observed failures  [ANTHROPIC RECOMMENDATION]  [ANTHROPIC]
- description = WHAT the Skill does + WHEN to use it  [OFFICIAL]
- Community variant: trigger-only descriptions (CSO)  [COMMUNITY PRACTICE]  [COMMUNITY]
- Add only enough guidance to correct the baseline failures
- Add supporting files only when needed (progressive disclosure)
- Re-run the original failing case → should now pass

## Discovery testing (does it activate correctly?)

- Should ACTIVATE on in-scope prompts (avoid false negatives)
- Should NOT activate on similar-but-out-of-scope prompts (avoid false positives)
- Tune the description keywords, when_to_use, and paths  [OFFICIAL]

## Behavioural / REFACTOR pressure testing

- Pressure scenarios
- Time pressure
- Sunk-cost pressure
- User says 'skip the procedure'
- Authority claim ('the lead approved skipping')
- Conflicting instructions
- Ambiguous / borderline case
- Partial completion already done
- Existing work that would need to be undone
- Long-context / late in session
- Similar but NON-applicable task
- Per-failure loop
- Failure observed
- Capture exact rationalization
- Determine root cause
- Modify the MINIMUM necessary instruction
- Fresh-session retest
- Re-run all previous tests
- New failure? YES loop / NO continue
- Artifacts produced
- Uses the generic loop

## Structure + frontmatter reference

- Directory + progressive disclosure  [OFFICIAL]
- Command name: dir name (personal/project) vs frontmatter name (plugin)  [OFFICIAL]
- String substitutions: $ARGUMENTS, $0/$1, $name, CLAUDE_SKILL_DIR  [OFFICIAL]
- Autonomous vs user invocation are both first-class  [OFFICIAL]
- A project skill's allowed-tools activates on workspace trust acceptance, so a checked-in skill can grant itself broad tool access - review .claude/skills/ before trusting a repo [OFFICIAL]

## Integrate with other mechanisms

- Skill can pre-approve tools, fork to a subagent, or scope a hook

## Common failure modes / anti-patterns

- Skipping a needed baseline for a workflow/compliance Skill
- Vague discovery description (never fires)
- Putting the whole procedure in the description (Claude follows it, skips the body)
- Massive SKILL.md always in context
- Unnecessary examples / multi-language dilution
- Solving hypothetical failures instead of observed ones
- Testing only inside the authoring conversation
- No negative-trigger (false-positive) tests

## Compatibility notes

- ${CLAUDE_SKILL_DIR} in allowed-tools requires v2.1.129+ [OFFICIAL]  [v2.1.129]
- ${CLAUDE_PROJECT_DIR} Skill substitution requires v2.1.196+ [OFFICIAL]  [v2.1.196]
- v2.1.216 fixed plugin Skills with a name frontmatter field losing their plugin prefix in slash-command autocomplete [OFFICIAL]  [v2.1.216]
- background with context: fork requires v2.1.218+ [OFFICIAL]  [v2.1.218]
- Current Boolean aliases beyond true/false require v2.1.218+ [OFFICIAL]  [v2.1.218]

## User-invoked Skills / legacy slash-command terminology

- Custom commands have been MERGED into skills  [OFFICIAL]
- Legacy → modern (same system now)
- Legacy: .claude/commands/NAME.md (flat file)  [LEGACY]  [DEPRECATED]
- Modern: .claude/skills/NAME/SKILL.md (folder)  [OFFICIAL]
- Both → /name; the Skill branch owns full authoring
- When a purely explicit workflow is right
- YES → Skill discovery matters (write a strong description)
- NO → set disable-model-invocation: true (explicit /name only)  [OFFICIAL]
- Arguments: $ARGUMENTS, $0/$1, argument-hint
- Frontmatter: description, allowed-tools, model (same as skills)
- Output + error cases defined
- Migration: legacy command → skill
- Testing + discoverability
- Anti-patterns
- Auto-invoking a destructive command (should be explicit)
- Building a new legacy commands/ file instead of a skill
- No argument-hint / no arg validation
- Duplicate old + new both live
- Definition of Done
- Invocation model chosen (auto vs explicit)
- Args parse + validate
- Runs correctly from /name
- Discoverable (or intentionally hidden)
- Legacy duplicate removed

## SKILL.md frontmatter (all optional; description recommended)

| field | req | purpose |
|---|---|---|
| name | no | display name; DEFAULTS to directory name |
| description | rec | when + what; drives auto-invocation; ~1536-char cap with when_to_use |
| when_to_use | no | extra trigger phrases / example requests |
| argument-hint | no | autocomplete hint e.g. [issue-number] |
| arguments | no | named positional args for $name substitution |
| disable-model-invocation | no | true = user-only (/name); also blocks subagent preload |
| user-invocable | no | false = hide from / menu (background knowledge) |
| allowed-tools | no | pre-approved tools for the invoking turn |
| disallowed-tools | no | tools removed while skill active |
| model | no | model override for the turn (or inherit) |
| effort | no | low\|medium\|high\|xhigh\|max for the turn |
| context | no | fork = run in a subagent context |
| agent | no | which subagent type when context: fork |
| hooks | no | hooks scoped to this skill's lifecycle |
| paths | no | globs that scope auto-activation |
| shell | no | bash (default) \| powershell for inline ! commands |


## Worked example

**Where it goes.** `~/.claude/skills/<name>/SKILL.md` (user) or
`.claude/skills/<name>/SKILL.md` (project). The directory name is the `/name` command.

```markdown
---
name: deploy-checklist
description: Use when deploying or releasing a service, to walk the pre-deploy checks.
disable-model-invocation: false
allowed-tools: Bash, Read
---

# Deploy checklist

1. Confirm the release branch is green in CI.
2. Check the migration plan is reversible.
```

Frontmatter is YAML; the body is Markdown and becomes the instruction text.


## Detail

- A folder with a SKILL.md (YAML frontmatter + Markdown body). Model-invoked when the description matches, or user-invoked as /name. The body loads only when used, so reference material is cheap until needed.
- Content lifecycle: rendered SKILL.md enters as one message and stays for the session and is never re-read, so write standing instructions, not one-time steps; the allowed-tools grant clears on your next message [OFFICIAL]
- Compaction re-attaches the most recent invocation of each skill, first 5,000 tokens each within a 25,000-token combined budget filled newest-first, so older skills drop entirely [OFFICIAL]
- Put load-bearing rules early in SKILL.md, because compaction keeps only the first 5,000 tokens of each skill [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Consumer-side control: skillOverrides in settings changes visibility without editing a skill you did not write (four states, written by /skills); permission rules govern the Skill tool. user-invocable: false controls only menu visibility and does NOT block Skill-tool access - use disable-model-invocation [OFFICIAL]
- Official Claude documentation defines Skill behavior. Anthropic Skill Creator supplies official evaluation guidance. Superpowers supplies a stricter community TDD method.
- CLAUDE.md content is always in context. A Skill body loads on demand. A fact everyone always needs → CLAUDE.md. A procedure used sometimes → Skill.
- Fresh session = no prior context that could leak the answer. Repeat a few times; behaviour varies.
- From superpowers writing-skills and the skill-creator plugin. Not a core-docs requirement, but the discipline that makes a skill actually change behaviour.  [ENGINEERING]
- The description is the trigger surface Claude reads when deciding whether to load the Skill, so it carries both what the Skill does and when to apply it.
- Some community Skill libraries state only triggering conditions, symptoms, and keywords, reasoning that a workflow summary invites Claude to act on the summary and skip the body. That is a community method, not the documented rule, and it contradicts the what-plus-when guidance above. Adopt it deliberately or not at all.  [COMMUNITY]
- Large reference docs, examples, and scripts live beside SKILL.md and load only when referenced. Keeps the always-loaded body small.
- Trigger testing is a SEPARATE dimension from behaviour testing. A skill can trigger perfectly and still give wrong output, or give great output but never fire.
- Levers: description (key use case first; combined with when_to_use it is truncated near 1536 chars in the listing), when_to_use trigger phrases, and paths globs that scope auto-activation to matching files.
- Once it triggers and works on the happy path, attack it. Each pressure that breaks compliance becomes a rationalization-table row + a red-flag, then a counter in the skill.
- Layout: skills/<name>/SKILL.md (required) plus reference.md, examples.md, scripts/helper.py loaded/executed only when needed.
- Personal/project skill: the command comes from the directory name; frontmatter name is only the display label. Plugin skill: command is namespaced /plugin:name.
- Also ${CLAUDE_SESSION_ID}, ${CLAUDE_PROJECT_DIR}, and dynamic context injection via a backtick-bang command line whose output is inlined before Claude reads the body.
- Required baseline recorded for workflow/compliance Skills
- Fires on in-scope, silent on out-of-scope (FP + FN checked)
- Original failing case now passes
- Holds under the pressure scenarios
- Rationalization table + red-flags captured
- Eval/regression suite exists and passes
- Body is lean; heavy content in supporting files
- Frontmatter minimal + valid
- .claude/commands/deploy.md and .claude/skills/deploy/SKILL.md both create /deploy and work the same way. Existing .claude/commands/ files keep working ([LEGACY] path); skills add supporting files, invocation-control frontmatter, and auto-loading.
- Use explicit-only when the action is destructive, expensive, or should never fire on its own (deploy, release, bulk edit). Otherwise let Claude auto-invoke.
- Invoke /name with representative args; confirm it appears in the / menu unless user-invocable: false.
