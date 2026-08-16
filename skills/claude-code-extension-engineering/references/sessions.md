# Sessions, transcripts and rewind

> Claude Code 2.1.229, verified 2026-08-13. What that means here: every claim below was checked
> against live fetches of the Manage sessions and Checkpointing pages on that date, not against the
> docs mirror, because this file is new and had no prior verification to inherit. It carries NO
> verbatim quotes, so the quote gate says nothing about it.


What survives when a session ends, what a resumed session carries back, and what `/rewind` can and
cannot undo. This is a DURABILITY reference rather than a usage guide: the questions it answers take
the form "I had that, where did it go", which no other reference in this library owns.

**Layer:** Runtime state | **Classification:** builtin | **Status:** stable

## Read this first: what survives a session, not how sessions talk

- This file is about durability: what a resumed session carries back, what `/rewind` can and cannot undo, and what is gone for good. If the question is about listing or messaging your OTHER live sessions, on this machine or another, that is `cross-session-messaging`, which this library does not restate [OFFICIAL]
- The distinction is time. This file is about a session that ENDED; that page is about sessions running CONCURRENTLY [ENGINEERING]

## Where the record lives

- Transcripts are stored as JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`, where the project segment is the working directory path with non-alphanumeric characters replaced by hyphens. [OFFICIAL]
- The per-line entry format is INTERNAL and changes between versions, so a script parsing those files directly can break on any release; read session data through `/export`, the `-p --output-format json` result, or the `transcript_path` that hooks and status line commands receive. [OFFICIAL]
- Storage location, retention and whether transcripts are written at all are configurable: `CLAUDE_CONFIG_DIR` moves storage off `~/.claude`, `cleanupPeriodDays` changes the 30-day retention, `CLAUDE_CODE_SKIP_PROMPT_HISTORY` suppresses writes in all modes, and `--no-session-persistence` suppresses them for one non-interactive run. [OFFICIAL]

## `~/.claude.json` is a DIFFERENT file from `~/.claude/settings.json`

Two files one character apart hold different things, and putting a key in the wrong one fails
silently. This is the first thing to check when a settings key "does nothing".

- `~/.claude.json` holds the OAuth session, user- and local-scope MCP server configuration, per-project state such as allowed tools and trust settings, and assorted caches. Project-scoped MCP servers live separately in `.mcp.json` [OFFICIAL]
- A set of keys belongs to `~/.claude.json` rather than `settings.json`, and putting them in `settings.json` is not an error you will see: Claude Code silently ignores them at startup [OFFICIAL]
- The documented set is `autoConnectIde`, `autoInstallIdeExtension`, `diffTool`, `externalEditorContext`, `permissionExplainerEnabled` and `teammateDefaultModel`, listed on the settings page under global config settings, which is the table to check when a key does nothing [OFFICIAL]
- The diagnostic order that follows: confirm the key belongs in the file you edited BEFORE checking scope, syntax or precedence. A key in the wrong file and a key at an inert scope look identical from the outside, and only one of them is fixed by moving it between user and project settings [ENGINEERING]

## Most settings hot-reload; a few do not

- Claude Code watches the settings files and reloads them on change, so edits to most keys apply to the RUNNING session with no restart. That covers `permissions`, `hooks` and credential helpers such as `apiKeyHelper`, across user, project, local and managed settings, and the `ConfigChange` hook fires for each detected change [OFFICIAL]
- A few keys are read once at session start and take effect only on the next run. `outputStyle` is one, because it forms part of the system prompt, which is rebuilt on `/clear` or restart [OFFICIAL]
- Do not assert the general case backwards. Telling someone that settings are read at startup and so a restart is required is wrong for most keys and wastes their time; the true statement is that reloading is the default and the exceptions are enumerated [ENGINEERING]

## Deleting the record, which is a command rather than a file hunt

- `claude project purge [path]` deletes the state Claude Code holds for ONE project: transcripts and auto memory under `projects/`, the per-session `tasks/`, `debug/` and `file-history/` entries, the matching prompt lines in `history.jsonl`, and that project's entry in `~/.claude.json`. It prints the full deletion plan and asks for confirmation before removing anything [OFFICIAL]
- It takes `--dry-run` to preview the plan, `-y`/`--yes` to skip confirmation, `-i`/`--interactive`, and `--all`. A path matching no state prints an error and exits 1, rather than reporting a successful deletion of nothing [OFFICIAL]
- Prefer it to deleting the JSONL files by hand. The state is spread across five locations and a manual sweep reliably leaves the `~/.claude.json` entry and the `history.jsonl` prompt lines behind, so the transcripts are gone while the prompts that produced them are not  [ENGINEERING]

## What a resumed session restores

- Conversation history, the model, an `--agent` selection with its prompt and tool restrictions, the permission mode, an active goal, and unexpired scheduled tasks all carry over, while background Bash and monitor tasks do NOT. [OFFICIAL]
- `plan` and `bypassPermissions` are NEVER restored, and `auto` is restored only when the account still meets the auto-mode requirements, so a session that ran with permissions bypassed comes back without it, which is a safety property rather than an inconvenience. [OFFICIAL]
- Launch-time configuration is not restored and must be passed again, specifically `--mcp-config`, `--settings`, `--plugin-dir`, `--fallback-model` and directories added with `--add-dir`, while the standard settings files are re-read at launch: this is the usual cause of a setup that worked right up until it was resumed. [OFFICIAL]
- The model is not restored when it has been retired, when `availableModels` disallows it, when a `--model` flag or an `ANTHROPIC_MODEL`-family variable picks one at launch, or on providers that use deployment IDs. [OFFICIAL]

## What /rewind can undo, and what it cannot

- Every user prompt creates a checkpoint and file snapshots are kept for the 100 most recent checkpoints in a session, saved with the conversation so `/rewind` still works after a resume. [OFFICIAL]
- Checkpoints are deleted along with sessions after 30 days, governed by the same `cleanupPeriodDays` setting that governs transcripts. [OFFICIAL]
- Files modified by BASH COMMANDS are not tracked and cannot be undone through rewind, because only edits made through the file-editing tools are captured, so an `mv` or `rm` Claude ran is outside the mechanism entirely. [OFFICIAL]
- Subagent edits are usually NOT restored, the documented exception being a foreground forked skill which edits during the user's own turn, so a background fork and a background code-review fix need git instead. [OFFICIAL]
- Symlinked and hard-linked paths are skipped by a restore, which reports the count of skipped files and leaves their contents as they are. [OFFICIAL] [v2.1.216]
- Checkpointing is explicitly not a replacement for version control: it is session-level recovery, and permanent history remains git's job. [OFFICIAL]

## The durability question, answered directly

| The thing | Survives session end | Recoverable by /rewind |
|---|---|---|
| Conversation history | yes, in the transcript | yes |
| Edits by the file-editing tools | on disk | yes |
| Edits by a bash command | on disk | NO |
| Edits by a background subagent | on disk | NO, use git |
| Symlinked or hard-linked paths | on disk | NO, skipped with a warning |
| `bypassPermissions` and `plan` mode | NO, never restored | not applicable |
| Background Bash and monitor tasks | NO | not applicable |
| Anything passed only as a launch flag | NO, re-pass it | not applicable |

## Failure posture

- The absence of a saved session is reported rather than silent: resuming an unknown id reports that no conversation was found instead of starting an empty one, and a resume that fails from the picker exits non-zero while the same failure inside a running session leaves the current conversation running. [OFFICIAL]
- Two terminals resuming the same session WITHOUT forking interleave their messages into one transcript, so parallel work on one conversation needs a branch rather than a second open copy. [OFFICIAL]

## Definition of Done

- The recovery path for bash-made and subagent-made edits is git, and that is stated rather than assumed
- Launch flags the session depended on are recorded somewhere durable, since resume will not carry them
- Retention is set deliberately if anything downstream depends on transcripts existing
- Nothing parses the JSONL entry format directly
