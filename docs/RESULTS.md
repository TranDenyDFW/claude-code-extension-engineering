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

**235 questions (set v2), 100% pass.** Each question carries a regex answer key and a source
file, run by [tests/run-tests.mjs](../tests/run-tests.mjs).

Near-tautological on the first run, since the keys derive from the content. It earns its keep
as a regression gate and through `--prove-fail`, which guts every source file and confirms all
223 positive assertions go red. A suite that stays green against deleted content proves
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

**10 of 10 defects caught versus 3 of 10**, both with zero false positives on a correct
control. The comparison is against
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
