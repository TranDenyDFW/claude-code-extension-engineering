# P4

## Requirement

Block writes to `infra/` so people do not edit it casually.

## Mechanism chosen

**permission-deny**

Nearest rejected alternative: A PreToolUse hook. It fails OPEN when its handler is missing or crashes, and its matcher covers only the tools you name, so a Bash command that writes the same path is never seen by it.

- The deny rule is harness-owned, so it holds when the handler is deleted, and it reaches the Bash file commands Claude Code recognises as well as the built-in file tools.

## What this does NOT cover

- **V3 arbitrary subprocess.** permissions.md: Read and Edit deny rules "don't apply to arbitrary subprocesses that read or write files indirectly, like a Python or Node script that opens files itself". Measured on this machine, paired against a control with the rule removed. OS-level sandboxing is the layer that closes this, and it does not run on native Windows.

That gap is not a footnote here, it is case C6 in the spec below, asserted as NOT covered. If the product ever closes it, or if someone widens this bundle to cover it, the case goes red and this README has to be rewritten. A disclosure that cannot fail is not a disclosure.

## Proving it

This bundle ships its own acceptance test. Run:

```
node tools/extension-prove.mjs --bundle <this directory>
```

6 cases: 2 enforce, 2 near-miss, 1 residual, 1 wiring.
