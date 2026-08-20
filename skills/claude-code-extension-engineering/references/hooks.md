# Hooks

> Claude Code 2.1.233. What that means here: this file carries SIX verbatim quotes and
> `tools/quote-check.mjs` confirms they still appear upstream. Per-claim provenance lives in
> `evidence/claims.jsonl`, where the gates read it; nothing else is asserted here.


Code the HARNESS runs on a lifecycle event, independent of the model's judgment. This is the only mechanism whose FIRING the harness owns: the model cannot talk its way out of a hook running. Firing is not outcome, though. What happens after depends on the handler's failure policy (an HTTP handler fails OPEN on connection failure) and on the tamper boundary (disableAllHooks switches every hook off; only managed policy survives that), both covered below. Five handler types (command, http, mcp_tool, prompt, agent), and the last two carry judgment, so hooks are no longer purely mechanical.

**Layer:** Automation | **Classification:** primitive | **Status:** stable

## Read this first: SDK hooks are a different mechanism

- If the question is about hooks in the **Agent SDK**, this is the wrong file. The SDK's hooks are
  programmatic: callbacks registered in code against an SDK session, not JSON handlers discovered
  from `.claude/`. They are covered in `agent-sdk.md`.
- The word is the entire overlap. Answering an SDK question out of this file produces settings-file
  syntax for a surface that never reads settings files, which is the failure this library exists to
  prevent: accurate, sourced, and about a mechanism the asker is not using.
- Everything below is the harness-run, event-driven mechanism configured under `.claude/`.

## Decide a Hook is correct

- Can the outcome be checked deterministically?
- Exception: prompt / agent hook types add judgment  [OFFICIAL]

## Handler type

- Windows: set "shell": "powershell" on a command hook (auto-detects pwsh.exe, falls back to powershell.exe). Use ${CLAUDE_PROJECT_DIR} or $env:CLAUDE_PROJECT_DIR; bare $CLAUDE_PROJECT_DIR parses as an undefined variable and resolves to $null [OFFICIAL]
- args: string[] (exec form) spawns without a shell so path placeholders never need quoting; continueOnBlock: true on PostToolUse feeds the rejection reason back and continues the turn (both 2.1.139) [OFFICIAL]  [v2.1.139]

## Testing matrix (test as code)

- Expected PASS (exit 0, no block)
- Expected BLOCK (exit 2 on a blocking event)
- Boundary case
- Malformed input JSON
- Missing field
- Unexpected tool / event
- Hook runtime error
- Hook timeout
- False positive (blocks a safe action)
- False negative (misses a bad action)
- Repeated execution (idempotent, fast)
- Shares the generic capture-change-retest loop in [testing.md](testing.md)
- ASK THE ASKER TO RUN `/hooks` BEFORE ENUMERATING CAUSES. It opens a read-only browser of every hook registered for the current session, grouped by event, with the settings file each came from, and a hook that does not appear there is not being read at all. That settles in one command what a list of causes can only enumerate, and it reaches what reading settings files by hand does not: managed policy settings, a plugin's own `hooks/hooks.json`, and hooks declared in skill or subagent frontmatter. `/status` lists the active settings sources and `claude doctor` reports a file that failed validation  [OFFICIAL]
- Evidence source: matches, exit codes, and full stdout/stderr go to the debug log (claude --debug-file PATH, or ~/.claude/debug/SESSION-ID.txt with --debug, which prints NOTHING to the terminal); CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose adds matcher-level detail [OFFICIAL]

## What the matrix above cannot see

Every row of that matrix drives the HANDLER and reads what comes back. A handler can be perfect and
never run, and no amount of handler testing detects it.

