# Choosing a mechanism

> Claude Code 2.1.224, verified 2026-08-07. What that means here: this file carries NO verbatim quotes, so the quote gate says nothing about it; the capability surface is unchanged at 43 current tools and 31 current hook events. 101 of 186 mirrored pages changed since 2.1.220 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading.


Answer the axis questions in order, then open the matching mechanism reference. Many real needs combine two or more mechanisms; the composition cards cover the pairings that actually work.

## Decision axes (ask in order)

- **Who owns enforcement: the model or the harness?**
  - Judgment that varies by context → Skill (guidance the model reads; the model owns the outcome). A rule that must fire on every matching event → Hook (the harness runs it; the model cannot talk it out of firing). Caveat below: hooks are no longer strictly mechanical, and ownership is not a guarantee.
  - go to: [Skills](skills.md)
  - go to: [Hooks](hooks.md)
  - Caveat: Too simple on current builds. Hooks now carry judgment via prompt and agent handlers, and a skill can be forced into a subagent with context: fork. Choose by WHO owns enforcement and WHERE it runs, then pin down the three properties the word "guarantee" hides:
    - Authority: model-owned (skill guidance, CLAUDE.md, description routing) vs harness-owned (hook firing, tool filters, permission rules).
    - Failure policy: fail-open (an HTTP handler on connection failure, a command handler whose interpreter is missing), fail-closed (exit 2 on a blocking event), or advisory (PostToolUse feedback, additionalContext). Harness-owned with a fail-open handler is weaker than it looks; decide the posture explicitly per hook.
    - Tamper boundary: user-configurable (disableAllHooks switches every hook off, and there is no per-hook disable), project-configurable (checked-in .claude/ hooks and skills), or managed-policy enforced (only managed settings can disable managed hooks; allowManagedHooksOnly blocks user, project, and plugin hooks). Enforcement that must survive the user requires the managed tier.
- **Automatic invocation or explicit user trigger?**
  - Auto when-relevant → Skill discovery (description) or a Hook (event). Only on demand → a user-invoked Skill with disable-model-invocation: true.
  - go to: [Skills](skills.md)
  - Caveat: Both answers are the same primitive. Set the mode in frontmatter: disable-model-invocation for on-demand only. This is not a choice between two mechanisms.
- **Main-agent behaviour or delegated isolated work?**
  - Shape the main thread → Skill / Hook. Offload a bounded job into its own context window with its own tools → Subagent.
  - go to: [Skills](skills.md)
  - go to: [Subagents](subagents.md)
- **One project, or reusable and shared?**
  - One repo → standalone .claude/. Shared, versioned, cross-project → Plugin.
  - go to: [CLAUDE.md family](claude-md-family.md)
  - go to: [Plugins](plugins.md)
- **Procedural knowledge or mechanically-enforceable policy?**
  - A procedure the model should follow → Skill. A checkable invariant (regex, exit code, file present) → Hook.
  - go to: [Skills](skills.md)
  - go to: [Hooks](hooks.md)
  - Caveat: this branch used to end at Hook, and that was the single most expensive wrong answer on the page. "Mechanically enforceable" is FOUR mechanisms, not one, and the axis that separates them is COVERAGE SET, not strength. See the branch below before writing a hook for a path.
- **Which calls must the enforcement actually see?**
  - This is the branch to take for anything phrased "prevent", "must not", "never let". The four layers are COMPLEMENTARY and each one's gap is another's coverage, so "pick the strongest" is not a well-formed question. Route on what has to be covered.
  - Advisory prose in CLAUDE.md → covers the model's INTENT and nothing else. Zero enforcement, and correct when the requirement has no guarantee language.
  - PreToolUse hook → covers exactly the tools its matcher names, and FAILS OPEN when the handler is missing, crashes, or its interpreter is absent. A `Write|Edit` matcher cannot see a Bash command at all, so a hook alone never covers a shell write.
  - `permissions.deny` rule → harness-owned, so it holds when a handler is deleted. Covers the built-in file tools plus a subset of Bash that the docs give BY EXAMPLE and never enumerate, so you cannot read or test your way to its edge. It leaks at the subprocess boundary: a Node or Python script that opens the file itself writes straight through. Deny beats allow regardless of specificity, so it cannot carry an exception.
  - OS sandbox → closes exactly that subprocess boundary, at the OS level, for child processes too. It covers ONLY Bash and its children, so it does not cover the built-in file tools at all, and it DOES NOT RUN ON NATIVE WINDOWS.
  - go to: [Permission rules](permissions.md)
  - go to: [Sandboxing](sandboxing.md)
  - go to: [Hooks](hooks.md)
  - Caveat: on native Windows the sandbox is ABSENT, not weaker, so the subprocess vector has no answer there and the honest output is the strongest available configuration plus a stated residual. Two further Windows-specific gaps measured on this project: the deny rule's documented recognition sentence names Bash only and never PowerShell, and a `powershell Add-Content` write through a live `Edit(...)` deny rule was observed on 2.1.220. Do not read "PowerShell rules have parity with Bash rules" as covering it: that sentence is about rule SYNTAX, not about which file commands are recognised.
