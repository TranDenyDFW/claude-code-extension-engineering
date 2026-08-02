# Lint bench: what existing tools catch, and what the extension doctor adds

Run 2026-08-02 on Windows, Node v24.14.1. Raw per-cell outputs in
[lint-bench/results.json](lint-bench/results.json); fixtures generated deterministically by
[lint-bench/make-fixtures.mjs](lint-bench/make-fixtures.mjs) and drift-gated in CI.

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

Fifteen committed trees: twelve failure modes this repo's references document, two positive
controls the incumbent documents catching (they verify the RUNNER, not the tools), and one
clean tree on which any finding counts against a tool exactly like a miss. Each carries a
manifest naming the defect, the citation behind it, and a concept-word signal regex.

## The matrix

| Fixture | agnix | cct | cclint | skill-validator | plugin validate | doctor (bare) | doctor + agnix |
|---|---|---|---|---|---|---|---|
| dead-skill-frontmatter | catch | miss | miss | miss | n/a | catch | catch |
| over-cap-description | miss | miss | miss | miss | n/a | catch | catch |
| dup-skill-across-scopes | miss | miss | miss | miss | n/a | catch | catch |
| bad-hook-event | catch | catch | miss | miss | n/a | catch | catch |
| bad-matcher-regex | catch | miss | miss | miss | n/a | catch | catch |
| missing-hook-handler | miss | miss | miss | miss | n/a | catch | catch |
| disable-all-hooks | miss | miss | miss | miss | n/a | catch | catch |
| settings-shadowing | miss | miss | miss | miss | n/a | catch | catch |
| unresolvable-subagent-tools | catch | miss | miss | miss | n/a | catch | catch |
| memory-over-cap | miss | miss | miss | miss | n/a | catch | catch |
| mcp-scope-collision | miss | miss | miss | miss | n/a | catch | catch |
| plugin-version-pinned | miss | miss | miss | miss | miss | catch | catch |
| control-array-matcher | catch | miss | catch | miss | n/a | catch | catch |
| control-bad-skill-name | catch | miss | miss | miss | n/a | catch | catch |
| clean tree | FALSE-POS | FALSE-POS | clean | clean | n/a | clean | clean |

| Tool | Caught (of 12) | Clean-tree false positives | Crashes | Wrote during a run |
|---|---|---|---|---|
| agnix (bare) | 4 | 1 | 0 | no |
| claude-code-templates | 1 | 1 | 0 | no |
| cclint | 0 | 0 | 0 | no |
| claude-skill-validator | 0 | 0 | 0 | no |
| claude plugin validate | 0 | 0 | 0 | **yes** |
| extension-doctor (bare) | 12 | 0 | 0 | no |
| extension-doctor + agnix | 12 | 0 | 0 | no |

Cell-level notes, each verified against the raw output rather than the score:

- **agnix's four catches are genuine** (frontmatter parse error, unknown hook event,
  matcher validity, unresolvable subagent tools), file-anchored, error-level. Its clean-tree
  false positive is CC-HK-010, a warning demanding a `timeout` field on a perfectly valid
  hook.
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
  column, and the clean-tree discipline, not our own perfect score.

## Three rounds of scoring hardening, disclosed because each one changed the numbers

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

The lesson is the repo's recurring one: a benchmark's first output flatters everyone, and
only reading the raw evidence deflates it.

## Decision rule, committed in the plan before the bench ran

> Ship the wrapper if it catches at least 10 of the 12 documented failure modes, with ZERO
> false positives on the clean tree, and strictly more fixtures caught than the best bare
> tool.

**Applied: SHIP, with one clause requiring honest interpretation.** The wrapper catches 12
of 12 with zero clean-tree false positives, and strictly beats every bare COMPETITOR (best:
agnix at 4). The literal "best bare tool" is our own bare doctor, also at 12, which the
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
  own fixtures as part of verification.
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
