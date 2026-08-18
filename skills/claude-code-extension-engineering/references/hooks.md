# Hooks

> Claude Code 2.1.229, verified 2026-08-13. What that means here: this file carries TWO verbatim quotes, both in the Stop section, and `tools/quote-check.mjs` confirms both still appear upstream; the capability surface moved to 44 current tools and held at 31 current hook events. 129 of 190 mirrored pages changed since 2.1.224 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading. The header said NO quotes until 2026-08-13, which was true when written and stopped being true the moment the Stop section was added without anyone rereading the header.


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
- Evidence source: matches, exit codes, and full stdout/stderr go to the debug log (claude --debug-file PATH, or ~/.claude/debug/SESSION-ID.txt with --debug, which prints NOTHING to the terminal); CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose adds matcher-level detail [OFFICIAL]

## Failure safety / guard-the-guard

- A safety hook must not brick Claude Code  [ENGINEERING BEST PRACTICE]  [ENGINEERING]
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
`session_id`, `transcript_path` (JSONL), `cwd`, `hook_event_name`, and `agent_id` inside a subagent.

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
- Proven wiring recipe: put the hook in settings.json (or a plugin hooks.json) with an ABSOLUTE path and a named interpreter, quoted, exactly like the working examples python "C:\path\x.py" and node "C:\path\x.mjs". Runtime contract: read stdin fd 0 as JSON (session_id, transcript_path which is JSONL, cwd, and agent_id inside a subagent); prefer exit 0 with a JSON decision over exit code 2. Both block on a blocking event, but exit 2 also blocks on events that cannot act on it, and a non-zero exit is indistinguishable from a crash. Reserve exit 2 for the case where you have no stdout channel; feed text back with additionalContext inside hookSpecificOutput on Stop, PostToolUse or UserPromptSubmit [ENGINEERING BEST PRACTICE]  [ENGINEERING]
