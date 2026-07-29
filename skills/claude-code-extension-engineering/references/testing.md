# Testing and iteration

> Claude Code 2.1.219, verified 2026-07-26.


How to prove an extension works. Run the task WITHOUT the extension first and record the failure, because a control run is what separates content worth shipping from content the model already produces unaided. Trigger and behaviour are separate tests: firing when it should is not the same as being correct once it fires.

**Layer:** Capability &middot; **Classification:** supporting &middot; **Status:** stable

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

## Detail

- Shared evaluation, regression, failure capture, and iteration practices.
- Shared testing philosophy referenced by every extension mechanism.
- Every fixed failure becomes a permanent test. Re-run the whole suite on each edit, and after a model upgrade.
