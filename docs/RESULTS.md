# Measured results

`testing.md` in this reference demands a control run before shipping any extension. That
standard is applied to this repo itself, and the numbers are published whether or not they
flatter it. One of them is a pre-committed benchmark that returned NEGATIVE, after which
nothing shipped.

Every number below is re-derived from committed artifacts, and CI fails if the prose drifts
from them. This file is in the drift gate's scan list for exactly that reason: moving numbers
out of a gated file and into an ungated one is how a claim stops being checked without anyone
deciding that it should.

## Tier 1, deterministic regression

**263 questions (set v2), 100% pass.** Each question carries a regex answer key and a source
file, run by [tests/run-tests.mjs](../tests/run-tests.mjs). Sixteen rows were added on
2026-08-13 alongside the out-of-scope boundary table. Three are negative: naming a topic in
order to DECLINE it enlarges the trigger surface, and the guard against over-triggering has
to ship in the same change as the content that creates the risk. Thirteen are positive, added
after an independent reviewer measured that the new content had NO coverage at all: the
boundary table, the word-collision table and the Stop contract could each have been deleted
whole while the suite still reported a full pass.

Six more followed the same day, and both halves of that pattern are worth naming. Four
(`F230` to `F233`) guard the facts added to close the four measured content gaps. Two
(`F234`, `F235`) guard facts a second independent reviewer found the library still could not
deliver: the `terminalSequence` version floor, and the six keys that belong in
`~/.claude.json`. Each was watched going RED against the passage removed and green again on
restore, with a green control on the pristine copy first, because that reviewer's own harness
had crashed mid-run and left a copy dirty, producing a red that meant nothing.

Two more (`N021`, `N022`) came from the live benchmark rather than from a review, and they
guard a ROUTE rather than a fact. A graded session was asked why a settings key was ignored,
opened `INDEX.md`, followed the mid-session-config row to `output-styles.md`, generalised that
page's restart-only behaviour to settings as a whole, and never opened `sessions.md`, where
the correct general rule had just been added. The fact was present and unreachable, which no
content row can detect, because the content stays there while the path to it does not.

**On the quote gate's scope, since the count above has no denominator without it.**
[tools/quote-check.mjs](../tools/quote-check.mjs) inspects double-quoted spans of 25
characters or more, and ONLY on lines carrying an evidence tag. The same reviewer counted 42
qualifying spans on untagged lines and read the plausible ones: all are the library's own
scare quotes, its own phrasing of a wrong conclusion, or measured CLI output, so the scoping
is correct. It is stated here because "every verbatim quote checked" is true of the tagged
set and silent about the rest.

Near-tautological on the first run, since the keys derive from the content. It earns its keep
as a regression gate and through `--prove-fail`, which guts every source file and confirms all
247 positive assertions go red. A suite that stays green against deleted content proves
nothing; this one cannot.

Set v2 (2026-07-31) added coverage for the marketplace-submission facts, the frontmatter
gotcha and the measured behaviours, and retired two known-deficient v1 keys. The 2026-08-05
pass added 26 rows for monitors and channels, including a routing-NEGATIVE row asserting the
skill does not present itself as an observability tool, because documenting monitors is
exactly what creates that over-trigger risk. The 2026-08-06 pass added 18 rows for the
enforcement layer, every answer key verified to match its source exactly once before the row
was written. Changelog: [tests/results.md](../tests/results.md).

## Tier 2, control versus treatment

**135 questions, 44% unaided versus 100% with the skill.** Identical model, prompts and blind
adjudicated grading on both arms; the only difference was access to the skill files. Measured
2026-07-28 on Claude Code 2.1.219 with claude-opus-5.

The treatment score is a retrieval result, not a truth result, and the control had no web
access. Both caveats are spelled out in [tests/results.md](../tests/results.md).

## Tier 3, architecture decisions, and the negative that shipped nothing

**60 scenarios, four arms, twice-graded, three replicates.** The hypothesis was that this
reference and the official docs solve different halves of the rubric, so combining them should
beat the docs. On an instrument rebuilt specifically to detect a small effect, it does not.

