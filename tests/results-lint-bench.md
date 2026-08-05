# Lint bench: what existing tools catch, and what the extension doctor adds

Competitor run 2026-08-02 on Windows, Node v24.14.1. Doctor column re-run 2026-08-05 on the
same machine after the monitor and channel checks landed. Raw per-cell outputs in
[lint-bench/results.json](lint-bench/results.json), which holds the 2026-08-02 run;
fixtures generated deterministically by
[lint-bench/make-fixtures.mjs](lint-bench/make-fixtures.mjs) and drift-gated in CI.

**Read the two dates as two runs, not one.** The competitor columns were measured on
2026-08-02 and have NOT been re-measured. Two fixtures changed afterwards, so the
2026-08-02 cells for those two trees describe trees that no longer exist byte for byte:
`clean` gained a valid monitors-and-channels plugin, and `unresolvable-subagent-tools`
gained an in-fixture build marker. Neither change makes a competitor's verdict wrong (no
surveyed tool reads monitors, channels, or the version store at all), but "not wrong as
far as we can tell" is not "measured", and the distinction is the whole point of this
document.

## The question

This repo's references catalog ways Claude Code extensions FAIL SILENTLY: a dead skill with
unparseable frontmatter, a hook under a misspelled event, a settings key shadowed across
scopes. Before shipping a checker for them, the directive was: install the existing tools,
test them against that catalog, and decide from measured coverage whether our knowledge
layer ships as a wrapper over an incumbent. Then measure the combination against the bare
tools.

## Tools under test, pinned

| Tool | Version | Install |
|---|---|---|
| agnix (agent-sh) | 0.45.0 | npm, sandboxed |
| claude-code-templates | 1.29.4 | npm, sandboxed |
| @felixgeelhaar/cclint | 0.16.0 | npm, sandboxed |
| claude-skill-validator (aliksir) | 1.3.2 | npm, sandboxed |
| claude plugin validate | 2.1.219 (Claude Code) | already installed |
| extension-doctor | this repo | [tools/extension-doctor.mjs](../tools/extension-doctor.mjs) |

All third-party installs were local to a scratch sandbox, never global. Every (tool,
fixture) run executed against a TEMP COPY of the fixture with HOME and USERPROFILE pointed
into the copy, so tools that hardwire the home directory walked the fixture, never this
machine's real config. Each copy was hashed before and after every run.

## Fixtures

Twenty-one committed trees in five kinds. Each carries a manifest naming the defect, the
citation behind it, and a concept-word signal regex.

| Kind | n | What it is |
|---|---|---|
| failure-mode | 12 | The failure modes this repo's references document. **The only cohort the competitor columns were measured over.** |
| late-failure-mode | 5 | Monitor and channel failure modes, added 2026-08-05 with the checks that catch them. Scored identically, counted separately. |
| control | 2 | Positive controls the incumbent documents catching. They verify the RUNNER, not the tools. |
| clean | 1 | A correctly authored tree. Any finding counts against a tool exactly like a miss. |
| negative-control | 1 | A correctly authored tree whose names sit in the version-asymmetry blind spot. Zero findings required, same rule as clean. |

Two design decisions in that table are load-bearing.

**The late cohort is a separate kind so the published 12 stays 12.** Folding five new trees
into `failure-mode` would have turned "12 of 12" into "17 of 17" without anyone re-running
a competitor, restating an unmeasured denominator as a measured one. The runner's own
self-test pins the split, and a mutant that merges the cohorts turns it red.

**The negative control is a separate kind for the same reason.** Its scoring rule is
identical to clean's, so the cheap move was a second clean tree. But "the clean tree" is a
specific published concept in the matrix below, and a second one would silently change what
the clean-tree column counts. A new kind changes the table visibly instead.

The negative control is the fixture this stage most needed and did not have. It pins a
build marker of 2.1.222, NEWER than the capability catalog, which is the regime where
absence from the catalog proves nothing, and then declares only real names: `Read`,
`PowerShell` and `ReportFindings` in a subagent tools list, and a `DirectoryAdded` hook.
Every one of those was called broken by the doctor as shipped on 2026-08-02. Round five
below is what that cost.

