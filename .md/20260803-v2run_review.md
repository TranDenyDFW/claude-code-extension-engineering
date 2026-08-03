Reviewer: independent subagent

Executed 2026-08-03 against WORK at HEAD `3475e47`. Every check run fresh. Checks 3, 4, 6, 7
and the leave-one-batch-out table were re-derived with my own scripts, without calling
`tier3-score.mjs` to produce any figure under test.

---

## 1. Repo state: PASS

```
$ git log --oneline -5
3475e47 chore: remove a grader helper script that leaked into the repo
62045ec feat: v2 Tier 3 run on the repaired instrument. Combining docs and skill: no effect.
151d40a fix: unseeded re-repair of the 14 context_boundary keys after review found prompt seeding
175c2b9 feat: scenario set v2, keys repaired blind and mirror-verified, lint green
2843095 feat: v2 Tier 3 instrument, everything except the repaired keys themselves

$ git status --porcelain
?? .md/20260803-v2run_verify.md
```

HEAD is `3475e47`. The only untracked path is under `.md/`. Re-checked after running every
gate and every tamper test: still exactly the same one line.

---

## 2. Every gate: PASS

Exit codes as observed, one run each:

| Command | Exit | Expected |
|---|---|---|
| `node tests/run-tests.mjs` | 0 | 0 |
| `node tests/run-tests.mjs --prove-fail` | 0 | 0 |
| `node tools/verify-evidence.mjs` | 0 | 0 |
| `node tools/coverage-report.mjs --doc-numbers` | 0 | 0 |
| `node tools/check-validate-output.mjs --self-test` | 0 | 0 |
| `node tools/extension-doctor.mjs --self-test` | 0 | 0 |
| `node tests/lint-bench/run-bench.mjs --self-test` | 0 | 0 |
| `node tools/tier3-strip.mjs --self-test` | 0 | 0 |
| `node tools/tier3-pack.mjs --self-test` | 0 | 0 |
| `node tools/tier3-score.mjs --self-test` | 0 | 0 |
| `node tools/tier3-keys-lint.mjs --self-test` | 0 | 0 |
| `node tools/tier3-keys-lint.mjs --defects` | 0 | 0 |
| `node tools/tier3-keys-lint.mjs --set v2` | 0 | 0 |
| `node tools/tier3-keys-lint.mjs --set v1` | 1 | 1 |
| `node tools/tier3-strip.mjs --check` | 0 | 0 |
| `node tools/tier3-pack.mjs --check` | 0 | 0 |
| `node tools/tier3-score.mjs --check` | 0 | 0 |
| `node tools/tier3-score.mjs --set v2 --check` | 0 | 0 |

Key lines:

```
architecture-scenarios-v2.jsonl: 0 error(s), 42 warning(s)      [--set v2, exit 0]
architecture-scenarios.jsonl:   15 error(s), 50 warning(s)      [--set v1, exit 1]
PASS: 191 of 191 rows passed.
prove-fail: 181/181 positive assertions correctly went RED.
PASS: the published tables match the raw grades exactly.         [--set v2 --check]
```

---

## 3. Four-arm table re-derived independently: PASS

My script reads only `tests/tier3/grades-v2.jsonl` and `tests/tier3/blinding-map-v2.json`.
Cell rule applied as specified: mean of the two base grades, overridden by a `grader:"adj"`
record when present. 3,369 records collapse to 1,680 cells, 0 integrity problems.

My numbers (unrounded in parentheses):

| Arm | Overall | Primary (strict) | primary | rejected_alt | owner | context | lifecycle | failure | version |
|---|---|---|---|---|---|---|---|---|---|
| a | 71% (70.536) | 34/60 | 69% (69.17) | 61% (60.83) | 90% (89.58) | 95% (94.58) | 79% (78.75) | 66% (65.83) | 35% (35.00) |
| b | 88% (88.214) | 57/60 | 96% (95.83) | 67% (66.67) | 95% (94.58) | 97% (96.67) | 95% (95.42) | 87% (86.67) | 82% (81.67) |
| bplus | 88% (88.214) | 57/60 | 96% (95.83) | 68% (67.50) | 96% (95.83) | 97% (97.08) | 96% (95.83) | 85% (85.42) | 80% (80.00) |
| d | 87% (87.440) | 57/60 | 96% (95.83) | 64% (63.75) | 95% (95.42) | 98% (97.92) | 95% (95.00) | 85% (84.58) | 80% (79.58) |

Identical to the published block in every cell, including all four strict-primary counts.
Nothing sits near a rounding boundary in a way that would flip a cell.

