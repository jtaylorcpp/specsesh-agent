## Why

We have agents that execute a change: the task loop and the group loop. Nothing helps write one. The principal wants an agent that guides a user from intent to a change ready to execute, in four stages: proposal, design, specs, tasks. Each stage is drafted by the agent, checked by rules rather than by the model, and approved or revised by the user before the next starts. That's the task loop's shape: iterate until the checks pass, then hand back. This change builds the loop. The stages themselves follow in their own changes.

## What Changes

- **`SpecStage`**: a stage is a name, the files it owns in the change directory, an Agent Script, and a gate: a function returning validation issues, with no model.
- **The stage contract**, checked at start.
  - Seeded: `change_id`, `stage`, `intent`, `approved` (the earlier stages' files), `current` (this stage's files as they are now), `base` (spec text the stage needs), `iteration`, `carried`.
  - Read back: `files`, `summary`, `next_action` (`review` or `ask`), `question`.
- **`agentscript.spec-loop`**, one durable task with phases `iterate`, `await`, `write` and `gate`:
  - the script runs once per iteration as an `agentscript.run` child;
  - `files` comes back as a bundle of `=== <path>` sections, and only the files the stage owns are written;
  - the gate's issues carry into the next iteration, up to `maxIterations` (default 8).
- **A clean gate blocks for review.** The loop ends `blocked`, with an escalation to the principal (always: only the principal approves) naming the files to review. `ask` blocks with the script's question, to the loop's `escalateTo`.
- **`startSpecLoop`, `waitForSpecLoop` and `specLoopExtensions`** in `./task`.

## Out of scope

- Answering the review (approve or revise) and recording approvals: `add-spec-review`.
- Any real stage: `add-spec-proposal-stage`, `add-spec-design-stage`, `add-spec-specify-stage`, `add-spec-plan-stage`. Tests here use a stage defined in the test.
- The CLI: `add-spec-cli`.
- Tools in stage scripts. A stage returns text and the loop writes it. That works on every provider, including claude-code, which serves one tool per request.

## Capabilities

- **New:** `spec/loop`.

## Impact

- New: `packages/agent/src/task/spec-stage.ts`, `spec-bundle.ts`, `spec-loop.ts`, `spec-api.ts`; tests with the faux provider.
- Depends on `reorder-design-before-specs` (the stage order), and on nothing in `add-actors-and-workspaces`: the loop writes files itself and needs no actions.
