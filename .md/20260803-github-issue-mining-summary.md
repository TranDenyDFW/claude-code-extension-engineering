# GitHub issue mining: summary

Run 2026-08-03/04. Source: `anthropics/claude-code`, full issue population.
Full detail in `scratchpad/gh-external-questions/FINDINGS.md` (374 lines).
Companion negative result: `scratchpad/hf-external-questions/FINDINGS.md` (HuggingFace).

---

## The question and the answer

**Asked:** can real GitHub issues supply an EXTERNAL scenario set, so the Tier 3 benchmark
stops being graded entirely on scenarios this project wrote?

**Answer:** no for scenarios, yes for two other things nobody asked for.

| | verdict |
|---|---|
| Scenarios usable verbatim | **0 of 81,002** |
| Real, docs-answerable mechanism choices (close-read, blind-rated) | 8 of 9, but they collapse onto ~1 axis |
| Project-authored design statements | **51**, externally authored, directly key-shaped |
| Project-stated version gates | **46**, fixing the field our keys almost always leave "none" |
| Pattern data | large, measured, immediately actionable |

---

## What was actually harvested

- **81,002 issues, the complete population.** Search API independently reports 80,997 for
  `is:issue`; the 5 extra were filed during the 25-minute run. 238 MB.
- **2,048 comment threads**, 13,942 comments, fetched in two passes.
- **15 Anthropic staff handles**, discovered by snowballing comment associations rather than
  guessing: `ashwin-ant`, `localden`, `dicksontsai`, `bcherny`, `ant-kurt`, `wolffiex`,
  `rboyce-ant`, `catherinewu`, `hackyon-anthropic`, `igorkofman`, `blois`, `sarahdeaton`,
  `dhollman`, `jarrah-anthropic`, `morganl-ant`.
- Discussions are disabled on the repo, so issues are the entire surface.

---

## The three findings that matter for the next round

### 1. Our harvest filter is anti-correlated with what it hunts

The dominant real confusion is **advisory versus enforceable**: users want a hard guarantee
and reach for better *wording* instead of an enforcing mechanism.

- **#17908** asks how to phrase a CLAUDE.md rule so it is respected, after Claude ran
  `git commit --amend` anyway.
- **#56383** reports a memory rule active for 13 consecutive sessions and ignored all 13 times.
- **#80211** states outright that nothing physically prevents the agent from reading the file
  its AGENTS.md forbids.
- **#16011** rewrites constraints as user-welfare framing rather than picking a blocking
  mechanism.

**None of these is filed as a mechanism question.** They arrive as bug reports, docs requests
and proposals. A filter keyed on mechanism-name density plus choice language misses exactly
the population that matters, by construction.

### 2. Permissions deny rules are the ideal distractor

In every advisory-versus-enforceable issue read, **the permissions deny rule is never
considered**. Blind raters independently named it as the overlooked alternative in 5 of 9, and
correctly declined to name it for #79959 where deny rules were the user's own proposal.

Users are blind to it. That is precisely what makes it discriminating in a benchmark item.

### 3. What users actually weigh, measured

| pair | n |
|---|---:|
| plugin vs skill | 48 |
| hook vs plugin | 36 |
| skill vs subagent | 34 |
| mcp vs plugin | 25 |
| hook vs settings | 22 |
| skill vs slash_command | 22 |
| hook vs subagent | 21 |

**Explicitness tracks vocabulary novelty, not decision difficulty.** `plugin vs skill` leads
but is the least real ownership contest: plugin is a distribution wrapper, not a candidate
owner. `skill vs slash_command` has been retired by the product; they merged.

And the ground moved under the instrument:

```
quarter      settings    mcp   hook  plugin   skill  subagent
2025-Q1            39     47      3       3       0         3
2026-Q2          6142   3937   2951    2914    2446      1842
```

`skill` went 0 to 2,446 and `plugin` 3 to 2,914 in five quarters. **Every item needs a version
pin.**

---

## Contamination worth knowing about

