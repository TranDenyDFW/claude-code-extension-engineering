# Key repairs, v1 to v2

Applied 42 patch(es); 5 candidate(s) examined and left
unchanged because the docs do not settle them; 0 rejected at apply time.

Repair agents were BLIND: inputs were the v1 rows, defect records with every
sentence describing sheet or arm behavior redacted (52 sentences removed), and the
20-page docs mirror. No grades, answers, or results were readable. Every evidence
quote below was re-verified mechanically against the mirror bytes when applied.

## S003.version_caveat
- evidence: `sub-agents.md`: "As of v2.1.198, subagents run in the background by default. Claude runs a subagent in the foreground when it needs the result before continuing."
- rationale: The old key buried the v2.1.198 fact inside a bare none, contradicting its own failure_mode which relies on background-default behavior; the same doc paragraph also states background subagents run with a smaller built-in tool set, and the frontmatter table says that when background is unset Claude chooses.
- new: none for subagent delegation itself; the background-by-default run mode and its smaller built-in tool set are gated: as of v2.1.198 subagents run in the background by default, on earlier versions Claude chooses foreground or background per call

## S008.version_caveat
- evidence: `sub-agents.md`: "Claude runs a subagent in the foreground when it needs the result before continuing."
- rationale: Defect flagged cross-key disagreement with S003 over whether subagents carry a version caveat; the chaining example (use the code-reviewer subagent, then the optimizer subagent) has no min-version marker, so the only version-gated fact is the v2.1.198 background default, which the foreground-when-needed rule makes mostly moot for strict sequences.
- new: none for chaining subagents in sequence, the documented pattern carries no version gate; as of v2.1.198 subagents default to background, but Claude runs a subagent in the foreground when it needs the result before continuing, which each sequential handoff does

## S014.rejected_alternative
- evidence: `memory.md`: "Instead of loading them at launch, they are included when Claude reads files in those subdirectories."
- rationale: The old alternative (appending to the project CLAUDE.md) was already ruled out by the scenario text itself ('the root instructions file is already near its useful size limit'), so it was not a live option. A subdirectory CLAUDE.md is the nearest live alternative: it also loads on demand rather than at launch, so it competes directly with the path-scoped rule on this need.
- new: A nested CLAUDE.md inside src/api/ that loads on demand when Claude reads files in that subtree

## S014.rejection_reason
- evidence: `memory.md`: "Nested CLAUDE.md files in subdirectories are not re-injected automatically; they reload the next time Claude reads a file in that subdirectory."
- rationale: Updated to reject the new alternative on mirror-verified grounds: rules' paths frontmatter takes glob patterns ('Use glob patterns in the `paths` field to match files by extension, directory, or any combination') while subdirectory CLAUDE.md inclusion is triggered purely by reads in the directory, and the compaction gap is stated verbatim in the troubleshooting section.
- new: A nested CLAUDE.md scopes by directory only: it fires for any file read under src/api/ and cannot target just the TypeScript sources the way the rule's paths globs such as src/api/**/*.ts can. It is also weaker after compaction: nested CLAUDE.md files are not re-injected automatically after /compact, reloading only on the next read in that subdirectory.

## S016.version_caveat
- evidence: `memory.md`: "{/* min-version: 2.1.210 */}After Claude writes to `MEMORY.md`, Claude Code measures the file against the 200-line and 25KB read limits."
- rationale: memory.md says auto memory is on by default with no gate on the mechanism, but the key's failure_mode leans on the 200-line/25KB index limit whose enforcement (warn/error after writes) is version-gated at v2.1.210, refined at v2.1.211 to strip frontmatter and block comments before measuring.
- new: none for auto memory itself, which is on by default with no min-version in memory.md; the post-write MEMORY.md limit check that warns and errors on an oversized index requires v2.1.210 or later, and from v2.1.211 the check measures only the content that loads

## S017.enforcement_owner
- evidence: `output-styles.md`: "Custom output styles leave out Claude Code's built-in software engineering instructions, such as how to scope changes, write comments, and verify work, unless `"
- rationale: The old one-word 'model' contradicted the key's own rejection_reason: omitting the coding-instructions block is a deterministic client-side construction step ('Output styles directly modify Claude Code's system prompt'), while following the injected voice remains model behavior ('All output styles trigger reminders for Claude to adhere to the output style instructions'). A split states both truthfully.
- new: split: the harness owns the removal, output styles directly modify the system prompt and Claude Code leaves out the built-in software-engineering instructions when keep-coding-instructions is false; the model owns adhering to the runbook voice and structure each response

