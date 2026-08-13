# P1

## Requirement

Prevent any change to a file under `infra/`. The protection must still hold if the guard script is deleted or crashes.

## Mechanism chosen

**permission-deny**

Nearest rejected alternative: A PreToolUse hook. It fails OPEN when its handler is missing or crashes, and its matcher covers only the tools you name, so a Bash command that writes the same path is never seen by it.

- The deny rule is harness-owned, so it holds when the handler is deleted, and it reaches the Bash file commands Claude Code recognises as well as the built-in file tools.
- The requirement names the failure mode explicitly, which the deny rule satisfies by construction rather than by convention.
- The requirement uses ABSOLUTE language, so the spec is marked strict: any residual vector makes the run report NOT DONE. The strongest available configuration is still emitted, together with a sandbox proposal for the one layer that would close the gap.

## What this does NOT cover

- **V3 arbitrary subprocess.** permissions.md: Read and Edit deny rules "don't apply to arbitrary subprocesses that read or write files indirectly, like a Python or Node script that opens files itself". Measured on this machine, paired against a control with the rule removed. OS-level sandboxing is the layer that closes this, and it does not run on native Windows.

That gap is not a footnote here, it is case C7 in the spec below, asserted as NOT covered. If the product ever closes it, or if someone widens this bundle to cover it, the case goes red and this README has to be rewritten. A disclosure that cannot fail is not a disclosure.

## Proving it

This bundle ships its own acceptance test. Run:

```
node tools/extension-prove.mjs --bundle <this directory>
```

7 cases: 2 enforce, 2 near-miss, 1 residual, 1 tamper, 1 wiring.

## This requirement is ABSOLUTE, and this bundle does not fully satisfy it

The requirement uses absolute language, so the spec carries `strict: true` and the run
reports **NOT DONE** while any residual survives. That is not a bug in the bundle: it is
the strongest configuration available on this platform, plus an honest statement that the
strongest available is not the same as total.

See `sandbox-managed-settings.json.proposal` for the one layer that would close the gap.
It is deliberately non-loadable. Adopting it is an administrator decision on a platform
where the sandbox actually runs, and it is not one this tool will make for you.
