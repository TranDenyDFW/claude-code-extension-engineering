# LSP / code intelligence

> Claude Code 2.1.220, verified 2026-07-29. Delta from 2.1.219: none (changelog: bug fixes and reliability improvements only).


Language-server integration for symbol-aware navigation and live diagnostics. It has no standalone authoring path: it is configured only through .lsp.json in a plugin root or lspServers in plugin.json, so shipping an LSP means shipping a plugin.

**Layer:** Packaging | **Classification:** subtype | **Status:** stable | **Since:** v2.0.74

## Selection

- Use when symbol-aware navigation or diagnostics materially outperform text search. The LSP tool itself arrived at 2.0.74, so on older builds this whole branch is unavailable rather than merely degraded [OFFICIAL]  [v2.0.74]
- Keep text search as a fallback when the server is unavailable [ENGINEERING BEST PRACTICE]  [ENGINEERING]

## Installation and discovery

- Install an official marketplace LSP plugin where available [OFFICIAL]
- Custom plugins configure servers through .lsp.json [OFFICIAL]
- The language-server binary must be installed and discoverable [OFFICIAL]

## Lifecycle

In order, per server:

1. Resolve the workspace root and the file-extension mapping.
2. Start and initialize the language server.
3. Publish diagnostics after edits.
4. Serve definition, references, hover, and symbol lookups.
5. Restart after failure, and stop on plugin or session cleanup.

## Safety and reliability

- Start project LSP servers only after workspace trust [OFFICIAL]
- Bound startup and request timeouts [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Handle missing binaries, initialization failure, stale diagnostics, and server crashes [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- Do not let one failed server suppress another valid server [ENGINEERING BEST PRACTICE]  [ENGINEERING]

## Testing an LSP plugin

- Clean-install and binary-discovery smoke test
- Definition, references, hover/type, workspace-symbol, and diagnostic tests
- Edit/diagnostic freshness test
- Crash/restart and fallback-to-search test
- Windows path/URI and multi-root test where supported
- LSP tool introduced in Claude Code 2.0.74 [OFFICIAL]  [v2.0.74]
- restartOnCrash and shutdownTimeout require v2.1.205; earlier builds accept the schema but SKIP that LSP server entirely at startup, with the reason visible only in claude --debug output [OFFICIAL]  [v2.1.205]

## Definition of Done

- Plugin and binary dependencies documented
- Workspace trust and boundaries verified
- Navigation and diagnostics proven live
- Failure and restart behavior tested
- Fallback path works
- Cleanup leaves no orphan server

## Runtime fields and the validation blind spot

- shutdownTimeout is expressed in MILLISECONDS: the maximum wait for a graceful shutdown before Claude Code terminates the server.  [v2.1.205]
- restartOnCrash defaults to true. Set it false to leave a crashed server down.  [v2.1.205]
- There is NO static validation path for .lsp.json: claude plugin validate reads the manifest only and never opens .lsp.json. Combined with pre-v2.1.205 builds skipping an unsupported server silently, a broken LSP config can pass validation and then do nothing, with the reason visible only under claude --debug.  [ENGINEERING] [v2.1.219]

## Per-server fields

Every key below sits inside the per-server object, keyed by language id.

| Field | Meaning |
|---|---|
| `command` | The server executable, e.g. `gopls` |
| `args` | Argument array, e.g. `["serve"]` |
| `extensionToLanguage` | File-extension to language-id map, e.g. `{".go": "go"}` |
| `settings` | Passed to the server via `workspace/didChangeConfiguration` |
| `workspaceFolder` | Workspace folder path for the server |
| `startupTimeout` | Max wait for server startup (milliseconds) |
| `shutdownTimeout` | Max wait for graceful shutdown (milliseconds), then Claude Code terminates it |
| `restartOnCrash` | Restart after a crash. Defaults to `true` |
| `maxRestarts` | Restart attempts before giving up |
| `diagnostics` | Push diagnostics into Claude's context after edits |

`restartOnCrash` and `shutdownTimeout` require v2.1.205. `shutdownTimeout` has no documented
default. When several enabled servers claim the same extension, see the multiple-servers rule.

- restartOnCrash and shutdownTimeout live INSIDE the per-server object, in the same field set as command and args, not at the top level of .lsp.json.  [v2.1.205]


## Failure posture

- LSP failure is ADVISORY, never blocking: a missing binary, a failed handshake, or a server dying mid-session degrades navigation and diagnostics back to text search rather than stopping the session. Nothing about an LSP plugin can be used as a guarantee  [ENGINEERING]  [v2.1.220]
- The failure is also quiet, which is the real hazard: symbol-aware answers silently become grep-quality answers. Test the fallback path deliberately, because nothing announces the downgrade  [ENGINEERING]

## Detail

- Language-server integration for symbol navigation, references, hover/type information, and live diagnostics.
