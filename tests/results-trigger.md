# Trigger benchmark: live skill discovery

Run 2026-07-30 on Claude Code 2.1.219 (CLI), model claude-opus-5. Prompt set v1
([trigger-benchmark.jsonl](trigger-benchmark.jsonl)): 25 should-trigger prompts and 25
should-NOT-trigger near-misses, negatives built per the Anthropic Skill Creator method
(genuinely tricky, not obviously irrelevant: "write a hook" for React, "explain MCP"
conceptually, git hooks, VS Code extensions, WordPress plugins).

## Method: LIVE, not simulated

Each prompt ran as a real headless session:
`claude -p <prompt> --plugin-dir <repo> --output-format stream-json --verbose --max-turns 3`,
one pass per prompt, fixed 4-worker pool. A trigger is an assistant `tool_use` of the
`Skill` tool naming this skill, parsed from the transcript. Raw transcripts retained.

The environment is a real, heavily loaded developer machine: the session init listed
**1,786 skills and 19 plugins** competing for discovery. That makes this a worst-case
discovery test, not a clean-room one.

## Results

| | Triggered | Did not |
|---|---|---|
| Should trigger (25) | 4 | 21 |
| Should NOT trigger (25) | 0 | 25 |

**Precision 100%. Recall 16%. False-positive rate 0%. False-negative rate 84%.**

The four that fired: T09 (plugin installs but skills do not show up), T20 (composition
patterns for skill plus hook), T22 (version compatibility across updates), T23
(marketplace.json format).

## Reading this honestly

- **The description never over-fires.** Zero invocations across 25 near-miss negatives is
  the half of the Skill Creator target this description already meets.
- **Passive discovery in a crowded environment is rare for everyone.** In a first
  (invalidated) run of the same 50 prompts, only 4 of 50 sessions invoked ANY of the 1,786
  available skills. The model mostly answers extension questions from its own knowledge
  without loading anything. Recall 16% measures this skill's pull against that baseline
  plus 1,785 competitors, not against silence.
- **One pass per prompt.** The Skill Creator method runs each query 3 times; budget capped
  this at 1. Treat per-prompt outcomes as noisy; the aggregate direction is stable.
- **Not a clean profile.** Session-start hooks and the full plugin population were live.
  A clean-room re-run would isolate the description's own pull; tracked in IMPROVEMENTS.md.

## The invalidated first run, kept for the record

The first 50-session run used the marketplace-installed copy of this plugin and scored
recall 0%. Investigation showed the plugin was enabled and `claude plugin details`
reported its skill, yet no session's init listing contained it, while a `--plugin-dir`
load of the identical directory listed it immediately. Two separate things were true:

1. The installed cache was pinned at version 1.0.0 from before this repo removed the
   version field, so pushed commits had never reached the installed copy. This is the
   documented version-cache trap happening to its own documenter; `claude plugin update`
   moved the install to commit-SHA versioning (`1.0.0 -> 5fc3205dee42`).
2. Even after the update, the marketplace-installed skill stayed absent from session
   listings on this machine. Recorded with reproduction steps in
   [evidence/observations/marketplace-install-skill-invisible-2.1.219.json](../evidence/observations/marketplace-install-skill-invisible-2.1.219.json);
   not yet reproduced in a clean profile, so environment factors (1,786 skills, identical
   plugin/marketplace/skill names) are uneliminated.

A benchmark run against an environment where the skill cannot appear measures nothing;
those transcripts were discarded from scoring and the run repeated with `--plugin-dir`.