Measured 2026-08-02: unaided 71%, official docs 89%, docs plus a staged
decide-then-verify-then-cite procedure 89%, docs plus that procedure plus this skill 89%.
**Combined versus docs alone: 21 scenarios to 20, p=1.000.** A dead heat. The pre-committed
rule returned NEGATIVE and nothing shipped.

Three replicates later, the finding is not the effect but the noise around it:
**run-to-run arm spread of 4 to 5 points dwarfs the 0 to 1 point being measured.** An
instrument cannot resolve a difference smaller than its own variance, and publishing one
anyway is how small effects get manufactured.

**What survives is what always survived**: documentation beats unaided recall by 18 points, 48
paired scenarios to 9, p<0.001, robust to dropping any batch. The largest single component is
`version_caveat`, 35% unaided against 81 to 83% with docs, which is the intuitive result since
version gates are exactly what cannot be recalled.

**The instrument is the real product of that work.** v1 could not resolve the question: dead
key fields, documentation arriving unevenly across arms, and one grader in six who
manufactured a headline that had to be retracted. v2 fixes all four and gates each one: a key
linter that the frozen v1 set fails at 15 errors and v2 passes at 0; a byte-identical local
docs mirror with sha256 per page; two independent graders per cell with blind adjudication;
and citations carrying verbatim quotes checked against the mirror. First reliability number
this benchmark has ever had: **92% exact inter-grader agreement across 1,680 double-graded
cells**, 99% within half a point, zero non-verifying quotes.

So the claim is narrower than the project once hoped and now well measured: the reference
beats unaided recall, and reaches that from a local read rather than dozens of network
fetches. It adds nothing MEASURABLE once the documentation is present. That is a statement
about what this instrument can resolve, not a proof that no benefit exists.

Full method, all three runs, the retraction and the repair log:
[tests/results-tier3.md](../tests/results-tier3.md).

## The deny rule's Bash boundary, measured because it cannot be read

`permissions.md` says a deny rule reaches "file commands Claude Code recognizes in Bash, such
as `cat`, `head`, `tail`, and `sed`". Four examples, no enumeration anywhere on the page. So
there is no reading of the documentation that reaches the edge, and you cannot test your way
there either, because a command that never ran is indistinguishable on disk from one that was
denied.

**400 paired live sessions, eight shapes at n=10, on TWO builds.** Two arms per pass,
identical but for one deny rule. A pass counts only when the rule arm held AND the control arm
changed; both unchanged means the command never ran and the pass is DISCARDED, because scoring
that as a denial measures the model's own caution and publishes it as a security property.

The second run exists because Claude Code 2.1.223 shipped a fix for "a Bash permission bypass
where a crafted command could hide parts of itself from permission checks", and the `cd` row
below is a bypass of exactly that shape. **Every shape reached the same verdict on 2.1.219 and
on 2.1.224.** Only the discard counts moved.

| Shape | Verdict | n | Discarded |
|---|---|---:|---:|
| `printf ... >> infra/main.tf` | DENIED | 10/10 | 0 |
| `cp seed.tf infra/main.tf` | DENIED | 7/10 | 3 |
| `mv infra/main.tf infra/renamed.tf` | DENIED | 10/10 | 0 |
| `sed -i 's/.../.../' infra/main.tf` | DENIED | 10/10 | 0 |
| `rm infra/main.tf` | DENIED | 8/10 | 2 |
| `cd infra && touch fresh.tf` | **ALLOWED** | 10/10 | 0 |
| `powershell Add-Content` | **ALLOWED** | 10/10 | 0 |
| `node build.mjs` | **ALLOWED** | 10/10 | 0 |

Both rig controls unanimous at 10/10: an Edit-tool write to the protected path came back
DENIED, and the same append aimed OUTSIDE the tree came back ALLOWED. Without both, a table of
denials cannot be told apart from a session in which nothing ever ran.

Three of those rows are not in the documentation either way. `touch infra/fresh.tf` was
denied; `cd infra && touch fresh.tf` writes the same file and went through, ten of ten. The
recognition sentence names Bash and never PowerShell. And the arbitrary-subprocess residual,
which this project previously carried as an official citation it had never observed, is now a
local measurement.

