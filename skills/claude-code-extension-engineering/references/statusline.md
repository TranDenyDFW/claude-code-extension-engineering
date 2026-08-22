# Status line

> Claude Code 2.1.239. What that means here: this file carries NO verbatim quotes, so the quote gate
> says nothing about it. Per-claim provenance lives in `evidence/claims.jsonl`, where the gates read
> it; nothing else is asserted here.


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
- Read that as scoped to the INTERACTIVE TUI entrypoint. Claude Code decides interactivity from argv plus the terminal: `-p`/`--print`, `--init-only`, any `--sdk-url`, OR `!process.stdout.isTTY` each make the session non-interactive, and a non-interactive session never mounts the prompt screen. The status line is a component inside that screen, so on a non-TTY entrypoint a configured `statusLine` is not run at all rather than run and discarded  [ENGINEERING] [v2.1.237]
- The `!process.stdout.isTTY` clause is the one that catches people, because it fires with no flag present. A host that pipes stdio, for example a desktop or IDE shell driving the CLI over `--input-format stream-json --output-format stream-json`, is non-interactive by that clause alone, and its users never see a status line they correctly configured  [ENGINEERING] [v2.1.237]
- Hooks are the contrast that makes the boundary usable: they are process level, not TUI, so `PreCompact`, `PostCompact` and the rest fire on every entrypoint. If something must observe a lifecycle point on a piped-stdio host, it is a hook; the status line cannot cover for it  [ENGINEERING]
- Diagnose a silent status line in this order: is the entrypoint interactive, THEN is the workspace trusted, THEN is the command itself failing. The trust gate and the entrypoint gate produce an identical silence, and only one of them is fixed by accepting a dialog  [ENGINEERING]
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
- Claude Code does NOT render this command's stderr, which is what makes stderr the safe channel for a side effect that fails. Wrap any capture, cache write or state update so a failure reports there and the line still prints: the display must never be taken down by bookkeeping attached to it  [ENGINEERING]
- When capturing the stdin payload, WRAP it rather than mutating it. Keep the received object byte-faithful and put your own metadata, a receive timestamp and a provenance flag, BESIDE it. The stdin schema is not stable, so the cheap moment to record a field is before you know you need it, and a capture that edits the payload can no longer tell you what the host actually sent  [ENGINEERING]
- REFUTED as usually written, but the harness supplies what the probe was for. Claude Code CAPTURES the script's output instead of connecting it to the terminal, so `tput cols` and language-level width detection see nothing from inside the script. The documented substitute is to read the `COLUMNS` and `LINES` environment variables, which Claude Code sets to the current terminal dimensions before running the script, on v2.1.153 or later. So the answer is not to emit blindly: it is to take the dimensions from the environment rather than from a terminal query  [OFFICIAL]  [v2.1.153]
- Hyperlink support is decided by the HARNESS, not by your script. Claude Code runs its own detection, which is why links that render as plain text on Windows Terminal are a detection-list miss rather than a script bug, and `FORCE_HYPERLINK` is the documented override. Emit conservatively for anything the harness does not resolve for you  [OFFICIAL]
- Escape sequences can collide with the harness's own drawing: complex ANSI and OSC 8 output is documented as occasionally garbling when it overlaps other UI updates, and multi-line status lines with escape codes are more prone to it than single-line plain text. Treat a layout that survives only at one width as unsupported  [OFFICIAL]
- A corpus practice keeps columns 15 to 25 of the second-to-last line clear because the harness draws there. UNVERIFIED against the current build: the collision phenomenon is documented, the specific column range is not, and it is exactly the kind of number a release moves. Prefer the general rule above to the coordinates  [ENGINEERING]

## Paying for the line, which is the part that runs thousands of times

- Cache expensive work to a file with a staleness check rather than shelling out on every render. The documented example runs `git` only when the cache is missing or older than five seconds, and it keys the cache filename on the SESSION so concurrent sessions in different repositories cannot read each other's state  [OFFICIAL]
- The session key is the load-bearing half. A cache file at a fixed path is shared by every session on the machine, so the failure is not a stale number but one project's branch shown in another project's window  [ENGINEERING]
- Serve the STALE value while refreshing rather than blanking the segment, so a slow refresh degrades to an old number instead of a hole. This is not the documented example's behaviour, which recomputes when stale and pays the wait  [ENGINEERING]
- Where one segment must move faster than the rest, give it its OWN freshness clock rather than shortening the whole cache. One global interval sized for the fastest segment pays the slowest segment's cost at that rate  [ENGINEERING]
- ANTI-PATTERN, and the sharpest one here: resolving a package from a registry inside the render loop, for instance calling `npx` for a version string. The docs warn that slow commands such as `git status` cause lag; a NETWORK call is that failure with an outage attached, and at render frequency it is a self-inflicted flood  [ENGINEERING]
- On Windows, hide the console window of every subprocess the script spawns and lengthen the cache, or each render flashes a console. The setting is undocumented in the status line material even though the file already carries a Windows section  [ENGINEERING]
- A single flag file at a predictable path is the only bridge between a hook and the status line, which are separate processes with no return channel. Have every reader honour `CLAUDE_CONFIG_DIR` so the bridge follows a relocated configuration rather than splitting in two  [ENGINEERING]
- `statusLine` is a SINGLETON key: an installer that writes it unconditionally destroys whatever the user already had. Write it only when absent, and otherwise print the merge snippet and let the user apply it  [ENGINEERING]

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