## The matrix

| Fixture | agnix | cct | cclint | skill-validator | plugin validate | doctor (bare) | doctor + agnix |
|---|---|---|---|---|---|---|---|
| dead-skill-frontmatter | catch | miss | miss | miss | n/a | catch | catch |
| over-cap-description | miss | miss | miss | miss | n/a | catch | catch |
| dup-skill-across-scopes | miss | miss | miss | miss | n/a | catch | catch |
| bad-hook-event | catch | catch | miss | miss | n/a | catch | catch |
| bad-matcher-regex | miss | miss | miss | miss | n/a | catch | catch |
| missing-hook-handler | miss | miss | miss | miss | n/a | catch | catch |
| disable-all-hooks | miss | miss | miss | miss | n/a | catch | catch |
| settings-shadowing | miss | miss | miss | miss | n/a | catch | catch |
| unresolvable-subagent-tools | catch | miss | miss | miss | n/a | catch | catch |
| memory-over-cap | miss | miss | miss | miss | n/a | catch | catch |
| mcp-scope-collision | miss | miss | miss | miss | n/a | catch | catch |
| plugin-version-pinned | miss | miss | miss | miss | miss | catch | catch |
| control-array-matcher | catch | miss | catch | miss | n/a | catch | catch |
| control-bad-skill-name | catch | miss | miss | miss | n/a | catch | catch |
| clean tree | clean | FALSE-POS | clean | clean | n/a | clean | clean |

Late cohort, added 2026-08-05. Doctor column measured that day through the same runner
(`run-bench.mjs --only doctor`); no competitor has ever been run against these trees, and
`not run` is written rather than `miss` because an unrun cell is not a measurement:

| Fixture (late) | agnix | cct | cclint | skill-validator | plugin validate | doctor (bare) | doctor + agnix |
|---|---|---|---|---|---|---|---|
| monitor-user-config-ref | not run | not run | not run | not run | not run | catch | not run |
| monitor-command-missing | not run | not run | not run | not run | not run | catch | not run |
| monitor-cwd-assumption | not run | not run | not run | not run | not run | catch | not run |
| monitor-duplicate-name | not run | not run | not run | not run | not run | catch | not run |
| channel-server-unbound | not run | not run | not run | not run | not run | catch | not run |
| future-tool-unverified (negative control) | not run | not run | not run | not run | not run | clean | not run |

| Tool | Caught (of 12 published) | Caught (of 5 late) | Clean-tree false positives | Negative-control false positives | Crashes | Wrote during a run |
|---|---|---|---|---|---|---|
| agnix (bare) | 3 | not run | 0 | not run | 0 | no |
| claude-code-templates | 1 | not run | 1 | not run | 0 | no |
| cclint | 0 | not run | 0 | not run | 0 | no |
| claude-skill-validator | 0 | not run | 0 | not run | 0 | no |
| claude plugin validate | 0 | not run | 0 | not run | 0 | **yes** |
| extension-doctor (bare) | 12 | 5 | 0 | 0 | 0 | no |
| extension-doctor + agnix | 12 | not run | 0 | not run | 0 | no |

Cell-level notes, each verified against the raw output rather than the score:

- **agnix's three catches are genuine** (frontmatter parse error, unknown hook event,
  unresolvable subagent tools), file-anchored, error-level. An earlier revision of this
  document claimed FOUR, including bad-matcher-regex, and called all four verified; an
  independent review showed that fourth cell was another echo artifact (round four, below)
  and the sentence was wrong as published. With scoring restricted to error-level
  diagnostics, agnix's clean-tree CC-HK-010 style warning also stops counting as a false
  positive, so both its columns changed.
