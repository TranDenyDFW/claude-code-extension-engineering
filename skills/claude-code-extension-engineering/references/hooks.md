# Hooks

> Claude Code 2.1.224, verified 2026-08-07. Re-verified MECHANICALLY against a refreshed docs mirror: every verbatim quote in this file still appears upstream (tools/quote-check.mjs), and the capability surface is unchanged at 51 tools and 31 hook events. 101 of 186 mirrored pages changed since 2.1.220 and were NOT all re-read, so this is a quote-and-capability check, not a full re-reading.


Code the HARNESS runs on a lifecycle event, independent of the model's judgment. This is the only mechanism whose FIRING the harness owns: the model cannot talk its way out of a hook running. Firing is not outcome, though. What happens after depends on the handler's failure policy (an HTTP handler fails OPEN on connection failure) and on the tamper boundary (disableAllHooks switches every hook off; only managed policy survives that), both covered below. Five handler types (command, http, mcp_tool, prompt, agent), and the last two carry judgment, so hooks are no longer purely mechanical.

**Layer:** Automation | **Classification:** primitive | **Status:** stable

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
