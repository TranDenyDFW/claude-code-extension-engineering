# prove-bench: does a tool notice the extension does not do what it was asked to do?

Run 2026-08-04. Windows 11, Node v24.14.1, Claude Code 2.1.219.
Reproduce: `node tests/prove-bench/make-fixtures.mjs && node tests/prove-bench/run-bench.mjs`

## The question

Every existing checker in this ecosystem asks whether an extension is well-FORMED.
None asks whether it BEHAVES as specified. This bench asks the second question.

## Result

Transcribed verbatim from `node tests/prove-bench/run-bench.mjs`:

```
fixture                     extension-prove   test-hook.sh
--------------------------  ----------------  ----------------------------
allows-what-it-blocks       CATCH             MISS  [reported success]
blocks-the-near-miss        CATCH             MISS  [reported success]
correct-guard (control)     clean             clean  [reported success]
deny-rule-never-consulted   CATCH             MISS  [reported success]
fails-open-on-crash         CATCH             CATCH  [reported failure]
handler-path-missing        CATCH             CATCH  [no verdict line]
hook-only-no-deny-rule      CATCH             MISS  [reported success]
jq-dependency               CATCH             CATCH  [reported failure]
matcher-wrong-tool          CATCH             MISS  [reported success]
shallow-glob-misses-nested  CATCH             MISS  [reported success]
stdout-theatre              CATCH             MISS  [reported success]

extension-prove : caught 10/10 defects, 0 false positive(s) on the control
                  (a catch requires the failing case set to MATCH the fixture's declared defect, not merely a non-zero exit)
test-hook.sh    : caught 3/10 defects, 0 false positive(s) on the control
```

**The 10 of 10 is BY CONSTRUCTION and is not the headline.** The fixtures were authored
here, against the checks this tool performs. The measured content is the competitor column
and the fact that both tools pass the control.

## What the split actually shows

`test-hook.sh` catches exactly the three defects that surface as a non-zero exit code
(`fails-open-on-crash`, `jq-dependency`, `handler-path-missing`). It misses all seven that
require either an expected outcome or an evaluation of the wiring. That is not a bug in its
implementation, it is its design: it accepts no expected outcome and never reads `hooks.json`.

The clearest single case is `allows-what-it-blocks`: a handler whose guard never fires, so
`infra/main.tf` is written unprotected. `test-hook.sh` prints `Hook approved/succeeded` and
`Test completed successfully`, exit 0.

## Why, from the shipped source

`plugin-dev/skills/hook-development/scripts/test-hook.sh`, lines 245 to 252:

```bash
if [ $exit_code -eq 0 ] || [ $exit_code -eq 2 ]; then
  echo "✅ Test completed successfully"
  exit 0
```

Exit 0 is allow, exit 2 is deny, and both print success. Usage is
`<hook-script> <test-input.json>`: there is no parameter for the expected outcome.
Separately, the strings `hooks.json` and `matcher` do not appear anywhere in the file, so
the matcher is never evaluated. `matcher-wrong-tool` is a correct handler wired to the wrong
tool: it passes every shipped validator and never fires in production.

## Fairness notes, stated because they cut against us

- **`test-hook.sh` was given a jq shim.** jq is absent on this machine, and without it the
  script reports `Test input is not valid JSON` for JSON that Node parses fine, because
  line 155's `jq empty "$TEST_INPUT" 2>/dev/null` swallows command-not-found. Scoring it in
  that state would score a missing dependency rather than the tool, so the bench ships a shim
  and puts it on PATH. This is the competitor's best possible run.
- **It was given the most favourable input**: the conformance case that a correct
  implementation must DENY, rather than a near-miss or a fail-posture case.
- **The shim does not leak into the fixtures.** It is extensionless, so it resolves for
  `test-hook.sh`'s own bash-invoked `jq` but never for a handler's `execFileSync('jq')` under
  Windows. The `jq-dependency` fixture therefore still fails for the real reason (`ENOENT`),
  which is the behaviour a user would get on a machine without jq. Confirmed independently by
  a second reviewer, who also verified a `.cmd` shim would not change this.
- **It is a single-hook tester, not a bundle checker.** Three fixtures
  (`deny-rule-never-consulted`, `shallow-glob-misses-nested`, and the deny half of
  `correct-guard`) concern permission rules, which it has no notion of. Those are scored as
  misses because the defect is real and undetected, not because the tool was misused.
