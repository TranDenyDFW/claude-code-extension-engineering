# Sandboxing

> Claude Code 2.1.224, verified 2026-08-07. Sources fetched live that day; the sandbox itself could NOT be exercised here, because this machine is native Windows and the sandbox does not run there. Every line below is documentation, tagged accordingly, and nothing in this file is a local observation.


OS-level enforcement for Bash commands and their child processes. It is the only layer in Claude Code that a process cannot talk its way past: the operating system, not the model and not the harness, holds the boundary. It is also the narrowest layer, because it sees Bash and nothing else.

**Layer:** Enforcement | **Classification:** configuration | **Status:** stable | **Since:** v2.1.219 for `strictAllowlist`; the sandbox itself predates it

## It does not run on Windows. Read this before anything else.

Put first because everything downstream is conditional on it, and because a reader on Windows who
meets this fact in a footnote has already written a plan around a layer they do not have.

- "The sandbox is built into Claude Code and runs on macOS, Linux, and WSL2. Native Windows is not supported. On Windows, run Claude Code inside a WSL2 distribution." [OFFICIAL]  [v2.1.220]
- The practical consequence is not "less isolation on Windows", it is NONE. A Windows developer configuring a path protection has exactly two layers available, a permission deny rule and a command hook, and both are described in [permissions.md](permissions.md) and [hooks.md](hooks.md) as leaking at the subprocess boundary. On that platform the subprocess vector has no answer  [ENGINEERING]
- WSL2 counts as supported, so "run Claude Code inside WSL2" is a real migration and not a shrug. It changes the whole session, not one setting: paths, line endings, the toolchain, and which binaries are reachable  [ENGINEERING]
- On WSL2 the sandbox blocks the Windows-interop path: "sandboxed commands cannot launch Windows binaries such as `cmd.exe`, `powershell.exe`, or anything under `/mnt/c/`", because "WSL hands these off to the Windows host over a Unix socket, which the sandbox blocks". A command that needs one has to be listed in `excludedCommands`, which runs it OUTSIDE the sandbox [OFFICIAL]  [v2.1.220]

## It covers Bash and its children, and NOTHING else

The second fact people get wrong, and the reason this is a complement to the permission layer
rather than a replacement for it.

- "Sandboxing provides OS-level enforcement that restricts what Bash commands can access at the filesystem and network level. It applies only to Bash commands and their child processes." [OFFICIAL]  [v2.1.220]
- So the sandbox does NOT cover Claude's own built-in file tools. A `Write` or `Edit` call is not a Bash command and never enters the sandbox; the layer that governs those is a permission rule. The two coverage sets are complementary and neither contains the other  [ENGINEERING]
- Enforcement is at the OS level and therefore survives the thing a hook cannot: "These paths are enforced at the OS level, so all commands running inside the sandbox, including their child processes, respect them." That child-process clause is precisely the vector a deny rule cannot reach [OFFICIAL]  [v2.1.220]
- Read the two coverage sets together before choosing. A deny rule reaches the built-in file tools and a documented-by-example subset of Bash; the sandbox reaches all of Bash including children and none of the built-in tools. Configuring only one leaves a hole the other closes, which is why [selection.md](selection.md) routes on coverage set rather than on strength  [ENGINEERING]

## Deny rules keep working inside it, so this is additive

- "Explicit deny rules are always respected." A deny rule does not stop being enforced because the sandbox is on, and the sandbox does not stop being enforced because a deny rule exists [OFFICIAL]  [v2.1.220]
- This kills the plausible-sounding check "auto-allow is on and a deny rule exists, therefore the deny rule is being bypassed". Its premise is false, and a linter that emits it is crying wolf. It was proposed for this project's doctor and rejected on exactly this sentence  [ENGINEERING]
- `autoAllowBashIfSandboxed` "still defaults to `true`, so sandboxed commands keep running without prompts. Set it to `false` to prompt for sandboxed commands." Auto-allow is the DEFAULT once sandboxed, so turning the sandbox on quietly reduces the number of prompts you see [OFFICIAL]  [v2.1.220]

## The escape hatch, which is on by default

- When a command fails because of sandbox restrictions, "Claude analyzes the failure and may retry the command with the `dangerouslyDisableSandbox` parameter. The retried command runs outside the sandbox, so it goes through the regular permission flow" [OFFICIAL]  [v2.1.220]
- The retry is not an unchecked bypass: in default mode it prompts, and in auto mode "the classifier evaluates the underlying command instead of prompting you". To be prompted every time even in auto mode, "add an ask rule for `Bash(dangerouslyDisableSandbox:true)`" [OFFICIAL]  [v2.1.220]
- Setting `"allowUnsandboxedCommands": false` disables the hatch entirely, shown in the `/sandbox` panel as Strict sandbox mode: "the `dangerouslyDisableSandbox` parameter is completely ignored and all commands must run sandboxed or be explicitly listed in `excludedCommands`" [OFFICIAL]  [v2.1.220]
- If your requirement contains "cannot be bypassed", the default configuration does not satisfy it and `allowUnsandboxedCommands: false` is not optional  [ENGINEERING]