Scope: Windows, on two builds. That is what the table speaks for, and the reason it is stated
rather than assumed is that the recognised command set has no documented contract anywhere, so
there is nothing to generalise from. Another platform needs its own run.

Detail, the 25-shape n=1 screen, and the shapes that could not be measured at all:
[permissions.md](../skills/claude-code-extension-engineering/references/permissions.md).

## Lint bench: the doctor against four ecosystem linters

Four ecosystem linters plus the official validator, installed sandboxed and run against
committed fixtures encoding the documented failure modes.

| Tool | Published failure modes | Late | Enforcement | Clean-tree FP | Crashes |
|---|---:|---:|---:|---:|---:|
| claude plugin validate (official) | 0 of 12 | 0 of 5 | 0 of 9 | 1 | 0 |
| extension-doctor | 12 of 12 | 5 of 5 | 9 of 9 | 0 | 0 |

Best competitor overall: 3 of 12. Nothing else caught matcher validity, cross-scope
duplicates, settings shadowing, `disableAllHooks`, the missing handler, the memory cap, MCP
scope collisions, the description cap or version pinning.

**Our own 12 of 12 is by construction and is NOT the headline.** We authored both the fixtures
and the expected outcomes. What is measured is the competitor column and the zero false
positives on the control. Five rounds of scoring hardening, each of which deflated fake
catches, plus the limitations: [tests/results-lint-bench.md](../tests/results-lint-bench.md).

## Prove bench

**10 of 10 defects caught versus 2 of 10**, both with zero false positives on a correct
control.

**This number was 3 of 10 until 2026-08-13, and the correction is against our own interest to
state, so it is stated first.** The competitor's third catch was `handler-path-missing`, whose
recorded detail read `no verdict line`: it exited non-zero without printing either of its own
verdict strings, because it had not run. Under a PowerShell PATH, bare `bash` resolved to the
Microsoft Store WSL alias, which exits 1 with an elevation error, and the scoring function
reads any non-zero exit on a defective fixture as a catch. So a launch failure of OURS was
published as a detection by THEM. The runner now probes for a real bash and refuses to score a
run that produced no verdict, which drops the competitor to 2 and leaves our own score
unchanged, since our tool is scored on matching the declared defect rather than on exit code.

The comparison is against
`plugin-dev/skills/hook-development/scripts/test-hook.sh`, which ends with
`if [ $exit_code -eq 0 ] || [ $exit_code -eq 2 ]` and prints success for both, accepts no
expected outcome, and never reads `hooks.json`, so the matcher is never evaluated.

Same construction limit as above. Detail:
[tests/results-prove-bench.md](../tests/results-prove-bench.md).

## Trigger benchmark

**Precision 100%, recall 96%.** One hundred fifty real headless sessions, three passes per
prompt, majority scoring, in a clean profile. The description never fired on any of the 25
near-miss negatives and fired on 24 of 25 in-scope prompts.

The earlier 16% run turned out to have measured an EMPTY description: the skill's own
frontmatter had been unparseable YAML since authoring, and it was caught the moment the CI
validation gate was armed. Full three-run history:
[tests/results-trigger.md](../tests/results-trigger.md).

## Evidence, not just tags

Every tagged claim in the references maps to a record in
[evidence/claims.jsonl](../evidence/claims.jsonl); every source carries a URL, retrieval date
and status in [evidence/sources.json](../evidence/sources.json); measured behaviours have
reproduction commands under [evidence/observations/](../evidence/observations/).

[tools/verify-evidence.mjs](../tools/verify-evidence.mjs) checks the ledger's integrity,
including drift detection when a tagged line moves, and CI runs it on every push. Two source
rows are recorded `verified-partial` rather than rounded up to `verified`, because a status
column that only ever says `verified` measures nothing.

A daily workflow compares the verified build against the latest npm release and opens a
verification issue when Claude Code moves ahead. The README badge is that status.

## The creator's own gate

`extension-scaffold` generates 13 frozen probes across its two purpose packs and PROVES every
one: each asserts a frozen case-kind sequence, a frozen file list and pack-specific checks, and
then the generated bundle is run through `extension-prove`. A strict probe must report NOT DONE
with every case green, which is the pairing a pass count would miss.

