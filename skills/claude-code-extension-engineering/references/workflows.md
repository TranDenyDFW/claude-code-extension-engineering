# Dynamic Workflows

> Claude Code 2.1.229, verified 2026-08-13. What that means here: this file carries NO verbatim quotes, so the quote gate says nothing about it; the capability surface moved to 44 current tools and held at 31 current hook events. 129 of 190 mirrored pages changed since 2.1.224 and were NOT all re-read, so this is a quote-and-capability check rather than a full re-reading.


An orchestration script saved to .claude/workflows/ and invoked as /<name>. A background runtime executes it to fan out subagents at scale, so the plan, the loop and the intermediate results stay in script variables and only the final answer returns to the caller's context. Write one when the CONTROL FLOW itself must be deterministic.

**Layer:** Orchestration | **Classification:** primitive | **Status:** stable | **Since:** v2.1.154

## Read this first: a workflow you AUTHOR, not a workflow you FOLLOW

- This file is a Dynamic Workflow: a JavaScript orchestration script you write into `.claude/workflows/` and invoke as a slash command. If the question is how to use Claude Code to explore a codebase, fix a bug, refactor or run tests, that is a task recipe and it lives on the `common-workflows` page, which this library does not restate [OFFICIAL]
- The word is the only overlap. Someone asking how to work through a refactor does not want a fan-out script, and handing them one answers a question they did not ask [ENGINEERING]

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

Limits: concurrency `min(16, available CPUs - 2)`; 1000 agents per run; 4096 items per
`pipeline()` or `parallel()` call. What that concurrency figure means on a real machine is under
Detail below.

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
- Resume is the feature that ban exists to protect, so it is worth knowing it is there. A run returns a `runId`, and passing it back as `resumeFromRunId` re-runs the script with already-completed `agent()` calls returning cached results instead of re-executing [OFFICIAL]
- What survives is decided by START ORDER, not by which calls changed. An agent still running when you stopped is not saved, and cached results stop at the first agent that did not finish: every agent that STARTED after that one re-runs even if it completed. Stop a four-agent fan-out while the second is in flight and only the first replays from cache [OFFICIAL]
- That rule is the argument for fanning work across many small agents rather than a few long ones, since a long agent in flight discards everything that started after it. Resume works within the same Claude Code session; exiting Claude Code mid-run means the next session starts the workflow fresh [OFFICIAL]
- A `remote_launched` run has no `runId` at all, so `runId` is optional rather than guaranteed. Its resume handle is the cloud session URL instead, and the local resume idiom does not transfer [OFFICIAL]
- Prefer pipeline() to parallel(). pipeline() runs each item through every stage independently with no barrier, so wall-clock equals the slowest single chain. parallel() is a BARRIER that waits for all thunks, and is only correct when a stage genuinely needs cross-item context from all of the previous stage. A thunk that throws resolves to null rather than rejecting, so filter(Boolean) before use.  [ANTHROPIC] [v2.1.219]

## What a workflow trusts, which is more than it looks

A workflow reads files and tool output and puts them into agent prompts. That makes it a place
where untrusted text becomes instructions, and nothing in the API stops it.

- Anything the script reads and interpolates into a prompt is untrusted input: file contents, tool output, a previous agent's return value. Fence it and say what it is, rather than concatenating it into an instruction  [ENGINEERING]
- Treat an injection attempt as a REPORTABLE FINDING rather than something to survive quietly. A run that silently ignored an attempt and a run that never saw one look identical afterwards  [ENGINEERING]
- The plan and state files a workflow reads are a TRUST BOUNDARY. Whatever can write them steers every later phase, so they belong where the run controls them rather than where the work happens  [ENGINEERING]
- Validate every phase return before continuing. `agent()` returns `null` on failure or skip and never throws, so an unchecked return propagates a null into the next stage instead of stopping  [ENGINEERING]
- Validate argument ELEMENT types, not just the container. `args` arrives verbatim, so a stringified list is one string and `.map` throws on it  [ENGINEERING]
- Put a conditional requirement in the output SCHEMA rather than the prompt, so it is enforced at the tool-call layer and retried, instead of hoped for  [ENGINEERING BEST PRACTICE]  [ENGINEERING]
- A retry means a CHANGED approach, not the same call again: feed the error back into the next prompt. Budget exhaustion is terminal rather than a retry condition  [ENGINEERING]
- Agent-writable scratch belongs outside `.git`, and a base SHA should be recorded BEFORE dispatch rather than computed afterwards, because concurrent agents move HEAD  [ENGINEERING]
- "Outside `.git`" reads two ways, and only one of them survives a crash. A directory INSIDE the working tree holding a `.gitignore` that ignores everything satisfies both readings at once: uncommittable, and still present after the process dies. Scratch placed outside the tree entirely satisfies commit hygiene and can vanish with the run  [ENGINEERING]
- That mechanism has a documented cost worth paying deliberately: Grep respects `.gitignore` and skips ignored files, while Glob does not and finds them alongside tracked ones. So a self-ignoring scratch directory is invisible to the search tool a later phase would naturally reach for, and readable only by passing its path directly or by globbing  [OFFICIAL]

