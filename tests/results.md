# Test results

Run 2026-07-28 against Claude Code 2.1.219, question set v1 (160 questions).
Answering and grading model: `claude-opus-5`.

---

## Tier 1: deterministic content coverage

`node tests/run-tests.mjs`. Each question carries a regex answer key and a source file. The
runner asserts the key matches (or, for routing-negative rows, does not match).

| Category | n | Pass | Rate |
|---|---|---|---|
| factual | 105 | 105 | 100% |
| navigation | 15 | 15 | 100% |
| routing-positive | 15 | 15 | 100% |
| routing-negative | 10 | 10 | 100% |
| anti-hallucination | 15 | 15 | 100% |
| **TOTAL** | **160** | **160** | **100%** |

**Read this number correctly.** It is close to tautological on the first run, because every
answer key was extracted from the shipped content. 100% here means the keys are accurate, not
that the content is good. Tier 1 earns its keep as a *regression* gate: when a future Claude
Code version changes a fact, or an edit removes one, the affected rows go red.

### Prove-fail

`node tests/run-tests.mjs --prove-fail` replaces every source file with its title line and
re-runs. Result: **150 of 150 positive assertions went red**. The 10 routing-negative rows stay
green by design and are excluded from the assertion, because "this term is absent" is trivially
true against empty content and would hide a hollow suite.

A suite that stays green when the content is deleted proves nothing. This one does not.

---

## Tier 2: control versus treatment

The measurement `references/testing.md` demands of every extension, applied to this one. Same
135 questions asked twice (routing rows are excluded: they test invocation, which has no
control equivalent).

- **Control arm.** Six subagents, no access to the skill, answering from general knowledge.
- **Treatment arm.** Six subagents, same questions, answering from the skill files only.

| Category | n | Control | Treatment | Delta |
|---|---|---|---|---|
| factual | 105 | 50 (48%) | 105 (100%) | +55 |
| navigation | 15 | 1 (7%) | 15 (100%) | +14 |
| anti-hallucination | 15 | 9 (60%) | 15 (100%) | +6 |
| **TOTAL** | **135** | **60 (44%)** | **135 (100%)** | **+75 (+56 points)** |

### Method, and why the comparison is fair

Both arms received an identical prompt scaffold, identical question text, identical output
format, and the same model. The only difference was the clause granting or withholding access
to the skill content. Behaviour confirms the separation held: control agents made 2 tool calls
each (read the batch, write the answers), treatment agents made 18 to 22 (reading references).

Grading ran in two passes, applied identically to both arms:

1. **Regex.** The same `answer_key` used by Tier 1, matched against the free-text answer. Raw
   result was control 8 (6%), treatment 94 (70%).
2. **Adjudication.** All 168 regex misses from both arms went to four grader subagents, blind
   to which arm produced each answer, interleaved by question ID. Graders saw the question, the
   verbatim ground-truth line, and the answer. Verdicts: 93 CORRECT, 16 PARTIAL, 59 INCORRECT.
   Only CORRECT upgrades a row. PARTIAL does not.

The adjudication pass **upgraded control by 52 rows and treatment by 41**. It helped the
control arm more, which is what you want from a fairness correction: the strict regex had been
penalising the arm that could not know the source's exact phrasing.

### Per-source-file breakdown

| Source | n | Control | Treatment |
|---|---|---|---|
| `references/hooks.md` | 17 | 35% | 100% |
| `SKILL.md` | 15 | 7% | 100% |
| `references/plugins.md` | 13 | 38% | 100% |
| `references/skills.md` | 12 | 58% | 100% |
| `references/subagents.md` | 11 | 36% | 100% |
| `references/workflows.md` | 10 | 20% | 100% |
| `references/mcp.md` | 9 | 67% | 100% |
| `references/hook-events.md` | 6 | 33% | 100% |
| `references/agent-teams.md` | 6 | 50% | 100% |
| `references/context-modes.md` | 5 | 100% | 100% |
| `references/output-styles.md` | 4 | 50% | 100% |
| `references/testing.md` | 4 | 25% | 100% |

---

## What these numbers do not prove

Stated plainly, because a benchmark that only advertises its wins is not evidence.

- **Treatment scoring 100% is a retrieval result, not a correctness result.** The treatment arm
  read the same files the answer keys were derived from. It shows the content is findable and
  unambiguous. It says nothing about whether the content is *true* of Claude Code. Accuracy
  against the product is a separate problem, and `references/sources.md` still carries
  `not recorded` in the Verified column on 15 of its 19 rows.
