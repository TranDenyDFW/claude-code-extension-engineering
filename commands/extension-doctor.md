---
description: Diagnose silent failures in this machine's Claude Code extension config (dead skills, hooks that never fire, scope shadowing), with evidence-cited findings
---

Run the extension doctor against this machine's real configuration and walk the findings
with the user.

## Step 1: run it

```
node "${CLAUDE_PLUGIN_ROOT}/tools/extension-doctor.mjs" --json
```

The tool is read-only. It walks the managed policy file, `~/.claude`, and the current
project's `.claude/`, runs the cross-scope checks nothing else covers, and, if the `agnix`
linter is installed on PATH, ingests its per-file findings too (`--no-delegate` skips that).

## Step 2: report findings in severity order

For each finding, present: the file, what is wrong, WHY it matters (the `citation` field
names the reference section and evidence tag behind the check), and the concrete fix.

- **BROKEN** means the component can never work as configured: an unparseable SKILL.md
  loads with empty metadata and stops auto-triggering; a hook under a misspelled event
  never fires; an unresolvable subagent tools list refuses to spawn (v2.1.208+).
- **SILENT** means it runs but a documented silent-failure condition is present: a missing
  hook handler fails open, `disableAllHooks` is switching everything off, a name collision
  is being resolved by shadowing.
- **INFO** is worth knowing: a settings key shadowed across scopes, a pinned plugin
  version blocking marketplace updates.

Do not soften BROKEN findings. The motivating case is real: the skill this plugin ships
was itself dead for weeks with an unparseable description, invisible to every built-in
diagnostic, and the calibration run of this tool found the same defect class live in two
more skills on the machine it was built on.

## Step 3: offer fixes one at a time

For each finding the user wants fixed, make the minimal edit (quote the YAML value, fix
the event name, correct the path), then re-run the doctor to confirm the finding is gone.
Never batch-edit config files without showing each diff first.

If there are zero findings, say so plainly and stop; do not invent advisories.