- **Need context isolation?**
  - Yes → Subagent (fresh window, returns only a summary).
  - go to: [Subagents](subagents.md)
- **Need tool restriction?**
  - Per-turn pre-approval → Skill allowed-tools. Hard capability limit for a delegated worker → Subagent tools / disallowedTools.
  - go to: [Skills](skills.md)
  - go to: [Subagents](subagents.md)
- **Behaviour tied to a lifecycle moment?**
  - Yes → Hook (before/after tool, prompt submit, session start/end, stop, compaction, ...).
  - go to: [Hooks](hooks.md)
- **Behaviour tied to an outside process emitting lines for as long as the session lives?**
  - Report every occurrence of something happening off to the side, and never gate it → Monitor, a plugin-declared shell command whose every stdout line is delivered to Claude as a notification. "Tell me when X finishes" is a background task; "tell me every time X happens" is a monitor.
  - go to: [Monitors](monitors.md)
  - Caveat: enforcement ownership is NOT A CHOICE on this branch. A monitor has no block or deny contract and no timeout field, so fail-open is the only available posture; if the requirement ends "and then it must stop something", the monitor is the SENSOR and a hook is the GATE. The context boundary is the MAIN window, since every line is admitted there and every later request re-reads it, so filter in the command rather than in the model's judgment. Lifecycle is the whole session and nothing shorter: disabling the plugin mid-session does NOT stop it, a plugin update strands it on the OLD path until a full session restart, and it does not load at all from a project-scope `@skills-dir` plugin, so a monitor checked into the repo reaches nobody.
- **Distribution, versioning, or rollback needed?**
  - Yes → Plugin (marketplace, pinned version).
  - go to: [Plugins](plugins.md)
- **Persistent every-session instruction, or path-scoped rule?**
  - Use CLAUDE.md for concise always-on project context; use .claude/rules for modular or path-scoped instruction sets.
  - go to: [CLAUDE.md family](claude-md-family.md)
- **Need external data or actions behind an authenticated boundary?**
  - Use MCP when Claude needs a governed connection to an external service.
  - go to: [MCP servers](mcp.md)
  - Caveat: MCP is PULL-ONLY. Claude asks and the server answers, and nothing in that contract lets the server speak first; the enforcement point is the per-server permission prompt, which only exists because the model initiated the call. If the requirement is the SERVER initiating, that is the channel branch below, and it is the same server with one capability key added rather than a different mechanism.
- **Need an outside system to PUSH an event into a live session?**
  - Yes → Channel, an MCP server that emits `notifications/claude/channel`, so everything on the MCP branch above still applies unchanged.
  - go to: [Channels](channels.md)
  - Caveat: research preview, and the failure policy is the weakest on this page. It fails OPEN AND SILENT at three separate points: the `await` on `mcp.notification()` resolves when the message reaches the TRANSPORT and not when Claude has processed it, an unregistered or policy-blocked channel has its events dropped with no error returned to your server, and `/mcp` reports the server healthy in exactly that case because the tools still work. Enablement is an AND of four gates (the capability key in your code, the config entry, `--channels` at launch, and the allowlist with `channelsEnabled`), and the last of those is MANAGED-TIER ONLY, so the tamper boundary sits with the ORG and it owns availability rather than you. Enforcement ownership inverts too: an ungated channel is a PROMPT INJECTION VECTOR, the harness performs no sender check, and the only gate is application code you write, on SENDER identity (`message.from.id`) and never room identity (`message.chat.id`), because in a group chat those differ.
- **Need to fan work out across tens or hundreds of agents?**
  - go to: [Dynamic Workflows](workflows.md)
  - go to: [Subagents](subagents.md)
- **Need independent peers that communicate directly?**
  - Use Agent Teams only when subagent result-return is insufficient and coordination justifies the higher token cost.
  - go to: [Agent Teams](agent-teams.md)
  - Caveat: Agent Teams is EXPERIMENTAL in the OFF-BY-DEFAULT sense, needing CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, and coordination cost is high. It is NOT the only unstable mechanism on this page. SKILL.md defines two senses of EXPERIMENTAL and this is the first; Monitors and Channels are unstable in the second, live the moment they are configured but carrying a manifest schema, flag syntax or protocol contract documented as liable to change between releases. An earlier version of this line said Agent Teams was the only one, which contradicted the channels branch above calling Channels a research preview.
- **Need to change how Claude itself responds, not what it knows?**
  - go to: [Custom Output Styles](output-styles.md)
  - go to: [Skills](skills.md)
- **Need symbol-aware navigation or live language diagnostics?**
  - Use an LSP/code-intelligence plugin.
  - go to: [LSP / code intelligence](lsp.md)
  - Caveat: LSP has no standalone authoring path. It is configured only as a plugin component via .lsp.json or lspServers in plugin.json, so building one means building a plugin.
