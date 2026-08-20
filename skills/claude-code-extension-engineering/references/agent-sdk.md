# Agent SDK

> Claude Code 2.1.233. What that means here: this file carries ONE verbatim quote and
> `tools/quote-check.mjs` confirms it still appears upstream. Per-claim provenance lives in
> `evidence/claims.jsonl`, where the gates read it; nothing else is asserted here.


The programmatic authoring tier. Cross-referenced beside the interactive surface, never mixed into it: these are library APIs, not files the CLI discovers.

**Layer:** Programmatic tier | **Classification:** sdk | **Status:** stable

## Getting in, because the rest of this file assumes you already are

- TypeScript is `npm install @anthropic-ai/claude-agent-sdk`, Python is `pip install claude-agent-sdk`. The entry point is `query()`, imported as `import { query } from "@anthropic-ai/claude-agent-sdk"` or `from claude_agent_sdk import query, ClaudeAgentOptions`, and it returns an ASYNC ITERATOR, so the calling shape is `for await (const message of query({...}))` rather than a single awaited result [OFFICIAL]
- The SDK is a library for Python and TypeScript ONLY. Any other language drives the same agent loop by running the CLI as a subprocess with `-p` and `--output-format json`, which is a different integration with different failure modes, not a thinner binding [OFFICIAL]
- The npm package BUNDLES a native Claude Code binary as an optional dependency, and the SDK version tracks the bundled build: SDK v0.3.191 carries Claude Code v2.1.191, so a feature needing a given Claude Code version needs the SDK release with the same patch number or later. A package manager configured to skip optional dependencies throws `Native CLI binary for <platform> not found`, and the fix is `pathToClaudeCodeExecutable` pointing at a separately installed `claude` [OFFICIAL]
- On recent Debian, Ubuntu and Homebrew Python, installing against system Python fails with `error: externally-managed-environment`. Install into a virtual environment [OFFICIAL]

## Read this first: building an agent, not running several at once

- This file is the SDK: library APIs you import to build your own agent. If the question is how to take on several tasks at once inside Claude Code, that is the `agents` page, which compares subagents, agent view, agent teams and dynamic workflows. This library covers three of those four and has NO file on the fourth: the `claude agents` dashboard, documented on `agent-view`, appears in no reference here [OFFICIAL]
- Naming the missing one is the honest answer. Reaching for the SDK to solve an interactive-CLI problem is the error this file warns against elsewhere, and a parallelism question is exactly that shape [ENGINEERING]

## Which thing you actually want, because four products are adjacent

Four surfaces sit next to each other and the names do not separate them. Pick by who runs the
loop and who hosts it.

| If you are | Use | Because |
|---|---|---|
| Building an agent without implementing the tool loop yourself | **Agent SDK** | A library running the agent loop IN YOUR OWN PROCESS |
| Doing interactive work or one-off tasks from a terminal | **Claude Code CLI** | The terminal interface, for daily interactive use |
| Calling the API directly and writing the tool loop yourself | **Client SDK** | Direct Anthropic API access, not Claude Code. You implement the loop |
| Running long or async agents without managing a sandbox or session infrastructure | **Managed Agents** | Hosted REST API, a SEPARATE PRODUCT. Anthropic runs the agent and the sandbox |

- The Agent SDK is Claude Code as a library: the same built-in tools, agent loop and context management, driven from your own process [OFFICIAL]
- It ships for **Python and TypeScript only**. To drive the same agent loop from any other language, run the CLI as a subprocess with `-p` and `--output-format json` rather than looking for a port of the library [OFFICIAL]
- Anthropic does not permit third-party products built on the Agent SDK to offer claude.ai login or rate limits unless previously approved; use API-key authentication [OFFICIAL]

## What it is

- The Agent SDK is a separate programmatic surface with its own custom tools, programmatic hooks, canUseTool callback, session handling and structured output options. It is not discovered from .claude/ like the interactive mechanisms.  [v2.1.219]
- SDK custom tools are defined in code with tool() and createSdkMcpServer, so they run in the host process rather than as a separate MCP server.
- Capabilities carried over from the CLI: built-in tools, hooks, subagents, MCP, permissions, sessions, plugins, and skills/commands/memory [OFFICIAL]
- Do not reach for the SDK to solve an interactive-CLI problem. If the goal is to change how your own Claude Code sessions behave, the answer is one of the interactive primitives.  [ENGINEERING]

## It reads your `.claude/` directory, and `settingSources` is the switch

This is the part that matters to anyone who authored an extension: an SDK process picks up the
same filesystem configuration the CLI does, unless told otherwise.

- Omit `settingSources` and `query()` reads what the CLI reads: user, project and local settings, CLAUDE.md files, and `.claude/` skills, agents and commands. Pass `settingSources: []` to limit the agent to what you configure programmatically [OFFICIAL]
- The sources are named: `"user"` loads from `~/.claude/`, `"project"` from `<cwd>/.claude/`, `"local"` covers `CLAUDE.local.md` and `.claude/settings.local.json` [OFFICIAL]
- The lookup rules DIFFER by input type, which is easy to miss: project `settings.json` and hooks load only from `<cwd>/.claude/` with NO parent-directory fallback, while CLAUDE.md and rules walk `<cwd>` and every parent, and skills walk up to the repository root [OFFICIAL]

## What loads REGARDLESS of settingSources

Four inputs ignore the switch entirely. Setting `settingSources: []` and assuming a clean process
is the failure this list exists to prevent.

| Input | Still loaded | How to actually suppress it |
|---|---|---|
| Managed policy settings | always, from the host (MDM plist, registry policy, managed settings file) | remove the host policy; server-managed settings are org-controlled and cannot be disabled from the SDK |
| `~/.claude.json` global config | always | relocate with `CLAUDE_CONFIG_DIR` in `env` |
| Auto memory at `~/.claude/projects/<project>/memory/` | into the system prompt at session start | `autoMemoryEnabled: false`, or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `env` |
| claude.ai MCP connectors | when the session authenticates with a claude.ai login | `strictMcpConfig: true`, `disableClaudeAiConnectors: true`, or `ENABLE_CLAUDEAI_MCP_SERVERS=false` |

- **`mcpServers: {}` does NOT suppress the claude.ai connectors.** An empty map looks like "no servers" and is not [OFFICIAL]
- The connectors are not loaded when `CLAUDE_CODE_OAUTH_TOKEN` holds a `claude setup-token` token, which can only make model requests [OFFICIAL]
- Auto memory is written with the standard `Write` and `Edit` tools rather than a dedicated memory tool, so an agent with those tools disabled silently cannot save memories [OFFICIAL]

## Failure posture

- **Default `query()` options are not multi-tenant isolation.** Because the four inputs above are read regardless of `settingSources`, an SDK process picks up host-level configuration and per-directory memory. For multi-tenant deployments run each tenant in its own filesystem AND set `settingSources: []` plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; filesystem isolation alone does not remove server-managed settings, which are fetched when the process authenticates with an organization credential [OFFICIAL]
- The failure is silent in the direction that costs most: a process that loads more than you intended looks identical to one that loaded nothing extra, until a host CLAUDE.md or a user skill changes its behaviour  [ENGINEERING]

## Definition of Done

- `settingSources` is set deliberately rather than left to default, and the choice is written down
- Anything relying on isolation has been checked against the four always-loaded inputs
- The language decision is explicit: Python or TypeScript library, or CLI subprocess for anything else
- Authentication is API-key based unless claude.ai login was separately approved
