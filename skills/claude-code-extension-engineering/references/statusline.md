# Status line

> Claude Code 2.1.229, verified 2026-08-13. What that means here: every claim below was checked
> against a live fetch of the Status line page on that date, not against the docs mirror, because
> this file is new and had no prior verification to inherit. It carries NO verbatim quotes, so the
> quote gate says nothing about it.


A shell command Claude Code runs and renders as a bar at the bottom of the session. It receives
session state as JSON on stdin and displays whatever the script prints. It is the only authored
surface whose whole job is to SHOW state Claude Code already tracks, which is why it answers a class
of question no other mechanism does: the user can see the state but cannot get at it.

**Layer:** Presentation | **Classification:** primitive | **Status:** stable

## What it is

- The status line is a command, not a template: Claude Code runs it and renders its stdout, so anything the script can compute can be displayed and anything it cannot compute cannot be. [OFFICIAL]
- It renders in its own row ABOVE the built-in footer badges rather than replacing them, but configuring one suppresses most of the footer's keyboard hints, including the interrupt hint and the shortcuts fallback. [OFFICIAL]

## Settings

- `statusLine` takes `type` and `command`, plus three optional fields: `padding` for extra horizontal characters defaulting to 0, `refreshInterval` to re-run every N seconds with a minimum of 1, and `hideVimModeIndicator` to suppress the built-in insert-mode text. [OFFICIAL]
- `refreshInterval` runs IN ADDITION to the event-driven updates rather than replacing them, so setting it does not reduce how often the script runs. [OFFICIAL]
- `subagentStatusLine` is a SEPARATE setting that renders a row body per subagent in the agent panel, not a mode of `statusLine`, and the same workspace-trust and `disableAllHooks` gates apply to both. [OFFICIAL]
- A plugin can ship a default `subagentStatusLine` in its own settings, so a status line the user did not author can be in play on a machine that installed one. [OFFICIAL]

## When the script runs

- It runs once when a session starts, INCLUDING when the session is resumed, then again on session events, and on the `refreshInterval` timer if one is set. [OFFICIAL]
- Updates are debounced at 300ms so rapid changes batch and the script runs once after they stop, which means a script assuming one run per event will undercount. [OFFICIAL]
- The event-driven triggers go quiet while the main session is idle, for example while a coordinator waits on background subagents, so a display that must keep moving needs `refreshInterval` rather than events. [OFFICIAL]

## The stdin contract

Claude Code passes one JSON object. The fields worth knowing, because they answer the questions
people actually ask:

| Field | Carries |
|---|---|
| `model.id`, `model.display_name` | current model |
| `workspace.current_dir`, `workspace.project_dir`, `workspace.added_dirs` | where the session is rooted and what was added |
| `workspace.git_worktree`, `workspace.repo.*` | worktree name and parsed repository identity |
| `cost.total_cost_usd`, `cost.total_duration_ms`, `cost.total_api_duration_ms` | spend and elapsed time |
| `context_window.used_percentage`, `context_window.remaining_percentage` | pre-calculated, so no arithmetic is needed |
| `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage` | rate-limit consumption |
| `effort.level`, `thinking.enabled`, `fast_mode`, `exceeds_200k_tokens` | current reasoning posture |
| `transcript_path` | the session transcript, the same field hooks receive |

- Context percentages arrive PRE-CALCULATED, so a script that recomputes them from raw token counts duplicates work and can disagree with what Claude Code itself reports. [ENGINEERING]

## Windows

- On Windows the command runs through Git Bash when Git Bash is installed and through PowerShell when it is absent, so one configuration runs under two different shells depending on what the machine has. [OFFICIAL]
- Git Bash treats unquoted backslashes as escape characters, so a Windows-style path reaches the runner with its separators eaten; use forward slashes, or invoke `powershell -NoProfile -File` with a forward-slash path, which behaves the same whichever shell Claude Code routes through. [OFFICIAL]

## It renders on every keystroke, so treat its input as untrusted

Whatever the script prints reaches the terminal, and the script runs constantly. That combination
turns any file it reads into an input worth checking.

- A script that reads a flag or state file at a predictable path is reading something another process can write. Refuse a symlink, cap the read to a small byte count, filter the characters, and match the value against a closed list before printing it  [ENGINEERING]
- The characters that matter are ANSI escapes and OSC sequences, which a terminal ACTS on rather than displays. Strip them from anything you did not author, and truncate visibly rather than silently  [ENGINEERING]
- Keep any hyperlink target allowlist in the renderer, never in the payload being rendered, or the thing you are displaying chooses where the link goes  [ENGINEERING]
- Do not style a shell command as clickable. A command the user is meant to TYPE, rendered as a link, invites a click on something that was never a URL  [ENGINEERING]
- Render nothing rather than a placeholder before the first real measurement, so the line never shows a number that was never measured  [ENGINEERING]
- Suppress errors per metric and supply a default, so one failing segment degrades rather than taking the whole line down  [ENGINEERING BEST PRACTICE]  [ENGINEERING]

## Failure posture

- A status line CANNOT block, refuse, or enforce anything: it is display, and a script that exits non-zero or prints nothing degrades to an empty row rather than stopping the turn, so it must never be reached for as a guard. [ENGINEERING]
- It runs on every update in an active session, so a slow command such as a `git status` in a large repository is paid repeatedly, and the cost belongs in the script's own caching rather than in a longer interval, because event-driven runs happen regardless of `refreshInterval`. [ENGINEERING]

## Choosing this over the alternatives

- Choose a status line when the requirement is TO SEE state Claude Code already holds, a monitor when something must react to a change, and a hook when something must happen at a lifecycle point: this surface answers "show me" and never "do something when". [ENGINEERING]

## Definition of Done

- The script is proven to run under the shell the target platform actually uses
- Its cost per run is measured, not assumed
- Pre-calculated fields are used rather than recomputed
- The display degrades visibly rather than silently when the script fails
