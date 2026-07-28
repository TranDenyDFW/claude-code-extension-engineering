# Testing and iteration

> Claude Code 2.1.219, verified 2026-07-26.


How to prove an extension works. Run the task WITHOUT the extension first and record the failure, because a control run is what separates content worth shipping from content the model already produces unaided. Trigger and behaviour are separate tests: firing when it should is not the same as being correct once it fires.

**Layer:** Capability &middot; **Classification:** supporting &middot; **Status:** stable

## Cross-cutting Engineering (Testing, Regression, Iteration)

- Testing strategy
- Establish a BASELINE first (fresh session, without the change)
- Fresh-session tests (no leaked context)
- Two independent dimensions
- Discovery / routing: does it fire (FP + FN)?
- Behaviour: is the output correct once it runs?
- Coverage classes
- Positive (happy path)
- Negative (should NOT act)
- Edge / boundary
- Adversarial / pressure
- Malformed / missing input
- Repeated execution
- Guard-the-guard: enforcement code cannot break the tool
- Integration: mechanisms tested together, not only alone
- Regression strategy
- Keep every baseline + pressure failure as an eval case
- Rationalization table grows; each row has a counter
- Red-flags list (self-check signals)
- Re-run the full suite on any change to the mechanism
- Re-baseline after a model or Claude Code version change
- Iteration loops
- Generic loop
- CAPTURE FAILURE
- MINIMAL CHANGE
- Specialised loops (per failure class)
- Discovery failure
- Wrong / no trigger
- Inspect description + keywords
- Adjust minimally
- Fresh-session re-trigger
- Behavioural failure
- Wrong output under pressure
- Capture rationalization
- Re-run pressure suite
- Hook false positive
- Blocks a safe action
- Tighten matcher / logic
- Pass-path retest
- Hook false negative
- Misses a bad action
- Broaden check
- Block-path retest
- Re-check false positives
- Subagent routing failure
- Mis-routes / no route
- Fix description (not the prompt)
- Re-test delegation
- Integration failure
- Parts pass alone, fail together
- Find the seam
- Re-run integration
- Plugin install failure
- Clean install breaks
- Fix structure / manifest
- Re-install clean
- Upgrade + rollback re-test
- Regression
- Old case breaks again
- Re-open its eval
- Re-run FULL suite
- Bisect with --safe-mode (or CLAUDE_CODE_SAFE_MODE), which starts with CLAUDE.md, plugins, skills, hooks and MCP all disabled (2.1.169); iterate with /reload-skills (2.1.152) and /reload-plugins. Skill edits apply in-session, but a NEW top-level skills directory needs a restart [OFFICIAL]  [v2.1.169]

## Detail

- Shared evaluation, regression, failure capture, and iteration practices.
- Shared testing philosophy referenced by every extension mechanism.
- Every fixed failure becomes a permanent test. Re-run the whole suite on each edit, and after a model upgrade.
- Development is not a one-way checklist. The generic loop below, plus one specialised loop per failure class. The last node of each loop arrows back to the first.
