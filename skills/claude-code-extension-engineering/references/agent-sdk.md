# Agent SDK

> Claude Code 2.1.224, verified 2026-08-07. Re-verified MECHANICALLY against a refreshed docs mirror: every verbatim quote in this file still appears upstream (tools/quote-check.mjs), and the capability surface is unchanged at 51 tools and 31 hook events. 101 of 186 mirrored pages changed since 2.1.220 and were NOT all re-read, so this is a quote-and-capability check, not a full re-reading.


The programmatic authoring tier. Cross-referenced beside the interactive surface, never mixed into it: these are library APIs, not files the CLI discovers.

**Layer:** Programmatic tier | **Classification:** sdk | **Status:** stable

## What it is

- The Agent SDK is a separate programmatic surface with its own custom tools, programmatic hooks, canUseTool callback, session handling and structured output options. It is not discovered from .claude/ like the interactive mechanisms.  [v2.1.219]
- SDK custom tools are defined in code with tool() and createSdkMcpServer, so they run in the host process rather than as a separate MCP server.
- Do not reach for the SDK to solve an interactive-CLI problem. If the goal is to change how your own Claude Code sessions behave, the answer is one of the interactive primitives.  [ENGINEERING]