- **cct's one catch is real but derives from a defect of its own**: it validates hook events
  against a four-event allowlist, so it flags our misspelled event AND would flag 26 real
  events the same way. Its clean-tree false positives are complaints about the machine
  ("Shell Environment unknown", "Authentication not configured"), not the fixture.
- **cclint genuinely linted the fixtures it could see and found nothing**: its raw output on
  bad-matcher-regex shows the settings file scanned, zero violations. It is project-scoped,
  so home-side fixtures are invisible to it by design.
- **claude plugin validate passed the pinned-version fixture without comment** and was the
  only tool that WROTE during a validation run (state under the redirected home).
- **The doctor's 12 of 12 is by construction and is NOT the headline.** The fixtures encode
  exactly the failure modes the doctor was built to catch, and its self-test enforces the
  mapping. The measured content of this bench is the competitor columns, the false-positive
  column, and the clean-tree discipline, not our own perfect score. The 5 of 5 on the late
  cohort is by construction in exactly the same way, and even less interesting: those trees
  and those checks were written in the same week by the same author.

## Five rounds of scoring hardening, disclosed because each one changed the numbers

The first scoring pass matched signals against raw tool output and produced agnix 9 of 12.
Reading the raw outputs showed the extra five were fake: agnix prints a run-level VER-001
info line ("No tool or spec versions pinned") whose text collides with signals. Scoring was
restricted to file-anchored diagnostics. agnix: 4.

The second pass showed cclint and skill-validator at 9 of 12, architecturally impossible
for project-scoped and skills-only tools. The raw outputs showed zero violations; the
"catches" came from tools ECHOING THE FIXTURE'S TEMP PATH, and fixture ids like
`settings-shadowing` match their own signal. Fix: neutral copy names (fx01...), structured
per-tool parsers, and the rule that a tool reporting zero violations scores miss regardless
of its prose. Both tools: 0. All three defenses have must-fail cases in the runner's
self-test.

The fourth round was found by the independent reviewer, not by us, and it survived our own
raw-output verification pass: agnix's scored "catch" on bad-matcher-regex was a
warning-level CC-HK-010 style complaint whose message QUOTES the defective matcher value
("at hooks.PreToolUse[matcher=Bash|(]..."), so the word "matcher" in the echo matched the
signal while agnix never validated the regex at all. A diagnostic can echo the defect
without attesting it. Fix: the agnix adapter scores error-level diagnostics only, which is
also exactly how the extension doctor consumes agnix when delegating, with a must-fail
self-test case pinning it. agnix: 4 to 3.

The fifth round is the worst of the five, and it is not about scoring at all. It is about
the fixture SET, and it was found by an external review after this document had already
published "ZERO false positives" as a headline. The doctor as shipped on 2026-08-02
resolved subagent tool names and hook event names against a HAND-TYPED list. That list was
missing 14 real tool names (`CronCreate`, `CronDelete`, `CronList`, `EndConversation`,
`EnterWorktree`, `ExitWorktree`, `LSP`, `PowerShell`, `PushNotification`, `RemoteTrigger`,
`ReportFindings`, `ScheduleWakeup`, `ShareOnboardingGuide`, `WaitForMcpServers`) and 1 real
hook event (`DirectoryAdded`). Every one of them was reported BROKEN on a correctly
authored config. `PowerShell` alone had shipped in v2.1.84, six months before the list was
typed.

The clean-tree column stayed at 0 through all of it, and honestly so: the clean tree
contained none of those 15 names. **The claim "ZERO false positives" was true on these
fixtures and false in general**, and no gate in this repo could tell the difference,
because the fixture set and the checker were written by the same author from the same
mental model. A checker cannot be wrong about a name its fixtures never mention.

Two things changed as a result. The name lists were replaced by
[data/capabilities/catalog.json](../data/capabilities/catalog.json), generated from the
official docs mirror with per-name provenance and an explicit `catalogVersion`, so absence
from the catalog is treated as proof of nonexistence ONLY on a build the catalog covers and
as UNVERIFIED otherwise. And the fixture set gained the `future-tool-unverified` negative
control, which puts three of the previously-broken names and the previously-broken hook
event in a tree pinned to a build NEWER than the catalog, where zero findings are required.
That fixture would have gone red on the 2026-08-02 build.