## S018.context_boundary
- evidence: `hooks.md`: "stderr text is fed back to Claude as an error message"
- rationale: PreToolUse command hooks run as harness-spawned shell processes; the only thing that enters the session context on a block is the reason (exit-2 stderr per this quote, or the deny reason, which the PreToolUse decision-control table says is 'For "deny", shown to Claude').
- new: harness (the hook command is a separate process spawned at the tool-call boundary with no context window of its own, receiving the attempted command as JSON on stdin; only the deny reason crosses into the session context, since exit-2 stderr is fed back to Claude and a JSON deny's permissionDecisionReason is shown to Claude)

## S021.version_caveat
- evidence: `mcp.md`: "From v2.1.186, `claude mcp login <name>` runs a configured server's OAuth flow directly from your shell, so you don't need to open the `/mcp` panel inside a ses"
- rationale: The primary key names claude mcp login as one of the two sign-in paths and that path is version-gated at v2.1.186; the /mcp in-session flow has no gate, and mcp.md line 575 adds that the startup notice for servers needing authentication requires v2.1.193 or later.
- new: none for the HTTP transport and OAuth sign-in via /mcp; authenticating from the shell with claude mcp login requires v2.1.186 or later, and the startup notice flagging servers that need authentication requires v2.1.193 or later

## S022.rejected_alternative
- evidence: `hooks-guide.md`: "This hook uses the `PostToolUse` event with an `Edit|Write` matcher, so it runs only after file-editing tools."
- rationale: The old alternative (a hand-rolled .lsp.json plugin) was the same mechanism class as the primary, an LSP server delivered as a plugin, differing only in provenance. A PostToolUse hook that runs the compiler after each edit is the nearest genuinely distinct mechanism for the see-errors-after-edit half of the need, and it is a documented hook pattern (the guide's format-after-edit example uses exactly this event and matcher).
- new: A PostToolUse hook on an Edit|Write matcher that runs the TypeScript compiler after each edit and feeds the errors back to Claude

## S022.rejection_reason
- evidence: `plugins-reference.md`: "go to definition, find references, and hover information"
- rationale: Updated to reject the new alternative. The mirror lists exactly two things LSP integration provides that a hook cannot: 'Instant diagnostics: Claude sees errors and warnings immediately after each edit' and 'Code navigation: go to definition, find references, and hover information'. The scenario explicitly demands both, and the hook mechanism satisfies only the first.
- new: A PostToolUse hook can rerun the compiler after each edit and inject the errors, matching the docs' after-edit hook pattern, but it delivers diagnostics only: go to definition, find references, and hover information are LSP capabilities, so Claude would still grep for symbol names. The typescript-lsp plugin covers both halves of the need, errors and warnings immediately after each edit plus on-demand code navigation.

## S023.context_boundary
- evidence: `plugins-reference.md`: "tokens added to every session by the plugin's listing text, such as skill descriptions, agent descriptions, and command names"
- rationale: The plugin details command documents exactly which plugin parts occupy the main context every session (always-on listing text) versus on invoke, and its sample inventory marks the SessionStart hook as harness-only with no model context cost; distribution machinery itself never touches a context window.
- new: per component (marketplace registration and plugin installs run in the harness, outside any context window; once enabled, skill and agent descriptions and command names sit in every session's main context as the always-on listing cost, full bodies load on invoke, and the plugin's hooks execute harness-side)

## S025.context_boundary
- evidence: `plugins-reference.md`: "Claude Code uses the plugin's version as the cache key that determines whether an update is available."
- rationale: Version resolution and the update check are pure harness operations on the plugin cache; the model never participates and no token of it enters any context window.
- new: harness (version resolution is client-side cache-key bookkeeping performed when /plugin update or auto-update fires; no context window is involved and nothing enters the session context, updated components simply reach later sessions under their own per-component rules)

## S030.context_boundary
- evidence: `hooks.md`: "The exceptions are `UserPromptSubmit`, `UserPromptExpansion`, and `SessionStart`, where stdout is added as context that Claude can see and act on."
- rationale: The install itself is a separate hook process and disk state, but unlike most hook events SessionStart stdout crosses into the session context, a real and gradeable boundary fact for this SessionStart-hook pattern.
- new: harness process with one context leak (the manifest diff and npm install run in a SessionStart hook process and write only to the on-disk data directory; SessionStart is one of the events whose stdout is added as context, so any install output the hook does not redirect enters the session context for Claude to see)

## S031.rejected_alternative
- evidence: `interactive-mode.md`: "Output is written to a file and Claude can retrieve it using the Read tool"
- rationale: The old alternative (run inline, then /compact) was a remediation applied after the damage, not a competing mechanism. Backgrounding the test run is a documented competing mechanism for the same job: test runners are listed among common backgrounded commands, output is parked in a file, and Claude retrieves it selectively.
- new: Run the suite as a background Bash task and have Claude pull the failures out of the output file afterward

## S031.rejection_reason
- evidence: `sub-agents.md`: "the verbose output stays in the subagent's context while only the relevant summary returns to your main conversation"
- rationale: Updated to reject the new alternative. The mirror names 'Running tests' first in its list of operations to isolate in a subagent, and the background-task docs confirm retrieval happens through Read into the requesting context, so filtering thousands of log lines inline defeats the isolation requirement.
- new: Backgrounding detaches the process, not the output: whatever Claude reads back from the output file to locate the failures still enters the main conversation, so the sifting happens in the very context the scenario wants kept clean. Running tests is the sub-agents doc's named isolation case: the verbose output stays in the subagent's context while only the relevant summary returns.

## S031.version_caveat
- evidence: `sub-agents.md`: "As of v2.1.198, subagents run in the background by default."
- rationale: Defect said the bare none is ambiguous between no availability gate and no relevant version fact; scoped it to the mechanism per the S040 pattern and named the one version fact that touches the delegated run, matching the repaired S003 key for the same mechanism.
- new: none (no version gate on delegating the noisy run to a subagent as of 2.1.220, per sub-agents.md); the background-by-default behavior of the delegated run dates to v2.1.198

## S033.version_caveat
- evidence: `interactive-mode.md`: "Before v2.1.212, `/btw` without a question printed a usage message instead."
- rationale: Defect recorded independent convergence on v2.1.212 and v2.1.187 as real gates the bare none hid; the core /btw command has no min-version marker, while the bare-reopen gate is at line 374 and the overlay key table at line 382 states Left/Right stepping requires Claude Code v2.1.187 or later.
- new: none for /btw itself; reopening the overlay with a bare /btw requires v2.1.212 or later (before that it printed a usage message), and Left/Right stepping through earlier answers requires v2.1.187 or later

## S037.version_caveat
- evidence: `sub-agents.md`: "Before v2.1.218, frontmatter hooks could run from folders you hadn't trusted, including in non-interactive sessions."
- rationale: The key's own failure_mode conceded the v2.1.218 workspace-trust fact while version_caveat said none; hooks.md line 570 introduces frontmatter hooks with no min-version, so the true caveat is the v2.1.218 trust gate documented at sub-agents.md lines 624-626 and hooks.md line 593, including the fails-open skip that matters for a compliance blocker.
- new: none for PreToolUse hooks in subagent frontmatter themselves; on v2.1.218 and later a project-level subagent's frontmatter hooks run only after the workspace trust dialog is accepted (user-level agents in ~/.claude/agents/ are exempt), and until the folder is trusted the hooks are skipped while the subagent still runs

## S040.enforcement_owner
- evidence: `sub-agents.md`: "Explore and Plan are the only subagents that omit CLAUDE.md and git status. There is no frontmatter field or per-agent setting to change which agents skip them."
- rationale: The old 'model' contradicted the rejection_reason, which describes harness machinery: the skip is a fixed client-side construction of the Explore/Plan startup context. The docs' prescribed fix ('restate it in the prompt you give Claude when delegating') is the model-owned, advisory half, which the key's failure_mode already concedes. A split names both layers correctly.
- new: split: the harness owns why the rule never arrives, Explore and Plan omit CLAUDE.md by construction and no setting changes that; compliance with the rule restated at delegation is model-owned and purely advisory

## S041.failure_mode
- evidence: `hooks.md`: "Claude Code treats exit code 1 as a non-blocking error and proceeds with the action"
- rationale: Old key described the CLAUDE.md alternative failing; rewritten to the PreToolUse hook's own semantics. Fail-open on non-2 exits is the documented behavior; hooks.md also states the if filter "fails open, running your hook regardless of pattern, when the Bash command can't be parsed" and says to "use the permission system rather than a hook to enforce a hard allow or deny".
- new: Fails open on hook bugs: Claude Code treats exit code 1 as a non-blocking error and proceeds with the tool call, so only exit code 2 or an explicit permissionDecision deny actually blocks; matcher gaps leak as well, since the deny runs only on calls the Edit|Write and Bash matchers catch, and the docs point hard allow/deny guarantees at the permission system because Bash command filtering is best-effort.

## S041.version_caveat
- evidence: `hooks.md`: "Comma separators and the surrounding whitespace tolerance require Claude Code v2.1.191 or later."
- rationale: Searched hooks.md for gates on PreToolUse, permissionDecision, and settings-based hooks and found none on the mechanism itself, so the bare none becomes the scoped form; the one nearby gate worth naming is the v2.1.191 comma matcher separator, and the key's pipe form is the always-works variant, which answers the defect's charge that a bare none penalises more precise answers.
- new: none (no version gate on PreToolUse permissionDecision deny hooks in settings.json as of 2.1.220, per hooks.md); the Edit|Write pipe matcher form works on every version, while comma separators require v2.1.191 or later

## S042.failure_mode
- evidence: `skills.md`: "the content is usually still present and the model is choosing other tools or approaches"
- rationale: Old key described the CLAUDE.md alternative. Skills fail open twice: discovery (troubleshooting section: check the description includes keywords users would naturally say) and adherence (same paragraph continues "use hooks to enforce behavior deterministically" and "re-invoke it after compaction to restore the full content").
- new: Advisory at every step: auto-invocation rides on description matching, so weak keywords mean the runbook never loads and a release proceeds without it; once invoked the body is ordinary context the model can drift from, with the docs prescribing stronger descriptions or hooks to enforce behavior deterministically; after compaction a large skill needs re-invoking to restore the full content.

## S043.enforcement_owner
- evidence: `mcp.md`: "Claude Code refreshes the stored token, reconnects, and retries the request once"
- rationale: The old 'external' contradicted the rejection_reason, which credits the primary with 'a managed OAuth flow, and per-tool permissioning': both are Claude Code functions per the mirror (token storage/refresh in mcp.md; mcp__<server>__<tool> rules in permissions.md). The external service's share is only the 401/403 rejection that triggers the flow ('Claude Code marks a remote server as needing authentication when the server responds with 401 Unauthorized or 403 Forbidden'). A split states the true division.
- new: split: the harness owns the client-side machinery, it runs the OAuth flow, stores and refreshes tokens, and evaluates per-tool mcp__ permission rules; the tracker service enforces access on its side by rejecting unauthorized requests with 401 or 403

## S043.failure_mode
- evidence: `mcp.md`: "Claude Code refreshes the stored token, reconnects, and retries the request once. It flags the server in `/mcp` only if that retry also fails."
- rationale: Old key described the curl-skill alternative. mcp.md also documents reconnection ("up to five attempts, starting at a one-second delay and doubling each time... After five failed attempts the server is marked as failed") and the output limits ("limits output to 25,000 tokens by default", warning at 10,000).
- new: Fails closed toward the tracker: on a 401 Claude Code refreshes the stored token, reconnects, and retries the request once, flagging the server in /mcp for re-authentication only if that retry also fails, so expired credentials pause tracker access until the user signs back in; a dropped HTTP connection is retried with exponential backoff up to five attempts before the server is marked failed; oversized ticket payloads are limited by the 25,000-token default MCP output cap (warning at 10,000).

## S044.failure_mode
- evidence: `hooks.md`: "Claude doesn't see it, and the session or subagent proceeds"
- rationale: Old key described the stale-CLAUDE.md alternative. hooks.md's exit-code-2 table lists SessionStart as non-blocking ("Shows stderr to user only"), caps hook output strings including additionalContext at 10,000 characters with file-preview replacement, and advises "SessionStart runs on every session, so keep these hooks fast".
- new: Fails open silently: SessionStart cannot block, a failing query script's exit code 2 stderr renders only as a hook error notice that Claude doesn't see, and the session begins without the sprint and branch context; an additionalContext value over 10,000 characters is written to a file and replaced with a preview and path instead of injected; and since the hook runs on every session start, a slow query delays every launch (docs: keep these hooks fast).

## S045.context_boundary
- evidence: `plugins-reference.md`: "tokens added to every session by the plugin's listing text, such as skill descriptions, agent descriptions, and command names"
- rationale: Same doc basis as S023: the plugin details view splits cost into always-on listing text in the main context versus on-invoke, and shows hooks as harness-only; the grader-suggested 'per component' framing matches the documented split.
- new: per component (marketplace distribution, installation, and version updates run in the harness, outside any context window; enabled components then cost context per their own rules: skill and agent descriptions and command names are always-on in every session's main context, bodies cost tokens on invoke, hooks run harness-side)

## S045.failure_mode
- evidence: `plugins-reference.md`: "Plugin <name> has an invalid manifest file at .claude-plugin/plugin.json"
- rationale: Old key described the copy-paste alternative. plugins-reference.md's common-issues table maps "Plugin not loading" to "Invalid plugin.json" with claude plugin validate as the check, documents that an invalid server config is skipped while others still start (claude --debug shows why), and its version-management table states "Pushing new commits without bumping it has no effect, and /plugin update reports 'already at the latest version'".
- new: Fails open at load time: a plugin with an invalid manifest errors (Plugin <name> has an invalid manifest file at .claude-plugin/plugin.json) and invalid component entries are skipped, with the reason visible only via claude plugin validate or claude --debug, so a consuming repo silently runs without the tooling; updates strand the same way: with an explicit version field, pushing new commits without bumping it has no effect and /plugin update reports already at the latest version across all 40 repos.

## S046.failure_mode
- evidence: `memory.md`: "To block an action regardless of what Claude decides"
- rationale: Old key described the description-matched alternative. skills.md confirms the closed side ("This removes the skill from Claude's context entirely"; the invocation table shows model invocation No) and the YAML edge ("If the frontmatter YAML is malformed, Claude Code loads the skill body with empty metadata"); memory.md supplies the enforcement boundary quoted, matching the healthy S013 key's gap clause.
- new: Fails closed only on the invocation surface: the flag removes the skill from Claude's context and blocks Skill-tool invocation, leaving /deploy as the sole path; it gates nothing beneath the skill, so the deploy commands themselves remain runnable through Bash, and blocking the action regardless of what Claude decides still requires a PreToolUse hook or permission deny rules; malformed frontmatter YAML also loads the body with empty metadata, silently dropping the flag.

## S047.failure_mode
- evidence: `common-workflows.md`: "The task runs autonomously, so it can't ask clarifying questions"
- rationale: Old key described the hook alternative never running. The mirror lacks the github-actions page, so this patch uses common-workflows.md's scheduling table (GitHub Actions runs in "Your CI pipeline" for "Tasks tied to repo events") and its autonomy warning; the stays-untriaged consequence follows from the scenario's own no-human-at-a-terminal premise.
- new: Runs as an autonomous one-shot in the CI pipeline, so it cannot fail into a human: the docs note such a task runs autonomously and can't ask clarifying questions, so ambiguous triage instructions get resolved unilaterally instead of paused for a person; a run that errors fails closed for that issue, which simply stays untriaged until another repo event retriggers the workflow, with the failure visible only in the pipeline, never in any local Claude Code session.

## S048.enforcement_owner
- evidence: `agent-teams.md`: "Use agent teams when teammates need to share findings, challenge each other, and coordinate on their own."
- rationale: The old 'harness' contradicted the sibling keys' reading (S002 answers 'model' for the identical scenario) and overstates what the harness guarantees: Claude Code provides delivery machinery ('Each agent's mailbox is a JSON file at ~/.claude/teams/{team-name}/inboxes/{agent-name}.json') but nothing in the mirror makes cross-examination happen; challenging each other is teammate (model) behavior. A split resolves the S002/S048 inconsistency truthfully.
- new: split: the harness supplies the machinery subagents structurally lack, direct teammate mailboxes and the shared task list; the model owns actually conducting the adversarial debate and converging on the written consensus

## S048.failure_mode
- evidence: `agent-teams.md`: "no team is set up at session start, no team directories are written, and Claude does not spawn or propose teammates"
- rationale: Old key described the subagent alternative's anchoring failure. agent-teams.md's limitations section supplies the soft failures verbatim: "teammates sometimes fail to mark tasks as completed, which blocks dependent tasks", "/resume and /rewind do not restore in-process teammates. After resuming a session, the lead may attempt to message teammates that no longer exist", and "Two teammates editing the same file leads to overwrites".
- new: Fails closed at spawn: without CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 no team is set up, no team directories are written, and Claude does not spawn or propose teammates; a running team fails soft: task status can lag when a teammate fails to mark work complete, blocking dependent tasks, and /resume or /rewind does not restore in-process teammates, so the lead may message teammates that no longer exist; two investigators editing the same findings file overwrite each other.

## S049.failure_mode
- evidence: `output-styles.md`: "Output styles apply to the main conversation only"
- rationale: Old key described the CLAUDE.md alternative fighting the engineering prompt. output-styles.md states the subagent exclusion ("a subagent runs its own system prompt... so styles don't change how subagents respond") and the reload boundary ("Output style is part of the system prompt, which Claude Code reads once at session start. Changes take effect after /clear or a new session"); as prompt text it is advisory, matching the key's enforcement_owner of model.
- new: Advisory: the style is system-prompt text, so holding the tabular report format each turn stays with the model; it applies to the main conversation only, since a subagent runs its own system prompt and ignores the style; and the style is read once at session start, so a mid-project edit takes effect only after /clear or a new session.

## S050.failure_mode
- evidence: `cli-reference.md`: "Minimal mode: skip auto-discovery of hooks, skills, plugins, MCP servers, auto memory, and CLAUDE.md"
- rationale: Old key described plain -p's environment-dependent results. cli-reference.md defines --bare's omissions (and that bare mode leaves "Bash, file read, and file edit tools"), defines --allowedTools as tools that execute without prompting, and documents --permission-prompt-tool as the way to "handle permission prompts in non-interactive mode", so an uncovered tool call has no approval path in a headless CI run.
- new: Fails closed by omission: bare mode skips auto-discovery of hooks, skills, plugins, MCP servers, auto memory, and CLAUDE.md, so any context or tool grant the CI run needs but the flags do not pass simply is not there, and the lint pass silently runs without it; a tool call outside --allowedTools also cannot be interactively approved mid-run, since handling permission prompts in non-interactive mode requires a --permission-prompt-tool handler.

## S051.context_boundary
- evidence: `hooks.md`: "For most events, stdout is written to the debug log but not shown in the transcript."
- rationale: PostToolUse is not one of the stdout-as-context exceptions, so a normal formatter run leaves the session context untouched; the exit-2 table entry for PostToolUse ('Shows stderr to Claude; the tool already ran') is the only crossing.
- new: harness (the formatter runs in a separate PostToolUse hook process after each matching edit, outside any context window; on success its stdout goes to the debug log and nothing enters the session context, and only exit-2 stderr is shown to Claude)

## S052.context_boundary
- evidence: `permissions.md`: "Permission deny rules block Claude from even attempting to access restricted resources"
- rationale: Rule evaluation is client-side ('Permission rules are enforced by Claude Code, not by the model'); because the read is refused before it runs, the protected bytes have no path into the context window.
- new: harness (deny rules are evaluated by the permission system before each tool call, outside any context window; the blocked call never executes, so the secret file contents never enter any context in any session)

## S053.context_boundary
- evidence: `hooks.md`: "Notification hooks can't block or modify notifications. They are intended for side effects such as forwarding the notification to an external service."
- rationale: Notification is a standalone async event whose exit-2 behavior is 'Shows stderr to user only'; the alert path runs wholly in the harness and the model never sees any of it, which a wrong sheet (e.g. claiming the alert text reaches Claude) can contradict.
- new: harness, out-of-band (the notifier runs as a separate process whenever Claude Code sends a notification, entirely outside any context window; nothing crosses into the session context: the hook cannot block or modify anything and exit-2 stderr goes to the user only)

## S054.context_boundary
- evidence: `settings.md`: "The reload covers user, project, local, and managed settings"
- rationale: Settings files, including the managed tier, are read and live-reloaded by the Claude Code client; the mode restriction acts in the harness's permission machinery and contributes no tokens to any context window.
- new: harness (managed settings are configuration the client loads from the OS-protected policy source, not context; they gate which permission modes are selectable for the session and nothing from them enters any context window)

## S056.context_boundary
- evidence: `permissions.md`: "rules prompt for confirmation whenever Claude Code tries to use the specified tool"
- rationale: Ask-rule evaluation and the prompt are harness/terminal interactions ('Permission rules are enforced by Claude Code, not by the model'); the model's call simply waits on the user's decision.
- new: harness (the ask rule is evaluated before the tool call and the confirmation is a terminal prompt to the user, all outside any context window; the push executes only after approval, so nothing from the gate itself enters the session context)

## S057.context_boundary
- evidence: `hooks.md`: "For most events, stdout is written to the debug log but not shown in the transcript."
- rationale: The compliance log is captured and stored entirely harness-side: PostToolUse hooks get the command on stdin, and their normal output never reaches the model, so the record cannot be shaped by the model it audits.
- new: harness (the logger runs in a separate PostToolUse hook process outside any context window, receiving the executed command and its result as JSON on stdin; the audit trail is written to disk and nothing enters the session context, since hook stdout goes to the debug log)

## S058.context_boundary
- evidence: `hooks.md`: "For `"deny"`, shown to Claude"
- rationale: Same PreToolUse execution model as S018: a harness-spawned process decides allow/deny ahead of permission rules, and the sole context crossing is the deny reason (JSON permissionDecisionReason or exit-2 stderr) fed back to the model.
- new: harness (the gate runs as a separate hook process before each Bash call, outside any context window, with the command arriving as JSON on stdin; the one approved invocation proceeds normally and only a deny reason crosses into the session context so Claude sees why a call was refused)

## S059.context_boundary
- evidence: `permissions.md`: "provides OS-level enforcement that restricts the Bash tool's filesystem and network access. It applies only to Bash commands and their child processes."
- rationale: Sandboxing sits below both the model and the harness permission layer, applied to the spawned process tree; permissions.md also states the boundary prevents access 'even if a prompt injection bypasses Claude's decision-making', confirming zero context-window involvement.
- new: OS boundary below the harness (Seatbelt or bubblewrap enforce the sandbox on the Bash command and every child process at the operating-system level; no context window is involved anywhere, so the block holds even if a prompt injection bypasses Claude's decision-making, and nothing enters the session context)

## S060.context_boundary
- evidence: `settings.md`: "For each locked surface, Claude Code skips user-level and project-level sources and loads only plugin-provided and managed sources"
- rationale: strictPluginOnlyCustomization is a load-time filter in the client: what it blocks never exists in the session, which is a substantive, falsifiable boundary claim (a sheet saying blocked components still appear in the skill listing would contradict it).
- new: harness (the lock is applied when customization sources load; blocked user- and project-source skills, agents, hooks, and MCP servers are never loaded at all, so neither their descriptions nor their tool definitions ever enter any context window, while permitted plugin and managed components enter context per their own rules)

## Examined, unchanged
- S010.rejected_alternative: Examined the defect's claim that the workflow/nesting split is arbitrary. The mirror does keyed work here: the workflows comparison table puts subagents at 'A few delegated tasks per turn' versus workflows at 'Dozens to hundreds of agents per run', and sub-agents.md names this exact shape for nesting ('such as a reviewer subagent that dispatches a verifier per finding, so the intermediate output never reaches your main conversation'). At 5 to 10 findings hanging off one delegated task, the workflow remains the nearest live competing mechanism to reject, so the key stays.
- S029.rejected_alternative: Examined for a nearer alternative and found none in the mirror. The docs present exactly two team-sharing paths for an MCP server: the checked-in project-scope .mcp.json ('Check `.mcp.json` into version control so everyone on your team gets the same MCP tools and services') and plugin-bundled servers, whose documented benefit is team consistency across installs. The plugin plus marketplace is therefore the correct nearest distinct mechanism, and the key stays.
- S053.rejected_alternative: Examined the one candidate the mirror offers as possibly nearer: the built-in preferredNotifChannel setting, documented for task-complete and permission-prompt notifications but with 'auto' sending a desktop notification only in iTerm2, Ghostty, and Kitty and doing nothing in other terminals. The docs present it and the Stop hook as parallel plausible mechanisms without ranking them, and the Stop hook's rejection stays doc-true (Stop 'Runs when the main Claude Code agent has finished responding', so it cannot fire mid-turn at a permission prompt). Not clearly settled, so the key stays.
- S055.rejected_alternative: Examined the TaskCompleted hook as a possibly nearer alternative, since the mirror documents it for enforcing passing tests. It gates a task being marked completed through the TaskUpdate tool, not the agent ending its turn, so it only fires when the task list is in use and does not meet the scenario's 'before the agent ends its turn' requirement any more directly than the existing alternative. The docs do not settle a nearer alternative, so the key stays.
- S057.rejected_alternative: Examined the defect's complaint that PreToolUse reads as a sub-part of the primary. It is a distinct sibling event with its own timing (before processing, so it records attempts including ones later denied; the mirror confirms 'Permission denials fire `PreToolUse`'), which is precisely the audit-accuracy discrimination the key grades. The only other capture mechanisms (OpenTelemetry export, session transcripts) are not documented in the 20 mirror pages, so the docs here do not settle a nearer alternative and the key stays.

## Apply-time rephrase

- S037.version_caveat: the applied patch stated the correct v2.1.218 workspace-trust gate
  but LED with the word "none", which both the keys-lint self-contradiction rule and a
  plain reading flag as confusing. Rephrased to lead with the gate; substance and evidence
  citation unchanged (sub-agents.md: "Before v2.1.218, frontmatter hooks could run from
  folders you had not trusted, including in non-interactive sessions.").

## The seeding episode, and its fix

An independent review of the repair phase found that the ORIGINAL context-boundary
repair prompt embedded a parenthetical pre-stating the answer substance for the very
family it repaired ("settings and hooks run in the harness outside any context
window..."). The seeded direction was doc-true and every applied value was
quote-verified, but a prompt that contains answer content for a graded field is not
blind, and the review failed that check. Correctly.

Fix: a fresh agent re-derived all 14 keys from the scenario rows and the mirror with
NO answer-shaped hints. The unseeded values are the ones shipped; both versions are
recorded below. The unseeded agent independently converged on the same substance in
every case, which is what one expects when the answers are doc-determined facts, and
is evidence the seeding steered phrasing at most. That claim is checkable here.

### S018.context_boundary
- seeded (superseded): harness (the hook command is a separate process spawned at the tool-call boundary with no context window of its own, receiving the attempted command as JSON on stdin; only the deny reason crosses into the session context, since exit-2 stderr is fed back to Claude and a JSON deny's permissionDecisionReason is shown to Claude)
- unseeded (SHIPPED): no context window of its own (the hook runs as a shell process at the tool-call boundary, before the push can execute); what crosses back into the main conversation is only the block plus its reason, fed to Claude as an error message so it knows why the call was refused
- evidence: `hooks.md`: "stderr text is fed back to Claude as an error message. The effect depends on the event: `PreToolUse` blocks the tool call"

### S023.context_boundary
- seeded (superseded): per component (marketplace registration and plugin installs run in the harness, outside any context window; once enabled, skill and agent descriptions and command names sit in every session's main context as the always-on listing cost, full bodies load on invoke, and the plugin's hooks execute harness-side)
- unseeded (SHIPPED): no context window for the distribution layer (marketplace registration, install, and update tracking are harness operations that never enter a conversation); once a teammate enables the plugin, each bundled component crosses into their sessions under its own rules, for example skills are model-invoked from task context while hooks fire on harness events
- evidence: `plugins.md`: "Skills are model-invoked: Claude automatically uses them based on the task context."

### S025.context_boundary
- seeded (superseded): harness (version resolution is client-side cache-key bookkeeping performed when /plugin update or auto-update fires; no context window is involved and nothing enters the session context, updated components simply reach later sessions under their own per-component rules)
- unseeded (SHIPPED): no context window anywhere in the mechanism (version resolution and update checks are harness bookkeeping over the plugin cache); the commit SHA serves purely as the version string that decides when teammates receive an update, and nothing about versioning ever enters a conversation
- evidence: `plugins.md`: "If omitted and your plugin is distributed via git, the commit SHA is used and every commit counts as a new version."

### S030.context_boundary
- seeded (superseded): harness process with one context leak (the manifest diff and npm install run in a SessionStart hook process and write only to the on-disk data directory; SessionStart is one of the events whose stdout is added as context, so any install output the hook does not redirect enters the session context for Claude to see)
- unseeded (SHIPPED): the install work itself runs in shell processes outside any context window, writing dependencies to the persistent per-plugin data directory; the one boundary crossing to watch is that SessionStart hook stdout is added as context Claude can see, so a noisy npm install leaks into the main context unless the script silences its output
- evidence: `hooks.md`: "The exceptions are `UserPromptSubmit`, `UserPromptExpansion`, and `SessionStart`, where stdout is added as context that Claude can see and a"

### S045.context_boundary
- seeded (superseded): per component (marketplace distribution, installation, and version updates run in the harness, outside any context window; enabled components then cost context per their own rules: skill and agent descriptions and command names are always-on in every session's main context, bodies cost tokens on invoke, hooks run harness-side)
- unseeded (SHIPPED): no context window for distribution (versioned install and update propagation happen in the harness, outside any conversation); inside each consuming session the bundle crosses into context per component, for example plugin MCP servers start automatically when enabled and surface as standard tools in the main conversation while hooks run as event handlers outside the model
- evidence: `plugins-reference.md`: "Plugin MCP servers start automatically when the plugin is enabled"

### S051.context_boundary
- seeded (superseded): harness (the formatter runs in a separate PostToolUse hook process after each matching edit, outside any context window; on success its stdout goes to the debug log and nothing enters the session context, and only exit-2 stderr is shown to Claude)
- unseeded (SHIPPED): no context window (the formatter is a shell process fired after each matching edit); by default nothing crosses into the conversation because for most hook events stdout goes to the debug log, and only a blocking exit 2 stderr or an explicit additionalContext return feeds anything back to Claude
- evidence: `hooks.md`: "For most events, stdout is written to the debug log but not shown in the transcript."

### S052.context_boundary
- seeded (superseded): harness (deny rules are evaluated by the permission system before each tool call, outside any context window; the blocked call never executes, so the secret file contents never enter any context in any session)
- unseeded (SHIPPED): no context window (deny rules are evaluated by Claude Code at the tool-call boundary, not by the model); what the boundary guarantees is that matching secret file contents never cross into context, with coverage extending beyond the Read tool to Grep, Glob, @file mentions, and IDE-shared context
- evidence: `permissions.md`: "Claude makes a best-effort attempt to apply `Read` rules to all built-in tools that read files like Grep and Glob, to `@file` mentions in yo"

### S053.context_boundary
- seeded (superseded): harness, out-of-band (the notifier runs as a separate process whenever Claude Code sends a notification, entirely outside any context window; nothing crosses into the session context: the hook cannot block or modify anything and exit-2 stderr goes to the user only)
- unseeded (SHIPPED): no context window (the notifier is a pure side-effect command fired on the Notification event); nothing crosses back into the conversation: the event supports no decision control, and even blocking stderr is shown to the user only, never to Claude
- evidence: `hooks.md`: "No decision control. Used for side effects like logging or cleanup"

### S054.context_boundary
- seeded (superseded): harness (managed settings are configuration the client loads from the OS-protected policy source, not context; they gate which permission modes are selectable for the session and nothing from them enters any context window)
- unseeded (SHIPPED): no context window at any point (a managed-settings policy key the harness reads at startup to decide which permission modes are selectable); it consumes no conversation context, and nothing the model or a developer-writable file emits can cross back to change it, since managed settings cannot be overridden by anything
- evidence: `settings.md`: "**Managed** (highest): can't be overridden by anything"

### S056.context_boundary
- seeded (superseded): harness (the ask rule is evaluated before the tool call and the confirmation is a terminal prompt to the user, all outside any context window; the push executes only after approval, so nothing from the gate itself enters the session context)
- unseeded (SHIPPED): no context window (the rule is evaluated by the harness before the matching Bash call and pauses it on a terminal prompt); what crosses the boundary is the human's confirmation or refusal rather than model output, and the tool call proceeds only after that approval
- evidence: `permissions.md`: "**Ask** rules prompt for confirmation whenever Claude Code tries to use the specified tool."

### S057.context_boundary
- seeded (superseded): harness (the logger runs in a separate PostToolUse hook process outside any context window, receiving the executed command and its result as JSON on stdin; the audit trail is written to disk and nothing enters the session context, since hook stdout goes to the debug log)
- unseeded (SHIPPED): no context window (the hook is a shell process that receives the executed command and its result as JSON on stdin); the audit trail flows outward to a log file on disk, and nothing returns to Claude's context from a logging hook that exits 0 quietly
- evidence: `hooks.md`: "Command hooks receive JSON data via stdin and communicate results through exit codes, stdout, and stderr."

### S058.context_boundary
- seeded (superseded): harness (the gate runs as a separate hook process before each Bash call, outside any context window, with the command arriving as JSON on stdin; the one approved invocation proceeds normally and only a deny reason crosses into the session context so Claude sees why a call was refused)
- unseeded (SHIPPED): no context window (the script runs as a shell process before each Bash tool call reaches execution); on a deny decision the reason crosses into the main conversation and is shown to Claude, while on an allow decision the reason is shown to the user but not Claude and the call simply proceeds
- evidence: `hooks.md`: "For `"allow"` and `"ask"`, shown to the user but not Claude. For `"deny"`, shown to Claude"

### S059.context_boundary
- seeded (superseded): OS boundary below the harness (Seatbelt or bubblewrap enforce the sandbox on the Bash command and every child process at the operating-system level; no context window is involved anywhere, so the block holds even if a prompt injection bypasses Claude's decision-making, and nothing enters the session context)
- unseeded (SHIPPED): no context window (the boundary is an OS-level sandbox enforced at command execution time, blocking all processes rather than just Claude's own tools); the protected credential contents never reach any context, and the boundary holds even when a prompt injection has already steered Claude's decisions
- evidence: `permissions.md`: "Sandbox restrictions prevent Bash commands from reaching resources outside defined boundaries, even if a prompt injection bypasses Claude's "

### S060.context_boundary
- seeded (superseded): harness (the lock is applied when customization sources load; blocked user- and project-source skills, agents, hooks, and MCP servers are never loaded at all, so neither their descriptions nor their tool definitions ever enter any context window, while permitted plugin and managed components enter context per their own rules)
- unseeded (SHIPPED): no context window (a load-time gate the harness reads from managed settings); skills, agents, hooks, and MCP servers from user and project sources are blocked from loading at all, so nothing from those sources ever reaches any session or its context
- evidence: `permissions.md`: "Block skills, agents, hooks, and MCP servers from user and project sources, so they can only come from plugins or managed settings."

