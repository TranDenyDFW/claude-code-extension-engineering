# Claude Code hook events

> Claude Code 2.1.219, verified 2026-07-26.


30 events. The fields below are identical across every event and are stated here once rather than repeated in each row.

- **Plain text:** Exit-0 plain stdout is context for SessionStart/UserPromptSubmit/UserPromptExpansion; otherwise command stdout is normally diagnostic. HTTP 2xx plain text and non-JSON MCP text are handled as documented context.
- **Async:** command handlers only; async output cannot block or return a decision.
- **Timeout:** varies, 2 distinct values:
  - Default 10 seconds for display batches; configure a bounded timeout.
  - see the per-handler defaults on the Contract branch; synchronous by default. Bound latency explicitly.
- **Compatibility:** current documentation. Verify this event and handler type on your installed Claude Code build before relying on it.

> Freshness: this table is the documented event set as of the map's verification date. Claude Code ships frequently, so re-check the changelog before relying on the count. Known delta at the 2026-07-25 verification: changelog v2.1.219 adds DirectoryAdded, which fires after /add-dir or the SDK register_repo_root control request registers a new working directory mid-session; it is not yet on the hooks reference page and is therefore not in this table.

- 30 documented events; matcher, output, and blocking are event-specific [OFFICIAL]
- The event list and capability contracts below were verified against the current Hooks reference.
- Never infer one event's behavior from another event.


| Event | Matcher | Handlers | Input focus | JSON control | Exit 2 / block |
|---|---|---|---|---|---|
| SessionStart | startup\|resume\|clear\|compact\|fork | command, mcp_tool | Session start mode, model, optional agent type | context only | No; stderr notice |
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
