## Why

After `add-actors-and-workspaces` and `add-agent-runner`, the parts of an agent that don't care where they run are runtime-neutral: the typed host config, model closures over `env`, workspaces, the built-ins, grants, and the `agent` runner. Cloudflare still has only `AgentScriptHost`:
- one Workers AI model, chosen by subclassing `createModel()`;
- no actions at all: the plain extensions refuse every one;
- no workspace.

So an agent on Cloudflare can talk but can't work on anything.

The principal's model for Cloudflare:
- **Models stay in the Durable Object on the `AI` binding** (`AI.run`, no keys), or on any other model closure the host passes.
- **The workspace is a Cloudflare Sandbox**, a container with a real filesystem, git and the ability to run checks.
- **The repo of record is an Artifacts fork,** one per task, the way a worktree is locally. The agent commits only to its fork, and merging back is the principal's call.

No model runs inside the Sandbox, and no Cloudflare credential enters it except a fork-scoped git token.

## What Changes

- **`defineAgentHost<Env>(config)`** (`./cloudflare`) returns a Durable Object class built from an `AgentConfig<Env>` with `createAgentHarness`, inside Cloudflare's `PiHarness`. Its HTTP API is `AgentScriptHost`'s:
  - `POST /runs/<host>` with `{ source, entry?, variables?, model? }`, where `model` names one of the config's models (default `default`);
  - `GET /runs/<host>/<task>` for progress;
  - a refused start answers `422`, and an unknown model `400`.

  `AgentScriptHost` stays as it is.
- **`workersAI(binding, modelId)`** (`./cloudflare`): a `ModelFactory` over the `AI` binding, so `models: { default: (env) => workersAI(env.AI, "@cf/…") }` is the whole setup.
- **`sandboxWorkspace(sandbox, { dir })`** (`./cloudflare`, written against a small `SandboxLike` interface matching the Sandbox SDK's `exec`, `readFile`, `writeFile` and `mkdir`):
  - confined reads and writes, with a `realpath` check for symlinks;
  - `exec` with every argument POSIX-quoted, so nothing is interpreted by the Sandbox's shell, and a hard time limit through `timeout -s KILL`;
  - `snapshot` from git, plus `list` and `search`;
  - `publish(message)`, which commits and pushes to the checkout's remote.
- **`Workspace` gains optional `publish`.** `localWorkspace` doesn't implement it: locally the runner never commits.
- **`artifactsSandboxWorkspace(artifacts, sandbox, { repo, fork, dir })`** (against a small `ArtifactsLike` interface):
  - gets the fork by name, or forks the repo, so a restarted object reuses its fork;
  - issues a write token for the fork only;
  - clones the fork into the Sandbox unless `dir` already holds that checkout;
  - returns the `sandboxWorkspace`.

  The token never appears in an action output, a record, an event or an error.
- **A Cloudflare host's runners are `{ agent }` only.** `claudeCodeRunner` stays in `./node`, so a process delegate on Cloudflare is refused at start, naming the runner.
- **The example Worker** gains a `defineAgentHost` host on a faux model with an in-memory workspace. `test/routes.sh` covers its routes.

## Out of scope

- **Running OpenSpec task and group loops on Cloudflare.** The change sources and `tasks.md` ticking would live in the Sandbox checkout. That's `add-cloudflare-task-loop`, built on this.
- **Claude Code inside a Sandbox** (an API-key runner, or a model proxy back to `AI.run`).
- **Opening pull requests from a fork, and merging back.**
- **Deploying anything.** Nothing here runs `wrangler deploy`. Tests use fakes and `wrangler dev --local`.

## Capabilities

- **New:**
  - `cloudflare/agent-host`: `defineAgentHost`, `workersAI`, the routes, the runners;
  - `cloudflare/sandbox-workspace`: `SandboxLike`, `sandboxWorkspace`, `ArtifactsLike`, `artifactsSandboxWorkspace`, token hygiene.
- **Modified:** `actions/workspace` (from `add-actors-and-workspaces`): optional `publish`.

## Impact

- **New:** `packages/agent/src/cloudflare/agent-host.ts`, `src/cloudflare/workers-ai.ts`, `src/cloudflare/sandbox-workspace.ts`, `src/cloudflare/artifacts.ts`. The last two import no `agents` or `cloudflare:workers`, so plain Node tests drive them.
- **Updated:** `examples/cloudflare-worker`, the README, docs, and tests (a local-exec fake Sandbox, a fake Artifacts binding, a local bare git remote).
- **Depends on `add-actors-and-workspaces` and `add-agent-runner`,** archived first.
- **The real binding names** (Sandbox SDK, Artifacts) are checked against Cloudflare's docs in the design. `SandboxLike` and `ArtifactsLike` keep the code independent of their exact versions.