## failIfUnavailable turns an unsupported platform into a startup failure

This is the key that decides whether a sandbox config is a protection or an outage, and the
distinction is scope.

- "By default, if the sandbox cannot start because dependencies are missing or the platform is unsupported, Claude Code shows a warning and runs commands without sandboxing. To make this a hard failure instead, set `sandbox.failIfUnavailable` to `true`. This is intended for managed deployments that require sandboxing as a security gate." [OFFICIAL]  [v2.1.220]
- Read that together with the Windows line. "The platform is unsupported" INCLUDES native Windows, so `failIfUnavailable: true` reaching a Windows developer means Claude Code refuses to start for them. In managed-policy scope that is the deliberate, documented intent of the key: a security gate that fails closed  [ENGINEERING]
- The documented delivery scope for the enforce configuration is managed settings: "To require the sandbox for every developer, deliver the `sandbox` keys through managed settings, either as a file managed by your MDM or through server-managed settings on Claude.ai" [OFFICIAL]  [v2.1.220]
- Whether `failIfUnavailable` is honoured from a repository's own `.claude/settings.json` is NOT documented either way. `sandbox.filesystem` is explicitly restricted ("User settings, managed settings, and the `--settings` CLI flag can set it. Project settings in `.claude/settings.json` and `.claude/settings.local.json` can't"), and no equivalent sentence exists for `failIfUnavailable`. The docs restrict one key explicitly and are silent on the neighbouring one, which is a difference worth noticing rather than smoothing over: do not read the filesystem restriction as covering it  [ENGINEERING]
- Both possible answers are bad in a checked-in project file, which is why this project's scaffold refuses to emit one. If project scope IS honoured, every Windows developer who clones the repo is blocked from starting Claude Code, and a path protection has become a team-wide outage. If it is NOT honoured, the keys sit in version control looking like enforcement and enforcing nothing. `extension-scaffold` therefore emits `sandbox-managed-settings.json.proposal`, whose suffix makes it unloadable, so the answer is written down without being silently adopted  [ENGINEERING]

## Scope restrictions worth knowing before you write a settings file

- `sandbox.filesystem` cannot be set from project or local settings, "so a checked-out project can't switch filesystem isolation off" [OFFICIAL]  [v2.1.220]
- When managed settings configure `sandbox.filesystem` at all, "only managed settings can set the key", which is how an administrator deployment stays in force [OFFICIAL]  [v2.1.220]
- `strictAllowlist` works only "in user, managed, or CLI `--settings` settings"; "Setting it in a repository's `.claude/settings.json` or `.claude/settings.local.json` has no effect" [OFFICIAL]  [v2.1.219]
- `mask` credential entries, `network.tlsTerminate` and `credentials.allowPlaintextInject` "are all ignored in a repository's `.claude/settings.json` or `.claude/settings.local.json`" [OFFICIAL]  [v2.1.220]
- The pattern across all four: the keys that WIDEN access, or that an administrator is expected to pin, are unavailable to a checked-in project file. Assume any sandbox key you write into a repo may be inert, and verify the specific key rather than the section  [ENGINEERING]

## Turning filesystem isolation off is an escalation risk, stated by the docs

- "With filesystem isolation off and commands auto-allowed, a sandboxed command can write files that later commands run or read, such as shell startup files, executables on `$PATH`, or `~/.claude/settings.json`, and use them to widen its own access on the next run." [OFFICIAL]  [v2.1.220]
- Network locking narrows but does not remove this: `allowManagedDomainsOnly` "narrows the risk but doesn't remove it, since that lock applies only to commands running inside the sandbox" [OFFICIAL]  [v2.1.220]

## Detail

- This file is DOCUMENTATION ONLY, and that is a deliberate limit rather than an oversight. The repo's rule is that a claim tagged as measured must have a reproduction on this machine; the sandbox does not run on native Windows, so no line here can earn that tag. A future pass on macOS, Linux or WSL2 is what would upgrade it  [ENGINEERING]
- Related: [permissions.md](permissions.md) for the layer that DOES cover the built-in file tools, [selection.md](selection.md) for routing between them, [composition-cards.md](composition-cards.md) for the four-way comparison card.
