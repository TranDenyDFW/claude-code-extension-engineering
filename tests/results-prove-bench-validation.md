# prove-bench: the validation-failure-mode cohort

A second cohort, measured 2026-08-07 on Windows, Claude Code 2.1.224, Node 24.

It is a **separate experiment** in its own directory with its own results file. The published
10-of-10-versus-3-of-10 result in [results-prove-bench.md](results-prove-bench.md) and its
`tests/prove-bench/results.json` are not read or written by anything here. A measurement that
moves when you add work beside it is not a measurement.

## The question

The first cohort asked whether a behavioural spec catches a defective **path protection**. This
one asks the same about a defective **command validator**, which is a different and harder shape:
the extension now runs programs, reads documents, and decides from state that is not in the tool
payload.

## Design

One validation policy (`release-guard`), three families in it so that a defect confined to one
evaluator produces a distinct failing set rather than the same blanket failure every time:

| rule | family | what it does |
|---|---|---|
| `no-rm-rf` | dangerous-operation | blocks `rm` with `-rf`, including inside a compound command |
| `tests-before-push` | required-check | blocks `git push` unless a declared check exits 0 |
| `manifest-valid` | schema-validation | blocks `deploy apply` unless a document satisfies a narrow schema |

`extension-scaffold` generates one bundle from that policy. That bundle is the **control**.
Eleven variants carry a defective implementation and a **byte-identical `conformance.json`**. The
spec is the constant, the implementation is the single variable, and the invariant is asserted by
`checkSpecIsConstant`, not assumed.

Wiring counts as implementation: two variants change `settings.json` rather than the handler,
because a validator that never fires is the commonest way one of these fails in production and it
is not a defect you can see by reading the handler.

**Expected failures are hand-declared, never read back from the tool.** `scoreDiagnosis` requires
the failing case-id set to EQUAL the set the defect predicts, so deriving that set by running
`extension-prove` would make the score a check that cannot fail: whatever the tool reported would
be, by construction, what was expected.

## Result

```
extension-prove : 10 of 10 caught with the correct diagnosis, 0 false positives on the control
test-hook.sh    :  1 of 11 caught,                            0 false positives on the control
known blind spot: 1 fixture, excluded from the denominator and named below
```

| fixture | defect | extension-prove | test-hook.sh |
|---|---|---|---|
| `correct-validator` | control | clean | clean |
| `no-op-validator` | parses the payload, always exits 0 | CATCH | MISS |
| `stdout-theatre` | prints a BLOCKED banner as text, exits 0 | CATCH | MISS |
| `blocks-everything` | denies every Bash command | CATCH | MISS |
| `matcher-wrong-tool` | matcher names `Write`, policy is about Bash | CATCH | MISS |
| `handler-path-bare-variable` | bare `$CLAUDE_PROJECT_DIR`, so the handler never runs | CATCH | CATCH |
| `substring-match` | `command.includes('rm -rf')` instead of parsing | CATCH | MISS |
| `first-segment-only` | stops at the first shell operator | CATCH | MISS |
| `ignores-check-exit-code` | runs the required check, discards its status | CATCH | MISS |
| `document-read-not-validated` | reads the document, validates nothing | CATCH | MISS |
| `only-first-rule-consulted` | rules 2 and 3 are dead configuration | CATCH | MISS |
| `explicit-allow-decision` | emits `permissionDecision: "allow"` | **MISS (declared)** | MISS |

The competitor's single catch is `handler-path-bare-variable`, where bash could not find the
script at all. It caught a missing file, not a validation defect. On every fixture where the
handler exists and runs, it printed "Test completed successfully", including the one that denies
every command in the session and the one that blocks nothing at all.

## The declared blind spot, which is ours

`explicit-allow-decision` emits `permissionDecision: "allow"` on its non-deny path. In production
that **bypasses the permission system** for that call and auto-approves what the user would
otherwise be asked about, converting an unmatched command into an approved one.

`extension-prove` cannot see it. Its verdict model treats an explicit allow and an absent decision
as the same outcome, so no case in the shared spec can distinguish them. The fixture ships anyway,
scores MISS, and is excluded from the denominator rather than counted against a competitor that
has the same gap for a different reason. It is listed here so the gap is a measured statement
rather than an absence, and the row flips to a catch the day the verdict model is widened.

## Proving the number can be wrong

Three ways, all run:

**One prediction was wrong, and it was reported rather than reconciled.**
`handler-path-bare-variable` was declared to fail its two `fired: {min: 1}` cases as well, on the
reasoning that a handler which cannot be found does not fire. The first run reported
WRONG-DIAGNOSIS. The evidence says the tool was right: the interpreter exists and only the script
is missing, so node starts, fails to load the module and exits 1, and the verdict records
`fired: 1` with the note "handler exit 1 is a non-blocking error on PreToolUse (fails open)". The
declaration was corrected and the reasoning kept in the fixture, because silently editing an
expectation to match the tool is exactly the circularity the design forbids. Worth knowing
separately: `fired` counts a handler PROCESS that ran, not a handler SCRIPT that ran.

**The control can go FALSE-POS.** Gutting the control's handler in a copied fixture tree
(`PROVE_BENCH_FIXTURES`) turns its row red.

**The tool can be weakened and the number collapses.** The published cohort's own audit stubbed
`runHandler` so no extension code executed and the exit-code-scored result came out
byte-identical. Repeated here against `scoreDiagnosis` (`PROVE_BENCH_PROVE_TOOL` pointed at a
stubbed prover):

```
extension-prove : 4 of 10 caught, 1 false positive on the control, 6 wrong diagnosis
```

Four rows survive because a stubbed handler happens to produce the same failing set as a genuinely
inert one. The control going FALSE-POS is what makes the run unpublishable, which is what a
control is for.

Both overrides refuse to write `results.json`: an experiment must not land in the record.

## What this does NOT show

- **We wrote the fixtures and the expected outcomes.** The measured content is the competitor
  column, the zero false positives on the control, and the collapse under a weakened prover. Our
  own 10 of 10 is by construction, the same limit as the first cohort.
- **Eleven defects is not the space of defects.** They were chosen as mistakes a reasonable person
  ships, and three of them share a failure signature, which is realistic rather than a flaw.
- **One machine, one platform.** `test-hook.sh` was given a jq shim on PATH so it got its best
  chance; without one it fails earlier and scores better by accident.

## Re-running it

```bash
node tests/prove-bench/validation/make-fixtures.mjs --check
node tests/prove-bench/validation/run-bench.mjs
```

`--check` asserts the committed fixtures still match the generator and that all twelve still share
one `conformance.json`. The runner refuses to overwrite `results.json` if the re-run would drop a
recorded tool column, which is the guard the first cohort learned the hard way.
