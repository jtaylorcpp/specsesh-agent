## Context

`delegationActions` builds one `delegate/<name>` action per grant. Its only input is `instructions`. A process runner's `prepare` turns `{ instructions, terms, workspace }` into `{ argv, stdin, env }`, and the delegation layer then writes `${stdin}\n\n${renderTerms(terms)}` to the process. That terms block is real, and the CLAUDE.md hard line ("the instructions go only on stdin, followed by the terms block") describes the code accurately. The claude-code runner returns `stdin: instructions` unchanged. The agent runner seeds its child with `variables: { instructions }`.

The task loop already holds the whole contract as text in its durable input (`proposal`, `design`, `deltas`, `taskText`). It seeds those into each iteration's `agentscript.run` child as variables. Only the reasoning steps can read them, and `task-delegate.agent` hands its delegate `@variables.plan`.

The action registry, delegates included, is built once per harness (`taskLoopExtensions`), not once per loop. So anything per-loop has to reach a delegate through the run, not through the action.

## Goals / Non-Goals

**Goals:**
- Every delegate a task-loop iteration calls with `run` sees the change's contract and the contract rules, in fixed text a test can pin.
- The preamble is durable. A resumed run hands its delegates exactly the text it started with.
- The stdin hard line stays true, `src/durable` stays runtime-neutral, and a run outside a loop doesn't change.

**Non-Goals:**
- Changing the language, the delegate's inputs or the grant schema.
- Changing any `.agent` file.
- Delegates offered as step tools.

## Decisions

### The loop supplies the contract, not the script, the grant or the language

The contract belongs to the loop. It read the change at start, it judges against the change, and it is the one place that knows a run is "task 2.1 of change X".

- **Interpolation in `with`** would need a subset change, and every script would have to remember to do it.
- **A second script-facing input** (`context`) still leaves the bundled script to pass the right text, and it widens the delegate's fixed `{ instructions }` signature that the binding check pins.
- **A grant option** puts per-change content in a config the principal reviews once per repo, and the grant has no access to the change.

With the loop supplying it, every delegating script in a loop gets the contract with no edits, including the user's own scripts, and nothing a script writes can drop or rewrite it.

### Mechanism: a per-run `delegatePreamble`, carried in `RunInput`

- `RunInput` gains `delegatePreamble?: string`.
- The task loop's `iterate` phase sets it on the child run it creates, rendered by `taskPreamble(input)` in a new `src/task/preamble.ts`.
- The run's `act` phase adds `delegatePreamble: task.input.delegatePreamble` to the `ActionContext` it builds, for both the executed path and the durable `start` path.
- `ActionContext` gains `delegatePreamble?: string`, documented as "set only by the run that owns this call; actions other than delegates ignore it".

The delegation layer treats it as an opaque string. Only `src/task` knows what is in it, so `src/durable` learns nothing about OpenSpec. Because the preamble sits in the child's durable input, beside `source` and `options`, durability comes for free:

- A run resumed in a fresh process reads it from `task.input`, just as it reads the script.
- The agent runner's `start` may run again after a crash between the intent commit and the child commit. It rebuilds the same seed from the same input.
- Once the delegate's child exists, its seeded `instructions` are in its own durable input.
- The loop renders the preamble from its own durable input, which holds the texts read at start (`Sources are read once, at start`). A file edited mid-loop, even by a delegate, can't make the delegate and the judge see different contracts.

**Alternative:** a delegation context passed to `delegationActions` at build time. Rejected: the registry is per harness, and one harness runs many loops.

**Alternative:** render the preamble inside the delegation layer from the seeded variables. Rejected: that puts the task contract's variable names into `src/durable`.

The text is stored twice in the child's input: once as seeded variables and once in the preamble. That costs one change's size per iteration in the database, which is acceptable.

### Full text, not paths

The preamble includes the proposal, design and deltas in full, and the task line inline. It doesn't point at paths:

1. **The loop may have no paths.** `change` can be `{ proposal: { text }, … }`, and the durable input keeps only text.
2. **Paths would be wrong in some workspaces.** With `--worktree`, the change was read from the main tree but the delegate runs in the worktree. On Cloudflare the workspace is a Sandbox checkout, where host paths mean nothing.
3. **A delegate may not be able to read.** An `agent` grant's `tools` may leave out `read_file`.
4. **One snapshot.** The delegate sees exactly the text the plan step and the judge saw (see above).
5. **The cost is bounded.** A change is tens of kilobytes, and stdin and a seeded variable carry that easily. The claude-code runner sends it on stdin, never argv, so there is no argv length limit to hit.