- Assert the REGISTRATION itself, as data. Load the settings or hooks file, walk to the entry you expect, and assert the event name, the matcher, the `shell` field and the command shape, printing the actual value on failure. This file already tells a reader that wiring causes outrank handler causes when a hook does not fire, and then offers no way to test the wiring  [ENGINEERING]
- A SCHEMA VIOLATION ELSEWHERE IN THE FILE CAN STOP YOUR HOOKS LOADING, silently. Measured 2026-08-17 by a controlled A/B on 2.1.229: two runs differing only in `permissions.allow` being a valid array versus the string NOT_AN_ARRAY, with a byte-identical SessionStart hook block. The valid run fired and injected once; the invalid run did not fire at all and injected nothing, with NO warning in the debug log. So an unrelated key can disable every hook in the same file  [ENGINEERING]  [v2.1.229]
- The documented behaviour at USER scope is the whole-file rejection, and it is documented as REPORTED: tolerance applies only to managed settings, while user, project and local files remain strict, a file that fails validation being rejected as a whole and reported. An interactive session shows a Settings Error dialog at startup, `/status` then lists the affected files, and `claude doctor` gives the details  [OFFICIAL]
- So the gap the measurement found is NOT tolerant-versus-fatal, it is REPORTED-versus-SILENT. Whole-file rejection is exactly what the docs promise, and the surprise is that the probe saw no notice of any kind. A headless run has no startup dialog to show, which is the likeliest explanation and is not something this library has measured  [ENGINEERING]
- Managed settings behave differently and are the case that must not be generalised from: they parse tolerantly, so a failing entry is STRIPPED, a warning recorded, and every remaining valid entry still enforced  [OFFICIAL]
- The practical consequence is a validation step, not a bigger matrix: validate the whole settings file against its schema BEFORE writing it, because the failure mode is not a broken hook but a file whose hooks never load. `$schema` in the file gives editors the same check  [ENGINEERING]
- Assert the NEGATIVE half of any branching output. Where two output shapes are mutually exclusive, assert the expected field is present AND each competing field is absent, or a handler emitting several at once passes a test written only for the one you wanted  [ENGINEERING]
- Run integration tests against a THROWAWAY home and config directory supplied through the environment, so the install, activate, reinstall and uninstall cycle cannot touch the developer's real configuration and cannot pass merely because that machine is set up correctly. `CLAUDE_CONFIG_DIR` is the documented lever; note it redirects CONFIG only, so a probe that also needs a clean environment must scrub that separately  [ENGINEERING]

## ENRICHING or ENFORCING: decide this before writing a line

This file gives both postures and never says which one you are in. "A safety hook must not brick
Claude Code" argues for failing open; the jq bullet under Contracts treats failing open as the
defect. Both are right, for different hooks, and the discriminator decides how the handler is
written down to its shell flags.

- The event decides part of it for you, and this is documented rather than a matter of style. Nine events have NO DECISION CONTROL at all, WorktreeRemove, Notification, SessionEnd, PostCompact, InstructionsLoaded, StopFailure, CwdChanged, DirectoryAdded and FileChanged, and are for side effects like logging or cleanup. Setup and SubagentStart carry context only. A guard wired to any of those is enriching whatever its author intended  [OFFICIAL]
- SessionStart sits in that same documented row and is the exception the row's label hides: it accepts four further outputs beyond context, listed under Contracts below. It still cannot BLOCK, so it is enriching for the purpose of this section, but calling it context-only is the error this library already corrected once  [OFFICIAL]  [v2.1.220]
- The docs go further and say a hook is the WRONG MECHANISM for hard enforcement in at least one place: the `if` filter fails open when a Bash command cannot be parsed, and because it is best-effort, "use the [permission system](/docs/en/permissions) rather than a hook to enforce a hard allow or deny"  [OFFICIAL]
- The no-opinion signal is a real contract, not an accident: exit 0 with no output means the hook has no decision to report and the call continues through the normal permission flow. An HTTP handler's 2xx with an empty body is equivalent. A timeout is stronger still, since the output is DISCARDED and the hook renders no decision whatever it printed  [OFFICIAL]
- ENRICHING hooks must not fail fast. Write them without `set -euo pipefail` and end every branch in an unconditional `exit 0`, because strict mode aborts on any unexpected non-zero command, an aborting hook exits non-zero, and a non-zero exit on a blocking event converts a warning-only hook into one that blocks the user. Wrap even existence checks so a miss cannot propagate  [ENGINEERING]
- ENFORCING hooks are the opposite and should use strict mode, because a guard that silently skips its own check is worse than no guard. This is the contradiction a hook-script linter and an advisory-hook rule appear to have with each other, and it dissolves once the posture is named first: the linter is describing gates, the advisory rule is describing enrichment  [ENGINEERING]
- A guard may deliberately INVERT the runtime's fail-open default, and truncation is the case that proves it. If the runner caps stdin and reports truncation, a fail-open policy is itself an attack surface: pad the tool input past the cap and the protected filename never reaches the check. That is a bypass by padding, and the answer is exit 2 on truncation even though the surrounding default is to continue  [ENGINEERING]
- For anything wrapping a hook, the rule is one line: FAIL OPEN ON TRANSPORT ERRORS, FAIL CLOSED ON A REAL BLOCK. Re-raise only the exit status that means block and treat every other non-zero as no opinion. Propagating every child failure turns a missing interpreter into a blocked tool call; propagating none silently disables the guard  [ENGINEERING]
- A Node handler reading stdin needs an error listener that exits 0. A broken pipe or a dead parent emits `error` on `process.stdin`, Node rethrows it as an uncaught exception, and the harness reports a failing hook when nothing was wrong with the check itself  [ENGINEERING]
- An ENRICHING hook still READS as a directive to the model, which is the trap in calling it advisory. Injected context is instruction-shaped whether or not it was meant that way, so a warning carrying an alarming number should name the inference it is NOT making: informational only, not an instruction to stop  [ENGINEERING]

