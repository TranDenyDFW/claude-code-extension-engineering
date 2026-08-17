# MCP servers

> Claude Code 2.1.229, verified 2026-08-13. What that means here: this file carries NO verbatim quotes, so the quote gate says nothing about it; the capability surface moved to 44 current tools and held at 31 current hook events. 129 of 190 mirrored pages changed since 2.1.224 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading.


A governed connection to an external system: tools, resources and prompts served over a defined protocol with its own authentication and permission boundary. Choose it over a shell command when the connection needs credentials, a schema, or an audit boundary.

**Layer:** Tools | **Classification:** primitive | **Status:** stable

## WHERE the config lives, because `settings.json` is not one of the places

A graded answer told a user to put `mcpServers` in `settings.json`. That file is never an MCP
config location, and the mistake is easy to make because nearly every other extension
mechanism does live there.

- Project scope is `.mcp.json` at the project root, and it is the one meant for version control. Local and user scope both live in `~/.claude.json`, the file one character away from `~/.claude/settings.json` and a different file entirely [OFFICIAL]
- Local scope is the DEFAULT. A server added with no scope flag is stored in `~/.claude.json` under that project's path, so it loads in that project only and does not appear in your others, which is the usual reason a server seems to vanish after switching directories [OFFICIAL]
- Check the file before checking the command line. A `mcpServers` block sitting in `settings.json` is not an error anyone will show you, it is simply never read, and the symptom is identical to a server whose command is wrong  [ENGINEERING]

## Selection and ownership

