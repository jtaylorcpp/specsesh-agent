## 1. Workspaces for Cloudflare

- [x] 1.1 `packages/agent/src/durable/workspace.ts`: optional `publish(message)` on `Workspace`; `memoryWorkspace(files?)` (in-memory `read`, `write`, `list`, `search`; no `exec`, `snapshot` or `publish`), exported from `src/durable/index.ts`
- [x] 1.2 `packages/agent/src/cloudflare/sandbox-workspace.ts` (new; imports neither `agents` nor `cloudflare:workers`):
  - `SandboxLike`, and `sandboxWorkspace(sandbox, { dir, secrets? })`;
  - confined `read` and `write` with the `realpath -m` check, `write` running `mkdir -p` on the parent;
  - `exec` with POSIX-quoted argv under `timeout -s KILL`, mapping exit `137` to `timed-out` and a throw to `spawn-error`;
  - `snapshot`, `list` and `search` through git and the shared glob matcher;
  - `publish`;
  - every sandbox output redacted of `secrets` before it is returned or thrown.
- [x] 1.3 `packages/agent/src/cloudflare/artifacts.ts` (new; no `agents` or `cloudflare:workers`): `ArtifactsLike` and `artifactsSandboxWorkspace(artifacts, sandbox, { repo, fork, dir })`. It gets or creates the fork, issues a write token, clones unless `dir` already holds that fork, and passes the token as a secret.
- [x] 1.4 `packages/agent/__tests__/cloudflare/fakes.ts` (new): the local-exec fake `SandboxLike` (`bash -c` in a temporary directory) and the fake `ArtifactsLike` over local bare repositories, whose failures echo the token
- [x] 1.5 `packages/agent/__tests__/cloudflare/sandbox-workspace.test.ts`: `cloudflare/sandbox-workspace` "The workspace modules load in plain Node", "A local fake satisfies SandboxLike", "An escape never reaches the sandbox", "A metacharacter stays an argument", "A slow command is killed", "A delegate's change is diffed in the sandbox", "Publishing reaches the remote" and "Nothing to publish" (8), each named `Scenario: <exact scenario name>`
- [x] 1.6 `packages/agent/__tests__/cloudflare/artifacts.test.ts` + `__tests__/durable/memory-workspace.test.ts`: "A second build reuses the fork and the checkout", "A failing push does not print the token", `actions/workspace` "A local workspace cannot publish" and "An in-memory edit round-trips" (4)

## 2. defineAgentHost

- [x] 2.1 `packages/agent/src/cloudflare/workers-ai.ts` (new): `workersAI(binding, modelId)` as a `ModelFactory`-compatible value over `createAI({ binding })`; exported from `src/cloudflare/index.ts`
- [x] 2.2 `packages/agent/src/cloudflare/agent-host.ts` (new) + `src/cloudflare/index.ts`:
  - `defineAgentHost<Env>(config)` returns a Durable Object class whose `PiHarness` factory calls `createAgentHarness(config, { storage, env, context })`, with runners defaulting to `{ agent: agentRunner() }`, and model factories run in the constructor;
  - routes shared with `AgentScriptHost` by factoring its handlers into one function;
  - `POST`'s optional `model` name: unknown → `400` naming it and listing models;
  - `AgentScriptHost` unchanged in behaviour.
- [x] 2.3 `examples/cloudflare-worker`:
  - a second Durable Object, `FauxAgentHost`, built with `defineAgentHost` over faux models `default` and `reviewer` and `memoryWorkspace()`;
  - its binding and migration in `wrangler.jsonc`;
  - `test/routes.sh` gains PASS/FAIL checks for `cloudflare/agent-host` "A run edits the host's workspace", "An unknown model name is 400", "A named model runs the steps" and "An unknown task is 404".
- [x] 2.4 `packages/agent/__tests__/cloudflare/agent-host.test.ts`: "A host class is built from a config" (a `tsc --noEmit` fixture against the package's declarations) and "A claude-code grant is refused on Cloudflare" (through `createAgentHarness` with the host's default runners) (2). Also check that `__tests__/package/examples.test.ts` still lists exactly the two examples.

## 3. Docs

- [x] 3.1 `packages/agent/README.md`: the `./cloudflare` line names `defineAgentHost`, `workersAI` and the Sandbox and Artifacts workspace. `docs/ontology/loops/action.md`: the Cloudflare workspace (one fork per task, publish to the fork) and no model inside the Sandbox. `pnpm docs:check` passes.
- [x] 3.2 `CLAUDE.md`: the layout notes the new `src/cloudflare/` modules, which of them are Worker-only, and that nothing here deploys

## 4. Verify

- [ ] 4.1 `pnpm -r check`, `pnpm -r test` (twice, stable), `pnpm pack:check`, `pnpm spec:check`, `pnpm docs:check` pass, and `examples/cloudflare-worker/test/routes.sh` passes on `wrangler dev --local`
- [ ] 4.2 `pnpm test:live` (the orchestrator runs it), then `pnpm spec:archive add-cloudflare-workspace`
