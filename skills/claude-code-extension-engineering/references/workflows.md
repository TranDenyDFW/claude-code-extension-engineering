# Dynamic Workflows

> Claude Code 2.1.229, verified 2026-08-13. What that means here: this file carries NO verbatim quotes, so the quote gate says nothing about it; the capability surface moved to 44 current tools and held at 31 current hook events. 129 of 190 mirrored pages changed since 2.1.224 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading.


An orchestration script saved to .claude/workflows/ and invoked as /<name>. A background runtime executes it to fan out subagents at scale, so the plan, the loop and the intermediate results stay in script variables and only the final answer returns to the caller's context. Write one when the CONTROL FLOW itself must be deterministic.

**Layer:** Orchestration | **Classification:** primitive | **Status:** stable | **Since:** v2.1.154

## Where it lives and how it ships

- Saving the script to .claude/workflows/ is what turns it into a reusable /<name> command. A workflow that is only authored in-session is not distributable and disappears with the session; the on-disk copy is the artifact.  [v2.1.154]
- Ship one to a team as a plugin component: a workflows/ directory at the plugin root, or the workflows field in plugin.json. It is then namespaced as /<plugin>:<name>.  [v2.1.154]
- The workflowSizeGuideline settings key sets the default size guideline from any settings file, and it is also reachable from /config as 'Dynamic workflow size'. The shipped default aims for fewer than 15 agents per run.  [ANTHROPIC] [v2.1.154]

## Choosing this over a subagent or a team

- Choose a workflow when the CONTROL FLOW must be deterministic: loops, conditionals and fan-out expressed in script rather than left to model judgment. Choose a subagent for one bounded delegated job. Choose Agent Teams only when peers must talk to each other, and note it is experimental and env-gated while workflows have been stable since 2.1.154.  [ENGINEERING]  [v2.1.154]

## Authoring API

The script body runs in an async context, so `await` works directly. Standard JS
built-ins are available.

| Call | What it does |
|---|---|
| `agent(prompt, opts)` | Spawn one subagent. Returns its final text, or a validated object when `opts.schema` is a JSON Schema. Returns `null` if it is skipped or dies after retries. |
| `pipeline(items, ...stages)` | Run each item through all stages independently. NO barrier between stages. This is the default for multi-stage work. |
| `parallel(thunks)` | Run thunks concurrently and wait for all of them. A barrier. A failing thunk becomes `null`, never a rejection. |
| `phase(title)` | Start a progress group; later `agent()` calls are grouped under it. |
| `log(message)` | Emit a progress line to the user. |
| `args` | Whatever was passed in as the workflow's input, verbatim. |
| `budget` | `{total, spent(), remaining()}` for scaling work to a token target. |
| `workflow(name, args)` | Run another workflow inline. One level of nesting only. |

`agent()` options: `label`, `phase`, `schema`, `model`, `effort`, `agentType`, and
`isolation: 'worktree'` (expensive; only when agents mutate files in parallel).

Limits: 16 concurrent agents, 1000 per run, 4096 items per `pipeline()` or `parallel()` call.

`args` is whatever the caller passed in, verbatim. Pass arrays and objects as real JSON values,
never a JSON-encoded string: `args: ["a.ts", "b.ts"]`, not `args: "[\"a.ts\", ...]"`. A stringified
list arrives as one string and `args.map` throws.

**There is no filesystem API inside a workflow.** The runtime surface is the call table above and
nothing else, so a script cannot enumerate files itself. Build the list OUTSIDE (glob it, then pass
it in as `args`) or have a first-stage `agent()` return it.

`schema` takes a plain JSON Schema object, defined in the script:

```js
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'verdict'],
  properties: {
    file: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    notes: { type: 'string' },
  },
}
```

Save as `.claude/workflows/<name>.js`:

```js
export const meta = {
  name: 'per-file-analysis',
  description: 'Same analysis across N files, collected',
  phases: [{ title: 'Analyze' }],
}
const results = await pipeline(
  args,
  f => agent(`Analyze ${f}`, { label: f, phase: 'Analyze', schema: RESULT_SCHEMA })
)
return results.filter(Boolean)
```

- Every script starts with `export const meta = {name, description, phases}`. The meta object must be a PURE LITERAL: no variables, function calls, spreads or template interpolation, or the script will not parse.  [ANTHROPIC] [v2.1.219]
- Scripts are plain JavaScript, NOT TypeScript: type annotations, interfaces and generics fail to parse. Date.now(), Math.random() and argless new Date() all throw, because they would break resume; pass timestamps in through args instead.  [ANTHROPIC] [v2.1.219]
- Prefer pipeline() to parallel(). pipeline() runs each item through every stage independently with no barrier, so wall-clock equals the slowest single chain. parallel() is a BARRIER that waits for all thunks, and is only correct when a stage genuinely needs cross-item context from all of the previous stage. A thunk that throws resolves to null rather than rejecting, so filter(Boolean) before use.  [ANTHROPIC] [v2.1.219]

## Known ambiguity

- UNRESOLVED: whether /<name> comes from the filename or from meta.name is not stated in any current source. Keep the filename and meta.name identical so the distinction cannot bite you. With nested .claude/ directories the workflow closest to the working directory wins a collision.  [ENGINEERING] [v2.1.219]


## Failure posture

- A failing agent() resolves to null, it does NOT throw. The script continues with a hole in its results, so an unfiltered results array silently propagates that hole downstream. Filter with filter(Boolean) before use, and treat a short result set as a failure signal rather than a smaller answer  [ENGINEERING]  [v2.1.219]
- A thunk that throws inside parallel() becomes null by the same rule, so parallel() never rejects. There is no exception to catch: the only evidence of failure is the shape of the data  [ENGINEERING]  [v2.1.219]
- The workflow itself fails CLOSED at parse time: a meta object that is not a pure literal, or TypeScript syntax, stops the script from running at all rather than running partially  [ANTHROPIC]  [v2.1.219]

## Detail

- Dynamic Workflows is STABLE since v2.1.154, not experimental.  [v2.1.154]
- Claude authors the script; saving it to .claude/workflows/ turns it into a reusable /<name> command. It is also distributable as a plugin component.  [v2.1.154]
- Hard caps: 1000 subagent invocations per run and 16 concurrent.  [v2.1.154]
