# Claude Code hook events

> Claude Code 2.1.220, verified 2026-07-29. Delta from 2.1.219: none (changelog: bug fixes and reliability improvements only).


30 events. The fields below are identical across every event and are stated here once rather than repeated in each row.

- **Plain text:** Exit-0 plain stdout is context for SessionStart/UserPromptSubmit/UserPromptExpansion; otherwise command stdout is normally diagnostic. HTTP 2xx plain text and non-JSON MCP text are handled as documented context.
- **Async:** command handlers only; async output cannot block or return a decision.
- **Timeout:** varies, 2 distinct values:
  - Default 10 seconds for display batches; configure a bounded timeout.
  - see the per-handler defaults on the Contract branch; synchronous by default. Bound latency explicitly.
- **Compatibility:** current documentation. Verify this event and handler type on your installed Claude Code build before relying on it.

- 30 documented events; matcher, output, and blocking are event-specific [OFFICIAL]
- The event list and capability contracts below were verified against the current Hooks reference.
- Never infer one event's behavior from another event.

## Changelog-only event deltas

The documented event set and the shipped event set are not the same thing: events can land in the changelog before the Hooks reference records them, so the table below tracks the reference and this section tracks the gap.

- DirectoryAdded: introduced by changelog v2.1.219, fires after /add-dir or the SDK register_repo_root control request registers a new working directory mid-session. Re-checked 2026-07-29: the full Hooks reference page still contains zero occurrences of DirectoryAdded, so its matcher, handler set, and blocking contract remain undocumented. Treat every property of this event as unverified until the reference catches up or a live test pins it down.  [OFFICIAL]  [v2.1.219]
- Re-check the changelog after every release; this section is where the next delta lands.


| Event | Matcher | Handlers | Input focus | JSON control | Exit 2 / block |
|---|---|---|---|---|---|
| SessionStart | startup\|resume\|clear\|compact\|fork | command, mcp_tool | Session start mode, model, optional agent type; source reports "resume" for forks before v2.1.214 | context, plus 5 special outputs (see below) | No; stderr notice |
| Setup | init\|maintenance | command, mcp_tool | One-time CLI setup mode | context only | No; stderr notice |
| InstructionsLoaded | load reason | command, http, mcp_tool | Instruction file, path, memory type, load reason | none | No; ignored |
| UserPromptSubmit | none | command, http, mcp_tool, prompt, agent | Submitted prompt | top-level block/context | Yes; rejects prompt |
| UserPromptExpansion | command name | command, http, mcp_tool, prompt, agent | Expanded command and prompt | top-level block/context | Yes; blocks expansion |
| MessageDisplay | none | command documented; other types not listed in the official support matrix | Streaming display delta and identifiers | display replacement | No; original displayed |
| PreToolUse | tool name; optional if rule | command, http, mcp_tool, prompt, agent | Tool name, input, permission context | permission decision/update | Yes; blocks tool |
| PermissionRequest | tool name | command, http, mcp_tool, prompt, agent | Tool request and suggestions | allow/deny/update | Yes; denies permission |
| PermissionDenied | tool name | command, http, mcp_tool, prompt, agent | Denied tool call and reason | retry signal | No; denial already happened |
| PostToolUse | tool name | command, http, mcp_tool, prompt, agent | Tool input and successful result | feedback/output replacement | No; tool already ran |
| PostToolUseFailure | tool name | command, http, mcp_tool, prompt, agent | Tool input and error | feedback | No; tool already failed |
| PostToolBatch | none | command, http, mcp_tool, prompt, agent | Resolved parallel tool-call batch | top-level block/context | Yes; stops before next model call |
| SubagentStart | agent type | command, http, mcp_tool | Agent ID/type and launch context | context only | No; stderr notice |
| SubagentStop | agent type | command, http, mcp_tool, prompt, agent | Agent result and last message | top-level block/context | Yes; prevents stop |
| TaskCreated | none | command, http, mcp_tool, prompt, agent | Task definition and team metadata | exit/continue | Yes; rolls back creation |
| TaskCompleted | none | command, http, mcp_tool, prompt, agent | Task result and status | exit/continue | Yes; prevents completion |
| TeammateIdle | none | command, http, mcp_tool, prompt, agent | Teammate identity and task state | exit/continue | Yes; prevents idle |
| Stop | none | command, http, mcp_tool, prompt, agent | Last assistant message and active work | top-level block/context | Yes; continues conversation |
| StopFailure | error type | command, http, mcp_tool | API failure type and details | none | No; output ignored |
| ConfigChange | configuration source | command, http, mcp_tool | Changed configuration source | top-level block | Yes except policy settings |
| CwdChanged | none | command, http, mcp_tool | Previous and new working directory | none | No |
| FileChanged | literal filenames | command, http, mcp_tool | Watched file and change | none | No |
| WorktreeCreate | none | command, http, mcp_tool | Requested worktree context | path return | Yes; any nonzero fails creation |
| WorktreeRemove | none | command, http, mcp_tool | Worktree path and cleanup context | none | No; debug log only |
| PreCompact | manual\|auto | command, http, mcp_tool | Compaction trigger and transcript | top-level block | Yes; blocks compaction |
| PostCompact | manual\|auto | command, http, mcp_tool | Completed compaction context | none | No |
| Elicitation | MCP server name | command, http, mcp_tool | MCP form or URL request | accept/decline/cancel | Yes; denies elicitation |
| ElicitationResult | MCP server name | command, http, mcp_tool | User elicitation response | response override | Yes; changes action to decline |
| Notification | notification type | command, http, mcp_tool | Notification title, message, and type | none | No |
| SessionEnd | end reason | command, http, mcp_tool | Session termination reason | none | No |

## SessionStart special outputs

SessionStart is not "context only": its hookSpecificOutput accepts five fields, and two of them carry easy-to-miss scoping.  [OFFICIAL]  [v2.1.220]

| Field | Effect | Scoping caveat |
|---|---|---|
| additionalContext | String added to Claude's context before the first prompt | Attaches to an existing turn |
| initialUserMessage | String used as the FIRST USER MESSAGE of the session | Applies in non-interactive -p mode; it CREATES the turn, unlike additionalContext. A provided prompt follows as the next turn |
| sessionTitle | Sets the session title, same effect as /rename | Applies on startup, resume, and fork sources; IGNORED on clear and compact |
| watchPaths | Array of paths to watch, generating FileChanged events for this session | Paths must be ABSOLUTE |
| reloadSkills | Boolean; re-scans skill and command directories after SessionStart hooks complete | Skills the hook just installed become available in the SAME session, from the first prompt |
