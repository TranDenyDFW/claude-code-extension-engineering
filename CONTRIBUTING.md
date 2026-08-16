# Contributing

## The one rule this repository actually enforces

**A check that cannot fail is a defect.** Not a weak test, a defect, treated the same as a
broken feature. Six rounds of independent review found green gates here that proved nothing:
a drift checker comparing an artifact against a second read of the same artifact, a frozen
measurement table compared against itself, injections that never reached the gate they
targeted, and a counter whose deletion left the gate printing "guarded by NOTHING" while
exiting 0.

So: **feed every gate a known-bad input and watch it go red before you trust a pass.** If
your change adds or modifies a check, the pull request must say which known-bad input you
fed it and what it printed when it failed. "The tests pass" is not evidence about a test.

Several tools carry that proof as a flag. `node tools/coverage-report.mjs --prove-can-fail`
spawns the gate as a process against deliberately broken sources and requires a non-zero
exit, then requires zero against the real tree. Copy that shape.

## Getting set up

Node 22 or newer, and git. There are no dependencies and there is nothing to build; the
tools are `.mjs` files run directly.

```bash
npm test
```
```bash
npm run verify
```
```bash
npm run numbers
```

`package.json` carries eight scripts for hand use. It is **not** a mirror of CI.
`.github/workflows/freshness.yml` runs about fifty commands and is the contract; read it
before assuming a change is covered.

## Claims and evidence

Reference prose is not free text. Every load-bearing claim in
`skills/claude-code-extension-engineering/references/` is tied to a source in
`evidence/sources.json` through `evidence/claims.jsonl`, and `npm run verify` checks that
the links resolve.

Two things that check does **not** do, and you have to do yourself:

- It confirms a source id resolves. It cannot confirm the cited passage supports the claim.
  Automated attribution has already picked an existing but semantically wrong citation here.
- It does not read upstream. `npm run quotes` does, for the narrower case of text quoted
  verbatim, and it found two real defects on its first run, both ours: a quoted sentence
  whose verb had been changed to fit our prose, and a quotation with words inserted.

If you quote upstream documentation, quote it exactly or do not use quotation marks.

## Numbers in prose

Counts written into documentation drift from the artifacts they describe.
`npm run numbers` re-derives live values and fails when a document disagrees. If you add a
countable fact to prose, add it to `FACTS` in `tools/coverage-report.mjs` and derive it from
the artifact that owns it. Never type the number into that file: a typed count is just a
second place to forget.

## Platform

Windows behaviour is a first-class concern in the reference material (native Windows has no
OS sandbox, WSL2 cannot launch Windows binaries from a sandboxed command, and the
deny-rule recognition measurement is Windows-specific). Say which platform you tested on.

## Pull requests

- One concern per PR, and describe what you observed rather than what you intended.
- Record negative results. This project publishes a NULL from its own architecture
  experiment and a routing measurement that came in below its preregistered floor. A change
  that did not help is information, not a failure to report.
- Commit messages here carry reasoning: which assumption was wrong, and what proved the fix.
  Match that.
- AI-assisted contributions are welcome and are marked with a `Co-Authored-By` trailer. The
  bar does not move: the same must-fail evidence is required, and arguably matters more,
  because author and assistant can share an assumption.
