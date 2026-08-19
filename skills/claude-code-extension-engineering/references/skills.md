# Skills

> Claude Code 2.1.229, verified 2026-08-13. What that means here: all 1 verbatim quote in this file re-checked against a refreshed docs mirror and still present (tools/quote-check.mjs); the capability surface moved to 44 current tools and held at 31 current hook events. 129 of 190 mirrored pages changed since 2.1.224 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading.


A SKILL.md file holding reusable instructions the model reads when it decides the skill is relevant, or when you invoke it by name. One primitive with several invocation modes: model-invoked, user-invoked with /name, and plugin-shipped. Custom commands were merged into skills, so a .claude/commands/x.md and a .claude/skills/x/SKILL.md both produce /x and behave the same way.

**Layer:** Capability | **Classification:** primitive | **Status:** stable

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
- Baseline procedure:
  1. Write a representative task the skill should handle.
  2. Run it in a FRESH session WITHOUT the skill.
  3. Observe the actual behaviour. Does the model already do the right thing unaided?
     - YES → reconsider whether the skill is needed at all.
     - NO → capture the failure and continue.
  4. Record the exact failure, verbatim.
  5. Record the incorrect reasoning or rationalization, verbatim.
  6. Classify the failure type.
  7. Design the MINIMUM intervention that fixes it.
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

Once it triggers and works on the happy path, attack it. Each pressure below is a separate test case.

- Pressure scenarios, ten of them:
  - Time pressure.
  - Sunk-cost pressure.
  - The user says 'skip the procedure'.
  - Authority claim, as in 'the lead approved skipping'.
  - Conflicting instructions.
  - Ambiguous or borderline case.
  - Partial completion already done.
  - Existing work that would need to be undone.
  - Long context, late in the session.
  - A similar but NON-applicable task.
- Per-failure loop, run once per pressure that breaks compliance:
  1. Failure observed.
  2. Capture the exact rationalization the model used, verbatim.
  3. Determine the root cause.
  4. Modify the MINIMUM necessary instruction.
  5. Fresh-session retest.
  6. Re-run all previous tests.
  7. New failure? YES → loop back to step 1. NO → continue.
- Artifacts produced: a rationalization-table row and a red-flag entry per broken pressure, each with its counter written into the skill.
- This is the generic capture-change-retest loop from [testing.md](testing.md), specialised for behavioural failures.

## Structure + frontmatter reference

- Directory + progressive disclosure  [OFFICIAL]
- Command name: dir name (personal/project) vs frontmatter name (plugin)  [OFFICIAL]
- String substitutions: $ARGUMENTS, $0/$1, $name, CLAUDE_SKILL_DIR  [OFFICIAL]
- Autonomous vs user invocation are both first-class  [OFFICIAL]
- A project skill's allowed-tools activates on workspace trust acceptance, so a checked-in skill can grant itself broad tool access - review .claude/skills/ before trusting a repo [OFFICIAL]

## Integrate with other mechanisms

- Skill can pre-approve tools, fork to a subagent, or scope a hook

## Common failure modes / anti-patterns

- An unquoted colon-space inside the description makes the YAML frontmatter unparseable, and the failure is SILENT at runtime: the skill loads with empty metadata, every frontmatter field dropped, so discovery runs on the directory name alone and the skill almost never auto-fires. claude plugin validate catches it ("YAML frontmatter failed to parse"); the live symptom is a skill that looks installed but never triggers. Quote any description containing ": ". Found live in this very skill, which shipped with the defect from birth  [ENGINEERING]  [v2.1.220]
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
- Legacy versus modern, now the same system:
  - Legacy: .claude/commands/NAME.md, a flat file  [LEGACY]  [DEPRECATED]
  - Modern: .claude/skills/NAME/SKILL.md, a folder  [OFFICIAL]
  - Both produce /name. The Skill branch owns full authoring.
