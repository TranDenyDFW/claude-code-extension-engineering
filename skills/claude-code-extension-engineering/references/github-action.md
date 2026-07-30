# Claude Code GitHub Action

> Claude Code 2.1.220, verified 2026-07-29. Delta from 2.1.219: none (changelog: bug fixes and reliability improvements only).


Authored CI workflow YAML that runs Claude Code in GitHub Actions, built on the Agent SDK. The one genuinely authorable mechanism in the CI tier.

**Layer:** Programmatic tier &middot; **Classification:** sdk &middot; **Status:** stable

## What it is

- claude-code-action is user-authored GitHub Actions workflow YAML that runs Claude Code in CI and is built on top of the Agent SDK.  [v2.1.219]
- Because it runs in CI, secrets are repository secrets and the permission model is the workflow's, not your local settings. Never assume local permission rules apply.  [ENGINEERING]
