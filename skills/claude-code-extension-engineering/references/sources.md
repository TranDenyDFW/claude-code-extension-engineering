# Sources

> Claude Code 2.1.220, verified 2026-07-29. Machine-readable form: [evidence/sources.json](../../../evidence/sources.json); per-claim attribution: [evidence/claims.jsonl](../../../evidence/claims.jsonl); integrity gate: tools/verify-evidence.mjs.

| Id | Title | URL | Retrieved | Build | Status | Redistributable | Licence |
|---|---|---|---|---|---|---|---|
| CCX_RESEARCH | CCX architecture research, inventory and findings | internal | 2026-07-29 | 2.1.220 | verified | yes | Own work |
| DERIVED | Derived reasoning, no upstream citation | internal | 2026-07-29 | 2.1.220 | verified | yes | Own work |
| HARNESS_TOOL | Claude Code built-in tool descriptions (shipped in-product) | internal | 2026-07-29 | 2.1.220 | verified | no | Anthropic PBC product text; transcribed as reference, not redistributed verbatim in bulk |
| LOCAL_ENV | Direct observation of the installed Claude Code environment | internal | 2026-07-29 | 2.1.220 | verified | yes | Own work |
| SRC_AGENT_TEAMS | Claude Code Agent Teams | https://code.claude.com/docs/en/agent-teams | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_AGENT_SDK | Claude Agent SDK documentation | https://code.claude.com/docs/en/agent-sdk/overview | 2026-07-31 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_CHANGELOG | Claude Code changelog | https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_FEATURES | Claude Code extension architecture overview | https://code.claude.com/docs/en/features-overview | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_HOOK_GUIDE | Claude Code Hooks guide | https://code.claude.com/docs/en/hooks-guide | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_HOOKS | Claude Code Hooks reference | https://code.claude.com/docs/en/hooks | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_MCP | Claude Code MCP | https://code.claude.com/docs/en/mcp | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_MCP_SECURITY | MCP security best practices | https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices | 2026-07-29 | 2.1.220 | verified | yes | CC BY 4.0 (documentation, excluding specifications) |
| SRC_MCP_SPEC | MCP released specification 2025-11-25 | https://modelcontextprotocol.io/specification/2025-11-25 | 2026-07-29 | 2.1.220 | verified | yes | Apache-2.0 (specification contributions) |
| SRC_MEMORY | Claude Code CLAUDE.md and memory | https://code.claude.com/docs/en/memory | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_PLUGIN_REF | Claude Code Plugins reference | https://code.claude.com/docs/en/plugins-reference | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_OUTPUT_STYLES | Claude Code Output styles documentation | https://code.claude.com/docs/en/output-styles | 2026-07-31 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_PLUGINS | Create Claude Code Plugins | https://code.claude.com/docs/en/plugins | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_SKILL_CREATOR | Anthropic official Skill Creator | https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md | 2026-07-29 | 2.1.220 | verified | yes | Apache-2.0 |
| SRC_SKILLS | Claude Code Skills | https://code.claude.com/docs/en/skills | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_SUBAGENTS | Claude Code Subagents | https://code.claude.com/docs/en/sub-agents | 2026-07-29 | 2.1.220 | verified | no | Proprietary; Anthropic PBC, all rights reserved |
| SRC_SUPERPOWERS | Superpowers writing-skills | https://raw.githubusercontent.com/obra/superpowers/main/skills/writing-skills/SKILL.md | 2026-07-29 | 2.1.220 | verified | yes | MIT, Copyright (c) 2025 Jesse Vincent |

Every external row was fetched live on the retrieved date and spot-checked against 2 or 3 claims that cite it; the spot-check records live in sources.json. Two page titles have drifted upstream without the URL changing: the memory page and the hooks guide. One nuance found during verification: the hooks reference now says over-cap hook output is saved to a file and replaced with a preview, where this reference had said truncated; hooks.md was corrected the same day.