The lesson is the repo's recurring one, now five times over: a benchmark's first output
flatters everyone, reading the raw evidence deflates it, and the reading must be done by
someone who did not write the scorer. Round five extends it. The reviewer must also be free
to write their own INPUTS, because a fixture set authored alongside the checker cannot
falsify the checker's blind spots; it shares them.

## Decision rule, committed in the plan before the bench ran

> Ship the wrapper if it catches at least 10 of the 12 documented failure modes, with ZERO
> false positives on the clean tree, and strictly more fixtures caught than the best bare
> tool.

**Applied: SHIP, with one clause requiring honest interpretation.** The wrapper catches 12
of 12 with zero clean-tree false positives, and strictly beats every bare COMPETITOR (best:
agnix at 3). The literal "best bare tool" is our own bare doctor, also at 12, which the
wrapper does not strictly beat ON THESE FIXTURES; it cannot, because the fixture set was
selected as exactly the gap nobody covered, which makes that comparison circular. What
delegation adds is agnix's per-file rule set BEYOND the fixture universe, imported at zero
false-positive cost: the wrapper ingests agnix's error-level diagnostics only, after its
warning-level style opinions (CC-HK-010) put a false positive on the clean tree through an
earlier build of the wrapper.

The wrapper ships as [tools/extension-doctor.mjs](../tools/extension-doctor.mjs) plus the
`/extension-doctor` plugin command.

## Live calibration on a real machine

The doctor's precision was calibrated against this machine's real `~/.claude` (read-only),
and the run both found real defects and killed three false positives:

- **Two true positives**: two installed production skills whose frontmatter a real YAML
  parser rejects ("bad indentation of a mapping entry"), meaning both have been loading with
  EMPTY metadata, unable to auto-trigger, exactly the defect class that killed this repo's
  own skill for weeks (IMPROVEMENTS.md item 19). Adjudicated against js-yaml, not our own
  classifier.
- **Three false positives fixed and now pinned by self-test cases**: a legal multi-line
  quoted scalar, a legal zero-indent block sequence, and the `*` matcher wildcard, which is
  documented match-all syntax and was demonstrably firing on this machine while an early
  build called it broken.

Final live run: 2 findings, both true, zero noise.

## Limitations

- **We authored both the fixtures and the doctor.** The competitor columns are the
  measurement; our column is a self-test restated. An independent reviewer constructs their
  own fixtures as part of verification. Round five above is what happens when nobody does:
  a MEASURED false-positive class of 14 tool names and 1 hook event, present in the shipped
  doctor, invisible to a fixture set that never named them, and found by external review
  rather than by us.
- **The two runs are dated separately and only one is current.** The competitor columns are
  from 2026-08-02 and were never re-run; the doctor column was re-measured 2026-08-05. Two
  fixtures changed between those dates. Nothing here should be read as a same-day
  head-to-head across all 21 trees.
- **The late cohort has one column in it.** Five trees, one tool, written the same week by
  the same author. It demonstrates that the monitor and channel checks fire on a tree and
  stay quiet on a correct one. It demonstrates nothing comparative.
- **Signals are concept-word regexes.** A tool detecting a defect in vocabulary far from the
  signal would be under-credited. Mitigated by reading raw outputs for every surprising
  cell, both directions, and recording them in results.json.
- **Single run per cell.** These tools are deterministic linters, so run-to-run variance is
  near zero, but tool VERSIONS move fast (agnix released roughly daily in July 2026). The
  matrix is pinned to the versions listed; re-run before citing it against newer builds.
- **cct's health check is machine-sensitive**: its clean-tree column would differ on a
  machine with different auth state. Its fixture-defect columns would not.
- **skill-validator emits localized output** (Japanese); scoring used its structured JSON,
  not the prose, so localization does not affect the matrix.