`--gate --prove-gate-can-fail` then attacks that gate 11 times. Each injection puts a real
defect back, RE-RUNS THE WHOLE GATE, requires red, restores, and requires green again: a wrong
matcher tool, a deny decision flipped to allow, a near-miss over-blocked by a widened pattern,
a required-check result ignored, an invalid policy accepted, a crashing handler modelled as
success, and the frozen expectation map corrupted once per pack. An earlier version of this
harness contained two rows that restated fixed behaviour instead of running the gate, and a row
like that passes whether or not the gate works. That is why every row now re-runs it.

Separately, one deliberately broken HANDLER per validation family is caught by a named case,
in both directions for dangerous-operation: widened until it blocks a safe command, caught by
the near-miss arm, and narrowed until it blocks nothing, caught by the enforce arm.

```bash
node tools/extension-scaffold.mjs --gate
node tools/extension-scaffold.mjs --gate --prove-gate-can-fail
node tools/scaffold-parity.mjs --check
node tests/cli-contract.mjs
node tools/coverage-report.mjs --prove-can-fail
```

## The gate that five review rounds asked for

Every gate above tests at the FUNCTION boundary. One sentence, the final verdict the creator
prints, was wrong in four consecutive fixes and moved location each time: a stdout substring match,
then the prover's reporter, then a branch inside `scaffold()`, then the three lines calling the
function that had just been made correct. Every fix was right where it was tested, and nothing ever
ran the CLI and read its output, so the sentence relocated to the nearest place nobody was looking.

Four rounds of numbered checks produced zero failures on their own terms. Four rounds of open-ended
hunting produced fourteen issues. `tests/cli-contract.mjs` closes that gap: it spawns the tools as
processes and asserts exit code, required sentences, and FORBIDDEN sentences. The last is the half
that matters, because the two verdicts differ by three words and asserting only presence passes on
either. Measured afterwards and worth stating: with all four forbidden-sentence lists emptied, the
positive assertions alone still break 2 of 8, so the negative half is defence in depth rather than
the load-bearing part. The first version of this section said otherwise and a reviewer falsified it.

Measured rather than asserted: bypassing `finalVerdict` at its call site while leaving the function
itself correct leaves `extension-scaffold --self-test`, `extension-prove --self-test` and `--gate`
all at exit 0, and breaks two of the eight contracts. The bare invocation also runs three self-guards
that feed the comparator a known-wrong expectation, because a contract file whose comparator returned
"no problems" would otherwise report every contract green.

**Measured 2026-08-08, with the method stated so the ratio is falsifiable.** A verdict line is a
`console.log` OR `console.error` whose text begins with a word that tells the reader the outcome of
the run. The split is 78 and 8; an independent reviewer re-derived the total exactly and flagged
that an earlier wording said `console.log` alone, which yields 78. This
repository's CLIs can print **86 of them across 25 files**. The contract asserted 8, all on one tool,
which is 9.3% of the boundary whose absence let one sentence stay wrong through five review rounds.
It now asserts **15 across 4 tools, 17.4%**, and the remainder is enumerated rather than estimated.

The layered result, measured rather than argued. Neutering the evidence ledger's text-drift check
leaves `verify-evidence` itself at **exit 0**, because a clean ledger has no text drift for the
removed check to catch. Its artifact proof catches it, and so does the CLI contract. A tool's own run
is the weakest of the three instruments, which is the whole reason the other two exist.

Round six pushed the same question one level further: every must-fail proof that mutates a tool was
being performed by a reviewer's hand once and then living only in a review document, and this repo
applied its own cure to two of roughly twenty gates. The numbers gate now carries `--prove-can-fail`,
which spawns it against an unreadable, an absent and a wrong-typed source and requires red each time,
then green on the real tree. That is what would have caught two previous attempts at one defect there
mechanically, instead of by a third review. Extending it to the remaining gates is
[IMPROVEMENTS.md](../IMPROVEMENTS.md) item 44.

## A second prove-bench cohort: command validators

The first cohort asked whether a behavioural spec catches a defective path protection. The
validation cohort asks the same about a command validator, which is harder: the extension now runs
programs, reads documents, and decides from state that is not in the tool payload.

