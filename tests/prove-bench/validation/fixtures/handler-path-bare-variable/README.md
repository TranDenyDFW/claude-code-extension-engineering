# release-guard

Blocks Bash commands that violate policy `release-guard`, before they run.

## Install

```bash
cp -r .claude "$YOUR_PROJECT/"
```

Then merge `settings.json` into `$YOUR_PROJECT/.claude/settings.json` and restart Claude Code.

## Verify

```bash
node tools/extension-prove.mjs <this-directory>
```

17 behavioural cases. They assert what this hook DOES, including what it does not do.

## What it blocks

| rule | family | decision | when |
|---|---|---|---|
| `no-rm-rf` | dangerous-operation | deny | rm, flags -rf |
| `tests-before-push` | required-check | deny | git, args `^push.*$` |
| `manifest-valid` | schema-validation | deny | deploy, args `^apply .*$` |

Rules are evaluated in declared order, first match wins. Nothing matched: **allow**.

## What it does NOT do

- **`allow` is not auto-approve.** A rule that decides `allow` makes this hook emit nothing, so your normal
  permission prompts still happen. Only `deny` produces a decision.
- **A command hook fails open.** Delete the handler, break node, or exceed the hook timeout and nothing blocks.
  `deleted-handler-fails-open` proves it.
- **The matcher is not a shell.** It splits on `&&`, `||`, `;`, `|` and `&`, so `cd x && rm -rf y` IS seen.
  It cannot resolve `$VAR`, read inside `$( )` or backticks, or follow `sh -c`, `eval` or `xargs`.
  This policy is not `absolute`, so those are NOT inspected. `indirection-is-not-inspected` asserts that gap.
- **The schema language is not JSON Schema** and is not called that. It supports `required`, `properties`
  with a primitive `type` and optional `enum`, and `additionalProperties`. Any other keyword was refused at
  generation time rather than ignored, so nothing here is silently unenforced.
- the policy is not absolute, so a command hiding behind $( ), eval, sh -c or an unexpanded variable is NOT inspected. A residual case asserts that gap rather than a README sentence.