- **Tier 1 matches file-wide, not line-wide.** A key is asserted to appear somewhere in its
  source file, not on the line that answers the question. Where a phrase recurs, a row can stay
  green even if the specific passage it was written to guard is deleted. `F104` and `F078` are
  known examples. Both are sound today, and narrowing the match to a section is an open
  improvement.
- **Control at 44% is a floor, not a ceiling.** These agents had no web access and one pass.
  A model that could search the official documentation would score higher, so the honest claim
  is that the skill beats unaided recall, not that it beats looking things up.
- **Tier 2 is not reproducible.** It is model-graded and nondeterministic. Re-running will
  move the numbers. Tier 1 is the reproducible layer.
- **The question set is written by the same author as the content.** It tests what the content
  covers. It cannot reveal a topic that was never written about.
- **`references/context-modes.md` scored 100% in both arms.** On this evidence that file adds
  nothing a model does not already know, and it is a candidate for cutting by the same standard
  `references/composition-cards.md` sets.

---

## Re-running the suite

```bash
node tests/run-tests.mjs
node tests/run-tests.mjs --prove-fail
```

Tier 1 must be green and prove-fail must go red before any release. After a Claude Code version
bump, expect Tier 1 failures where the product changed: each failure is a content update, not a
test bug. Update the fact, update the key, and record the new build in the header of every
reference.

Tier 2 needs re-running only when the content changes materially. Keep the arms identical apart
from skill access, keep the grading blind, and report the adjudication upgrade counts for both
arms so the correction stays auditable.

---

## Per-question detail

Control and Treatment columns are the adjudicated result: a regex hit, or a blind grader
verdict of CORRECT.