- **We authored both the fixtures and the expected outcomes.** Same construct-validity limit
  disclosed in `results-lint-bench.md`.

## A defect in this bench, found and fixed during the run

The first run reported `test-hook.sh` catching 10 of 10 and producing a false positive on
the control. That was wrong. The bench was passing Windows drive-letter paths (`P:\...`) to
`bash`, which cannot resolve them, so the tool errored on every fixture and every error read
as a catch. **The control is what exposed it**: a tool that flags a correct implementation is
not detecting defects, it is failing. Fixed by converting paths to POSIX form and by
normalising `Path` versus `PATH` in the child environment. Recorded here because a bench that
inflates a competitor's score is as broken as one that deflates it, and this one did the
former before it was caught.

## An adversarial audit found two BLOCKING defects in this bench, both now fixed

Reported 2026-08-04 by an independent multi-agent audit and reproduced before fixing. Both were
defects in the EVIDENCE, not in the tool's output on these fixtures, which is the more dangerous
kind: the numbers were right and the reasons they were right were not established.

**1. The mutation engine had zero gate coverage.** Replacing the body of `applyMutation` with
`return` left all five gates green while `hook-only-no-deny-rule` flipped from
"5 passed, 2 failed" to "7 passed, 0 failed". Cause: `--prove-fail` filtered to `enforce` and
`wiring` cases, so `fail-posture`, the kind that carries the central claim that a command hook
fails open, was never exercised by any gate.
*Fixed:* `--self-test` now asserts `applyMutation` really deletes and really rewrites the
handler, and `--prove-fail` no longer excludes `fail-posture` (66 case-runs became 110).
*Proven:* gutting `applyMutation` now exits 1 with three specific failures.

**2. The headline was scored on exit code alone.** Stubbing `runHandler` so that NO extension
code executed at all left every gate green and reproduced "10 of 10 versus 3 of 10"
BYTE-IDENTICALLY, because any non-zero exit counted as a catch. Under that stub
`blocks-the-near-miss` passed the very case that defines its defect.
*Fixed:* every fixture now declares the case set its defect predicts, and a CATCH requires the
observed failing set to MATCH it. Detecting a defect for the wrong reason scores
`WRONG-DIAGNOSIS`, which is not a catch. This holds `extension-prove` to a STRICTER bar than the
competitor, which is only ever scored on its single verdict.
*Proven:* under the same stub the bench now reports **7 of 10 with 3 WRONG-DIAGNOSIS**, naming
each expected-versus-observed mismatch.

The headline number is unchanged at 10 of 10. What changed is that it now means the tool
identified each defect correctly, not merely that it exited non-zero.

Three further audit findings were fixed in the same pass: `--check` used to REPAIR the drift it
detected (it called the generator over the committed tree, so it could not fail twice and
silently destroyed the drifted content); `--prove-fail` would print its success message after
zero case-runs; and the docstring claimed a read-only guarantee that no gate asserted, now
narrowed to what is actually checked.

## The fixtures

One shared requirement, one byte-identical conformance spec, and only the implementation
varies. The requirement:

> Prevent any change to a file under `infra/`. Leave everything outside `infra/` untouched.
> The protection must still hold if the guard's own script is deleted or crashes.

The correct answer is a permissions deny rule `Edit(infra/**)`, not a hook. Two documented
facts make it the only passing implementation:

1. It is harness-owned, so it still denies when the handler is deleted or crashing. A command
   hook fails OPEN in both cases.
2. It must be written `Edit(...)`. Per the official permissions page, a path rule for `Write`,
   `NotebookEdit`, `Glob` or `MultiEdit` is "accepted but never consulted", and an `Edit` rule
   covers every file-editing tool. `deny-rule-never-consulted` is that exact silent failure.

`hook-only-no-deny-rule` is the pedagogically important fixture: a perfectly correct hook that
passes all five live cases and fails both fail-posture cases. It is the mechanism users reach
for. In the GitHub study, blind raters named the permissions deny rule as the overlooked
alternative in **5 of the 9 issues hand-read** for that question, and correctly declined to
name it for #79959 where deny rules were the user's own proposal.

An earlier version of this sentence said "the full-population GitHub study found the deny rule
went unconsidered in EVERY issue where a user wanted a hard guarantee". That overstated the
evidence by two steps: the population was 81,002 issues but this question was never computed
over it, and the underlying figure is 5 of 9 on a hand-read sample, not all. Corrected after an
adversarial audit. The backing detail file lived in a deleted harness scratchpad, so neither
the sample nor the population is re-derivable from this repo; the surviving source is
`.md/20260803-github-issue-mining-summary.md`.

