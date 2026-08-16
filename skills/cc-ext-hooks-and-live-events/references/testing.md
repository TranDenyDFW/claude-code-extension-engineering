# Testing and iteration

> Claude Code 2.1.229, verified 2026-08-13. What that means here: this file carries NO verbatim quotes, so the quote gate says nothing about it; the capability surface moved to 44 current tools and held at 31 current hook events. 129 of 190 mirrored pages changed since 2.1.224 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading.


How to prove an extension works. Run the task WITHOUT the extension first and record the failure, because a control run is what separates content worth shipping from content the model already produces unaided. Trigger and behaviour are separate tests: firing when it should is not the same as being correct once it fires.

**Layer:** Capability | **Classification:** supporting | **Status:** stable

## Testing strategy

- Establish a BASELINE first, in a fresh session, without the change in place.
- Run every test in a fresh session so no context leaks in from the authoring conversation.
- Two independent dimensions. Test them separately, because passing one says nothing about the other:
  - **Discovery / routing.** Does it fire when it should? Measure false negatives (missed) and false positives (fired when it should not have).
  - **Behaviour.** Once it fires, is the output correct?
- Coverage classes, all six:
  - Positive, the happy path.
  - Negative, cases where the correct action is to do nothing.
  - Edge and boundary.
  - Adversarial and pressure, where the prompt pushes against the rule.
  - Malformed or missing input.
  - Repeated execution, to catch state that leaks between runs.
- Guard-the-guard: enforcement code must not be able to break the tool it protects.
- Integration: mechanisms tested together, not only alone. Parts that pass in isolation routinely fail in combination.

## Regression strategy

- Every baseline failure and every pressure failure becomes a permanent eval case. Fixed once means tested forever.
- The rationalization table grows over time. Each recorded rationalization gets an explicit counter.
- Maintain a red-flags list of self-check signals, so a known bad pattern is recognised rather than re-derived.
- Re-run the full suite on any change to the mechanism.
- Re-baseline after a model change or a Claude Code version change. Both can move behaviour without any edit on your side.

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

- **Score structurally, never on text.** A handler printing `BLOCKED` to stdout with exit 0 and
  no `hookSpecificOutput` is an ALLOW. Matching on output text scores the banner, not the
  decision.
- **A false positive counts exactly like a miss.** Without the `near-miss` cases, a hook that
  denies unconditionally passes everything.
- **The spec must be able to fail.** Re-run every `enforce` and `wiring` case against two
  controls: an EMPTY tree with nothing installed, and an INERT bundle whose handler is present,
  executable and always exits 0. A case that still passes against either is asserting nothing.

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

- Shared evaluation, regression, failure capture, and iteration practices.
- Shared testing philosophy referenced by every extension mechanism.
- Every fixed failure becomes a permanent test. Re-run the whole suite on each edit, and after a model upgrade.