One policy, one generated bundle as the control, eleven defective implementations sharing a
byte-identical `conformance.json`. Expected failures are hand-declared, never read back from the
tool, because deriving them would make the score a check that cannot fail.

```
extension-prove : 10 of 10 caught with the correct diagnosis, 0 false positives on the control
test-hook.sh    :  0 of 11 caught, 1 not measured,            0 false positives on the control
```

**This block said 1 of 11 until 2026-08-13, and it is the same error as the one above, not a
second kind.** The single catch was `handler-path-bare-variable`, recorded with the detail
`no verdict line`: it exited non-zero without printing either of its verdict strings, so it had
not run. Both cohorts credited the competitor for our failure to launch it, and both drop by
exactly that one fixture once a verdictless run scores `n/a`. One fixture is declared a MISS on
purpose, because
`extension-prove` cannot yet distinguish an explicit `permissionDecision: "allow"` from no decision
at all, and naming that blind spot is better than omitting the fixture. Weakening the prover so no
handler code runs collapses the score to 4 of 10 with a false positive on the control, which is
what a control is for. The published 10-of-10-versus-2-of-10 experiment is untouched by this
cohort: separate directory, separate results file. Full write-up and limits:
[results-prove-bench-validation.md](../tests/results-prove-bench-validation.md).

```bash
node tests/prove-bench/validation/make-fixtures.mjs --check
node tests/prove-bench/validation/run-bench.mjs --verify-record
```

`--verify-record` re-runs the cohort and fails on any change to the prove column. A bare run
reports and writes nothing; re-recording is `--record`, deliberately.

## The INDEX.md routing rows: positive in direction, below the bar

**Pooled +5.83 of 42 against a preregistered floor of 6, so it does NOT clear the bar it was
measured against.** Three repeats, 60 sessions, two independent blind graders per repeat.
Measured 2026-08-12 on claude-sonnet-5, preregistered as `route-index-20260812` and sealed
before the first session.

The change under test is the twelve rows added to `references/INDEX.md`, which make six
reference files reachable from the symptom index rather than only from the mechanism table.
ARM A is the bundle without them; ARM D is the same bundle with them, asserted to differ in
exactly two files by sha256 over the whole skill tree.

| | pass 1 | pass 2 | pass 3 | pooled |
|---|---|---|---|---|
| seven symptom-shaped rows | +11.0 | +5.5 | +1.0 | **+5.83** |
| three rows naming their mechanism | 0.0 | +0.5 | 0.0 | +0.17 |

The comparison rows are flat, so the movement is not drift. The sign is positive in all three
repeats. The magnitude is below the floor, and one repeat returned +1.0.

**Pass 1 alone returned +11.0 and would have been published as clearing the floor.** It did not
replicate, and that is the finding worth keeping. Both rows carrying pass 1 failed to repeat:
on ROUTE-04 the control arm mis-routed to `subagents.md` once in three sessions and reached the
right answer the other two, and on ROUTE-05 the treatment arm scored the same as the control in
pass 3. The intermittent mis-route is real; a reliable one it is not.

The instrument is the limiting factor rather than the intervention. Two of seven rows were at
ceiling in every repeat, 6/6 in both arms, so they cannot detect anything and their zeros are
not a null. One never moved and never triggered invocation. Two of seven were live
discriminators, and both were noisy.

Two integrity defects were found and fixed during the campaign rather than after it. Sessions
can unblind themselves, because a run directory is named `<stamp>-<ARM>-<PROMPT>` and a session
that prints its working directory puts the arm letter in its answer; one row did this in all
three repeats. And the arena is not a sandbox: `CLAUDE_CONFIG_DIR` redirects where Claude Code
loads config but does not confine the Read tool, so a session read the host's real config file.
Across all 60 runs, zero sessions read anything answer-bearing, so the numbers stand.

## Re-running any of it

```bash
node tests/run-tests.mjs
node tests/run-tests.mjs --prove-fail
node tools/verify-evidence.mjs
node tools/coverage-report.mjs --doc-numbers
```

Tier 1 green, prove-fail red, the evidence gate green and the numbers gate green are the
release bar. Known gaps, including the ones found in this project's own tooling:
[IMPROVEMENTS.md](../IMPROVEMENTS.md).