## Failure safety / guard-the-guard

- A safety hook must not brick Claude Code, and the section above is how you decide whether that applies to the hook in front of you  [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Pass-path AND block-path both tested (toggle-bad → confirm → fix)
- Change flow for a hook, run in order every time the handler is modified:
  1. Hook modification.
  2. Unit or local test, outside Claude Code, driving the handler with fixture JSON on stdin.
  3. Pass-path test: a safe action still goes through.
  4. Block-path test: the bad action is actually stopped.
  5. Boundary test.
  6. Failure-mode test, covering both a handler error and a timeout.
  7. Live Claude Code test, in a real session.
  8. Regression suite.
- A hook is not tamper-proof: disableAllHooks: true switches every hook off and there is no per-hook disable; only managed-level settings can disable managed hooks, and allowManagedHooksOnly blocks user, project, and plugin hooks [OFFICIAL]

## Exit codes

| code | meaning |
|---|---|
| 0 | success; stdout parsed as JSON (JSON only processed on 0) |
| 2 | blocking error; stderr fed back; effect depends on event |
| other | non-blocking error; shown as a hook-error notice; execution continues |


## 5 types: command, http, mcp_tool, prompt, agent

| type | what it runs |
|---|---|
| command | shell command / executable (stdin JSON, exit code + JSON stdout) |
| http | POST to a URL endpoint (JSON body); headers + allowedEnvVars |
| mcp_tool | calls an MCP server tool with a mapped input |
| prompt | single-turn LLM eval (optional fast model) |
| agent | a subagent with tools evaluates the event |


## Worked example

**Where it goes.** `~/.claude/settings.json` (user, all projects),
`.claude/settings.json` (project, committed), `.claude/settings.local.json` (project, gitignored),
or a managed-policy settings file. Plugins use `hooks/hooks.json` at the plugin root.

**Built-in tool names** you can match on: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`,
`WebFetch`, `WebSearch`, `NotebookEdit`, `Agent`, `Skill`. The matcher is compared against
`tool_name`.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(rm *)",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh",
            "args": [],
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

A handler object is `{type, command}` plus optional `if`, `args`, `timeout`, `async`, `shell`.
`type` is one of `command`, `http`, `mcp_tool`, `prompt`, `agent`.

**To block from the handler**, print this on stdout and exit 0:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Destructive command blocked by hook"
  }
}
```


## Contracts the test run found missing

- SessionEnd hooks have a default timeout of 1.5 seconds, not the generic 600 s command default. It applies to session exit, /clear, and switching sessions via interactive /resume. Override with CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS.  [v2.1.219]
- The `if` field filters a handler using PERMISSION RULE syntax, for example "Bash(git *)" or "Edit(*.ts)". The handler runs only if the tool call matches, so `rm -rf /tmp/build` matches "Bash(rm *)" while `npm test` does not.  [v2.1.219]
- PostToolBatch has NO matcher support and always fires on every occurrence. It sits in the top-level block/context group alongside UserPromptSubmit, Stop, TeammateIdle, TaskCreated, TaskCompleted, WorktreeCreate, WorktreeRemove and MessageDisplay.  [v2.1.219]
- additionalContext is returned INSIDE hookSpecificOutput alongside the event name, and several hooks returning it for the same event all reach Claude. MEASURED on 2.1.219: additionalContext IS honoured on PostToolUseFailure. Three headless runs with a hook returning a marker on that event: the hook fired on each genuine tool failure and the marker reached the model every time, delivered as a system-reminder attached to the failed tool result. Two caveats stand: a PERMISSION DENIAL does not fire PostToolUseFailure (the first trial produced zero hook fires because headless default-deny blocked the tool before execution; that path is PermissionDenied), and continueOnBlock remains documented only on PostToolUse and unmeasured elsewhere.  [ENGINEERING] [v2.1.219]
- There is NO top-level `additional_context`. MEASURED on 2.1.229 with an isolated CLAUDE_CONFIG_DIR and a control that fired in every variant: three SessionStart hooks emitting distinct payload lengths gave one injection for the nested field alone, ZERO for a top-level `additional_context` alone, and one for both together. So the nested field is read, the top-level spelling is read by nothing, and there is no double injection. The trap is the zero row: a hook emitting only the top-level name injects nothing at all, with no error, no warning and a handler that exited 0  [ENGINEERING]  [v2.1.229]
- The event name is NOT in the environment. A SessionStart hook dumping every variable matching CLAUDE, HOOK or EVENT found none carrying the lifecycle event in any spelling, and argv was empty; it arrives on stdin as `hook_event_name` and only there. MEASURE THIS FROM A SCRUBBED PARENT or you will document your own environment as the contract: the same probe saw 24 variables when launched normally and 8 when launched with `env -i`, and the 16 that vanished were INHERITED rather than injected, `CLAUDE_CODE_HOST_SESSION_ID` among them. The 8 the runtime actually supplies to a headless handler are `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION` (set for a `-p` session, and it survived `env -i`, so it is not inherited), `CLAUDE_CODE_ENTRYPOINT` (sdk-cli), `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, `CLAUDE_PROJECT_DIR`, `CLAUDE_CONFIG_DIR`, and `CLAUDE_ENV_FILE`, whose value is a PER-INVOCATION path shaped `<config>/session-env/<session-uuid>/<event>-hook-<n>.sh` that does not exist on disk when the handler runs  [ENGINEERING]  [v2.1.229]
- Hook output is capped at 10,000 characters, counting additionalContext, systemMessage and plain stdout together. Output beyond the cap is saved to a file and replaced with a preview plus the file path, not silently truncated.  [v2.1.220]
- Do not copy the published examples that pipe stdin through jq: jq is absent on many Windows installs, so the handler exits non-zero, fails open, and silently blocks nothing while looking installed. Parse the JSON in your interpreter instead.  [ENGINEERING] [v2.1.219]
- SessionStart is not context-only: hookSpecificOutput accepts additionalContext, initialUserMessage (non-interactive -p mode; CREATES the first turn rather than attaching to one), sessionTitle (ignored on clear and compact sources), watchPaths (ABSOLUTE paths, feeds FileChanged), and reloadSkills (a hook-installed skill becomes available in the same session). Full table in [hook-events.md](hook-events.md).  [OFFICIAL]  [v2.1.220]

## What the handler receives on stdin

Every handler receives one JSON object on **stdin**. Common fields on every event:
`session_id`, `transcript_path` (JSONL), `cwd`, `hook_event_name`, plus `agent_id` and `agent_type` inside a subagent.
Also common, each with a presence condition: `permission_mode`, `effort` (an object with a `level`) and
`prompt_id`. See the Detail entry below for when each is absent.

Tool events add the fields you actually gate on:

```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run test suite",
    "timeout": 120000,
    "run_in_background": false
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

`PostToolUse` and `PostToolUseFailure` add the result:

```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file.txt", "content": "file content" },
  "tool_response": { "filePath": "/path/to/file.txt", "success": true },
  "tool_use_id": "toolu_01ABC123...",
  "duration_ms": 12
}
```

So a guard that inspects the command reads `tool_input.command`; one that reacts to a result reads
`tool_response`. `tool_name`, `tool_input` and `tool_use_id` are **event-specific**: check the event
you are wiring rather than assuming this shape everywhere.

Do not pipe stdin through `jq`. It is absent on many Windows installs, so the handler exits
non-zero, fails open, and blocks nothing while looking installed. Parse in your interpreter.

- A guard that inspects what it is guarding reads tool_input (for example tool_input.command on Bash); a reaction to a result reads tool_response. tool_name, tool_input and tool_use_id are EVENT-SPECIFIC, so confirm them for the event you are wiring instead of assuming one shape.  [v2.1.219]

## Stop: the loop protections, which are the whole contract

A Stop hook that blocks is asking the turn to continue, so it can ask forever. Two mechanisms
stop that, and a hook written without knowing about either is the single most common way a
Stop hook "does not work": it fires correctly, blocks correctly, and then either wedges or is
overridden, and neither looks like a hook problem from the outside.

- Stop hooks receive `stop_hook_active` alongside `last_assistant_message`, `background_tasks` and `session_crons`. It is `true` when Claude Code is ALREADY continuing because of a stop hook. Check it, or process the transcript, "to avoid blocking on a condition that will never resolve" [OFFICIAL]  [v2.1.229]
- There is a cap underneath: "Claude Code overrides the hook and ends the turn after 8 consecutive blocks." So a hook that never inspects `stop_hook_active` does not hang the session, it stops being enforced on the ninth attempt [OFFICIAL]  [v2.1.229]
- The cap is CONFIGURABLE, not fixed, and the override is announced: the turn ends with a warning after 8 consecutive blocks, and `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` changes the limit [OFFICIAL]  [v2.1.143]
- That variable takes the maximum number of consecutive blocks before Claude Code ends the turn anyway, defaults to 8, and accepts `0` to disable the cap entirely [OFFICIAL]
- Setting `decision` to `block` with a `reason` is the enforcing form. `additionalContext` inside `hookSpecificOutput` is the non-error form, for a hook that is working as designed and giving Claude guidance. It passes through the SAME two loop protections, `stop_hook_active` and the 8-continuation cap, but the transcript labels it `Stop hook feedback` and no hook error notification is shown [OFFICIAL]  [v2.1.229]
- Before diagnosing a Stop hook as broken, establish which of these applies. "It ran a few times then stopped mattering" is the block cap, not a wiring fault: re-registering the hook does nothing, and the fix is either to stop blocking on a condition that never resolves or to raise `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` if the hook legitimately needs the iterations [ENGINEERING]
- A blocking Stop hook needs an exit the MODEL can reach on its own, or the 8-block cap is what ends the turn instead, after the guard has been noise for eight of them. Two shapes, not interchangeable: an ESCAPE SENTINEL is a literal line the handler greps for in the reply, so the contract becomes call the demanded tool OR state in one line why you are not, and the turn unblocks with no human present; an OVERRIDE FILE the user creates unblocks only WITH one. Choose by whether a human decision is the point of the guard. Log every bypass either way, or the escape quietly becomes the default path  [ENGINEERING]
- `stop_hook_active` is not a loop cap you can build on. It reports only that the CURRENT continuation chain is hook-driven, which cannot express blocking at most once per session, the usual want for an advisory guard. That needs the handler holding its own state keyed by the `session_id` on stdin. Sanitise that id before putting it in a filename, and swallow every error inside the state layer: a guard that throws on an unwritable directory blocks the session over bookkeeping  [ENGINEERING]
- Processing the transcript is the documented alternative to `stop_hook_active` and to the `last_assistant_message` field above, and it carries two traps the payload samples do not show. `transcript_path` is APPEND-ONLY JSONL for the whole session, so read a BOUNDED tail (openSync plus readSync from an offset), never readFileSync, and expect the first parsed line of that tail to be a fragment. Then scope to the current turn, and know that TOOL RESULTS ARRIVE AS USER RECORDS, carrying a type of user rather than assistant. A real user turn is a user record with NO tool_result block, NO isMeta flag, and some actual text; all three tests are needed, and dropping the isMeta one overcounts turns by about a quarter. MEASURED 2026-08-17 across all 5,902 transcripts on one machine: 160,388 records of type user yielded only 10,670 real user turns, 6.7 percent, so a walk back to the nearest user record lands somewhere other than a turn boundary about fourteen times in fifteen. The SDK documents the analogous shape on its own message stream rather than on these files  [ENGINEERING]  [v2.1.219]
- In SUBAGENT frontmatter a declared Stop hook is converted to SubagentStop, which carries a different exit-2 contract. See the frontmatter-hooks entry under Detail below rather than assuming the Stop contract transfers [OFFICIAL]

## Wanting a NOTIFICATION is a different event from Stop

"Notify me when Claude finishes" reaches for Stop by name and usually wants Notification.
They fire at different moments and only one of them can block.

- Notification runs when Claude Code SENDS a notification and matches on notification type; omitting the matcher runs the hook for every type. Documented matchers include `permission_prompt` (Claude needs approval and you have not typed for about 6 seconds), `idle_prompt` (Claude finished responding about 60 seconds ago), `auth_success`, and the `elicitation_*` family for MCP forms. Two further matchers cover background sessions and carry their own precondition, which the official page states [OFFICIAL]  [v2.1.229]
- The hook fires even with desktop notifications turned off. `preferredNotifChannel`, including `notifications_disabled`, changes only HOW you are alerted, not WHETHER your hook runs. So "I disabled notifications" is not an explanation for a Notification hook that did not fire [OFFICIAL]  [v2.1.229]
- Stop fires when the turn ENDS and can block to continue it. Notification fires when Claude wants the user's attention and has no block contract. Wiring a desktop alert to Stop gets one at end-of-turn only, and never for a permission prompt the user is not watching, which is the case that actually needed it [ENGINEERING]
- `terminalSequence` is the field for emitting a terminal notification, and it survives where other output does not: on `StopFailure` the output and exit code are ignored EXCEPT `terminalSequence`. The field itself requires Claude Code v2.1.141 or later [OFFICIAL]  [v2.1.141]
- Check that floor before debugging anything else. On a pre-2.1.141 build the field is not misconfigured, it is absent, and the hook returns a shape the CLI does not read while looking correct in every other respect  [ENGINEERING]  [v2.1.141]

## Common failure modes / anti-patterns

- Wrong lifecycle event: the chosen event cannot block, so the guard is advisory without anyone noticing.
- Overly broad matcher, so it fires everywhere and gets disabled out of annoyance.
- Assuming every exit 2 blocks. The effect depends on the event.
- Assuming exit-0 stdout must always be JSON.
- Writing decisions to stdout versus stderr incorrectly.
- No pass-path test, so nobody knows the hook lets safe work through.
- No failure-mode or timeout test.
- Treating a runtime failure as a reliable policy block. A crash and a deliberate block are indistinguishable from the outside.

## Definition of Done

- Event actually supports the intended control
- Matcher scoped precisely
- Exit-code + JSON contract correct for THIS event
- PASS and BLOCK paths both proven live
- FP + FN acceptable
- Failure posture explicit; runtime errors and timeouts tested
- Regression suite passes

## Detail

- Deterministic (or delegated) code the HARNESS runs on a lifecycle event, independent of the model's judgment. Configured in settings.json, plugin hooks/hooks.json, or skill/agent frontmatter. Treat it like software.
- A hook is not limited to mechanical checks: prompt runs a single-turn LLM eval and agent runs a subagent. Use these when enforcement needs judgment but must still be harness-guaranteed.
- Some events restrict types (e.g. SessionStart / Setup: only command + mcp_tool).
- settings.json nesting: hooks -> EventName -> [ {matcher, hooks:[handlers]} ]. Handlers accept timeout, if (permission-rule filter), async/asyncRewake, exec-form args, and path placeholders ${CLAUDE_PROJECT_DIR} / ${CLAUDE_PLUGIN_ROOT}.
- JSON stdout schema (exit 0)  [OFFICIAL]
- Matcher: exact string, list (A|B), or regex (unanchored)  [OFFICIAL]
- Alphanumerics/_/-/space/comma/pipe → exact or list; anything else → regex. Anchor scoped names like ^my-plugin:agent$. Tool events match tool_name.
- HTTP handlers have no exit-2 equivalent: only 2xx plus a JSON decision body blocks. Non-2xx, connection failure, and timeout are non-blocking, so an HTTP gate fails OPEN [OFFICIAL]
- Timeout defaults: 600 s command/http/mcp_tool, 30 s prompt, 60 s agent; UserPromptSubmit lowers to 30 s, MessageDisplay to 10 s, SessionEnd to 1.5 s (raise per-hook, budget capped at 60 s, or CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS) [OFFICIAL]
- Coverage hole: EndConversation tool calls skip both PreToolUse and PostToolUse [OFFICIAL]
- It runs on EVERY matching event. Fail-open on internal error, keep the matcher precise, cap the timeout, and make it fast + idempotent. A malformed hook script can break every turn.  [ENGINEERING]
- Frontmatter hooks: a skill or subagent declares its own hooks under a hooks: key, scoped to that component's lifecycle; in a subagent a declared Stop hook is converted to SubagentStop (different exit-2 contract), and project subagent frontmatter hooks run only after workspace trust is accepted (v2.1.218+) [OFFICIAL] CAVEAT: a RELATIVE command in a frontmatter hook (command: ./x.py) did not fire in testing, because it resolves against the hook process cwd, not the skill directory, and ${CLAUDE_SKILL_DIR} is NOT substituted in hook commands (only in markdown content and allowed-tools). Prefer settings.json wiring with an absolute path until a run proves the frontmatter form fires.  [v2.1.218]
- Four common stdin fields carry a PRESENCE CONDITION the flat list hides, so a handler that reads them unguarded gets undefined rather than a value. `permission_mode` gives the current mode and "Not all events receive this field". `effort` is an object with a `level`, is present only for events firing within a tool-use context such as PreToolUse, PostToolUse, Stop and SubagentStop, and reports the DOWNGRADED level actually used when the requested effort exceeds the model; it is also exposed to hook commands as `$CLAUDE_EFFORT`. `prompt_id` is a "UUID identifying the user prompt currently being processed" that matches the OpenTelemetry `prompt.id` attribute, which is the documented way to correlate hook output with telemetry, and it is "Absent until the first user input" so a SessionStart handler never sees it (v2.1.196+). `agent_type` accompanies `agent_id` and is present when the session uses `--agent` OR the hook fires inside a subagent, not only the latter  [OFFICIAL]  [v2.1.196]
- Proven wiring recipe: put the hook in settings.json (or a plugin hooks.json) with an ABSOLUTE path and a named interpreter, quoted, exactly like the working examples python "C:\path\x.py" and node "C:\path\x.mjs". Runtime contract: read stdin fd 0 as JSON (session_id, transcript_path which is JSONL, cwd, and agent_id inside a subagent); prefer exit 0 with a JSON decision over exit code 2. Both block on a blocking event, but exit 2 also blocks on events that cannot act on it, and a non-zero exit is indistinguishable from a crash. Reserve exit 2 for the case where you have no stdout channel; feed text back with additionalContext inside hookSpecificOutput on Stop, PostToolUse or UserPromptSubmit [ENGINEERING BEST PRACTICE]  [ENGINEERING]