### An earlier requirement that was NOT satisfiable

The first draft added "unless the content carries an `APPROVED-<4 digits>` token". No
implementation can satisfy that:

- a command hook alone fails the fail-closed clause,
- a deny rule survives handler deletion but, per the permissions page, a broad deny rule
  "can't carry allowlist exceptions",
- both together means deny wins, so approved changes are blocked too.

The exemption was dropped. The unsatisfiability is itself a result worth recording: a
requirement combining a conditional exemption with a hard guarantee has no answer in the
current mechanism set short of OS-level sandboxing.

## Gates

```bash
node tools/extension-prove.mjs --self-test      # 35 checks: matcher, verdict, permission rules, expect
node tools/extension-prove.mjs --prove-fail     # 66 case-runs against empty and inert controls
node tests/prove-bench/run-bench.mjs --self-test
node tests/prove-bench/make-fixtures.mjs --check
```

`--prove-fail` is the one that matters. Every `enforce` and `wiring` case is re-run against
two controls: `empty` (nothing installed) and `inert` (valid settings, handler present and
executable, always exit 0). Any case that still passes is asserting nothing about the
extension, and the run prints `PROVER IS HOLLOW` and exits 1.

## Fidelity calibration against live Claude Code sessions

Run 2026-08-04 against Claude Code 2.1.219. `node tools/tier4-fidelity.mjs --live`.
Full record in `tests/tier4/fidelity.json`.

This was the project's load-bearing open limit: without it, `extension-prove` asserted
conformance to OUR READING of the documented contract, and a misreading would have been
invisible. Eight cases, one per behaviour class, each computed twice: once by the simulator,
once by a real `claude -p` session. The live observable is GROUND TRUTH ON DISK, whether the
target file exists and whether the handler's marker appeared, never the model's narration.

```
F1 stdout-json-deny             AGREE      exit 0 + permissionDecision deny blocks
F2 exit2-deny                   AGREE      exit 2 blocks on PreToolUse
F3 matcher-scoping              AGREE      matcher "Bash" does not select for a Write
F4 matcher-wildcard             AGREE      "*" matches every tool
F5 fail-open-on-crash           AGREE      a crashing handler blocks NOTHING
F6 permission-deny-edit         AGREE      Edit(infra/**) blocks a Write
F7 permission-deny-write-inert  AGREE      Write(infra/**) is accepted and NEVER consulted

fidelity: 8/8 = 100.0%
```

F7 matters most: the "accepted but never consulted" behaviour was encoded from the docs and had
never been observed. It holds live.

### The calibration found a real defect that 8 of 8 agreement HID

The live marker recorded the actual input:

```
FIRED event=PreToolUse tool=Write path=P:\ClaudeExt\...\probe4\infra\main.tf
```

Claude Code hands a hook an **absolute path with native separators**. Every conformance case
here fed a relative POSIX path, `infra/main.tf`. The eight outcomes still agreed only because
the calibration guard was deliberately written to normalise both shapes.

The bench's own CONTROL handler was not. Given the real shape it **allowed** the write:

```
relative POSIX (what the cases USED to feed)        -> deny
absolute Windows (what the product ACTUALLY sends)  -> allow      <- would not fire in production
```

So a handler could pass this bench and be dead in production, which is precisely the failure
class the project exists to catch, sitting inside its own instrument. Outcome agreement alone
would never have surfaced it; only recording the real input did.

**Fixed:** `extension-prove` now absolutises `file_path` against the temp project before
invoking a handler, matching the product. Permission rules are matched against the
project-RELATIVE form, because a rule is written `Edit(infra/**)`. The two shapes are different
and are no longer conflated. The fixture guards were corrected from an anchored `^infra/` to a
substring match, and re-verified against relative POSIX, absolute Windows and absolute POSIX.

A second defect surfaced while fixing the first: widening the guard regex silently broke the
`.replace()` target that three fixtures use to inject their defect, so they shipped WITHOUT the
defect and passed for the wrong reason. The generator now asserts every intended substitution
actually changed the text, and refuses to emit otherwise. Proven by breaking a target literal on
purpose: `FAIL fixture handler substitution was a NO-OP for: allows-what-it-blocks`, exit 1.

The headline is unchanged at 10 of 10 after both fixes, now measured under the real path shape.