The `Change:` line still names the change (the base name of `change.dir`), so a delegate can find the files when it wants more than the text.

### The preamble's text

`taskPreamble(input)` returns exactly this, with the `Change:` line only when `input.change` is set and the `# design.md` section only when `design` is not `""`. Each document has its trailing newlines trimmed.

```text
You are working on one task of an OpenSpec change. The documents below are its contract; the instructions after them are this iteration's plan.

Change: <change>
Task <task>: <taskText>

Rules:
- Change only what the task needs.
- Never tick boxes in tasks.md, and never edit the change's proposal, design or spec deltas.
- If the spec itself looks wrong, say so in your reply instead of coding around it.

# proposal.md

<proposal>

# design.md

<design>

# Spec deltas

<deltas>

# Instructions
```

The delegation layer joins it to the call as `${preamble}\n\n${instructions}`. Level-1 headings sit above the documents' own `##` headings and the deltas' `## <capability>` lines. The rules are the task-delegate system block's, which today reaches only the reasoning steps, reworded so they apply to the delegate.

`TaskLoopInput` gains an optional `change: string`:
- `prepareTaskLoop` sets it to `basename(change.dir)` for a `{ dir }` change.
- `taskLoopInputFor` sets it from the group input's `changeDir`.
- Older loops don't have it, so they render no `Change:` line.

Task scripts aren't seeded `change_id`. The loop renders the preamble itself, so no script needs the id.

### Where the preamble applies

- **Applies:** a task loop's iteration run, whether started directly or by a group loop as a child task loop.
- **Doesn't apply:** the group judge's run, which judges a group rather than one task, and its bundled judge acts on nothing. The spec loop's and draft loop's runs aren't tasks either. A plain `agentscript-durable` run, or a Cloudflare route, has no change, so its `RunInput` has no `delegatePreamble` and its delegates' stdin is unchanged.
- **Every delegate in the run gets it,** including an `agent` reviewer that only reads. The opening line says "working on", not "implementing", for that reason.
- **Step tools get none.** A process delegate offered under `reasoning.actions` runs as a pi-durable tool registered once per harness, and it reads its offer from the step's doc, not the run's input. Carrying the preamble there means changing the step doc and its dispatch, which are internals of `src/durable/extension.ts`, and the sibling change `clarify-step-context` owns that file. The bundled scripts call their delegates with `run`, and agent delegates are run-only. This is an open follow-up.

### The stdin hard line

The preamble goes into the `instructions` the delegation layer hands to `prepare`. It never goes into the terms. So:

- `prepare` builds argv from the terms alone, as before.
- The claude-code runner returns that text as `stdin` unchanged.
- The layer appends the terms block.

Stdin is the preamble, a blank line, the instructions, a blank line, then the terms block. Nothing new reaches argv, the environment or `--append-system-prompt-file`. CLAUDE.md's line becomes "the preamble and the instructions go only on stdin, followed by the terms block". `src/node/claude-code-runner.ts` needs no code change, and its tests pin the composed stdin. The recorded `Action` summary is taken from the call's own `instructions`, so the record stays meaningful.

### Runtime neutrality

`ActionContext`, `RunInput`, `delegation.ts` and `agent-runner.ts` change only in plain string handling, with no `node:` import, so `./cloudflare` imports them as before. `src/task/preamble.ts` is pure too. The `node:path` `basename` call happens in `start.ts` and `group.ts`, which already import `node:`.

## Risks / Trade-offs

- **Bigger stdin and a bigger durable input** for each iteration. Mitigation: a change is small, and nothing goes on argv.
- **A delegate that ignores "never edit the spec".** The rules are guidance, not enforcement, as before. The judge still sees the diff.
- **Merge overlap.** `extension.ts` belongs to the sibling change `clarify-step-context`. This change touches only the `RunInput` interface and the `ActionContext`s the `act` phase builds (its durable path and its call to `execute`), so the worktrees should merge with at most a trivial conflict.
- **Step-tool delegates get no preamble.** This is documented in the `durable/run-task` delta and left as a follow-up.

## Follow-ups (not in this change)

- `task-delegate.agent`'s `orient` step could stop restating the requirements in the plan and focus on approach. That means editing `orient`, which `clarify-step-context` owns. The `RETIRE:` paragraph it appends still belongs in the plan.
- A preamble for delegates offered as step tools, carried in the step doc.
