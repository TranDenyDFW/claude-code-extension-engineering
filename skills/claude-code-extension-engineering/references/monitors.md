# Monitors

> Claude Code 2.1.224, verified 2026-08-07. Re-verified MECHANICALLY against a refreshed docs mirror: every verbatim quote in this file still appears upstream (tools/quote-check.mjs), and the capability surface is unchanged at 51 tools and 31 hook events. 101 of 186 mirrored pages changed since 2.1.220 and were NOT all re-read, so this is a quote-and-capability check, not a full re-reading.


A shell command Claude Code starts automatically and runs for the LIFETIME of the session, delivering every stdout line to Claude as a notification. Like LSP it has no standalone authoring path: monitors are declared in a plugin and nowhere else, so shipping a monitor means shipping a plugin. It is the only automation mechanism that is pure INPUT. It adds context to a session and can never withhold, delay or refuse anything, because no block or deny contract exists for it anywhere.

**Layer:** Automation | **Classification:** subtype | **Status:** experimental | **Since:** v2.1.105

## Two different things are called Monitor

Settle this before reading anything else, because almost every wrong statement about monitors is a
property of one column asserted about the other.

| | Monitor TOOL | plugin MONITOR component |
|---|---|---|
| Armed by | the model, per request | plugin config, automatically |
| Style | imperative | declarative |
| Declared in | a `Monitor` tool call | `monitors/monitors.json` or `experimental.monitors` |
| Lifetime control | `timeout_ms`, default 300000 ms, or `persistent: true` | none. Session end only |
| Cancelled by | `TaskStop`, or asking Claude to cancel | nothing documented short of session end |
| Bash allow/deny rules | documented to apply | not documented either way |
| Experimental | not flagged | flagged experimental component |
| Since | v2.1.98 | v2.1.105 |

- They are ONE runtime, not two features. Plugin monitors are documented as using the same mechanism as the Monitor tool and sharing its availability constraints, and the tool documentation points back at plugin monitors as the automatic way to arm the same thing. Do not present them as unrelated, and do not carry a property across the table [OFFICIAL]  [v2.1.105]
- What the shared runtime does NOT share is the control surface. `timeout_ms`, `persistent` and `TaskStop` are inputs to the TOOL. None of them exists in the plugin component's schema [OFFICIAL]  [v2.1.105]

## No block or deny contract, and no timeout field

- A monitor is pure INPUT. The entire documented schema is `name`, `command`, `description` and `when`. There is no exit-code-2 semantics, no `{"decision":"block"}`, no `permissionDecision`, no `hookSpecificOutput` equivalent, and no field anywhere that lets a monitor gate, delay or refuse a thing [OFFICIAL]  [v2.1.105]
- There is also NO timeout field. Hooks carry a per-handler `timeout` with documented defaults; the Monitor tool carries `timeout_ms` defaulting to 300000 ms; the plugin monitor schema carries neither. The documented lifetime is the session [OFFICIAL]  [v2.1.105]
- Fail-open is therefore not a posture you choose here, it is the only posture available. When a monitor dies, the session simply stops hearing from it and carries on. Never write a requirement as "the monitor will catch X": nothing about a monitor is a guarantee, and the absence of notifications is indistinguishable from nothing having happened  [ENGINEERING]
- Every stdout line is unfiltered model-facing text produced by a process running unsandboxed at the same trust level as hooks. A monitored log is therefore an INJECTION SURFACE: anyone who can write a line into that file can put text in front of the model, with no filter in between. Watch sources you control, filter and reshape in the command rather than piping a raw log, and treat every delivered line as untrusted data  [ENGINEERING]
- The blast radius follows the trust level, not the payload. The command is as privileged as a hook while having none of a hook's control [OFFICIAL]

## Decide a monitor is correct

- The rule that decides most cases: a monitor is NOT a hook substitute because it cannot say no, and NOT a background-task substitute because it does not know how to stop  [ENGINEERING]
- Versus a HOOK: choose a hook whenever the answer has to gate something. A hook fires on a lifecycle event the harness owns and can deny the call; a monitor fires on a line of output and can only tell. If the requirement contains "prevent", "block", "require" or "must not", it is a hook. See [hooks.md](hooks.md)  [ENGINEERING]
- Versus a BACKGROUND TASK: a background Bash task runs to completion and reports once, and the user can list and stop it. A monitor emits one notification PER OCCURRENCE and, once a plugin armed it, has no documented stop short of session end. "Tell me when X finishes" is a background task. "Tell me every time X happens" is a monitor  [ENGINEERING]
- Versus a SUBAGENT: a subagent has a context window, judgment and tools. A monitor has a shell command and stdout. If deciding whether an event is worth reporting takes judgment, that judgment belongs to the model reading the notification or to a subagent, never inside the monitor  [ENGINEERING]
- Versus a SCHEDULED TASK: a monitor lives and dies with one interactive session and does not exist between sessions. Anything that must run whether or not somebody is at the terminal is not a monitor  [ENGINEERING]
- Two disqualifiers worth checking before writing any config: the watch must be worth a notification EVERY time it fires (see Context cost), and it must be acceptable that on some hosts and in some scopes it silently does not run at all (see Where monitors silently do not run)  [ENGINEERING]