## Integration is a PHASE, not the moment the results arrive

- Collecting fan-out results is a step with its own checks. The one check per-item review cannot perform is the SET-level one: workers sharing a prompt template and a model tend to fail the SAME way, so every individual result looks fine and the set is wrong. [agent-teams.md](agent-teams.md) carries the mechanism, that agreement between agents sharing a model and a prompt is cheap and cheapest where they are most alike, and that a disagreement should be surfaced rather than silently resolved; what belongs here is that a fan-out needs a pass looking for the correlated failure, not only a pass over each finding  [ENGINEERING]
- Note the CONTENTION rather than assuming the docs agree: every documented post-fan-out check is explicitly PER ITEM, adversarially verifying each finding, verifying each result, reproducing every reported finding independently. That is the approach the set-level check says is insufficient by itself. Both are worth running and they answer different questions  [ENGINEERING]
- Bound the review-and-fix loop with a round cap that ESCALATES to the caller rather than starting another round, since the failure this catches is a loop that never converges. This CONTENDS with [testing.md](testing.md), whose generic loop deliberately ends by returning to capture-failure rather than terminating, and the two are reconciled by scope: a developer iterating on one failure wants the open loop, an unattended orchestrator spending budget per round wants the cap. Claude Code does exactly this to itself, overriding a Stop hook after a run of consecutive blocks and announcing the override  [ENGINEERING]

## Constraints, contracts and what the runtime cannot do for you

- Rules binding EVERY unit of work belong in one named place the script reads once and interpolates into every dispatch, rather than in the caller's memory. State them as script constants, not as a heading the tooling is expected to find  [ENGINEERING]
- The reason for that wording is the runtime limit already stated in the Authoring API section above: a script cannot reach the filesystem, so it CANNOT open a plan file and lift a constraints section out of it. Any version of this technique that depends on tooling parsing the plan is impossible here; the workable form passes the constants in through `args` or defines them in the script  [OFFICIAL]
- Where one agent writes JSON that a SEPARATE reader consumes with no schema between them, state the exact field names as a contract and say what a mismatch looks like, because a near-miss name yields SILENT EMPTY OUTPUT that is indistinguishable from a run which legitimately found nothing. Inside a workflow this is already handled: `schema` enforces the shape at the tool-call layer and retries  [ENGINEERING]
- Do NOT generalise that into an assumption that the harness always fails loudly on a wrong key. For its own todo surface Claude Code REPAIRS some close-but-incorrect key names before execution, mapping `id` or `task_id` to `taskId`, and the repair is not reflected in the stream, which is why the documented advice there is to read those input fields DEFENSIVELY. Exact-names-as-contract is the rule for boundaries you own; it is not what the product does at boundaries it owns  [OFFICIAL]

## Known ambiguity

- UNRESOLVED: whether /<name> comes from the filename or from meta.name is not stated in any current source. Keep the filename and meta.name identical so the distinction cannot bite you. With nested .claude/ directories the workflow closest to the working directory wins a collision.  [ENGINEERING] [v2.1.219]


## Failure posture

- A failing agent() resolves to null, it does NOT throw. The script continues with a hole in its results, so an unfiltered results array silently propagates that hole downstream. Filter with filter(Boolean) before use, and treat a short result set as a failure signal rather than a smaller answer  [ENGINEERING]  [v2.1.219]
- A thunk that throws inside parallel() becomes null by the same rule, so parallel() never rejects. There is no exception to catch: the only evidence of failure is the shape of the data  [ENGINEERING]  [v2.1.219]
- The workflow itself fails CLOSED at parse time: a meta object that is not a pure literal, or TypeScript syntax, stops the script from running at all rather than running partially  [ANTHROPIC]  [v2.1.219]

## Detail

- Dynamic Workflows is STABLE since v2.1.154, not experimental.  [v2.1.154]
- Claude authors the script; saving it to .claude/workflows/ turns it into a reusable /<name> command. It is also distributable as a plugin component.  [v2.1.154]
- Hard caps: 1000 subagent invocations per run, and concurrency capped at `min(16, available CPUs - 2)` rather than a flat 16, so on any machine under 18 cores the real ceiling is lower than the headline number and the tool text puts the practical figure at about 10. Excess calls queue rather than failing.  [v2.1.154]
