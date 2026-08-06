# Channels

> Claude Code 2.1.220, verified 2026-07-29. Delta from 2.1.219: none (changelog: bug fixes and reliability improvements only).


An MCP server that PUSHES events into a running session, inverting the normal pull direction. An ordinary MCP server is a phone Claude can dial; a channel is a phone that rings. It is not an alternative to an MCP server, it IS one with a single capability key added, so everything in [mcp.md](mcp.md) still applies. Events only arrive while the session is open, so an always-on setup means Claude running in a background process or a persistent terminal.

**Layer:** Tools | **Classification:** subtype | **Status:** research preview | **Since:** v2.1.80

## Security

Read this first, because it is the reader's work and not the harness's. A channel is an inbound path into the model's context from outside the terminal, and the only thing between an attacker's text and Claude is code the channel author writes.

- An ungated channel is a prompt injection vector: anyone who can reach your endpoint can put text in front of Claude [OFFICIAL]
- Gate on SENDER identity (`message.from.id`), never room identity (`message.chat.id`). In group chats those differ, and room-gating lets anyone in an allowlisted group inject into the session [OFFICIAL]
- Check the allowlist BEFORE calling `mcp.notification()` and drop a non-matching sender silently [OFFICIAL]
- The same allowlist gates permission relay. Anyone who can reply through the channel can approve or deny tool use in the session, so declare the relay capability only on a channel that authenticates the sender [OFFICIAL]  [v2.1.81]
- Claude Code does NOT do the sender check for you. `--channels`, the Anthropic allowlist and `channelsEnabled` decide WHICH SERVER may push, never WHO may push through it. That check exists only where the channel author writes it  [ENGINEERING]
- Treat `description` and `input_preview` from a relayed permission request as untrusted display text even on a sanitizing client [OFFICIAL]  [v2.1.211]
- The pre-built plugins bootstrap the allowlist by pairing: the user DMs the bot, the bot returns a code, the user approves the code in-session, and the platform ID is added. iMessage instead auto-detects the user's own addresses and takes other contacts by handle [OFFICIAL]
- Bind a webhook channel's HTTP listener to 127.0.0.1 so nothing outside the machine can POST to it [OFFICIAL]

## The four gates

All four must pass before one event reaches the model, and three of the four fail silent.

| # | Gate | Owner | Failure |
|---|---|---|---|
| 1 | `capabilities.experimental['claude/channel'] = {}` in the `Server` constructor | your code | silent |
| 2 | an `.mcp.json` (or plugin `mcpServers`) entry | config | loud |
| 3 | `--channels plugin:<name>@<marketplace>` at launch | session | startup notice, then silent |
| 4 | the Anthropic allowlist, or an org `allowedChannelPlugins`, with managed `channelsEnabled: true` | policy | startup notice, then silent |

- Gate 1 is presence, not value: the key is always `{}`, and its presence is what registers the notification listener [OFFICIAL]
- Gate 2 is the loud one because Claude Code spawns each configured server as a subprocess. No entry means no process, so the listener never binds and an external POST is refused rather than accepted and dropped [ENGINEERING]
- Being in `.mcp.json` isn't enough to push messages: a server also has to be named in `--channels` [OFFICIAL]
- Gates 3 and 4 leave the server RUNNING and its tools working. Only the push path is closed [OFFICIAL]

## Fails open and silent

The single most important operational fact, and the docs state it three separate times.

- Claude Code does not acknowledge notifications. The `await` on `mcp.notification()` resolves when the message is written to the TRANSPORT, not when Claude has processed it [OFFICIAL]
- If the session did not load your server as a channel, or organization policy blocks it, Claude Code drops the events silently and returns no error to your server [OFFICIAL]
- With the org setting disabled or unset the MCP server still connects and its tools work, but channel messages won't arrive. `/mcp` reporting the server healthy is therefore NOT evidence of delivery, and a working reply tool is not evidence either [OFFICIAL]
- A plugin passed to `--channels` that is off the effective allowlist does not stop anything: Claude Code starts normally, the channel does not register, and only a startup notice explains why [OFFICIAL]  [v2.1.84]
- Nothing downstream can tell "no events happened" from "every event was dropped". If you need delivery confirmation, build it: track event state in your server and expose a reply tool Claude can call to report status back [OFFICIAL]
- The startup notice is the only positive confirmation the channel registered. Read it on every launch instead of inferring registration from a successful `curl`  [ENGINEERING]

## Notification contract

