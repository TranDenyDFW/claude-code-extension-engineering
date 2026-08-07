# Claude Code GitHub Action

> Claude Code 2.1.224, verified 2026-08-07. Re-verified MECHANICALLY against a refreshed docs mirror: every verbatim quote in this file still appears upstream (tools/quote-check.mjs), and the capability surface is unchanged at 51 tools and 31 hook events. 101 of 186 mirrored pages changed since 2.1.220 and were NOT all re-read, so this is a quote-and-capability check, not a full re-reading.


Authored CI workflow YAML that runs Claude Code in GitHub Actions, built on the Agent SDK. The one genuinely authorable mechanism in the CI tier.

**Layer:** Programmatic tier | **Classification:** sdk | **Status:** stable

## What it is

- claude-code-action is user-authored GitHub Actions workflow YAML that runs Claude Code in CI and is built on top of the Agent SDK.  [v2.1.219]
- Because it runs in CI, secrets are repository secrets and the permission model is the workflow's, not your local settings. Never assume local permission rules apply.  [ENGINEERING]