### Round 2: the classes round 1 left uncalibrated

Run 2026-08-04, 7 classes x 2 passes = 14 live sessions. Record in
`tests/tier4/fidelity-round2.json`. Two result kinds are kept strictly apart, because
counting unmodelled behaviour as agreement would be the same self-certifying defect this
project exists to catch:

| class | what the product ACTUALLY does |
|---|---|
| `timeout-fails-open` | a handler that exceeds its timeout **FAILS OPEN**. The marker proved it ran; the write proceeded anyway |
| `timeout-within-budget` | the same handler with a generous timeout denies correctly |
| `settings-scope-merge` | `settings.json` and `settings.local.json` hooks **MERGE**, both fire. Order is not guaranteed: two runs gave `["B","A"]` and `["A","B"]` |
| `if-filter-matches` | a handler with `if: "Bash(git *)"` fires for `git status` |
| `if-filter-excludes` | the same handler does NOT fire for `echo HELLO` |
| `http-handler-unreachable` | an unreachable HTTP gate **FAILS OPEN**, as documented |
| `user-prompt-submit-exit2` | exit 2 on `UserPromptSubmit` blocks the **whole turn**, so nothing is written |

Every one was stable across both passes.

**Three of these changed a verdict, so they were implemented rather than merely recorded:**
the timeout fail-open (previously the simulator would report a deny where the product
allows), the `if` filter (previously ignored entirely, so a filtered handler fired on every
call and produced a false deny), and the HTTP handler (now reported as unsimulated and
failing open rather than silently treated as absent). Eleven new self-test assertions gate
them. After implementing, a re-run scored **5 of 5 modelled classes agreeing**, with
`settings-scope-merge` and `user-prompt-submit-exit2` still recorded as MEASURED rather than
claimed.

Two corrections made during round 2, both caught before they reached a published number:

- The `user-prompt-submit-exit2` expectation was written backwards. I predicted the write
  would proceed; it does not, because exit 2 blocks the turn. The live run said DIVERGES and
  the expectation was wrong, not the product.
- `settings-scope-merge` first reported `["A","A"]`, which cannot distinguish "both handlers
  fired" from "one fired twice". Root cause: the second handler was derived with a
  `.replace()` whose target carried one backslash too many, so it silently no-opped and both
  handlers wrote the same marker. The case proved nothing until the second handler was
  written out in full. That is the third backslash-escaping failure of the day and the same
  no-op-substitution class the fixture generator now guards against.

### Still NOT calibrated, with the reason

Listing these is the point: an unlisted gap reads as covered.

| class | why not |
|---|---|
| PostToolUse exit 2 | the tool has already run, so disk state cannot distinguish blocked from allowed. The only signal is model narration |
| SessionStart additionalContext | observable only by asking the model to echo injected text, which measures the model, not the harness |
| Managed-settings precedence | requires writing the platform managed-settings path, an administrator surface, out of scope for a test harness |
| PreCompact, SubagentStop, Stop | each needs a session shaped to reach the event; not reachable from one headless turn with a disk-visible outcome |

### Honest limits of this calibration

- **n is small.** Round 1 is 8 classes at ONE pass each; round 2 is 7 classes at TWO passes
  each and every case was stable. The Tier 4 design called for at least 10 passes per class.
  This is 1 and 2. Stability across two passes is evidence, not a rate.
- **One CLI build, one platform.** 2.1.219 on Windows. Hook behaviour has moved between builds
  before.
- **Only the classes listed.** Settings precedence, timeouts, HTTP handlers, `if`-rule filters
  and every non-PreToolUse event are UNCALIBRATED and remain a reading of the docs.
- Live runs granted workspace trust by writing `hasTrustDialogAccepted` into `~/.claude.json`,
  backed up and restored automatically.

## What this does NOT measure

- **Not usefulness.** A bundle can pass every case and still be a bad thing to ship.
- **Not triggering.** Whether a generated skill is discovered and invoked is a different
  question, and `skill-creator/scripts/run_eval.py` already measures it properly with real
  `claude -p` sessions and a stratified train/test split.
- **Not the real harness.** `extension-prove` evaluates conformance to the documented contract
  as written in `references/hooks.md` and the official permissions page. It is not Claude
  Code, and no fidelity calibration against live sessions has been done. Every case kind
  carries the citation it was derived from so the reading can be disputed.
- **Not generalisation.** A finite input set. Passing is evidence about those inputs.