| ID | Category | Source | Question | Control | Treatment |
|---|---|---|---|---|---|
| A001 | anti-hallucination | `references/agent-teams.md` | Is Agent Teams stable and on by default? | PASS | PASS |
| A002 | anti-hallucination | `references/subagents.md` | What is the default subagent nesting depth? | FAIL | PASS |
| A003 | anti-hallucination | `references/workflows.md` | Does the slash command name for a workflow come from the filename or from meta.name? | FAIL | PASS |
| A004 | anti-hallucination | `references/hooks.md` | Is additionalContext honoured on PostToolUseFailure? | FAIL | PASS |
| A005 | anti-hallucination | `references/hooks.md` | Does a relative command path in a frontmatter hook work? | PASS | PASS |
| A006 | anti-hallucination | `references/compatibility.md` | Does this document tell me whether my installed build supports a feature? | PASS | PASS |
| A007 | anti-hallucination | `references/themes.md` | Can a custom theme change how Claude behaves? | PASS | PASS |
| A008 | anti-hallucination | `references/agent-sdk.md` | Should I use the Agent SDK to change how my interactive Claude Code sessions behave? | PASS | PASS |
| A009 | anti-hallucination | `references/hook-events.md` | Can I infer one hook event's blocking behaviour from another event's? | PASS | PASS |
| A010 | anti-hallucination | `references/context-modes.md` | Do all mechanisms called fork inherit the same context? | PASS | PASS |
| A011 | anti-hallucination | `references/mcp.md` | Can transport errors be relied on to enforce a policy decision? | PASS | PASS |
| A012 | anti-hallucination | `references/skills.md` | Should a skill description contain the whole procedure? | PASS | PASS |
| A013 | anti-hallucination | `references/plugins.md` | Is claude plugin validate sufficient as a CI gate by default? | FAIL | PASS |
| A014 | anti-hallucination | `references/output-styles.md` | Can I rely on /output-style to select a style on a current build? | FAIL | PASS |
| A015 | anti-hallucination | `references/sources.md` | Are all the upstream sources for this document redistributable? | FAIL | PASS |
| F001 | factual | `references/hooks.md` | What does a hook exit code of 0 mean, and how is stdout treated? | FAIL | PASS |
| F002 | factual | `references/hooks.md` | What does hook exit code 2 do? | PASS | PASS |
| F003 | factual | `references/hooks.md` | Name the five hook handler types. | FAIL | PASS |
| F004 | factual | `references/hooks.md` | On Windows, what happens if a hook command uses a bare $CLAUDE_PROJECT_DIR? | FAIL | PASS |
| F005 | factual | `references/hooks.md` | What is the default timeout for SessionEnd hooks? | FAIL | PASS |
| F006 | factual | `references/hooks.md` | What syntax does the hook handler `if` field use? | FAIL | PASS |
| F007 | factual | `references/hooks.md` | Does PostToolBatch support matchers? | PASS | PASS |
| F008 | factual | `references/hooks.md` | What is the character cap on hook output? | FAIL | PASS |
| F009 | factual | `references/hooks.md` | Why should a hook handler not pipe stdin through jq? | PASS | PASS |
| F010 | factual | `references/hooks.md` | Can an individual hook be disabled without disabling the others? | PASS | PASS |
| F011 | factual | `references/hooks.md` | Does an HTTP hook handler fail open or closed on a connection failure? | PASS | PASS |
| F012 | factual | `references/hooks.md` | Which tool calls skip both PreToolUse and PostToolUse? | FAIL | PASS |
| F013 | factual | `references/hooks.md` | Where does claude --debug write hook match and exit-code evidence? | FAIL | PASS |
| F014 | factual | `references/hooks.md` | Is ${CLAUDE_SKILL_DIR} substituted inside a frontmatter hook command? | FAIL | PASS |
| F015 | factual | `references/hooks.md` | What are the default hook timeouts by handler type? | FAIL | PASS |
| F016 | factual | `references/hook-events.md` | How many documented hook events are there? | FAIL | PASS |
| F017 | factual | `references/hook-events.md` | Which event does the changelog add that is missing from the hooks reference page? | FAIL | PASS |
| F018 | factual | `references/hook-events.md` | What does exit 2 do on the Stop event? | PASS | PASS |
| F019 | factual | `references/hook-events.md` | What does a nonzero exit do on WorktreeCreate? | FAIL | PASS |
| F020 | factual | `references/hook-events.md` | Which handler types does SessionStart accept? | FAIL | PASS |
| F021 | factual | `references/skills.md` | What is the approximate character cap on a skill description combined with when_to_use? | FAIL | PASS |
| F022 | factual | `references/skills.md` | How much of each skill does compaction re-attach? | FAIL | PASS |
| F023 | factual | `references/skills.md` | What is the combined token budget for skills re-attached at compaction? | FAIL | PASS |
| F024 | factual | `references/skills.md` | Does user-invocable: false prevent the Skill tool from accessing a skill? | PASS | PASS |
| F025 | factual | `references/skills.md` | Which frontmatter field makes a skill user-only? | PASS | PASS |
| F026 | factual | `references/skills.md` | What does context: fork do in skill frontmatter? | PASS | PASS |
| F027 | factual | `references/skills.md` | Which Claude Code version introduced ${CLAUDE_SKILL_DIR} in allowed-tools? | FAIL | PASS |
| F028 | factual | `references/skills.md` | What is the risk of a checked-in project skill that declares allowed-tools? | PASS | PASS |
| F029 | factual | `references/skills.md` | Where does a skill's command name come from for a personal or project skill? | PASS | PASS |
| F030 | factual | `references/skills.md` | Is a rendered SKILL.md re-read during the session? | PASS | PASS |
| F031 | factual | `references/skills.md` | Why should load-bearing rules go early in SKILL.md? | FAIL | PASS |
| F032 | factual | `references/plugins.md` | Is the plugin manifest required? | FAIL | PASS |
| F033 | factual | `references/plugins.md` | What happens to the default folder when a plugin manifest declares a custom path field? | FAIL | PASS |
| F034 | factual | `references/plugins.md` | Which manifest path field adds to the default rather than replacing it? | FAIL | PASS |
| F035 | factual | `references/plugins.md` | Where does a marketplace install place plugin files? | FAIL | PASS |
| F036 | factual | `references/plugins.md` | Is ${CLAUDE_PLUGIN_ROOT} stable across plugin updates? | PASS | PASS |
| F037 | factual | `references/plugins.md` | Where should a plugin write persistent state? | FAIL | PASS |
| F038 | factual | `references/plugins.md` | How do you stop claude plugin validate from passing on unrecognized top-level fields? | PASS | PASS |
| F039 | factual | `references/plugins.md` | Is a CLAUDE.md at the plugin root loaded as context? | PASS | PASS |
| F040 | factual | `references/plugins.md` | Where do plugin components live relative to .claude-plugin/? | PASS | PASS |
| F041 | factual | `references/plugins.md` | Which version introduced ZIP plugin loading? | FAIL | PASS |
| F042 | factual | `references/plugins.md` | Which version introduced claude plugin init? | FAIL | PASS |
| F043 | factual | `references/plugins.md` | What does defaultEnabled: false do? | PASS | PASS |
| F044 | factual | `references/subagents.md` | Which subagent frontmatter fields are required? | PASS | PASS |
| F045 | factual | `references/subagents.md` | Where does a file-based subagent's system prompt come from? | PASS | PASS |
| F046 | factual | `references/subagents.md` | Is there a prompt frontmatter field for file-based subagents? | PASS | PASS |
| F047 | factual | `references/subagents.md` | How many orchestration tools are removed from a subagent regardless of the tools list? | FAIL | PASS |
| F048 | factual | `references/subagents.md` | What is the concurrent subagent limit and its environment variable? | FAIL | PASS |
| F049 | factual | `references/subagents.md` | What is the per-session subagent limit? | FAIL | PASS |
| F050 | factual | `references/subagents.md` | Is a subagent's returned report trusted content? | PASS | PASS |
| F051 | factual | `references/subagents.md` | Which frontmatter fields do plugin subagents ignore? | FAIL | PASS |
| F052 | factual | `references/subagents.md` | What is the precedence order when subagent names collide? | FAIL | PASS |
| F053 | factual | `references/subagents.md` | Which subagents ship built in? | FAIL | PASS |
| F054 | factual | `references/mcp.md` | Which MCP transport is deprecated? | PASS | PASS |
| F055 | factual | `references/mcp.md` | Can a tool input schema use anyOf, oneOf or allOf at the root? | PASS | PASS |
| F056 | factual | `references/mcp.md` | At what size do MCP tool descriptions and server instructions truncate? | FAIL | PASS |
| F057 | factual | `references/mcp.md` | What is the default MCP output cap and its environment variable? | PASS | PASS |
| F058 | factual | `references/mcp.md` | What does _meta anthropic/requiresUserInteraction do? | PASS | PASS |
| F059 | factual | `references/mcp.md` | What happens in .mcp.json when a ${VAR} is unset and has no default? | FAIL | PASS |
| F060 | factual | `references/mcp.md` | What happens to a main-conversation MCP call still running at two minutes? | PASS | PASS |
| F061 | factual | `references/mcp.md` | What is the cost of setting alwaysLoad on an MCP server? | FAIL | PASS |
| F062 | factual | `references/workflows.md` | Where must a workflow script be saved to become a reusable slash command? | FAIL | PASS |
| F063 | factual | `references/workflows.md` | What constraint applies to the meta object in a workflow script? | PASS | PASS |
| F064 | factual | `references/workflows.md` | Are workflow scripts TypeScript? | FAIL | PASS |
| F065 | factual | `references/workflows.md` | Why do Date.now() and Math.random() throw inside a workflow script? | PASS | PASS |
| F066 | factual | `references/workflows.md` | What are the workflow concurrency and per-run agent limits? | FAIL | PASS |
| F067 | factual | `references/workflows.md` | What is the item cap for a single pipeline() or parallel() call? | FAIL | PASS |
| F068 | factual | `references/workflows.md` | What is the difference between pipeline() and parallel()? | FAIL | PASS |
| F069 | factual | `references/workflows.md` | Can a workflow script enumerate files itself? | FAIL | PASS |
| F070 | factual | `references/workflows.md` | Are Dynamic Workflows experimental? | FAIL | PASS |
| F071 | factual | `references/context-modes.md` | Why is the word fork ambiguous in Claude Code? | PASS | PASS |
| F072 | factual | `references/context-modes.md` | Does a named subagent receive the CLAUDE.md hierarchy? | PASS | PASS |
| F073 | factual | `references/context-modes.md` | Which built-in agents skip CLAUDE.md and the git-status snapshot? | PASS | PASS |
| F074 | factual | `references/context-modes.md` | What starting context does a conversation fork receive? | PASS | PASS |
| F075 | factual | `references/output-styles.md` | Which authored mechanism modifies the system prompt rather than adding context? | PASS | PASS |
| F076 | factual | `references/output-styles.md` | What does the keep-coding-instructions frontmatter key do? | PASS | PASS |
| F077 | factual | `references/output-styles.md` | What happened to the /output-style command? | FAIL | PASS |
| F078 | factual | `references/themes.md` | Where do custom themes live? | PASS | PASS |
| F079 | factual | `references/themes.md` | Do custom themes change model behaviour? | PASS | PASS |
| F080 | factual | `references/auto-memory.md` | Is auto memory on by default and is it hand-authored? | FAIL | PASS |
| F081 | factual | `references/auto-memory.md` | When should CLAUDE.md be chosen over auto memory? | PASS | PASS |
| F082 | factual | `references/agent-sdk.md` | Is the Agent SDK discovered from the .claude/ directory? | PASS | PASS |
| F083 | factual | `references/agent-sdk.md` | How are SDK custom tools defined and where do they run? | PASS | PASS |
| F084 | factual | `references/claude-md-family.md` | Does Claude Code read AGENTS.md? | FAIL | PASS |
| F085 | factual | `references/claude-md-family.md` | How deep do @path imports recurse? | FAIL | PASS |
| F086 | factual | `references/claude-md-family.md` | When does a path-scoped rule trigger? | PASS | PASS |
| F087 | factual | `references/lsp.md` | Which Claude Code version introduced the LSP tool? | FAIL | PASS |
| F088 | factual | `references/lsp.md` | What happens on builds before v2.1.205 if an LSP server declares restartOnCrash? | FAIL | PASS |
| F089 | factual | `references/lsp.md` | When may project LSP servers be started? | PASS | PASS |
| F090 | factual | `references/agent-teams.md` | Which environment variable enables Agent Teams? | FAIL | PASS |
| F091 | factual | `references/agent-teams.md` | How many teams can run per session, and can teams nest? | PASS | PASS |
| F092 | factual | `references/agent-teams.md` | What happens to a subagent definition body when reused as a teammate? | FAIL | PASS |
| F093 | factual | `references/agent-teams.md` | What team size does Anthropic recommend? | FAIL | PASS |
| F094 | factual | `references/agent-teams.md` | How should work be partitioned between teammates? | PASS | PASS |
| F095 | factual | `references/compatibility.md` | Do Cowork and cloud sessions read ~/.claude/skills? | PASS | PASS |
| F096 | factual | `references/compatibility.md` | What do the version numbers in this document record? | PASS | PASS |
| F097 | factual | `references/testing.md` | What must be run before building an extension, and why? | FAIL | PASS |
| F098 | factual | `references/testing.md` | What are the two independent testing dimensions? | PASS | PASS |
| F099 | factual | `references/testing.md` | Which flag or environment variable starts Claude Code with all extensions disabled for bisecting? | FAIL | PASS |
| F100 | factual | `references/testing.md` | Do skill edits apply in-session, and what needs a restart? | FAIL | PASS |
| F101 | factual | `references/selection.md` | Are hooks purely mechanical? | FAIL | PASS |
| F102 | factual | `references/selection.md` | Can an LSP server be authored without building a plugin? | PASS | PASS |
| F103 | factual | `references/selection.md` | Is choosing between automatic invocation and explicit trigger a choice between two mechanisms? | PASS | PASS |
| F104 | factual | `references/composition-cards.md` | For the Skill plus Hook pairing, what is the enforcement point? | PASS | PASS |
| F105 | factual | `references/composition-cards.md` | For the Plugin plus LSP pairing, what is the external dependency? | PASS | PASS |
| N001 | navigation | `SKILL.md` | Which reference covers choosing between the mechanisms? | FAIL | PASS |
| N002 | navigation | `SKILL.md` | Which reference covers combining two mechanisms? | FAIL | PASS |
| N003 | navigation | `SKILL.md` | Which reference covers hook event contracts? | FAIL | PASS |
| N004 | navigation | `SKILL.md` | Which reference covers which build introduced a capability? | FAIL | PASS |
| N005 | navigation | `SKILL.md` | Which reference covers the evidence sources? | FAIL | PASS |
| N006 | navigation | `SKILL.md` | Which reference covers fanning work out across many agents? | FAIL | PASS |
| N007 | navigation | `SKILL.md` | Which reference covers code intelligence and language servers? | FAIL | PASS |
| N008 | navigation | `SKILL.md` | Which reference covers persistent per-session instructions? | FAIL | PASS |
| N009 | navigation | `SKILL.md` | Which reference covers changing how Claude responds rather than what it knows? | PASS | PASS |
| N010 | navigation | `SKILL.md` | Which reference covers testing and iteration? | FAIL | PASS |
| N011 | navigation | `SKILL.md` | Which reference covers the programmatic library tier? | FAIL | PASS |
| N012 | navigation | `SKILL.md` | Which reference covers running Claude Code in CI on a pull request? | FAIL | PASS |
| N013 | navigation | `SKILL.md` | Which reference covers where a delegated job gets its starting context? | FAIL | PASS |
| N014 | navigation | `SKILL.md` | Which reference is marked experimental in the routing table? | FAIL | PASS |
| N015 | navigation | `SKILL.md` | What are the two questions the skill says decide most mechanism choices? | FAIL | PASS |

