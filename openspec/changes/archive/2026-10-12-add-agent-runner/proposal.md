## Why

`add-actors-and-workspaces` makes delegation a capability the user grants, with one kind of runner: a process (Claude Code) run through the loop's workspace. That runner is Node-only and subscription-bound, so it can't serve a Cloudflare host. And it hands work to an agent we don't control.

The other half of the principal's model is **delegating to one of our own agents, on another model.** For example, an Opus task loop asks a Haiku reviewer to read the change, or a Workers AI agent hands research to a stronger model behind AI Gateway. That delegate is just another Agent Script run in the same durable harness. It's bound to the same workspace, its tools are the ones the user grants, and it's checkpointed and resumable like every other run. Nothing in it is Node-specific, so it's the delegate a Cloudflare host can actually use.

For an agent delegate to work on a repo the way Claude Code does, it also needs to find things. So workspaces gain listing and searching.

## What Changes

- **The `agent` runner** (`agentRunner()` in `./durable`, runtime-neutral, also in `defaultRunners`). A grant `{ runner: "agent", model, script, tools?, maxSteps?, maxCalls? }` runs `script` as a **durable child `agentscript.run`**, with these properties:
  - **Model:** it runs on the harness's model named `model`.
  - **Input:** it is seeded with the call's `instructions`.
  - **Workspace:** the caller's.
  - **Tools:** only the actions the grant names, from the caller's registry, never a `delegate/` action, so a delegate can't delegate further.
  - **Steps:** at most `maxSteps` model steps.

  The call waits for the child by its id, so a crash resumes the same child and never starts a second one. It answers `{ ok, summary, files_changed }` from the child's `ok` and `summary` and the workspace's snapshots.
- **Durable host actions.** A host action may run as a child task instead of a single call. The `run` task's `act` phase creates the child and stores its id in one commit, waits for it idempotently, then folds the child's result into the run. Agent delegates are called with deterministic `run` only; offering one as a reasoning action is refused at start.
- **Run scope and step limits.** `RunInput` gains `scope`, the action names a run may bind and call, and `maxSteps`. A run that would take step `maxSteps + 1` ends `failed`, saying so.
- **Grant checks.** An agent grant is validated when the harness is built:
  - `model` must name one of the harness's models;
  - every tool must exist and must not be a delegate;
  - the script must lint clean, keep the delegate contract (seed `instructions`, read back `ok` and `summary`), and bind only to its tools.
- **Two bundled delegate scripts**, exported as source text so they need no file system:
  - `READ_AGENT`: read, list and search, for reviews and research;
  - `EDIT_AGENT`: adds `edit_file` and `run_command`.

  A JSON grant names them as `"read"` or `"edit"`, or gives a path.
- **Workspaces list and search.** `Workspace` gains optional `list(glob)` and `search(pattern, { glob, limit })`. `localWorkspace` implements them, honouring `.gitignore` inside git. Two new built-ins, `list_files` and `search_files`, use them. `createAgentHarness` registers both when its workspace supports them.
- **Named models in the repo config.** A top-level `models` map in `agentscript.config.json` (`{ "<name>": { "provider", "model" } }`) gives the CLI's harness more models than `default`, so a JSON agent grant can name one.

## Out of scope

- **Offering an agent delegate as a model-callable reasoning action.** That would mean a durable child inside a step's tool call. `run` covers the delegate pattern; tool-call children can come later.
- **The bundled task scripts using `list_files` and `search_files`.** Upgrading the self actor's tools is a separate change.
- **Cloudflare:** `add-cloudflare-workspace`, which builds on this runner.

## Capabilities

- **New:** `actions/agent-runner`: the runner, its grant, the durable call, the bundled delegate scripts.
- **Modified:**
  - `durable/run-task`: `RunInput` gains `scope` and `maxSteps`; the `act` phase runs durable host actions.
  - `actions/workspace` (from `add-actors-and-workspaces`): `list` and `search`, `list_files` and `search_files`.
  - `host/agent-config` (from `add-actors-and-workspaces`): search actions registered, models and actions passed to runners.
  - `task/headless`: the `models` config.

## Impact

- **New:** `packages/agent/src/durable/agent-runner.ts`, `src/durable/delegate-scripts.ts`.
- **Updated:**
  - `src/durable/extension.ts` (the `act` phase, scope, step limit);
  - `src/durable/workspace.ts`, `src/node/local-workspace.ts`, `src/durable/harness.ts`;
  - `src/task/config.ts` and the CLI;
  - docs, and tests (faux provider only).
- **Depends on `add-actors-and-workspaces`,** which must be archived first. `add-cloudflare-workspace` follows.
