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
for, and the full-population GitHub study found the deny rule went unconsidered in every
issue where a user wanted a hard guarantee.

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