- Use MCP for external data or actions; use a Skill for reusable knowledge and workflow [OFFICIAL]
- Name the server owner, data owner, operator, and credential owner [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Prefer built-in tools when they already satisfy the requirement [ANTHROPIC RECOMMENDATION]  [ANTHROPIC]

## Trust boundary

- Treat server descriptions, tool output, resources, and remote prompts as untrusted input [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Separate read, write, destructive, and administrative capabilities [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- A cloned repository cannot approve its own project MCP servers in current trust behavior [OFFICIAL]

## Transports

- stdio for local child-process servers [OFFICIAL]
- HTTP for remote request/response servers and OAuth [OFFICIAL]
- WebSocket for persistent bidirectional push; lacks the HTTP CLI/OAuth path [OFFICIAL]
- SSE is deprecated; prefer HTTP where available [OFFICIAL] [DEPRECATED]

## Which DIRECTION is being asked about, because "claude code mcp server" names both

- Almost every question means Claude Code as the CLIENT, connecting out to a server you configure. The inverse also exists: `claude mcp serve` runs CLAUDE CODE ITSELF as a stdio MCP server that another application connects to, wired into a client with `"command": "claude", "args": ["mcp", "serve"]`. If `claude` is not on PATH the `command` field needs the full executable path [OFFICIAL]
- **It prints nothing on start, and that is success.** A stdio server talks over stdin and stdout, so a silent terminal that appears to hang is the server running and waiting for a client. Anyone who kills it expecting a banner has killed a working server, and this is the one fact about `mcp serve` worth carrying [OFFICIAL]
- A bare "how do I use the Claude Code MCP server" is genuinely ambiguous between the two directions. Name both in one line and answer the client direction, which is what is nearly always meant, rather than picking one silently  [ENGINEERING]

## What YOUR server exposes, which is the other half of the trust boundary

The section above is about not trusting what a server sends you. This one is about the server you
run being reachable, which nothing else in this library covers.

- A stdio server speaks the protocol over stdin and stdout, so ANYTHING ELSE written to stdout corrupts the stream. Send logs to stderr or a file. The symptom is not a clean error: the client sees malformed frames from a server that looks like it started fine  [ENGINEERING]
- A LOCAL HTTP server is reachable by more than the thing you built it for. Bind loopback rather than all interfaces, and validate the Origin header, because a page in the user's browser can issue requests to localhost and your tools then run with the user's credentials. Binding loopback alone does not prevent that; the Origin check is what does  [ENGINEERING]
- Tool annotations describing a tool as read-only or destructive are HINTS for display and routing, not enforcement. Nothing stops an annotated-read-only tool from writing, so the annotation is documentation and the permission layer is the control  [ENGINEERING]
- Reject unknown fields rather than ignoring them, so a caller's typo fails loudly instead of silently doing nothing  [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Log the raw error and return a generic one. A transcript is written to disk, survives the session, and can be exported or resumed, so internals returned in an error text outlive the moment  [ENGINEERING]

## Protocol primitives

- Tools expose model-invoked actions with schemas [OFFICIAL]
- Resources expose addressable data [OFFICIAL]
- Prompts expose reusable server-provided prompt templates [OFFICIAL]
- Capability discovery and list-changed notifications keep catalogs synchronized [OFFICIAL]

## Schema and naming

- Use stable, specific names and bounded descriptions [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Validate every input; return structured, size-bounded output [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Expose pagination, filters, dry-run, idempotency, and stable identifiers where the domain requires them [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- No anyOf, oneOf, or allOf at the ROOT of a tool input schema: from v2.1.195 it is flattened and branch requirements become description prose, earlier versions skip the tool entirely - validate the combination server-side. Tool descriptions and server instructions truncate at 2KB each [OFFICIAL]  [v2.1.195]

## Authentication and secrets

- Use OAuth or scoped credentials appropriate to the transport [OFFICIAL]
- Never embed secrets in map examples, committed config, prompts, or tool output [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Constrain redirect URIs, token audience, scopes, storage, rotation, and revocation [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- .mcp.json expands ${VAR} and ${VAR:-default} in command, args, env, url, and headers; an unset variable with no default does not fail the load, it passes the literal through with only a warning in claude mcp list [OFFICIAL]
- A configured server whose tools never appear is often UNAUTHENTICATED rather than misconfigured. `/mcp` runs the OAuth sign-in for remote servers that require it, and from v2.1.195 a refresh rejected by the server produces an immediate notice pointing at `/mcp`, whose connected-server menu offers Re-authenticate [OFFICIAL]  [v2.1.195]
- A `401` on a server you already signed in to is retried once after a token refresh and is only flagged in `/mcp` if that retry also fails. Before v2.1.206 a transient failure such as a network error flagged the server as needing authentication for the REST OF THE SESSION even though its refresh token was still valid, so on older builds the flag is not proof of an expired credential [OFFICIAL]  [v2.1.206]
- Non-interactive runs have no `/mcp` panel and cannot complete an OAuth flow. From v2.1.196 a `claude -p` or Agent SDK run with tool search enabled, the default, is told the server's tools are unavailable pending authorisation, so Claude can NAME the server needing sign-in rather than answering as though it were never configured. Sign in from an interactive session with `/mcp` or `claude mcp login <name>` [OFFICIAL]  [v2.1.196]

## Permissions and destructive actions

- Project servers require trust and approval according to scope [OFFICIAL]
- Classify tools by read/write/destructive consequence [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Require explicit confirmation and recoverable design for destructive operations [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- _meta anthropic/requiresUserInteraction: true forces a prompt on every call, overriding acceptEdits, auto, bypassPermissions and allow rules (v2.1.199+); in dontAsk mode the call is denied and under a permission-prompt tool an allow converts to a deny, so a flagged tool cannot run headless [OFFICIAL]  [v2.1.199]

## Context and cost

- Tool names load first; schemas can be deferred through tool search [OFFICIAL]
- Bound output and avoid returning data the task did not request [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Use resources or files for large data rather than flooding the conversation [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Output warns at 10,000 tokens and is capped at 25,000 by default (MAX_MCP_OUTPUT_TOKENS); a server can raise one tool via _meta anthropic/maxResultSizeChars up to 500,000 chars, with no effect on image content. alwaysLoad exempts a server from tool-search deferral but then BLOCKS startup on its connect, up to 5 s [OFFICIAL]

## Reliability

- Define startup, connection, request, idle, and wall-clock timeouts [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Retry only transient and idempotent operations with bounded backoff [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Preserve last-known catalogs when refresh fails in current behavior [OFFICIAL]
- Expose degraded status and recovery actions [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- A main-conversation MCP call still running at two minutes moves to a background task and returns as a notification (v2.1.212+); subagent, IDE, and non-interactive calls are never backgrounded [OFFICIAL]  [v2.1.212]

## Packaging

- Plugins may bundle MCP server definitions [OFFICIAL]
- Keep secrets outside the plugin and use portable root placeholders [OFFICIAL]
- Test clean install, trust prompt, authentication, upgrade, and rollback [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- After testing a project-scoped trust prompt, re-arm it with claude mcp reset-project-choices [OFFICIAL]

## Anti-patterns

- One giant server with broad ambient authority
- Unbounded output or vague schemas
- Secrets in arguments, logs, map notes, or committed files
- Retries on destructive non-idempotent actions
- Assuming transport errors can enforce a policy decision
- Using draft MCP features as released behavior

## Testing an MCP integration

- Contract-test schemas and error shapes
- Transport-test startup, reconnect, timeout, and shutdown
- Permission-test allow, ask, deny, and destructive boundaries
- Security-test prompt injection, confused deputy, token scope, and data exfiltration
- Integration-test Skills, Hooks, Subagents, Agent Teams, and Plugins that consume the server

## Definition of Done

- Owner and trust boundary documented
- Transport and authentication justified
- Schemas bounded and validated
- Permissions and destructive actions tested
- Reliability and degraded operation tested
- Context cost measured
- Released-spec compatibility recorded
- Clean install and removal proven


## Failure posture

- An MCP server that fails to connect FAILS OPEN: the run continues without that server's tools, and the init message reports status failed, needs-auth, or still pending rather than aborting. Never treat an MCP call as a policy gate: the tool being absent is indistinguishable, from the model's side, from the tool declining  [ENGINEERING]  [v2.1.220]
- Degraded rather than absent is the harder case: last-known catalogs are preserved when a refresh fails, so a stale tool list can look healthy. Surface degraded status explicitly instead of inferring it from a successful call  [ENGINEERING]

## Detail

- A governed integration boundary that connects Claude Code to external tools, resources, prompts, and services.