- Emit `notifications/claude/channel` with `content` (string, becomes the tag body) and optional `meta` (`Record<string, string>`, each entry becomes a tag attribute) [OFFICIAL]
- The event lands in context as `<channel source="..." severity="..." run_id="...">body</channel>`. `source` is set automatically from the server's configured name, so it is not yours to set through `meta` [OFFICIAL]
- `meta` keys must be identifiers: letters, digits and underscores only. Keys containing hyphens or other characters are SILENTLY DROPPED, so `run_id` survives and `run-id` disappears with no error anywhere [OFFICIAL]
- Events queue into the session and are processed in order. Several arriving while Claude is busy are delivered TOGETHER on the next turn and handled as a group, so nothing may assume one event per turn. Run separate sessions to process independent streams concurrently [OFFICIAL]
- Transport is stdio only: Claude Code spawns the server as a subprocess on the same machine. The HTTP, SSE and WebSocket transports in [mcp.md](mcp.md) are not channel paths. A webhook channel binds its OWN local port and still pushes to Claude over stdio [OFFICIAL]
- The terminal renders an inbound event as a one-line summary such as `← webhook: build failed on main`, not the raw tag [OFFICIAL]
- The only hard build requirement is `@modelcontextprotocol/sdk` on a Node-compatible runtime. Bun is what the pre-built plugins happen to use, not part of the contract [OFFICIAL]

## Two-way replies

- Add `capabilities.tools = {}`, `ListTools` and `CallTool` handlers, and an `instructions` string naming the reply tool and the attribute to pass back (typically `chat_id` from the inbound tag). Nothing about the tool registration is channel-specific [OFFICIAL]
- Omit `capabilities.tools` for a one-way alert forwarder [OFFICIAL]
- `instructions` is added to Claude's system prompt: state what events to expect, what the tag attributes mean, whether to reply, and which tool to use [OFFICIAL]
- The user sees the inbound message and the tool call in the terminal but NOT the reply text. The reply appears on the other platform [OFFICIAL]
- The first reply triggers an ordinary permission prompt for the reply tool, which is exactly the prompt an unattended session stalls on [OFFICIAL]

## Permission relay