## Configuration

**Where it goes.** `monitors/monitors.json` at the plugin ROOT, alongside `hooks/` and `skills/`, never
inside `.claude-plugin/`. To declare the same array inline, set `experimental.monitors` in
`plugin.json`. To load from another path, set `experimental.monitors` to a relative path string such
as `"./config/monitors.json"`.

```json
[
  {
    "name": "deploy-status",
    "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/poll-deploy.sh",
    "description": "Deployment status changes"
  },
  {
    "name": "error-log",
    "command": "tail -F ./logs/error.log",
    "description": "Application error log",
    "when": "on-skill-invoke:debug"
  }
]
```

| Field | Required | Meaning |
|---|---|---|
| `name` | Yes | Identifier unique within the plugin. This is the dedup key: it prevents duplicate processes when the plugin reloads or the skill is invoked again |
| `command` | Yes | Shell command run as a persistent background process in the SESSION working directory |
| `description` | Yes | Short summary of what is watched. Shown in the task panel and in notification summaries, so it is user-facing and model-facing text, not a code comment |
| `when` | No | `"always"` (the default) starts it at session start and on plugin reload. `"on-skill-invoke:<skill-name>"` starts it the first time that skill in this plugin is dispatched |

- A custom `experimental.monitors` path REPLACES the default `monitors/` folder rather than extending it, the same rule as `commands`, `agents`, `workflows`, `outputStyles` and `experimental.themes`. List the default explicitly if you want both [OFFICIAL]  [v2.1.129]
- The `experimental.monitors` key arrived at v2.1.129. A top-level `monitors` key still loads, but `claude plugin validate` warns and a future release will require the `experimental.*` form [OFFICIAL]  [v2.1.129]
- EXPERIMENTAL here means SCHEMA INSTABILITY, not feature-flagged off. Agent teams are off until `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is set; monitors need no env var and run as soon as the plugin is active. What the word buys you is a manifest schema documented as liable to change between releases. Borrowing the term from [agent-teams.md](agent-teams.md) without that distinction is wrong in both directions: it implies an off switch that does not exist, and it hides a compatibility risk that does [OFFICIAL]  [v2.1.129]
- `command` resolves `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}` and any `${ENV_VAR}` anywhere in the string. It runs through a shell, so wrap each substitution in double quotes, as in `"${CLAUDE_PLUGIN_ROOT}/scripts/poll.sh"`. There is no exec-form `args` array for monitors, so that quoting is the only defence the command has [OFFICIAL]

## Lifecycle and working directory

1. The session starts, or the plugin reloads, and every `when: "always"` monitor is armed. An `on-skill-invoke` monitor waits for its skill's first dispatch.
2. Each monitor runs as a persistent background process in the SESSION working directory.
3. Every stdout line is delivered to Claude as a notification, for as long as the process lives.
4. The session ends and the monitors stop.

- The cwd is the SESSION working directory, NOT the plugin directory. A relative path in the command (`tail -F ./logs/error.log`, exactly as the official example writes it) resolves against wherever the user started Claude Code. That is the single most likely reason a monitor "never fires". Prefix with `cd "${CLAUDE_PLUGIN_ROOT}" && ` when the script needs its own directory [OFFICIAL]
- Disabling the plugin mid-session does NOT stop a monitor that is already running. They stop when the session ends. The `/plugin` disable a user reaches for when a component misbehaves is the one action that will not stop this component [OFFICIAL]
- After a plugin UPDATE mid-session, `/reload-plugins` switches hooks, MCP servers and LSP servers to the new path, but MONITORS REQUIRE A FULL SESSION RESTART. This is the one component where "reload the plugin and try again" is the wrong instruction [OFFICIAL]
- The path consequence is worse than the reload consequence: until the restart, the monitor keeps executing the PREVIOUS version's path, which stays on disk for roughly two weeks after an update before cleanup. It runs old code and looks healthy while doing it [OFFICIAL]
- For iteration this means every command edit costs a session restart to test. Budget for it rather than debugging a stale process  [ENGINEERING]
- `name` is the only documented protection against duplicate processes across a reload or a repeat skill dispatch. A renamed monitor is a different monitor to that check, so keep names stable  [ENGINEERING]

## Secrets and ${user_config.*}

- A monitor `command` cannot reference `${user_config.*}`. Since v2.1.207 Claude Code REJECTS the monitor with an error instead of substituting the value, because the substituted string would reach a shell where `$(...)`, backticks and `;` execute. The check runs on the command TEMPLATE, so the error appears even when no value has been configured yet [OFFICIAL]  [v2.1.207]
- The exact error text: `Monitor "deploy-status" from plugin deploy-tools references ${user_config.*} in its command. The substituted value would be passed to a shell. Monitor commands cannot safely reference ${user_config.*}; have the monitor script read the value from a config file or prompt instead.` [OFFICIAL]  [v2.1.207]
- Monitor processes also do NOT receive `CLAUDE_PLUGIN_OPTION_<KEY>` environment variables. This is where a monitor is strictly poorer than a hook: a rejected hook has two escape routes (exec form with `args`, or reading `CLAUDE_PLUGIN_OPTION_<KEY>` from its environment) and a monitor has neither. The one documented answer is to have the monitor script read the value from a config file it owns [OFFICIAL]  [v2.1.207]
- Before v2.1.207 monitor commands DID substitute `${user_config.*}`. A plugin authored against an older build fails to start that monitor on a current one, per monitor, while the rest of the plugin keeps loading and looks healthy [OFFICIAL]  [v2.1.207]
- Do not route around the rejection by putting the secret on the command line. Monitor stdout becomes model-facing notification text and a process command line is readable locally; keep the credential inside the script's own config read  [ENGINEERING]

## Where monitors silently do not run

Read this before promising anyone a monitor.

| Condition | What happens |
|---|---|
| Project-scope skills-directory plugin (`<cwd>/.claude/skills/`, checked into the repo) | Background monitors DO NOT LOAD. MCP servers still get per-server approval and LSP servers still start after trust; monitors are dropped outright |
| Non-interactive session | Monitors run only in interactive CLI sessions |
| Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry | The Monitor tool is unavailable there, so plugin monitors are skipped |
| `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set | Same: the tool is unavailable, so plugin monitors are skipped |
| `${user_config.*}` in the command | Rejected with an error instead of started, on v2.1.207 and later |

