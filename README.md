# claude-code-extension-engineering

![freshness](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FTranDenyDFW%2Fclaude-code-extension-engineering%2Fmain%2Fevidence%2Fstatus.json)

Decide which Claude Code extension mechanism should own a behaviour before you build it,
find out which of your existing extensions are silently broken right now, and prove the one
you build actually does what you asked for.

## Install

```bash
git clone https://github.com/TranDenyDFW/claude-code-extension-engineering.git
claude --plugin-dir ./claude-code-extension-engineering
```

Or as a plain skill, no plugin wrapper:

```bash
cp -r claude-code-extension-engineering/skills/claude-code-extension-engineering ~/.claude/skills/
```

Use `.claude/skills/` to scope it to one project; the directory name must stay
`claude-code-extension-engineering`. Marketplace listing is pending review; once approved,
`/plugin install claude-code-extension-engineering@claude-community`. Cowork and cloud
sessions do not read `~/.claude/skills`, see
[compatibility.md](skills/claude-code-extension-engineering/references/compatibility.md).

## What you get

- **`/extension-doctor`** walks managed policy, `~/.claude` and your project's `.claude/`,
  and reports what can never fire and why. Read-only, zero dependencies, every finding cites
  the reference section behind it.
- **`extension-prove`** asserts an expected OUTCOME for a bundle and evaluates the wiring.
  Every shipped checker asks whether an extension is well-FORMED; none asks whether it
  behaves as specified.
- **`extension-scaffold`** turns a requirement into a bundle plus a `conformance.json` that
  `extension-prove` can fail, and refuses to report done while any case is red. Two purpose
  packs: `protect-path` reads a path out of prose, `validate-before-action` generates a
  PreToolUse command validator from an explicit policy file. Anything else is refused rather
  than force-fitted.
- **The reference**, twelve authored mechanisms across seven layers plus the enforcement
  layer you configure rather than author. Every claim evidence-tagged, version-gated, and
  backed by a machine-checked provenance ledger.

## Try it

Check your own setup for extensions that will never fire:

```bash
node tools/extension-doctor.mjs
```

Generate a protection and prove it, in one command:

```bash
node tools/extension-scaffold.mjs \
  --requirement "Prevent any change to a file under infra/. The protection must still hold if the guard script is deleted or crashes." \
  --out ./my-guard
```

It picks `permission-deny` over a hook (a command hook fails open, and its matcher cannot see
a Bash command), emits the bundle with its own acceptance test, runs it, and then tells you
what it does NOT cover:

```
PASS  [enforce]   C1      PASS  [tamper]   C6
PASS  [near-miss] C2      PASS  [residual] C7
...
NOT DONE: the requirement is ABSOLUTE and a residual vector survives.
  C7  V3 arbitrary subprocess  is confirmed NOT covered
```

Every case passed and the run still says NOT DONE. That is the point: a passing `residual`
case is a measured statement that the vector is open, and "prevent ANY change" rules it out.

Generate a command validator from a policy instead:

```bash
node tools/extension-scaffold.mjs \
  --policy examples/policies/prod-deploy-gate.json \
  --out ./my-validator
```

The policy is explicit, versioned data, not prose: command grammars, prerequisite programs
and timeouts are never inferred. An unknown key, an unanchored pattern, a check with no
timeout, two rules that contradict each other, or a policy where nothing can ever deny is
REFUSED and nothing is generated. `--list-packs` shows what each pack needs.

Prove an existing bundle instead:

```bash
node tools/extension-prove.mjs --bundle <dir>
```

Exit 0 all cases passed, 1 a case failed, 3 the mechanism is not one this tool can prove.

## Five things this catches

1. **The Windows hook variable trap.** A bare `$CLAUDE_PROJECT_DIR` parses as an undefined
   PowerShell variable and resolves to `$null`, so the hook silently does nothing. And
   `claude --debug` prints nothing to the terminal; the evidence is in
   `~/.claude/debug/SESSION-ID.txt`.
2. **The plugin version cache trap.** A pinned `"version"` in plugin.json means pushed commits
   never reach installed users until the string changes.
3. **The manifest path replacement trap.** A custom path field REPLACES the default folder for
   that component type instead of adding to it. `skills` is the one exception.
4. **The rule that is accepted and never consulted.** `Write(infra/**)` as a deny rule is
   inert. It has to be `Edit(infra/**)`, and the narrower-looking spelling is the one that
   covers less.
5. **Workflow versus team.** Dynamic Workflows are stable and deterministic. Agent Teams are
   experimental, env-gated, one per session, and cost multiplies per teammate. Most "team"
   instincts are wrong.

## Where to look

Everything under `skills/claude-code-extension-engineering/`. Start at
[SKILL.md](skills/claude-code-extension-engineering/SKILL.md), or go straight to
[selection.md](skills/claude-code-extension-engineering/references/selection.md) if you are
choosing between mechanisms.

| Need | Open |
|---|---|
| Choosing between mechanisms | [selection.md](skills/claude-code-extension-engineering/references/selection.md) |
| Combining mechanisms | [composition-cards.md](skills/claude-code-extension-engineering/references/composition-cards.md) |
| Hooks | [hooks.md](skills/claude-code-extension-engineering/references/hooks.md) |
| Hook event contracts | [hook-events.md](skills/claude-code-extension-engineering/references/hook-events.md) |
| Permission rules: allow, ask, deny | [permissions.md](skills/claude-code-extension-engineering/references/permissions.md) |
| OS sandboxing (absent on native Windows) | [sandboxing.md](skills/claude-code-extension-engineering/references/sandboxing.md) |
| Skills | [skills.md](skills/claude-code-extension-engineering/references/skills.md) |
| Subagents | [subagents.md](skills/claude-code-extension-engineering/references/subagents.md) |
| Dynamic Workflows | [workflows.md](skills/claude-code-extension-engineering/references/workflows.md) |
| MCP servers | [mcp.md](skills/claude-code-extension-engineering/references/mcp.md) |
| Plugins | [plugins.md](skills/claude-code-extension-engineering/references/plugins.md) |
| Compatibility and version gates | [compatibility.md](skills/claude-code-extension-engineering/references/compatibility.md) |
| Everything else | [SKILL.md](skills/claude-code-extension-engineering/SKILL.md) router table |

## Digging deeper

- **[docs/RESULTS.md](docs/RESULTS.md)** - every measured number this project publishes,
  including the ones that did not flatter it. A pre-committed benchmark that returned NEGATIVE
  and shipped nothing, and a deny-rule bypass measured across 200 paired live sessions.
- **[IMPROVEMENTS.md](IMPROVEMENTS.md)** - known gaps, including the ones found in this
  project's own tooling.
- **[evidence/](evidence/)** - claims ledger, source ledger with retrieval dates, and
  reproduction commands for measured behaviours.

Evidence tags: untagged is official documentation, `[ANTHROPIC]` a recommendation,
`[ENGINEERING]` judgment, `[COMMUNITY]` community practice, `[vX.Y.Z]` the build a behaviour
was verified against, `[EXPERIMENTAL]` not stable. The verified build is in
[evidence/VERIFIED_VERSION](evidence/VERIFIED_VERSION); the badge above says whether Claude
Code has moved past it.

## Licence

MIT. See [LICENSE](LICENSE). Third-party licences worth naming: Superpowers writing-skills
(MIT, Jesse Vincent) and the Anthropic Skill Creator (Apache-2.0). The prose here is original
work derived from public documentation and direct observation; no upstream proprietary text is
redistributed verbatim in bulk. Source ledger:
[sources.md](skills/claude-code-extension-engineering/references/sources.md).