- Choosing the invocation model. Should Claude ever invoke this on its own?
  - YES → Skill discovery matters, so write a strong description.
  - NO → set disable-model-invocation: true, explicit /name only  [OFFICIAL]
- Authoring surface, unchanged from any other skill:
  - Arguments: $ARGUMENTS, $0/$1, argument-hint.
  - Frontmatter: description, allowed-tools, model.
  - Output and error cases defined explicitly.
- Migration path: move the legacy command file into a skill folder, then test both discoverability and invocation before deleting the original.
- Anti-patterns:
  - Auto-invoking a destructive command that should be explicit.
  - Building a new file under legacy commands/ instead of a skill.
  - No argument-hint and no argument validation.
  - Leaving the old and new versions both live, so /name is ambiguous.

### Definition of Done

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


## Definition of Done

- Required baseline recorded for workflow/compliance Skills
- Fires on in-scope, silent on out-of-scope (FP + FN checked)
- Original failing case now passes
- Holds under the pressure scenarios
- Rationalization table + red-flags captured
- Eval/regression suite exists and passes
- Body is lean; heavy content in supporting files
- Frontmatter minimal + valid


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
- An `@path` in the body inlines that file's contents at invocation, so a command can review or operate on fixed files without the caller pasting them: `- Package config: @package.json` reads the file when the command runs [OFFICIAL]
- A SUBDIRECTORY DOES NOT NAMESPACE A COMMAND. `.claude/commands/frontend/component.md` is `/component`, not `/frontend:component`; the subdirectory shows up in the command's description only. The `/frontend:component` form was real in v1.0.45 and is superseded, so treat a claim that it namespaces as stale rather than merely unsourced [OFFICIAL]
- NESTED SKILLS are the case that does take a qualified name, and only when the name clashes. `apps/web/.claude/skills/deploy/SKILL.md` is reachable as `/apps/web:deploy` while the project-root skill keeps the bare `/deploy`, and invoking the unqualified name appends the qualified variants with an instruction to also invoke whichever one owns the files in play [OFFICIAL]  [v2.1.203]
- .claude/commands/deploy.md and .claude/skills/deploy/SKILL.md both create /deploy and work the same way. Existing .claude/commands/ files keep working ([LEGACY] path); skills add supporting files, invocation-control frontmatter, and auto-loading.
- Use explicit-only when the action is destructive, expensive, or should never fire on its own (deploy, release, bulk edit). Otherwise let Claude auto-invoke.
- Invoke /name with representative args; confirm it appears in the / menu unless user-invocable: false.
- Scoring a pressure run needs OBSERVABLE SIGNALS, not just the outcome. The Definition of Done asks that a skill hold under the pressure scenarios, and a run that complied by luck and a run that complied because the skill worked look identical in a transcript. Two signals separate them: the agent CITES the skill, and it NAMES the temptation it felt before declining. Absent both, a pass is unfalsifiable  [ENGINEERING]
- An ALWAYS-ON skill that should stay inert inside subagents has no frontmatter route, and the two mechanisms that look like one are not. The skills key in [subagents.md](subagents.md) preloads skills INTO a subagent, and disable-model-invocation blocks that preload but also makes the skill user-only by slash name, which an always-on routing skill cannot accept. The convention that fills the hole is a guard line at the top of the BODY telling a subagent dispatched for a specific task to ignore the skill. A live instance runs in this project  [ENGINEERING]
- The description has a SECOND AUDIENCE the frontmatter table does not mention: it is rendered in the /help list, so it is sized for a one-line menu entry as well as for auto-invocation matching. A description tuned only for matching reads as noise in a menu, and one tuned only for the menu matches poorly  [ENGINEERING]
- Translating a skill: translate the BODY, keep the routing FRONTMATTER in English. The description is what the load decision matches against, so translating it silently breaks invocation while the skill still looks correct. Measured adjacent to this: a Japanese question in the evaluation set was answered correctly BECAUSE the English description still matched  [ENGINEERING]
