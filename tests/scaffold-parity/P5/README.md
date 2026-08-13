# P5

## Requirement

It would be good to protect `infra/` from accidental edits.

## Mechanism chosen

**advisory**

Nearest rejected alternative: A hook or deny rule, which would be heavier than the requirement asks for.

- No guarantee language found, so an advisory instruction is legitimate here.

## What this does NOT cover

- **V0 model-owned advisory.** CLAUDE.md prose is model-owned. Nothing in this bundle refuses the write, and that is the correct outcome for a requirement with no guarantee language.

That gap is not a footnote here, it is case C1 in the spec below, asserted as NOT covered. If the product ever closes it, or if someone widens this bundle to cover it, the case goes red and this README has to be rewritten. A disclosure that cannot fail is not a disclosure.

## Proving it

This bundle ships its own acceptance test. Run:

```
node tools/extension-prove.mjs --bundle <this directory>
```

2 cases: 1 near-miss, 1 residual.
