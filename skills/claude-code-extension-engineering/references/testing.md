# Testing and iteration

> Claude Code 2.1.239. What that means here: this file carries ONE verbatim quote and
> `tools/quote-check.mjs` confirms it still appears upstream. Per-claim provenance lives in
> `evidence/claims.jsonl`, where the gates read it; nothing else is asserted here.


How to prove an extension works. Run the task WITHOUT the extension first and record the failure, because a control run is what separates content worth shipping from content the model already produces unaided. Trigger and behaviour are separate tests: firing when it should is not the same as being correct once it fires.

**Layer:** Capability | **Classification:** supporting | **Status:** stable

## Testing strategy

- Establish a BASELINE, in a fresh session, without the change in place. The documentation prescribes exactly this for skills: collect a few realistic prompts, run each in a fresh session with the skill available and again with it disabled, and compare  [OFFICIAL]
- Running the control FIRST is ours, not documented. The docs name the with-change arm first and state no order at all. Order matters anyway, because a baseline taken after you have seen the treatment is a baseline you already know the answer to  [ENGINEERING]
- Run every test in a fresh session so no context leaks in from the authoring conversation. The documented reason is the same one: leftover context from authoring will MASK GAPS in the written instructions, so the session that wrote the extension is the worst place to test it  [OFFICIAL]
- Two independent dimensions. Test them separately, because passing one says nothing about the other. Documented for skills in one sentence: seeing a skill trigger tells you Claude found it, not that it did what you intended  [OFFICIAL]
  - **Discovery / routing.** Does it fire when it should? Measure false negatives (missed) and false positives (fired when it should not have). The documented instrument generates should-trigger and should-not-trigger prompts and measures the hit rate  [OFFICIAL]
  - **Behaviour.** Once it fires, is the output correct? The same documented sentence carries this half: whether the output matches what you expect when it does  [OFFICIAL]
- Extending both dimensions beyond SKILLS is ours. Every documented sentence here is scoped to skills and the skill-creator loop; nothing in the mirror applies the split to hooks, subagents or plugins, and the transfer is inference  [ENGINEERING]
- Coverage classes, all six. No taxonomy of test-coverage classes exists anywhere in the documentation, so the SET is this library's, even where individual members are documented practice  [ENGINEERING]
  - Positive, the happy path. The substance is documented for plugins, trigger the event each hook matches and confirm its effect, but not as a named class  [OFFICIAL]
  - Negative, cases where the correct action is to do nothing. The should-not-trigger half of description tuning is the documented instance  [OFFICIAL]
  - Edge and boundary  [ENGINEERING]
  - Adversarial and pressure, where the prompt pushes against the rule  [ENGINEERING]
  - Malformed or missing input. The docs prescribe HANDLING this in the code you write and never prescribe it as a case class to cover, which is the difference between a robust handler and a tested one  [ENGINEERING]
  - Repeated execution, to catch state that leaks between runs  [ENGINEERING]
  - Fixture hygiene belongs to that class and is easy to get backwards: give every fixture a fresh path per run, remove it with an API that is actually in scope, and never behind an empty catch. An observed failure called `require('node:fs')` inside an ES module, so the ReferenceError was swallowed, the fixture was never cleaned, and the test passed on a clean directory while failing on every rerun. A check that only passes the first time is not a check  [ENGINEERING]
- Guard-the-guard: enforcement code must not be able to break the tool it protects  [ENGINEERING]
- Integration: mechanisms tested together, not only alone. Parts that pass in isolation routinely fail in combination. Note the documented guidance points the OTHER way, telling you to check each skill, agent and hook separately, though it says so while debugging a broken plugin rather than as a testing philosophy  [ENGINEERING]

## A test that writes where production writes destroys the evidence it was meant to produce

An extension under test usually writes somewhere: a capture file, a log, an append-only sidecar. If
the test writes to that same path, its rows become indistinguishable from real ones, and the file
then reads as proof that the mechanism is live. This is worse than no evidence, because the file
looks like evidence and is checked instead of the thing itself.

- Give the writer a path override and make every test set it, so a test row cannot land in the
  production file by default. A path passed explicitly is a decision; a path defaulted to is an
  accident waiting for the first hurried run  [ENGINEERING]