- The project-scope hole is the one that bites, because checking the plugin into the repository is the natural way to give a team a plugin: everyone gets the plugin, nobody gets the monitor. Personal-scope plugins under `~/.claude/skills/` have none of these restrictions [OFFICIAL]
- No user-facing notice is documented for the silent cases. The plugin loads, the skills work, the monitor is simply absent. Design so a missing monitor degrades to "no extra context" and never to a broken workflow  [ENGINEERING]

## Context cost

- Monitor content never invalidates the prompt cache. Skills, commands, agents, hooks, LSP servers, monitors and themes all append after the existing conversation, so the next request pays for the new content and still reads everything before it from cache [OFFICIAL]
- Cache-safe is not free. Each line is admitted to the conversation and every later request re-reads it, so a chatty monitor costs its own size multiplied by the turns remaining in the session. The filter belongs in the COMMAND, upstream of Claude, not in the model's judgment after delivery  [ENGINEERING]
- Emit lines somebody would act on, never lines that prove the watcher is alive. A heartbeat is the classic mistake: pure cost, no decision  [ENGINEERING]
- The bound to design against is a whole session, not a request. With no timeout field and a busy source, nothing gives the stream a natural end  [ENGINEERING]
- Coverage cuts the other way, though: a filter narrowed to the happy path stays silent through a crash, and silence reads as "still fine". Match the terminal failure signatures too, then keep the volume down by watching a narrower source rather than by narrowing the pattern  [ENGINEERING]

## Testing a monitor

