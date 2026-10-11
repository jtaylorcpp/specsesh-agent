## Why

The ontology says a task is a feedback loop: plan, act, check, judge, and go again until the task's requirements hold. Nothing runs that loop today. Executing a change means a person or an agent reading `tasks.md` and ticking boxes. This change makes the **task loop** real, as the first runnable piece of the ontology. You hand it a change and a task id, and an Agent Script agent works the task durably, iteration by iteration. The script is yours to fine-tune.

## What Changes

- **A task agent** (`@specsesh/agent/task`). It takes:
  - **the change:** the proposal, design (optional), spec deltas and `tasks.md`, each given as **text or a file path**, or the change directory as a shortcut;
  - **the task id:** e.g. `2.4`, which must exist in the task list;
  - **an Agent Script definition:** the default `task.agent`, or your own;
  - **a workspace directory** that actions are confined to;
  - **options:** a budget (default 3 iterations), check commands, a command allowlist, and a model.
- **A durable task loop.** A pi-durable task, `agentscript.task-loop`, runs the script once per iteration as an `agentscript.run` child, checkpointed. After each iteration it reads the verdict and returns an ontology `LoopOutcome<TaskOutcome>`:
  - **`converged`**, when the judge says the task is met;
  - **`blocked`**, with an `Escalation` to a principal or an agent, when the judge asks for a decision or finds the spec wrong;
  - **`exhausted`**, when the budget runs out;
  - **`failed`**, when an iteration's run fails.
- **The script contract.** A task script is any Agent Script that declares the variables the loop fills (`task_id`, `task_text`, `proposal`, `design`, `deltas`, `iteration`, `carried`) and the ones it reads back (`met`, `unmet`, `next_action`, `question`). A script missing one, or with the wrong type, is refused before anything runs, naming it. Everything else (prompts, subagents, actions, checks) is yours to tune.
- **The default `task.agent`**, a single iteration:
  - **orient:** plan, from the change and carried feedback;
  - **act:** model-callable `read_file`, `edit_file` and `run_command`;
  - **check:** deterministic `run_checks`;
  - **judge:** a structured verdict.

  It lints clean against the pinned dialect today; it needs `add-agentscript-actions` to run.
- **Feedback carried forward.** When a verdict isn't met and `next_action` is `retry`, the next iteration runs with `carried` set to the unmet summary. An answered escalation resumes the loop with the answer's decision carried in.
- **Ticking the box.** When the loop converges and `tasks.md` was given as a file, the task's line changes from `- [ ]` to `- [x]`, and that line only. Given as text, the outcome reports convergence and writes nothing.
- **A CLI**, `agentscript-task run <change-dir> <task-id>`, with flags for `--script`, `--workspace`, `--check`, `--allow`, `--max-iterations`, `--db`, `--provider` and `--model`. It also has `resume`, and `answer` for an escalation.

## Out of scope

- The group loop and the change loop.
- Linking a task to its requirements and scenarios. The judge sees the whole deltas and the task text; per-scenario `TestEvidence` targets arrive with the parser.
- Real MCP servers, and acting on a remote workspace.
- An interface for answering escalations, beyond the CLI and the host function.

## Capabilities

- **New:**
  - `task/agent`: inputs, the script contract, the loop, the verdict mapping, ticking and escalation;
  - `task/cli`: the command line.
- **Modified:** `package/distribution`: the eighth entry `./task`, the third bin `agentscript-task`, `src/task/` in the layer rule, the bundled scripts copied into `dist/`, and the pack check running the task bin. It builds on `add-agentscript-actions` and the ontology without changing them.

## Impact

- Depends on `package-specsesh-agent`, `add-openspec-ontology` (types `Task`, `TaskId`, `Verdict`, `Feedback`, `Escalation`, `EscalationAnswer`, `LoopOutcome`, `TaskOutcome`, `Action`, `Evidence`) and `add-agentscript-actions`.
- Adds the `./task` entry and the `agentscript-task` bin to `@specsesh/agent`.
