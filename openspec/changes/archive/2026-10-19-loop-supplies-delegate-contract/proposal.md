## Why

A delegate gets one input, `instructions` (`src/durable/delegation.ts`), and the bundled `task-delegate.agent` sets it to the plan its `orient` step wrote. The subset has no string concatenation, so a script can't send "the change's contract, then this iteration's plan". The agent that writes the code never sees the proposal, design or deltas, only a model's paraphrase of them, and on smaller reasoning models the paraphrase drifts (GitHub issue #9).

The script's system block ("Change only what the task needs; never tick boxes, never edit the spec. If the spec itself looks wrong, say so instead of coding around it") doesn't reach the delegate either. It goes to the reasoning steps. The claude-code runner's stdin is `instructions` and the terms block, nothing else.

The principal chose that the loop supplies the contract. The language doesn't change, the script gets no new delegate input, and the grant gets no new option.

## What Changes

- **A run can carry a delegate preamble.** `RunInput` gains an optional `delegatePreamble: string`. The `act` phase passes it to each action it calls with `run`, as `ActionContext.delegatePreamble`, read from the task's durable input. A resumed run passes the same text. A step's tool calls get none.
- **Delegates put it first.** When the context carries a preamble:
  - A process delegate's stdin is the preamble, a blank line, the instructions, a blank line, then the terms block. argv is unchanged, and the preamble never goes on it.
  - An agent delegate's child is seeded with `instructions` set to the preamble, a blank line, then the call's instructions.
  - The recorded `Action` summary is still the first line of the call's own instructions.
  - Without a preamble, both behave exactly as they do today.
- **The task loop renders it.** Each iteration's `agentscript.run` child carries a fixed task preamble built from the loop's durable input. The text names the change (when it was given as a directory) and the task, gives the contract rules, then includes the full proposal, design (when not empty) and deltas, and ends with `# Instructions`. The group loop's task runs get the same preamble, because they are task loops. The group judge and the spec loop pass none.
- **No new script variable.** Task scripts aren't seeded `change_id`. `task-delegate.agent` doesn't change.
- **CLAUDE.md** states the claude-code hard line as "the preamble and the instructions go only on stdin, followed by the terms block", and describes the preamble under "Running a task".

## Out of scope

- Interpolation or concatenation in `with` values, and any other subset change.
- A second script-facing delegate input, or a grant option for the change documents.
- Delegates offered as a step's reasoning actions. Only a process delegate can be offered that way, and it gets no preamble in this change (see design).
- Changes to the bundled `.agent` files, including how `orient` frames the plan (the sibling change `clarify-step-context` owns those).
- Seeding `change_id` into task scripts.

## Capabilities

- **Modified:**
  - `durable/run-task`: `RunInput.delegatePreamble`, and how the run hands it to delegates.
  - `actions/delegation`: the process delegate's stdin layout and where the preamble comes from.
  - `actions/agent-runner`: the agent delegate's seeded `instructions`.
  - `task/agent`: the loop renders the task preamble and gives it to each iteration's run. Requirements are added only.

Four capabilities, because one mechanism crosses four layers. Each delta is small, and none can be dropped without leaving a spec that contradicts the code.

## Impact

- **Code:** `packages/agent/src/durable/extension.ts` gets the `RunInput` field and passes it into the `act` phase's `ActionContext`, and nothing else. The other files are `src/durable/actions.ts` (`ActionContext`), `src/durable/delegation.ts`, `src/durable/agent-runner.ts`, `src/task/loop.ts`, `src/task/loop-input.ts` (optional `change`), `src/task/start.ts`, `src/task/group.ts` (`taskLoopInputFor`), and a new `src/task/preamble.ts`. `src/node/claude-code-runner.ts` doesn't change: its stdin is the text `prepare` is given.
- **Durable inputs:** old task loops have no `change`, so they omit the `Change:` line. Old runs have no `delegatePreamble` and behave as before.
- **Runtime:** everything in `src/durable` stays runtime-neutral, and `./cloudflare` is unaffected.
- **Docs:** `CLAUDE.md` (Hard lines, Running a task).