- **`coygeek`**: 116 comments across 72 issues, **85 carrying RESOLVED / VERDICT / CONFIRMED
  markers**, association `NONE`. Opens like a maintainer ("### Short Answer: Go with a
  variation of your Option 2"). Only the association field distinguishes it. Any pipeline
  mining "the accepted answer" would key on one user's opinions while looking rigorous.
- **Bots are 23% of all comments** (3,247 of 13,942). Counting bot triage as "answered"
  corrupts the authority signal.
- **Closure is not adjudication.** Most examined issues closed via the staleness bot with no
  human reply. `not_planned` from a bot is silence.
- **The corpus carries false premises.** #34572 assumes subagents do not receive CLAUDE.md.
  The docs say: *"Explore and Plan skip your CLAUDE.md files... Every other built-in and custom
  subagent loads both."* Keying on it would have taught an inverted fact. This was the only
  product claim verified in the study, and it falsified on the first check.

---

## Corrections I made to my own work

Recorded because each was a real defect that changed a published number.

1. **Truncation.** My thread builder clipped bodies at 2,500 chars, truncating 7 of the 9
   close-read candidates by 763 to 4,999 characters each. Some refutations cited the
   truncation itself. Rebuilt at full length and re-judged.
2. **Prompt bias.** My re-judge prompt said "do not answer false merely because the genre is a
   feature request", which biases toward yes; it returned 9 of 9. A blind neutral re-rate gave
   8 of 9. One flip on n=9 is noise, so **the 9 of 9 is unmeasured, not confirmed**.
3. **Sampling error, the big one.** I first reported the staff answer supply as "thin and
   concentrated on one maintainer" (37 comments, 9 architectural). Wrong. Those 637 threads
   were selected for being decision-shaped, which is exactly the population staff do not
   triage. Targeting staff directly gives **1,928 project-authored comments, 669 naming a
   mechanism, across 612 issues**, spread across a team.
4. **Over-count on the rebound.** The corrected figure was first reported as 201
   "architectural". Reading them showed most are templated release notes, and my staff filter
   had leaked in a non-staff commenter. Strict recount: **51 design statements, 46 version
   gates**.

---

## Ranked options for the upcoming changes

| # | Option | Cost | What it buys |
|---|---|---|---|
| 1 | **Invert the harvest filter** toward bug and model-noncompliance templates | one classifier pass, cheap | Recall on the population that actually holds real decisions |
| 2 | **Split provenance per item**: situation cited to an issue, expected answer authored from versioned docs, labelled as such | 30 to 60 min per item | The only design compatible with this answer supply. Fixes the scenario-authorship criticism without pretending the key is external |
| 3 | **Permissions-distractor rubric line** | small, per item | Separates "a hook works" from "a deny rule was the cheaper deterministic answer" |
| 4 | **Version-pin every item** plus per-release staleness re-verify | small, recurring | Prevents the #34572 failure mode. Mandatory given the vocabulary shift |
| 5 | **Mine the 51 design statements** (`design-statements.json`) | hours, already extracted | Externally adjudicated ground truth for key `primary` and `rejection_reason` |
| 5b | **Mine the 46 version gates** (`version-facts.json`) | hours, already extracted | Fills `version_caveat`, our weakest key field, from project statements |
| 6 | **Reweight the pair inventory** toward `skill vs subagent` and `hook vs settings` | authoring time | Matches measured user reality; drops a pair the product retired |

Options 1, 3, 4 and 6 are cheap, independent, and improve the instrument whether or not a
single issue ever becomes a seed.

---

## What this did NOT establish

- That no usable item exists. 112 of 653 decision-shaped issues were read (17.2%); 9 examined
  closely. Rule of three puts the 95% upper bound on the verbatim rate near 28%, not zero.
- That the 8 surviving seeds are distinct. They probably are not: #56383, #79959, #80211,
  #34572 and arguably #40539 all test one fact.
- That a rewritten stem still resolves to ONE defensible answer.
- That the docs-determinable claims hold. Raters asserted PreToolUse matcher semantics, deny
  coverage of a Bash `cat`, whether `SessionEnd` can block. Only one claim was checked, and it
  falsified.
- That the pair counters are accurate. Both are keyword artifacts; treat them as upper bounds.
- **That any of this changes model behaviour.** Not one item was graded against a model.

---

## Gotchas captured to `cli-toolkit`

Three rows appended to `references/gotcha-catalogue.md` (2026-08-03), plus a
"Bulk `gh api` against a large repo" section in `references/git-github.md`:

1. **`gh api page=` is hard-capped at page 99** (9,900 items); page 100 returns HTTP 422
   demanding cursor pagination. Cursors are sequential, so **parallelising by page number is
   structurally impossible**. Use `--paginate` and stream to JSONL.
2. **The secondary rate limit is invisible to `gh api rate_limit`.** 403 "rate limit exceeded"
   while `/rate_limit` reports `core=4999/5000`. Concurrency triggers it, not volume. Six
   workers produced **1,381 failures of 1,579**; two workers with exponential backoff produced
   **1,164 fetched, 0 failed**.
3. **`author_association: CONTRIBUTOR` is not a staff flag.** It only means "had a PR merged".
   Community members carry it; some staff carry it instead of `MEMBER`. Combine with a
   known-handle list and exclude bots explicitly.

Item 3 was not in the original request. It is included because it is the same class of defect
and it produced a wrong published number twice in this session. Delete that row if unwanted.

---

## Artifacts

All under `scratchpad/gh-external-questions/`:

```
all-issues.jsonl        238 MB  full population, 81,002 issues
patterns.txt                    the full pattern report
gold.jsonl        112           2+ mechanisms plus choice language
candidates.jsonl  329           scored candidates
comparisons.jsonl 390           explicit comparisons with source lines
design-statements.json  51      project-authored design intent   <- highest value
version-facts.json      46      project-stated version gates     <- highest value
authoritative.md/.jsonl         all project-authored comments
comments/        2048           raw threads, association preserved
threads/           25           question plus thread, chunked for reading
full-recheck.md                 the 9 candidates at full body length
blind-comparison.md             neutral re-rate versus biased pass
FINDINGS.md                     the long form, with all limits
```
