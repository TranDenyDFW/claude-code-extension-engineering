# Project-authored statements from anthropics/claude-code issues

Harvested 2026-08-04 by `tools/gh-staff-harvest.mjs`. This is the only
externally-authored material this project holds: statements written by people on the Claude
Code team, not by us and not by other users.

## Why it exists here and not in a scratchpad

The first harvest wrote 240 MB into a harness session scratchpad and was deleted with the
session within hours. The analysis survived in prose, the data did not. This location is
in-repo and durable. `comments/` is gitignored as bulk; the two extracted files are tracked.

## What is here

| File | Rows | What it is |
|---|---:|---|
| `design-statements.json` | 20 | Staff comments stating how something is SUPPOSED to behave, or declining to change it |
| `version-facts.json` | 60 | Staff comments attaching a version number to a shipped behaviour change |
| `harvest-stats.json` | | Staff-harvest provenance |
| `corpus-stats.json` | | Full-population provenance, verified delta 0 |
| `all-issues.jsonl` | 81,291 | The complete issue population, 239 MB, gitignored as bulk |
| `comments/` | 1300 | Raw threads, gitignored. Re-derivable with `--extract-only` |

Run totals: 1,300 threads, 10,778 comments, 1,859 of them bots, 1,756 project-authored,
0 fetch failures.

## The full population is back, and verified

`tools/gh-corpus-harvest.mjs` re-harvested the complete issue corpus on 2026-08-05.

```
corpus     : 239.2 MB, 81291 lines
parsed     : 81291   malformed: 0
unique #   : 81291   duplicates: 0
created    : 2025-02-24T18:48:14Z .. 2026-08-05T02:39:44Z
search API : 81291   delta 0
STATUS: PASS
```

The delta against an independent `search/issues` count is **zero**, so this is the complete
population, not a sample. `all-issues.jsonl` is gitignored as bulk; `corpus-stats.json` is
committed as the provenance record.

A harvest that merely finishes is not a harvest that is complete, and this corpus has now been
destroyed twice: once by living in a harness session scratchpad that was deleted with the
session, once by a `| head -30` that SIGPIPEd the producer at 800 of 1,300 while the pipeline
still reported exit 0. The script therefore encodes all three constraints (cursor pagination
because `page=` caps at 99, no downstream pipe stage, durable in-repo output) and refuses to
report PASS unless malformed is zero, duplicates are zero, and the delta versus the search API
is between 0 and 50, that window being issues legitimately filed during the run.

Re-verify at any time without re-downloading:

```bash
node tools/gh-corpus-harvest.mjs --verify
```

## Method

15 known staff handles, searched with `commenter:`. That search returns full issue objects,
so the staff-comment extraction does not itself require the full population harvest. Only
issues mentioning an extension mechanism have their threads fetched. The full corpus above is
harvested separately by `gh-corpus-harvest.mjs` and serves the population-level pattern
analysis, not this extraction.

Two `gh` behaviours are encoded rather than rediscovered, both in the `cli-toolkit` gotcha
catalogue: `page=` is hard-capped at page 99, and the secondary rate limit is invisible to
`gh api rate_limit` and fires on concurrency. Hence 2 workers with backoff that recognises
the secondary limit rather than retrying into it.

## Authorship, which is a trap in both directions

`CONTRIBUTOR` means "has had a pull request merged". Community members carry it, so accepting
it alone admits non-staff. But several staff carry it INSTEAD of `MEMBER` because org
membership is private, so rejecting it undercounts staff. The first harvest got this wrong
both ways, once reporting 1 authoritative thread where there were far more. The rule used
here is `MEMBER`/`OWNER`/`COLLABORATOR`, or `CONTRIBUTOR` together with a staff-shaped handle
or membership of the known set. Bots are excluded explicitly.

## Classifier precision, stated because the first attempt was bad

The first classifier returned 60 design statements. Reading a sample showed roughly 1 in 6 was
genuine: it had swallowed triage boilerplate ("we'll need more detail", "closed in favor of
#69317"), a debugging narrative, and version announcements whose text contains "instead of".
That is the same error the first harvest made when it reported 201 "architectural" comments
that were mostly release notes.

The classifier now tests version facts FIRST, because a version number is unambiguous, then
requires an explicit design marker ("intended behavior", "by design", "working as intended",
"not planned", "you should use") and rejects short pure-triage comments. Design dropped from
60 to 20 and versions rose from 51 to 60. Sampling 8 of the 20 put roughly 7 as genuine.

**It is still a regex over prose. Treat 20 as an upper bound and read the row before citing it.**

## What these are for

`design-statements.json` is key-shaped material for `primary` and `rejection_reason`:

> **#12176 rboyce-ant:** "If you want to make a blocking permission decision, you should use
> the `PreToolUse` hook instead. We asynchronously execute the `PermissionRequest` hook"

> **#59829 dicksontsai:** "This is working as intended. The absolute-path normalization in
> PreToolUse is a deliberate change, not a regression to revert."

> **#18192 wolffiex:** "this is the intended behavior. it's to save context in environments
> where different modules in the same repo may be used independently. this is also how
> CLAUDE.md files work"

`version-facts.json` covers 42 distinct versions and directly addresses `version_caveat`, the
field our v2 keys fill with "none" almost everywhere. Coverage by mechanism: settings 24,
plugin 17, hook 15, mcp 13, skill 9, subagent 6.

## Using these in a key, and the discipline that requires

These are evidence, not keys. Editing an expected key after seeing benchmark results needs the
same care recorded in `key-repairs-v2.md`: do it blind to arm outcomes, log the repair, and
re-run the scorer rather than hand-editing a published table.

## Reproducing

```bash
node tools/gh-staff-harvest.mjs                 # search, fetch, extract
node tools/gh-staff-harvest.mjs --extract-only  # re-classify from cached threads, no network
```
