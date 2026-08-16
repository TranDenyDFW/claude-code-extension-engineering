# Security policy

## Reporting a vulnerability

Report privately through GitHub's advisory form:
<https://github.com/TranDenyDFW/claude-code-extension-engineering/security/advisories/new>

Do not open a public issue for anything that could be exploited before a fix exists. There
is one maintainer, so expect an acknowledgement within a few days rather than within hours.

## What this repository is, for threat-modelling purposes

It is not a runtime library that ships inside your application. It is a reference,
a diagnostic (`tools/extension-doctor.mjs`), a behavioural prover
(`tools/extension-prove.mjs`) and a generator (`tools/extension-scaffold.mjs`) that emits
Claude Code extension bundles, including enforcement code such as PreToolUse validators.

The consequence worth stating plainly: **it generates and evaluates security-shaped rules.**
A defect here does not crash a service, it produces a hook or permission rule that looks
like it enforces something and does not. That failure mode is silent by construction, which
is why the project keeps must-fail proofs on its own gates rather than only tests that pass.

## Trust boundaries you are accepting

**Policy files are executable-trust inputs, not passive configuration.**
`tools/packs/validate-before-action.mjs` runs programmes named by a policy via `spawnSync`
with `shell: false` and an argument array, so there is no shell-injection surface. But the
programme name comes from the policy. Treat a policy file the way you would treat a script
someone asked you to run, not the way you would treat a formatter config.
`tools/packs/policy-schema.mjs` narrows this deliberately: unknown keys are refused, `..`
project escape is rejected, regex constraints must be anchored, and a programme without a
timeout is invalid.

**Generated bundles are yours to review.** `extension-scaffold` writes a bundle plus a
falsifiable `conformance.json`; `extension-prove` then tests the bundle against it. A green
prove run means the bundle satisfied the cases in that file. It does not mean the cases
describe everything you cared about.

**The diagnostic reads your real configuration.** `extension-doctor` inspects managed, user
and project scope. It is read-only apart from temporary self-test fixtures. It prints
findings, which can include paths and setting names from your machine, so redact before
pasting output into a public issue.

**Live benchmarking is not sandboxed by `CLAUDE_CONFIG_DIR`.** That variable redirects where
Claude Code loads configuration; it does not confine the Read tool. This was found the hard
way here: a benchmark session read the host's real configuration file. If you run live
sessions against this repository's harnesses, use an ephemeral VM or a throwaway user with
no mounted home, no cloud credentials and no tokens.

## Supported versions

Guidance in `skills/cc-ext-*/references/` is dated and pinned to a
Claude Code build recorded in `evidence/VERIFIED_VERSION`. Only the current default branch is
supported. If `evidence/status.json` reports `stale`, the reference material has not been
re-verified against the latest release, and version-sensitive advice in it may be wrong.
That state is published rather than hidden; check it before relying on a claim.

## What is not a vulnerability here

- The freshness bot opening an issue per upstream release. That is noisy by design.
- `extension-doctor` reporting `UNVERIFIED` for names absent from the capability catalogue.
  Refusing to judge is the intended behaviour, not a gap.
- `extension-prove` exiting 3 on a mechanism it cannot model. Same reason.
