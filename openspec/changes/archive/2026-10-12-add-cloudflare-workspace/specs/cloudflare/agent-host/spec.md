## Purpose
A Cloudflare Durable Object built from the same typed `AgentConfig` a Node host uses: models as closures over `env` (the `AI` binding by default), a workspace factory, actions and granted `agent` delegates, served over `AgentScriptHost`'s HTTP API.

## ADDED Requirements

### Requirement: The cloudflare entry exports defineAgentHost and workersAI
`@specsesh/agent/cloudflare` SHALL export `defineAgentHost<Env>(config)`, returning a Durable Object class, and `workersAI(binding, modelId)`, a `ModelFactory`-compatible value built with `createAI({ binding })`. `AgentScriptHost` SHALL remain exported unchanged.

#### Scenario: A host class is built from a config
- **WHEN** a Worker declares `class Host extends defineAgentHost<Env>({ models: { default: (env) => workersAI(env.AI, "@cf/meta/llama-4-scout") }, workspace: () => memoryWorkspace() })`
- **THEN** it SHALL type-check against the package's declarations

### Requirement: The host builds its harness with createAgentHarness
The object SHALL build its pi harness inside `PiHarness` with `createAgentHarness(config, { storage, env: this.env, context })`, its runners defaulting to `{ agent: agentRunner() }`, so a run behaves as `durable/run-task` specifies and its actions and delegates are those the config grants.

#### Scenario: A run edits the host's workspace
- **GIVEN** the example host on a faux model that answers an `edit_file` call, over an in-memory workspace
- **WHEN** a script with a reasoning `edit_file` action is started and awaited
- **THEN** the workspace SHALL hold the edited file

### Requirement: POST starts a run on a named model
`POST /runs/<host>` with `{ source, entry?, variables?, model? }` SHALL start a run on the config's model named `model`, or `default`, answering `202 { task }`, or `200 { task, result }` with `?wait=1`. A `model` the config does not name SHALL answer `400` naming it and listing the models; a refused start SHALL answer `422` with the refusal.

#### Scenario: An unknown model name is 400
- **WHEN** `POST /runs/h` names `model` `"nope"` on a host with models `default` and `reviewer`
- **THEN** it SHALL answer `400` with an error naming `nope`, `default` and `reviewer`

#### Scenario: A named model runs the steps
- **GIVEN** the example host with faux models `default` and `reviewer`
- **WHEN** `POST /runs/h?wait=1` names `model` `"reviewer"`
- **THEN** the result's steps SHALL have run on `reviewer`'s model

### Requirement: GET reports a run as AgentScriptHost does
`GET /runs/<host>/<task>` SHALL answer exactly as `AgentScriptHost`'s route does: the run's progress while it runs, its outcome when terminal, `404` for an unknown task.

#### Scenario: An unknown task is 404
- **WHEN** `GET /runs/h/999` is requested
- **THEN** it SHALL answer `404`

### Requirement: A Cloudflare host has no process runner
A grant on a `defineAgentHost` host whose `runner` is not in its runners SHALL refuse the harness with `DelegateGrantError` naming the runner; by default only `agent` is available, so a `claude-code` grant is refused.

#### Scenario: A claude-code grant is refused on Cloudflare
- **GIVEN** a `defineAgentHost` config granting `{ claude_code: { runner: "claude-code" } }`
- **WHEN** the host builds its harness
- **THEN** it SHALL fail naming `claude-code` and `agent`