---

## 4. Paired comparisons and sign tests: PASS

Per-scenario arm score is the mean of its seven field scores; sign test is the exact
two-sided binomial on wins versus losses, ties excluded.

```
d vs b:     n=60 W=20 L=20 T=20  meanDelta=-0.7738 pts (rounds to -1)  p=1.000
d vs bplus: n=60 W=14 L=16 T=30  meanDelta=-0.7738 pts (rounds to -1)  p=0.856
bplus vs b: n=60 W=19 L=16 T=25  meanDelta= 0.0000 pts (rounds to  0)  p=0.736
b vs a:     n=60 W=48 L= 9 T= 3  meanDelta=17.6786 pts (rounds to 18)  p=0.000
```

Every wins, losses, ties, delta and p-value matches the published table exactly.

**Do I agree D vs B is a null result?** Yes. 20 wins and 20 losses on 60 paired scenarios is
the most exactly null split the design can produce, and the exact two-sided binomial on
(20, 20) is p = 1.000 by construction. There is no sign of a suppressed effect: the mean
delta is -0.77 points, the wrong direction for the hypothesis, and D also loses on the
per-field breakdown of `rejected_alternative` (64% against B's 67%). The correct reading is
"no effect detected at this instrument's resolution", which the results file states as
"no measurable benefit". It is not evidence that the effect is exactly zero, and the file
does not claim that.

---

## 5. Grading integrity: PASS

```
records: 3369  (1680 * 2 base + 9 adjudications)
distinct cells: 1680
cells with exactly 2 base grades: 1680
cells whose 2 base grades come from DIFFERENT graders: 1680
grader record counts: { g1: 1680, g2: 1680, adj: 9 }

full-point splits (|g1 - g2| == 1): 9
  S032|2|version_caveat  S032|3|version_caveat  S032|4|version_caveat
  S044|2|version_caveat  S044|3|version_caveat  S044|4|version_caveat
  S046|1|version_caveat  S046|2|version_caveat  S046|3|version_caveat
adjudicated cells: 9  (the identical nine)
full splits WITHOUT adjudication: 0
adjudications WITHOUT a full split: 0
```

All three conditions hold. No cell with a full-point split lacks an adjudication, and no
adjudication was applied to a cell that did not need one.

---

## 6. Inter-grader agreement: PASS

```
primary:              240 cells  exact 238  99.17% -> 99%   within-half 240  100%
rejected_alternative: 240 cells  exact 209  87.08% -> 87%   within-half 240  100%
enforcement_owner:    240 cells  exact 233  97.08% -> 97%   within-half 240  100%
context_boundary:     240 cells  exact 233  97.08% -> 97%   within-half 240  100%
lifecycle:            240 cells  exact 222  92.50% -> 93%   within-half 240  100%
failure_mode:         240 cells  exact 204  85.00% -> 85%   within-half 240  100%
version_caveat:       240 cells  exact 204  85.00% -> 85%   within-half 231   96%
ALL:                 1680 cells  exact 1543 91.845% -> 92%  within-half 1671 99.464% -> 99%
disagreements of any size: 137
```

Matches the published per-field table, the 92% and 99% headline, and the stated
"137 of 1680". The `lifecycle` row is the one rounding-sensitive cell (92.50% rounds up to
93%); the published 93% is the correct half-up rounding and is consistent with how every
other cell is rounded.

---

## 7. Verified quotes, my own checker against the mirror: PASS

Whitespace-normalized substring match of each supplied quote against the cited mirror page,
over all four factual fields (`enforcement_owner`, `lifecycle`, `failure_mode`,
`version_caveat`), 240 fields per arm.

```
arm a:     total=240  cited=0    verified=0    rate over ALL fields = 0.000%   (arm carries no citations object at all)
arm b:     total=240  cited=0    verified=0    rate over ALL fields = 0.000%   (arm carries no citations object at all)
arm bplus: total=240  cited=235  verified=235  rate over ALL fields = 97.917% -> 98%   cited-only = 100.000%
arm d:     total=240  cited=238  verified=238  rate over ALL fields = 99.167% -> 99%   cited-only = 100.000%

supplied quotes that do NOT verify: bplus 0, d 0
fields with NO citation: bplus 5 (S015, S024, S030, S047, S050 version_caveat)
                         d    2 (S015, S047 version_caveat)
```

Matches the published 98% and 99% and `verified-quote-rates-v2.json`
(`{"a":null,"b":null,"bplus":98,"d":99}`, rendered as "not requested" for A and B).
The claim "ZERO non-verifying quotes among those supplied" is exactly true: 473 supplied
quotes, 473 verify. The rate is genuinely computed over all factual fields, so the seven
uncited fields count against it, which is what the prose says.

---

## 8. Key repair integrity: PASS

**Six repairs spot-verified by reading the cited mirror passage in context.** All six hold.

1. `S003.version_caveat`. Key: "as of v2.1.198 subagents run in the background by default,
   on earlier versions Claude chooses foreground or background per call", plus "smaller
   built-in tool set". `sub-agents.md:771`: "As of v2.1.198, subagents run in the background
   by default. ... Background subagents run with a [smaller built-in tool set](#available-tools)
   than foreground subagents". `sub-agents.md:289` frontmatter table: "When unset, Claude
   chooses, and ... as of v2.1.198 it runs subagents in the background by default." TRUE.
2. `S016.version_caveat`. Key claims auto memory has no gate, the post-write index limit
   check needs v2.1.210, and v2.1.211 measures only loaded content. `memory.md:344`: "Auto
   memory is on by default." `memory.md:386` min-version 2.1.210: measures against the
   200-line and 25KB limits, reminds, then errors. `memory.md:388` min-version 2.1.211: "The
   check measures only the content that loads". TRUE on all three parts.
3. `S018.context_boundary`. Key: hook has no context window of its own, only the block plus
   its reason crosses back "fed to Claude as an error message". `hooks.md:678`: "Exit 2 means
   a blocking error. ... stderr text is fed back to Claude as an error message. The effect
   depends on the event: `PreToolUse` blocks the tool call". `hooks.md:1554`: "For `"deny"`,
   shown to Claude". TRUE.
4. `S021.version_caveat`. Key: no gate on HTTP transport or `/mcp` OAuth; `claude mcp login`
   needs v2.1.186; the startup notice needs v2.1.193. `mcp.md:613`: "From v2.1.186,
   `claude mcp login <name>` runs a configured server's OAuth flow directly from your shell".
   `mcp.md:575`: "The notice requires Claude Code v2.1.193 or later." TRUE.
5. `S040.enforcement_owner`. Key: split, harness owns why the rule never arrives, and no
   setting changes it. `sub-agents.md:923`: CLAUDE.md files load into a subagent's initial
   context, "The built-in Explore and Plan agents skip this." `sub-agents.md:928`: "Explore
   and Plan are the only subagents that omit CLAUDE.md and git status. There is no frontmatter
   field or per-agent setting to change which agents skip them." TRUE. (The key's PRIMARY for
   this scenario is a separate, disclosed problem; see check 14.)
6. `S060.context_boundary`. Key: load-time gate, blocked sources never load so nothing from
   them reaches any context. `settings.md:1171` and `1181`: "blocks skills, agents, hooks, and
   MCP servers from user and project sources ... For each locked surface, Claude Code skips
   user-level and project-level sources and loads only plugin-provided and managed sources".
   TRUE.

**The 14 context_boundary keys carry the UNSEEDED values.** Parsed all 14
`### Sxxx.context_boundary` blocks out of `key-repairs-v2.md` and compared both variants
against the live row in `architecture-scenarios-v2.jsonl`:

```
seeded/unseeded pairs in log: 14
ids: S018 S023 S025 S030 S045 S051 S052 S053 S054 S056 S057 S058 S059 S060
live key == UNSEEDED value AND != seeded value: 14 of 14
```

Also confirmed by count: 42 `## Sxxx.field` patch sections, 5 examined-and-unchanged bullets,
14 unseeded re-derivations, matching the header and the results-table claim of
"42 patches applied plus 14 re-derived unseeded".

---

## 9. Frozen v1: PASS

```
$ git diff 26f60f3..HEAD -- tests/architecture-scenarios.jsonl tests/tier3/grades.jsonl \
      tests/tier3/blinding-map.json tests/tier3/answers
(no output)
$ git diff --stat 26f60f3..HEAD -- <same paths>
(no output)
```

Empty. The v1 scenario set, v1 grades, v1 blinding map and v1 answers are untouched since the
retraction commit `26f60f3`.

---

## 10. Pre-commitment: FAIL as specified. Three of four predate the data; the rule that produced the verdict does.

Order of events, from `git log`:

| Commit | Time | What |
|---|---|---|
| `932191a` | 2026-08-02 08:19 | Tier 3 harness. `DECISION_MARGIN` introduced |
| `2843095` | 2026-08-02 20:24 | v2 instrument. `SIGN_ALPHA` and `verdictV2` introduced |
| `175c2b9` | 2026-08-02 20:31 | scenario set v2 (keys) |
| `151d40a` | 2026-08-02 20:59 | **first commit in which any `tests/tier3/answers-v2/` file exists (all 24 added here)** |
| `62045ec` | 2026-08-03 08:26 | v2 run published. `REPLICATE_RULE` and `pooledVerdict` introduced HERE |
| `3475e47` | 2026-08-03 08:27 | remove a stray grader helper |

```
$ git log --all --diff-filter=A --name-only -- "tests/tier3/answers-v2/*"
COMMIT 151d40a 2026-08-02T20:59:43-05:00  (24 files added)
$ git log 151d40a..HEAD -- tests/tier3/answers-v2
(empty: the answers were never modified after they landed)

$ git log --all -S"REPLICATE_RULE" -- tools/tier3-score.mjs
62045ec 2026-08-03T08:26:44-05:00
$ git log --all -S"pooledVerdict" -- tools/tier3-score.mjs
62045ec 2026-08-03T08:26:44-05:00
```

So the literal condition in the spec does not hold: `REPLICATE_RULE` (and `pooledVerdict`)
landed in the very commit that published the results, roughly 11.5 hours after the v2 answers
existed. That is why this block is FAIL.

What that does and does not mean, both stated plainly:

- The constants and the function that actually decided the headline are unchanged since
  before any v2 answer existed. Verified by extracting the function bodies from three
  commits and comparing byte for byte:
  ```
  export const DECISION_MARGIN = 6;   at 2843095, 175c2b9, 151d40a, 62045ec, 3475e47  (identical)
  export const SIGN_ALPHA = 0.05;     at 2843095, 175c2b9, 151d40a, 62045ec, 3475e47  (identical)
  verdict()   2843095 vs HEAD identical: true
  verdictV2() 2843095 vs HEAD identical: true
  ```
  The published line is emitted by `verdict()` (`tier3-score.mjs:652`), whose NEGATIVE branch
  is `gap <= 0 -> "D does not beat B (-1 points). Publish the negative."` D is 87, B is 88,
  gap -1. Nothing in that path was touched after the data existed. The diff `151d40a..62045ec`
  on `tier3-score.mjs` contains no removed line mentioning `DECISION_MARGIN`, `SIGN_ALPHA` or
  `verdictV2`; its 18 deletions are the citation-rate to verified-quote-rate swap, the
  set-aware block marker, and a `completenessProblems` signature change.
- **The verdict was applied, not fitted.** I found no evidence of threshold shopping.
- `REPLICATE_RULE` governs a pooled multi-replicate endpoint for which no data exists at all,
  so it could not have been fitted to replicates 2 and 3. But replicate 1 was in hand when it
  was written, so it is at best a partial pre-commitment. The prose in `results-tier3.md`
  ("already committed in the scorer (`pooledVerdict`, `REPLICATE_RULE`), written before any
  replicate data existed") is true as literally worded and would be read by most people as
  claiming the same pre-registration standard the primary rule genuinely meets. That sentence
  should say when it was written.

---

## 11. Gutting: PASS

Both in a temp copy of `tools/` and `tests/`, verified clean first (`--self-test` exit 0 on
the untampered copy).

`aggregateCells` gutted to return `{ flat: [], problems: [], agreement: {}, disagreements: [],
adjudicated: 0, cells: 0 }` immediately:

```
GUTTED node tools/tier3-score.mjs --self-test  EXIT=1
FAIL  two agreeing grades aggregate cleanly
```
(30 earlier rows still PASS, then the gate fails on that row and the run aborts.)

`lintKeys` gutted to return `{ errors: [], warns: [] }`:

```
GUTTED node tools/tier3-keys-lint.mjs --self-test  EXIT=1
FAIL  n/a context_boundary is an ERROR
FAIL  empty graded field is an ERROR
FAIL  version_caveat none beside a conceded gate is an ERROR (S037 class)
FAIL  version_caveat none beside an env flag is an ERROR
FAIL  a real version_caveat with the same fact elsewhere is only a WARN (S002 class)
FAIL  same-mechanism alternative is a WARN, not an ERROR (S022 class)
FAIL  the frozen v1 set is RED under this lint (baseline)  (0 error(s))
SELF-TEST FAIL: 7 check(s) failed
```

Both exit non-zero. Neither gate is decorative.

---

## 12. Drift: PASS

In the same temp copy, one digit changed in the published v2 block: the D row overall
`87%` to `88%`.

```
TAMPERED  node tools/tier3-score.mjs --set v2 --check   EXIT=1
FAIL: the published block does not match what the raw grades derive.
  first difference at line 10
    published: | D: docs + skill, staged procedure | 88% | 57/60 | 96% | 64% | 95% | 98% | 95% | 85% | 80% |
    derived:   | D: docs + skill, staged procedure | 87% | 57/60 | 96% | 64% | 95% | 98% | 95% | 85% | 80% |

REVERTED  node tools/tier3-score.mjs --set v2 --check   EXIT=0
PASS: the published tables match the raw grades exactly.
```

Exit 1 then exit 0, as required.

Temp copy deleted afterwards, as a separate command, and the deletion confirmed:
`DELETION CONFIRMED: ...\scratchpad\tamper does not exist`. WORK re-checked with
`git status --porcelain` after all tamper work: still only the untracked `.md/` verify file.

---

## 13. Blinding: PASS on all three stated conditions

```
total sheets: 240
distinct sheet key sets: 1
  [context_boundary, enforcement_owner, failure_mode, lifecycle, primary,
   rejected_alternative, sheet, version_caveat]
literal "citations" key anywhere under packets-v2: NONE
literal "arm" key on any sheet: NONE
word "arm" anywhere in the packet text: 0 occurrences
tokens "bplus", "staged procedure", "docs + skill": 0 occurrences
distinct arm orderings used: 24 out of 24
  a-b-bplus-d  a-b-d-bplus  a-bplus-b-d  a-bplus-d-b  a-d-b-bplus  a-d-bplus-b
  b-a-bplus-d  b-a-d-bplus  b-bplus-a-d  b-bplus-d-a  b-d-a-bplus  b-d-bplus-a
  bplus-a-b-d  bplus-a-d-b  bplus-b-a-d  bplus-b-d-a  bplus-d-a-b  bplus-d-b-a
  d-a-b-bplus  d-a-bplus-b  d-b-a-bplus  d-b-bplus-a  d-bplus-a-b  d-bplus-b-a
```

Grading batches mix focus areas and are not the natural blocks:

```
batch 1: S006,S008,S017,S018,S023,S031,S040,S045,S048,S059   6 distinct foci
batch 2: S003,S009,S013,S014,S016,S021,S036,S038,S047,S055   6 distinct foci
batch 3: S007,S022,S025,S027,S035,S037,S041,S049,S051,S054   5 distinct foci
batch 4: S001,S005,S010,S015,S026,S034,S043,S050,S057,S058   6 distinct foci
batch 5: S002,S011,S020,S024,S030,S033,S039,S042,S053,S056   6 distinct foci
batch 6: S004,S012,S019,S028,S029,S032,S044,S046,S052,S060   6 distinct foci
```

The stated conditions hold. I did find a residual blinding leak of a different kind, in the
sheet TEXT rather than in labels or structure; it is reported under "what the spec missed".

---

## 14. Judgment on the wording

**Verdict on this check: the results file is fair and in places exemplary. The README
paragraph is mildly overstated and should be softened.**

**(a) Does one replicate support the strength of the wording?**

Partly. The load-bearing sentence in `results-tier3.md` is "**Combining the reference with
the documentation produces no measurable benefit.**" The qualifier "measurable" is doing real
and correct work, and the next sentences keep it honest: "a dead heat, on an instrument
specifically rebuilt to detect a small effect." The Limitations section leads with "Single
replicate" and says outright that answer-agent nondeterminism "is the variance this design
cannot see, and it is the main reason not to read the 1-point D-versus-B gap as anything but
noise". That is the right disclosure in the right place, and it is not buried.

Where it stretches: the section heading is "a clean negative" and the body calls it "Not a
small effect the instrument struggled to see". A single pass cannot distinguish "there is no
effect" from "this particular pass landed at zero". 20W 20L is the expected split under the
null, but it is also within ordinary sampling range of a small true effect: a genuine 2 to 3
point advantage would frequently produce a split like this on n=60. The file's own decision
margin of 6 concedes this, and its own text says n=60 gives roughly plus or minus 6 points.
So the defensible claim is "any effect of the size worth shipping for is ruled out; smaller
effects are not". That is what the file mostly says. "Clean negative" nudges past it.

A second bound is not disclosed anywhere: **ceiling compression**. B, B+ and D sit at 88, 88
and 87 overall, with four of seven fields at 95% to 98% in all three docs arms. D can gain at
most about 12 points, and on the fields where the reference would plausibly help there is
almost no headroom left. A null measured against a ceiling is weaker evidence than a null
measured in the middle of the range. The Limitations section names single replicate, S040,
further key defects and model grading, but not this.

**(b) Is the S040 defect handled honestly?**

Yes, and better than most such disclosures. I verified every factual element of it against
the raw artifacts:

- The key's own `failure_mode` does concede the primary is inadequate: "a hard guarantee
  needs a different mechanism entirely, such as a permissions deny rule, a PreToolUse hook,
  or denying Agent(Explore)". The scenario prose says "vendor/ must never be read or
  searched", which is hard-guarantee framing.
- All four arms independently chose the permission deny rule. Confirmed by reading all four
  S040 answers.
- All four score 0 on `primary`, 0 on `lifecycle`, 0 on `failure_mode`, 0.25 on
  `context_boundary`, and 0 to 0.25 on `version_caveat`. Both graders agree on every one of
  those, so this is not a grading artifact. "Roughly 20 zero-scores from one arguable key" is
  an accurate count.
- "It does not bias D against B" is correct: the penalty is identical across arms, so the
  paired D-versus-B comparison is unaffected. It does depress every absolute number, as
  stated.
- The admission that "the keys-lint does not yet catch the class 'the key's own failure_mode
  names a better primary than the key's primary'" is accurate; I confirmed `--set v2` exits 0
  with S040 in the set.

Nothing here is spun. The disclosure is complete enough that I could reconstruct the whole
problem from it and then confirm it independently.

**(c) Would a README-only reader be misled?**

On the direction of the result, no. The README's numbers are exact and its
"**Combined versus docs alone: 20 scenarios to 20, p=1.000.** A dead heat" is precisely what
the raw grades say. But three things a careful reader would want are absent, and one phrase
actively invites a misreading:

1. "60 scenarios, four arms, **twice-graded**, and a clean negative." Twice-graded means two
   graders per cell. It sits exactly where a reader scanning a null result looks for
   replication, and the README never says anywhere that this is a single answer pass. A
   reasonable reader can finish that paragraph believing the run was repeated. It was not.
2. "It adds nothing once the documentation is present." The results file says "no measurable
   benefit" and "did not add anything measurable". The README drops "measurable" and states
   the absolute. That is the one sentence in the repo that is stronger than its evidence.
3. Neither the known-wrong S040 key nor the ceiling appears in the README, though the
   still-open key defects are linked.

None of this is fabrication and the link to the full method is prominent and honest.
Calling it "understated" would be wrong, and calling it dishonest would also be wrong. It is
**mildly overstated at the README level, fair in the results file**. Two edits would close
it: say "one answer pass per arm" next to "twice-graded", and restore the word "measurable"
to the closing sentence.

---

## 15. Dash scan and CI: PASS

```
files scanned (WORK, excluding .git and .md/): 210
dash-family hits (U+2010 through U+2015, U+2212, and the HTML entity forms): 0
```

```
$ GITHUB_TOKEN= gh run list --repo TranDenyDFW/claude-code-extension-engineering --limit 2
completed  success  chore: remove a grader helper script that leaked into the repo  freshness  main  push      30818046431  20s  2026-08-03T13:27:34Z
completed  success  freshness                                                       freshness  main  schedule  30804358739  24s  2026-08-03T10:08:36Z
```

The first row is HEAD (`3475e476bf80303ff091b292c9783eabe743c87b`). Job detail confirms every
step ran and passed, not just the job:

```
✓ Run deterministic suite        ✓ Prove the suite can fail
✓ Verify evidence ledger         ✓ Documentation numbers match the artifacts
✓ Validate-output checker self-test
✓ Tier 3 key quality             ✓ Tier 3 harness self-tests
✓ Extension-doctor self-test     ✓ Lint-bench runner self-test
✓ Tier 3 artifacts match their sources
✓ Validate plugin manifest       ✓ Compare versions and write status
```

Only annotation is the generic Node 20 deprecation notice on `actions/checkout@v4` and
`actions/setup-node@v4`.

---

## What the spec missed

### A. DEFECT, real: leave-one-batch-out drops the wrong batches

This is the most substantive finding and the spec has no check for it.

`tools/tier3-score.mjs:1051`:

```js
const batchOf = id => Math.floor((Number(String(id).slice(1)) - 1) / 10) + 1;
```

Batch membership is computed from the scenario NUMBER, which yields the natural blocks
S001 to S010, S011 to S020, and so on. In v2 those blocks are the **answer** batches, and
they are also exactly the six focus areas:

```
answer batch 1: enforcement   batch 2: knowledge    batch 3: delegation
answer batch 4: orchestration batch 5: integration  batch 6: crosscut
```

The **grading** batches are the seeded shuffles listed in check 13 (batch 1 is S006, S008,
S017, S018, S023, S031, S040, S045, S048, S059). The scorer never reads them. So the published
table is a leave-one-focus-area-out analysis wearing the label of a leave-one-grading-batch-out
analysis. The surrounding prose is explicit about which it claims to be:

> "Every comparison is recomputed with each **grading batch** removed in turn, because a batch
> that behaves unlike the rest can manufacture across ten scenarios what looks like a finding
> across sixty. **This is what caught the retracted v1 headline.**"

In v1 the two numberings coincided, since each batch was one focus area and one grader, so
`batchOf` was correct there. In v2 the whole point of the redesign was to break that
coincidence, and `batchOf` was not updated to follow. The specific failure mode the paragraph
invokes, a grader behaving unlike the rest, is therefore not tested at all in v2.

I recomputed the true grading-batch LOBO independently:

```
grading-batch drops (what the prose describes)
 d vs b:     b1:16W16L p=1.000  b2:17W16L p=1.000  b3:15W19L p=0.608
             b4:17W14L p=0.720  b5:18W17L p=1.000  b6:17W18L p=1.000
 d vs bplus: b1:11W14L p=0.690  b2:13W15L p=0.851  b3:10W15L p=0.424
             b4:11W11L p=1.000  b5:11W11L p=1.000  b6:14W14L p=1.000
 bplus vs b: b1:17W14L p=0.720  b2:16W13L p=0.711  b3:16W12L p=0.572
             b4:17W13L p=0.585  b5:14W13L p=1.000  b6:15W15L p=1.000
 b vs a:     b1:40W7L  b2:40W7L  b3:40W7L  b4:40W8L  b5:40W8L  b6:40W8L   all p=0.000

answer-batch drops (what is actually published)
 d vs b     b1:16W15L p=1.000   <- published "drop batch 1: 16W 15L, p=1.000"
 d vs bplus b1:11W11L p=1.000   <- published "drop batch 1: 11W 11L, p=1.000"
 bplus vs b b2:15W14L p=1.000   <- published "drop batch 2: 15W 14L, p=1.000"
 b vs a     b1:38W9L  p=0.000   <- published "drop batch 1: 38W 9L, p=0.000"
```

The second block reproduces the published table exactly, which is how I identified the cause.

**Impact on the conclusion: none.** Under the correct grading-batch definition every verdict
is unchanged. D versus B is non-significant on all six drops (worst p=0.608), D versus B+ and
B+ versus B likewise, and B over A stays p=0.000 on every drop. The negative survives either
way, and so does the one robust positive. This is a labeling and coverage defect, not a
result-changing one. But it should be fixed and disclosed, because as published the run has
no grader-batch robustness check while claiming to have one, and `--set v2 --check` cannot
catch it: a drift gate regenerates the block from the same code and will always agree with
itself.

### B. DEFECT, real: eleven blinded sheets identify their own arm in the answer text

The pack gate checks for arm LABELS and structural tells. It does not check the prose. Eleven
sheets carry epistemic markers that only an arm answering without documentation would write,
and every single hit is arm A:

```
batch-1 S006 sheet 2 ARM=a  "from memory"
batch-1 S017 sheet 4 ARM=a  "I recall"
batch-1 S018 sheet 3 ARM=a  "I recall"
batch-1 S023 sheet 3 ARM=a  "I recall"
batch-3 S007 sheet 3 ARM=a  "I recall"
batch-3 S049 sheet 1 ARM=a  "I recall"
batch-4 S001 sheet 3 ARM=a  "I recall"
batch-4 S057 sheet 1 ARM=a  "from memory"
batch-4 S058 sheet 1 ARM=a  "unaided"
batch-5 S056 sheet 4 ARM=a  "unaided"
```
(S018 matched two markers.) Zero hits in arms B, B+ or D. Example, `batch-4.json` line 540:

> "...and I cannot pin the exact version boundary unaided."

This does not touch the headline: D, B and B+ are mutually indistinguishable by this signal,
so D versus B is unaffected. It does bear on the one result reported as robust, B over A, in
the direction of inflating it, since a grader who can tell which sheet is unaided has a cue.
The effect is almost certainly small next to a 48-to-9 split, and arm A's hedging is intrinsic
to answering without docs so it cannot be fully eliminated. But `174fb6d` was a commit
specifically about closing a blinding defect that identified the baseline arm, and this is a
residual instance of the same class that no gate looks for. Worth a strip rule and a
disclosure line.

### C. Provenance corroborated, no defect

My scratchpad turned out to contain the grading-phase working files from the run under review
(20 sheet dumps for batches 1 and 4, plus five emitter scripts). I treated them as evidence:

- The dumps present sheets as `S1` through `S4` with the key above them and carry **no arm
  labels, no arm words, and no citations**. Blinding held at the grader's actual interface,
  not only in the committed packets.
- The emitters contain hard-coded per-cell scores, no formula, no randomization, no arm
  awareness. Every score I could parse matches the committed grade files exactly:
  ```
  gen.mjs (g2 b1)        -> grades-v2-g2-batch-1.jsonl: 252 cells compared, 252 identical, 0 mismatched
  emit-g2-b3.js (g2 b3)  -> grades-v2-g2-batch-3.jsonl: 252 cells compared, 252 identical, 0 mismatched
  emit.mjs (g2 b4)       -> grades-v2-g2-batch-4.jsonl: 224 cells compared, 224 identical, 0 mismatched
  make_grades.py (g1 b1) -> grades-v2-g1-batch-1.jsonl: 280 cells compared, 280 identical, 0 mismatched
  ```
  (1,008 cells; the unparsed remainder is my crude number extraction tripping on dict keys,
  not a data problem.)
- The aggregate is exactly its sources: normalizing JSON spacing, all 3,360 per-grader batch
  records appear in `grades-v2.jsonl`, and the only 9 records without a per-grader source are
  the 9 adjudications. Two files differ from the aggregate by `json.dumps` spacing alone,
  which is cosmetic.

This is a positive finding. It means the double-grading is real transcription of per-sheet
judgments, not synthesized numbers. `3475e47` removed one such helper that had leaked into
the repo; copies remain outside the repo, which is not a repo defect.

### D. Docs mirror verified against its manifest, no defect

All 20 pages in `tests/tier3/docs-manifest.json` are byte-identical and sha256-identical to
the local mirror (20 of 20). The published "hooks 245 KB, settings 273 KB, sub-agents 95 KB"
are decimal kB of 245,465 / 273,279 / 95,655 bytes and are correct; I checked before flagging
them, since in KiB they read 240 / 267 / 93.

### E. Two smaller notes

- `results-tier3.md` says the pooled endpoint was "written before any replicate data
  existed". True as worded, but it was written in the publishing commit, after replicate 1.
  The sentence should carry its date. See check 10.
- The `lifecycle` inter-grader row lands on 92.50%, the one figure in the whole block that
  depends on a rounding convention. Published as 93%, which is correct half-up rounding and
  consistent with the rest of the table. Noted only so a future reader does not rediscover it
  as a discrepancy.

### F. What I could not complete

Nothing. Every check in the spec was executed. Check 10 is reported as FAIL against its stated
condition rather than argued into a pass.

---

## Summary

| Check | Result |
|---|---|
| 1 repo state | PASS |
| 2 all gates | PASS |
| 3 four-arm table re-derived | PASS, exact |
| 4 paired comparisons re-derived | PASS, exact. D vs B is a genuine null |
| 5 grading integrity | PASS |
| 6 inter-grader agreement | PASS, exact |
| 7 verified quotes | PASS, 98% and 99%, zero non-verifying |
| 8 key repairs | PASS, 6 of 6 hold, 14 of 14 unseeded shipped |
| 9 frozen v1 | PASS, empty diff |
| 10 pre-commitment | **FAIL** on the stated condition. The verdict rule itself is pre-committed and byte-identical; `REPLICATE_RULE` is not |
| 11 gutting | PASS, both non-zero |
| 12 drift | PASS, 1 then 0 |
| 13 blinding | PASS on the stated conditions, 24 of 24 orderings |
| 14 judgment | Results file fair, README mildly overstated |
| 15 dashes and CI | PASS, 0 hits, CI green on HEAD |

Every published figure in the v2 block reproduces exactly from the raw grades using an
independent implementation, and the negative is real: I could not make D beat B under any
aggregation I tried. Against that, three things keep this from a clean pass. The
leave-one-batch-out table does not drop the batches its own prose says it drops, so the run
has no grader-batch robustness check while claiming the one that caught the v1 retraction.
Eleven blinded sheets name their own condition in the answer text, all of them arm A, on the
one comparison reported as robust. And `REPLICATE_RULE` did not predate the data the way the
spec required and the prose implies. None of these flips the result. All three should be
disclosed or fixed before this run is cited further, and the README's "it adds nothing"
should get its "measurable" back.

## Verdict: PARTIAL