- Shares the generic capture-change-retest loop in [testing.md](testing.md).
- Run the command by hand from the SESSION working directory first, not from the plugin directory. Most monitor bugs are cwd bugs, and from inside a session they are invisible  [ENGINEERING]
- Prove line buffering before blaming the wiring. A pipe stage that buffers holds lines until its buffer fills, so a correct command can look dead for minutes: `grep` needs `--line-buffered`, `awk` needs `fflush()`  [ENGINEERING]
- Test the arming path per `when` value: session start for `"always"`, first dispatch of the named skill for `"on-skill-invoke:<skill>"`, and then a SECOND dispatch, which must not produce a duplicate process  [ENGINEERING]
- Test the silent-skip matrix deliberately: install the same plugin at project scope and OBSERVE the monitor not loading. A check that cannot fail is a defect, and a monitor that never started looks exactly like a monitor with nothing to report  [ENGINEERING]
- Restart the session, not the plugin, after every command edit, and confirm the restart is what picked up the change  [ENGINEERING]
- Test a hostile line: write instruction-shaped text into the watched source and confirm your handling posture holds. That path is reachable by anyone who can write to the file  [ENGINEERING]
- Test the failure you cannot see: kill the monitor process mid-session and confirm the workflow still completes with no notifications at all  [ENGINEERING]

## What the documentation does not say

Each item below is a gap in the DOCUMENTATION, never a claim about the behavior. Verify against your
own build before depending on an answer either way.

- Whether a CRASHED monitor is restarted. No `restartOnCrash` or `maxRestarts` analogue is documented for monitors, unlike LSP servers, which document both  [UNVERIFIED]
- Whether a monitor entry missing a required field (`name`, `command`, `description`) is a hard error or is silently skipped  [UNVERIFIED]
- Whether a failed or rejected monitor appears in the `/plugin` Errors tab. That surface is documented for language servers and for dependency skips, not for monitors  [UNVERIFIED]
- Whether Bash allow/deny permission rules gate PLUGIN-declared monitor commands. The rule is documented for the Monitor TOOL; the plugin component documents only that it runs unsandboxed at hook trust level  [UNVERIFIED]
- Whether any cap exists on monitor notification volume  [UNVERIFIED]
- Whether `claude plugin validate` reads `monitors/monitors.json` at all. Its documented coverage is `plugin.json`, skill/agent/command frontmatter and `hooks/hooks.json`, which is the same blind spot `.lsp.json` has in [lsp.md](lsp.md)  [UNVERIFIED]
- How `when: "always"` starting a monitor "on plugin reload" interacts with monitors requiring a session restart after a plugin UPDATE. Both statements are official; the combination is not spelled out  [UNVERIFIED]

## Common failure modes / anti-patterns

- Using a monitor as a guard. It has no deny path, so the guard is advisory and nobody finds out.
- Assuming a relative path resolves against the plugin. It resolves against the session working directory.
- Telling a user to disable the plugin to stop a monitor. That does not stop it; only session end does.
- Running `/reload-plugins` after a plugin update and expecting the monitor to move to the new path.
- Piping a raw log to stdout, which is an injection surface and an unbounded context bill at once.
- Heartbeats and progress chatter, which carry cost and no decision.
- `${user_config.*}` in a monitor command, rejected outright on v2.1.207 and later, and silently substituted before it.
- Shipping the monitor only in a project-scope plugin, where it does not load at all.
- Reusing one `name` for two monitors, or renaming across reloads, and collecting duplicate processes.
- Reading "experimental" as "off by default". Monitors are on the moment the plugin is active; the word refers to the manifest schema.
- Filtering to the success marker only, so a crashloop is indistinguishable from a quiet, healthy run.

## Definition of Done

- Requirement genuinely needs input only, with no gate, block or refusal anywhere in it
- Command tested by hand from the SESSION working directory, with line buffering proven
- Output filtered upstream, and every emitted line is one somebody would act on
- Failure signatures covered, not just the happy path
- Watched source treated as untrusted input, with a hostile line tested
- No `${user_config.*}` in the command, and secrets read inside the script from its own config
- Scope chosen deliberately, with the project-scope and host skip cases accepted in writing
- Arming path tested per `when` value, and a second skill dispatch proven not to duplicate
- Stop story documented for the user: session end, because plugin disable does not stop it
- Session-restart requirement stated wherever the plugin documents its updates

## Detail

- A shell command Claude Code starts automatically when a plugin is active, running for the lifetime of the session and delivering every stdout line to Claude as a notification.
- Declared in `monitors/monitors.json` at the plugin root, inline as `experimental.monitors` in `plugin.json`, or as a relative path string that REPLACES the default folder.
- Same runtime as the Monitor tool, so it inherits that tool's availability constraints, but not its `timeout_ms` and not its `TaskStop` cancellation. Whether the tool's Bash allow/deny rules also gate a PLUGIN-declared monitor is UNVERIFIED, as the table above records: the docs state that rule for the Monitor tool only and say nothing either way about the component. Do not read this line as a denial.
- Pure input. It can add context and can never withhold any. The only documented stop is session end.