- STAMP the synthetic rows at write time rather than telling them apart later. A row written through
  the override carries `probe: true` forever; a heuristic applied afterwards ("this session id looks
  fake") has to be re-derived by every reader and gets it wrong once  [ENGINEERING]
- Ship a one-command report that counts genuine, probe and UNCLASSIFIABLE rows separately, and make
  it refuse to guess. Rows written before the stamp existed are not genuine and not probes; a report
  that folds them into either number is the same failure again, one level up  [ENGINEERING]
- Beware the synthetic row that carries real identifiers. A test that replays a captured payload,
  or that hand-builds one using the live session id and real token counts, produces rows that pass
  every plausibility check. The tell is timing and variance: a debounced UI writes rows that DIFFER,
  while a replay writes N identical rows inside a second  [ENGINEERING]
- Absence of genuine rows is not a finding on its own. Before concluding "the host never invoked
  it", exclude the gates that produce the same silence: the entrypoint, workspace trust, whether the
  settings file was even loaded, and whether the command can spawn at all. A negative needs a paired
  POSITIVE control, one run where the mechanism did fire, or it is just a file that is empty
  [ENGINEERING]

## Regression strategy

- Every baseline failure and every pressure failure becomes a permanent eval case. Fixed once means tested forever  [ENGINEERING]
- The rationalization table grows over time. Each recorded rationalization gets an explicit counter  [ENGINEERING]
- Maintain a red-flags list of self-check signals, so a known bad pattern is recognised rather than re-derived  [ENGINEERING]
- CADENCE, and the documentation disagrees with the obvious reading: run the FOCUSED tests while you are changing the mechanism, and the full suite ONCE before you commit, not after every edit. The only sentence in the docs about whole-suite runs prefers single tests for performance, and while that line is about a codebase's own tests rather than an extension eval suite, nothing anywhere recommends the whole suite per edit. A targeted test is already inside the suite, so a mid-iteration full run is duplication  [ENGINEERING]
- Re-baseline after a MODEL change. The docs prescribe revisiting instructions after major model releases, because a rule written around an older model's limitation MAY BECOME OVERHEAD once a newer model handles the case on its own  [OFFICIAL]
- Re-baseline after a Claude Code VERSION change too. That half is ours: no page prescribes it, and this library has repeatedly found behaviour moving between builds with no edit on the reader's side  [ENGINEERING]

## Iteration loops

Development is not a one-way checklist. The generic loop is CAPTURE FAILURE, then MINIMAL CHANGE, then retest. Each specialised loop below is that same cycle with a class-specific middle step, and each one ends by returning to CAPTURE FAILURE rather than terminating.

| Failure class | Symptom | Minimal change | Retest |
|---|---|---|---|
| Discovery failure | Wrong trigger, or no trigger at all | Inspect the description and its keywords, adjust minimally | Fresh-session re-trigger |
| Behavioural failure | Wrong output under pressure | Capture the rationalization verbatim, then counter it | Re-run the pressure suite |
| Hook false positive | Blocks a safe action | Tighten the matcher or the logic | Pass-path retest |
| Hook false negative | Misses a bad action | Broaden the check | Block-path retest, then re-check false positives |
| Subagent routing failure | Mis-routes, or does not route | Fix the agent description, not the calling prompt | Re-test delegation |
| Integration failure | Parts pass alone, fail together | Find the seam between them | Re-run integration |
| Plugin install failure | Clean install breaks | Fix the structure or the manifest | Re-install clean, then upgrade and rollback |
| Regression | An old case breaks again | Re-open its eval case | Re-run the FULL suite |

- Bisect with --safe-mode (or CLAUDE_CODE_SAFE_MODE), which starts with CLAUDE.md, plugins, skills, hooks and MCP all disabled (2.1.169); iterate with /reload-skills (2.1.152) and /reload-plugins. Skill edits apply in-session, but a NEW top-level skills directory needs a restart [OFFICIAL]  [v2.1.169]

## Grading CONTENT, which the conformance spec cannot do

The conformance spec below settles whether a runnable artifact behaves. It says nothing about
whether a piece of authored content is any GOOD, and this library publishes comparative results
that only a grading method can produce. That method belongs here, next to the results it justifies.

- The agent that did the work must not be the agent that grades it. The documentation states the principle directly, describing a verification subagent or dynamic workflow that has a fresh model try to refute the result, "so the agent doing the work isn't the one grading it"  [OFFICIAL]
- A documented eval loop already exists and is worth using before building one: the `skill-creator` plugin stores cases in `evals/evals.json`, spawns a subagent PER CASE so each run starts with a clean context, records token count and duration, writes pass or fail WITH EVIDENCE to `grading.json`, aggregates with-skill against without-skill into `benchmark.json`, and runs a blind A/B between two versions so an edit is confirmed as an improvement before it is committed  [OFFICIAL]
- Note what that loop already gives you, because two of its properties are rules this file states elsewhere on its own authority: a fresh context per case, and a with-versus-without comparison. The baseline discipline above is not a house convention  [ENGINEERING]
- SPLIT THE ROLES, because one agent doing all three corrupts each. A COMPARATOR sees both outputs as A and B, knows nothing about which arm produced which, and scores against stated criteria. A REPORTER reads the aggregate and is forbidden from proposing improvements, so the report stays a neutral read rather than an argument written backwards from its recommendation. An ANALYST comes last, sees the verdict FIRST, and only then opens both artifacts to explain the difference  [ENGINEERING]
- The ordering is the mechanism, not bureaucracy. An analyst who knows which arm is which before scoring will find reasons for the answer it expects, and a comparator that never unblinds produces a number nobody can act on. Blind scoring alone and diagnosis alone are both half a method  [ENGINEERING]
- Grade against criteria that are individually checkable, and have the grader score each one separately. A single overall verdict hides which criterion failed, and a criterion nothing can check passes by default forever. This library has shipped that defect: the Definition of Done in [subagents.md](subagents.md) once asked for summary quality to be verified with nothing anywhere defining a good summary  [ENGINEERING]
- When the grader cannot tell, the assertion FAILS. There is no partial credit, and every verdict carries the quoted evidence it rests on. An ambiguous result that drifts toward a pass is how a suite manufactures confidence, and [permissions.md](permissions.md) already takes the same conservative direction for a different question, where an unmatched shape is undetermined rather than allowed  [ENGINEERING]
- A green aggregate is not a read of the run. Pass rates hide which cases are HIGH VARIANCE across repeats and where cost is being spent for no discrimination, neither of which a score surfaces. A separate pass over the raw runs, emitting observations rather than a number, is what makes an aggregate actionable  [ENGINEERING]

## The conformance spec: ship the expected outcome beside the artifact

An extension that has no recorded expected outcome cannot be tested, only run. Ship a
`conformance.json` next to the extension and keep it in version control with it.

Four case kinds, because each catches a distinct real failure:

| Kind | Asserts | The failure it catches |
|---|---|---|
| `enforce` | the thing that must be blocked IS blocked | the guard never fires |
| `near-miss` | a safe neighbour is NOT blocked | a guard so broad it gets disabled out of annoyance |
| `wiring` | the matcher actually selects this handler for this tool | correct logic wired to the wrong tool, which never fires in production |
| `fail-posture` | deleting or crashing the handler does not yield `allow` | a command hook FAILS OPEN, so "guarantee" was never guaranteed |

```json
{ "id": "C1", "kind": "enforce", "event": "PreToolUse",
  "input": { "tool_name": "Write", "tool_input": { "file_path": "infra/main.tf" } },
  "expect": { "decision": "deny" } }
```

Three rules that decide whether the spec is worth anything:

- **Score structurally, never on text.** A handler printing `BLOCKED` to stdout with exit 0 and no `hookSpecificOutput` reported NO DECISION, not an allow: exit 0 with no output means the hook has nothing to say, so the call continues through the normal permission flow where a deny rule or a prompt can still stop it. `permissionDecision` takes `allow`, `deny`, `ask` or `defer`, and silence is none of them. Score the decision field, because the banner is not one and neither is its absence  [OFFICIAL]
- That distinction decides what a case PROVES. A `near-miss` case passing because the handler stayed silent has shown only that nothing blocked at that point, which is also what a deny rule further down the flow would produce. Assert the decision field, or the case cannot tell a working guard from an absent one  [ENGINEERING]
- **A false positive counts exactly like a miss.** Without the `near-miss` cases, a hook that denies unconditionally passes everything. The docs measure a hit rate for skill routing and never state this equivalence, so the weighting is ours  [ENGINEERING]
- **The spec must be able to fail.** Re-run every `enforce` and `wiring` case against two controls: an EMPTY tree with nothing installed, and an INERT bundle whose handler is present, executable and always exits 0. A case that still passes against either is asserting nothing. No page requires a test to be shown capable of failing, and neither control appears anywhere in the documentation  [ENGINEERING]
- **Ship the test INSIDE the artifact, not only beside it.** A hook or tool carrying a `--self-test` subcommand, printing PASS or FAIL per named check and exiting non-zero on any failure, can be verified on a machine that has neither this harness nor Claude Code installed. The external harness proves behaviour against a running host; the self-test proves the artifact is internally sound anywhere. They answer different questions, and an extension wants both  [ENGINEERING]
- **A check needs three outcomes rather than two: 0 passed, 1 a real negative, 2 the check COULD NOT RUN.** Collapsing the third into either of the others is how an inability to test gets recorded as a finding, or worse as a pass. This does not contradict the grading rule above, and the distinction is the point: a GRADER that cannot tell is covered by the no-partial-credit rule above, because an unreadable answer is still a bad answer; when a PROBE cannot run there is no answer to grade, and reporting one either way is fabrication. Decide which of the two a check is before choosing its failure mode  [ENGINEERING]
- **Anchor a check by CONTENT, never by line number.** A check scoped to specific lines stops checking the right thing the moment anything is inserted above them, and keeps reporting green. An observed case hardcoded two line numbers and would have gone on reporting CLEAN against whatever later occupied them. Pair that with a positive control INSIDE the checker: feed it a known-bad input on every run and abort if it fails to fire, so the check proves it can still see  [ENGINEERING]
- **Prove the production artifact was untouched, inside the test.** Three parts: make every store path overridable, because a tool that can only be exercised against production data will not be exercised; REFUSE to create a store at a path that does not exist, because a mistyped override otherwise produces an empty store and reports zeros, which reads exactly like "there was nothing to do"; and assert the production file's mtime is unchanged across the run rather than assuming the redirect held  [ENGINEERING]

`fail-posture` is the case kind that turns "does it work" into "is it a guarantee", and it is
the one that most often changes the mechanism. A command hook cannot pass it: a missing or
crashing handler fails open by design. Passing needs a harness-owned mechanism, normally a
`permissions.deny` rule. Write a file rule as `Edit(path)`, never `Write(path)`: a `Write` path
rule is accepted and never consulted.

```bash
node tools/extension-prove.mjs --bundle <dir>          # run the spec
node tools/extension-prove.mjs --prove-fail            # prove the spec can fail
node tools/extension-scaffold.mjs --list-packs
node tools/extension-scaffold.mjs --requirement "..." --out <dir>
node tools/extension-scaffold.mjs --policy <file> --out <dir>
```

## Staging state a handler reads: `setup`

A handler that runs a prerequisite check, or validates a document on disk, decides from state
that is NOT in the tool payload. A case stages that state:

```json
{ "id": "gate-passes", "kind": "wiring",
  "input": { "tool_name": "Bash", "tool_input": { "command": "deploy prod" } },
  "setup": { "files": { "deploy/manifest.json": "{}" }, "env": { "GATE_TESTS": "1" } },
  "expect": { "decision": { "not": "deny" } } }
```

Files are written into the per-case temp copy, never the bundle, and a path key that escapes
that copy is refused. `env` is merged into the handler's environment; `CLAUDE_PROJECT_DIR`
stays the harness's, so a case cannot repoint the project root and escape its own copy.

**Pair every setup-bearing case with `"mutate": "ignore-setup"`.** That drops the setup, and
the paired case must go the OTHER way. Without it, a staged file the handler never reads makes
the first case pass for the wrong reason, which is a check that cannot fail wearing a
prerequisite as a costume.

## Generating a command validator

`extension-scaffold` has two purpose packs. `protect-path` reads a path out of prose;
`validate-before-action` generates a `PreToolUse` validator from an explicit `--policy` file,
covering five validation families: command validation, dangerous-operation blocking, required
checks, document schema validation, and pre-deployment gates. Routing is by required inputs, so
prose can never reach the policy pack and a policy can never reach the prose pack.

The policy is data, and the generator REFUSES rather than defaulting: an unknown key, an
unanchored pattern, a check with no timeout, a command written as a string instead of an argv
array, two rules with the same predicate and different decisions, or a policy in which nothing
can ever deny. It also refuses a rule whose own declared `examples.match` does not actually
match it, which is the mistake no structural validator can catch.

Two things the generated validator does NOT do, both proved rather than documented. `allow` is
not auto-approve: the handler emits a decision only to deny, so normal permission prompts still
happen on every other path. And a command hook fails open, so every bundle carries a `residual`
case for the deleted handler, and a policy declaring `absolute: true` is marked strict and
reports NOT DONE rather than claiming a guarantee it cannot keep.

## Detail

- Evaluation, regression, failure capture, and iteration practices. Two of those four, evaluation and iteration, are documented, for skills only; the other two are this library's  [ENGINEERING]
- This file is the testing material other reference files point at, and "every mechanism" would be false: 6 of the 28 sibling reference files link here and 22 do not. The documentation has no shared testing page either, only per-mechanism sections on four pages using different vocabulary and different depth  [ENGINEERING]
- Every fixed failure becomes a permanent test. Re-baseline after a model upgrade, and run the full suite once before committing rather than after each edit, per the cadence rule above  [ENGINEERING]
