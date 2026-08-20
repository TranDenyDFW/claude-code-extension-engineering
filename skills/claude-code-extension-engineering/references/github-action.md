# Claude Code GitHub Action

> Claude Code 2.1.233. What that means here: this file carries ONE verbatim quote and
> `tools/quote-check.mjs` confirms it still appears upstream. Per-claim provenance lives in
> `evidence/claims.jsonl`, where the gates read it; nothing else is asserted here.


Authored CI workflow YAML that runs Claude Code in GitHub Actions, built on the Agent SDK. The one genuinely authorable mechanism in the CI tier.

**Layer:** Programmatic tier | **Classification:** sdk | **Status:** stable

## What it is

- claude-code-action is user-authored GitHub Actions workflow YAML that runs Claude Code in CI and is built on top of the Agent SDK.  [v2.1.219]
- Because it runs in CI, secrets are repository secrets and the permission model is the workflow's, not your local settings. Never assume local permission rules apply.  [ENGINEERING]

## Setting it up

- `/install-github-app` is the quick path: it installs the Claude GitHub App, writes the credential as a repository secret, and pushes a branch of workflow files already wired to that secret, then opens a pull request you merge to activate `@claude`. It needs admin access to the repository and the GitHub CLI authenticated with `gh auth login`, which it checks for and warns about [OFFICIAL]
- The secret it writes is named `ANTHROPIC_API_KEY` for an API key or `CLAUDE_CODE_OAUTH_TOKEN` for a subscription token, so a workflow referencing the wrong one fails on a credential that is present under the other name [OFFICIAL]
- From v2.1.187 the Actions half is OPTIONAL: choosing Skip for now installs only the App, and re-running the command later finishes the workflow and secret steps. Before that build the command went straight on to workflow selection, so the same command is a different length of commitment either side of the boundary [OFFICIAL]  [v2.1.187]
- The manual path, installing the App and copying the workflow file yourself, is the documented choice when you do not run Claude Code locally or the command fails, not merely a purist alternative [OFFICIAL]

## Configuring the run

- MCP servers reach the Action through the `claude_args` string as the ordinary CLI flag, `claude_args: "--mcp-config /path/to/config.json"`. `claude_args` is also where `--max-turns`, `--model`, `--allowedTools` and `--debug` go [OFFICIAL]
- No MCP-specific action input appears in the documented input table, so `claude_args` is the route to reach for. Stop short of concluding none exists: the table is explicitly only the most commonly used inputs and points at the action repository for the full list, which is not mirrored here  [ENGINEERING]
- NEVER execute PR-authored code in a privileged workflow. This is the single most consequential hazard for this mechanism and the page documenting the action does not name it: a workflow holding repository secrets that checks out and runs code supplied by a pull request author has handed those secrets to whoever opened the pull request. It applies with extra force here, because the action's whole purpose is to let a model read and act on PR content, which is attacker-controlled text by construction  [ENGINEERING]