- Declare `capabilities.experimental['claude/channel/permission'] = {}` to receive tool approval prompts remotely; the value is always `{}` [OFFICIAL]  [v2.1.81]
- Inbound is `notifications/claude/channel/permission_request` with `request_id`, `tool_name`, `description`, `input_preview` [OFFICIAL]
- `request_id` is five lowercase letters drawn from a to z WITHOUT `l`, so it never reads as a `1` or `I` typed on a phone. Claude Code only accepts a verdict carrying an ID it issued [OFFICIAL]
- The local terminal dialog does NOT display that ID, so your outbound handler is the only way to learn it. A relay that forgets to echo `request_id` can never be answered remotely [OFFICIAL]
- Outbound is `notifications/claude/channel/permission` with `request_id` and `behavior` set to `allow` or `deny`. Neither verdict affects future calls [OFFICIAL]
- Relay covers tool-use approvals like `Bash`, `Write` and `Edit`. Project trust and MCP server consent dialogs do NOT relay: they only appear in the local terminal, so an unattended session still stalls on those [OFFICIAL]
- Both dialogs stay live and the FIRST answer wins, local or remote; the other is dropped. A right-format verdict with an unknown ID is dropped silently and the dialog stays open, and a wrong-format reply falls through to Claude as ordinary chat [OFFICIAL]
- `description` is a summary of the call, never the command. For a Bash call where the model gave no description it is the constant `Run shell command` and carries zero command detail, so render `input_preview` when there is room [OFFICIAL]
- Since 2.1.211 clients sanitize both fields before relaying: direction-override and invisible characters and quote and angle-bracket lookalikes are neutralized, whitespace runs fold to one space, and text relays whole up to 3,500 code points (applied per top-level field for `input_preview`, which keeps the JSON's own structural quotes), with longer values keeping start and end around a counted elision marker. Earlier clients relay `description` RAW and cut `input_preview` to 200 UTF-16 units [OFFICIAL]  [v2.1.211]
- Match the verdict in the inbound handler BEFORE the chat-forward branch, on the alphabet Claude Code actually uses (`/^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i`), and lowercase the captured ID because phone autocorrect capitalizes it [OFFICIAL]

## Managed settings and availability

- `channelsEnabled` and `allowedChannelPlugins` are MANAGED TIER ONLY: users cannot override them [OFFICIAL]  [v2.1.84]
- `channelsEnabled` is the master switch and must be `true` for any channel to deliver. claude.ai Team and Enterprise default to blocked until an Owner enables it; Console API-key organizations are permitted by default and only need the key once they deploy managed settings [OFFICIAL]  [v2.1.128]
- `allowedChannelPlugins` REPLACES the Anthropic list when set, applies only while `channelsEnabled` is `true`, and names each entry as a plugin plus its marketplace [OFFICIAL]  [v2.1.84]
- An EMPTY `allowedChannelPlugins` array is not a kill switch: `--dangerously-load-development-channels` still bypasses it. To block channels entirely including the development flag, leave `channelsEnabled` UNSET [OFFICIAL]
- Channels require Anthropic authentication through claude.ai or a Console API key, and are not available on Amazon Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry [OFFICIAL]
- Pro and Max users without an organization skip both checks and opt in per session with `--channels` [OFFICIAL]
- Neither `--channels` nor `--dangerously-load-development-channels` appears in `claude --help` while the feature is in preview, and both work anyway. Absence from help is not evidence the build lacks the feature [OFFICIAL]
- Under `-p`, tools that need terminal input (multiple-choice questions, plan mode approval) are disabled so the session never stalls waiting for input [OFFICIAL]
- The community marketplace is NOT on the channel allowlist. The in-app submission forms publish there, which does not make a plugin loadable as a channel [OFFICIAL]

## Testing a channel

- Custom channels are off the approved allowlist during the preview. Test with `--dangerously-load-development-channels server:<name>` or `plugin:<name>@<marketplace>`, which shows a full-screen confirmation dialog first [OFFICIAL]
- The bypass is PER ENTRY and skips the ALLOWLIST ONLY. Combining the flag with `--channels` does not extend the bypass to the `--channels` entries, and the `channelsEnabled` policy still applies [OFFICIAL]
- The negative test everyone skips: run once with `channelsEnabled` off, or with the server absent from `--channels`, and watch `curl` return 200 while nothing reaches the session. Learn what silent looks like in a test rather than letting production teach you  [ENGINEERING]
- Feed the sender gate a known-bad ID and OBSERVE the drop. A gate only ever exercised on the pass path has never been shown to fail  [ENGINEERING]
- Send one `meta` key with a hyphen and confirm the attribute is absent from the tag, which pins the silent-drop rule to observed behaviour  [ENGINEERING]
- For relay, test all three outcomes: a matching ID applied, an unknown ID dropped with the dialog still open, and an unparseable reply forwarded to Claude as chat  [ENGINEERING]
- Shares the generic capture-change-retest loop in [testing.md](testing.md)

## Diagnosis

Fork on what `curl` did, because the two branches share no causes.

- `curl` SUCCEEDS but nothing reaches Claude: the write to the transport worked, so the loss is downstream. Run `/mcp` for server status. "Failed to connect" usually means a dependency or import error in your server file, and the stderr trace is in `~/.claude/debug/<session-id>.txt`. A healthy `/mcp` points at a gate, not at the server [OFFICIAL]
- `curl` FAILS with connection refused: the listener never bound. Either the port is not up yet or a stale process from an earlier run holds it; `lsof -i :<port>` names the holder, and it has to be killed before restarting the session [OFFICIAL]
- Connection refused also fits a missing gate 2: with no MCP config entry Claude Code never spawns the process, so nothing binds the port. Check the config before hunting a stale PID  [ENGINEERING]

## Anti-patterns

- Gating on room or chat ID instead of sender ID
- Declaring the permission capability on a channel with no sender authentication
- Treating a resolved `await` on `mcp.notification()` as delivery
- Treating a healthy `/mcp` as delivery
- Hyphenated `meta` keys, then debugging the missing attribute at the model instead of the notification
- Assuming one channel event per turn
- Shipping a relay that never echoes `request_id`
- Rendering only `description` for a Bash approval, so the approver reads `Run shell command` and approves blind
- An empty `allowedChannelPlugins` array used as a kill switch
- Exposing the channel's HTTP listener beyond 127.0.0.1
- Depending on the preview flag syntax or protocol contract without pinning a client version

## Definition of Done

- Sender gate written, and its DROP path observed with a known-bad sender
- All four gates enumerated for the deployment, with the owner of each named
- Silent failure observed deliberately once, so the shape is recognisable in production
- `meta` keys verified as identifiers and the attributes seen on the tag
- One-way versus two-way decided, and the `instructions` string states the reply contract
- Relay, if declared: sender authentication proven first, then all three verdict outcomes tested
- Organization policy path confirmed (`channelsEnabled`, `allowedChannelPlugins`) or explicitly out of scope
- Preview drift recorded: the flag syntax and protocol contract may change

## Detail

- A channel IS an MCP server, not an alternative to one: same stdio subprocess, same tool discovery, same permission prompts, plus one capability key that registers a push listener. The trust-boundary, schema and output-bound rules in [mcp.md](mcp.md) apply unchanged.
- Direction is the whole difference, and it is why security leads this page. A standard server answers when Claude asks; a channel speaks first, which makes it an injection surface whose gate is application code rather than harness policy.
- Delivery is unacknowledged in one direction only. Notifications are fire-and-forget with no error path, while reply tools and permission verdicts are ordinary MCP traffic that does report failure.
- Four owners stand between the event and the model: the org (`channelsEnabled`), the marketplace (Anthropic allowlist or `allowedChannelPlugins`), the session (`--channels`), and the code (the capability key). Only the code is yours. Three of the four say something at startup: a disabled or unset `channelsEnabled` warns, and an off-allowlist plugin gets a notice line. The missing capability key is the silent one, because from the outside a server that never declared itself simply looks like a server that has nothing to send.
- Research preview: availability is rolling out gradually, and the `--channels` flag syntax and protocol contract may change based on feedback [OFFICIAL]  [v2.1.80]
