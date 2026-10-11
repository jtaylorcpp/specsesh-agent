# durable/cloudflare Specification

## Purpose
Running scripts inside a Cloudflare Durable Object through Cloudflare's PiHarness, over a small HTTP API, with the same extension the Node host uses.

## Requirements

### Requirement: The Worker routes /runs/<host> to a Durable Object by name
The `agentscript-cloudflare` Worker's `fetch` handler SHALL split the request path on `/`, and when the first segment is `runs` and the second (`<host>`) is non-empty, forward the request unchanged to `env.HOST.getByName(<host>)`. Any other path MUST answer `404` with JSON `{ "error": "use /runs/<host>" }`. Each distinct `<host>` name MUST be its own `AgentScriptHost` object with its own storage and its own runs.

#### Scenario: A path outside /runs is refused
- **WHEN** a client requests `GET /`
- **THEN** the response SHALL be `404` with body `{ "error": "use /runs/<host>" }`

#### Scenario: /runs with no host is refused
- **WHEN** a client requests `POST /runs/`
- **THEN** the response SHALL be `404` with body `{ "error": "use /runs/<host>" }`

#### Scenario: Two host names are two objects
- **WHEN** a client starts a run at `/runs/a` and asks for that task ID at `/runs/b`
- **THEN** `/runs/b` SHALL answer `404` for that task unless it has a task with the same ID of its own

### Requirement: Every response is pretty-printed JSON
Every response the Worker and the object produce SHALL have header `content-type: application/json` and a body of `JSON.stringify(body, null, 2)`.

#### Scenario: An error response is JSON
- **WHEN** any request is refused
- **THEN** the response body SHALL parse as JSON with an `error` string

### Requirement: AgentScriptHost hosts pi-durable through PiHarness and Lifecycle
`AgentScriptHost` SHALL extend `DurableObject<Env>` and in its constructor create `new PiHarness({ harness })`, whose factory opens `Harness.open(storage, { models, registry }, context)` on the storage PiHarness supplies (this object's SQLite), and install it with `Lifecycle.install(this).use(this.harness)`. Request handling MUST obtain the harness with `await this.harness.pi()`.

#### Scenario: The object exposes its harness and lifecycle
- **WHEN** an `AgentScriptHost` is constructed
- **THEN** it SHALL expose `harness` (a `PiHarness`) and `lifecycle` (the installed `Lifecycle`)

### Requirement: The object installs the same extensions as the Node CLI
The object's registry SHALL have `AgentScript` and `AgentScriptStepExtension` from `agentscript-durable` installed, the same extensions the Node CLI installs, so a run behaves as `durable/run-task` specifies on either host.

#### Scenario: A run on the object is an agentscript.run task
- **WHEN** a run is started on the object
- **THEN** it SHALL be a pi-durable task named `agentscript.run` whose checkpoints have the `durable/run-task` phases

### Requirement: The model is Workers AI unless faux mode is on
When `AGENTSCRIPT_FAUX` is not exactly `"1"`, the object SHALL create a provider with `createAI({ binding: env.AI })` and run every step on model `AGENTSCRIPT_MODEL`, or `@cf/moonshotai/kimi-k2.7-code` when unset. When `AGENTSCRIPT_FAUX` is `"1"`, it MUST instead register a pi-ai `fauxProvider` and run every step on its model. Exactly one of the two providers MUST be registered.

#### Scenario: Default Workers AI model
- **GIVEN** `AGENTSCRIPT_FAUX` unset and `AGENTSCRIPT_MODEL` unset
- **WHEN** a run is started
- **THEN** its steps SHALL run on Workers AI model `@cf/moonshotai/kimi-k2.7-code`

#### Scenario: AGENTSCRIPT_MODEL picks the Workers AI model
- **GIVEN** `AGENTSCRIPT_MODEL=@cf/some/model`
- **WHEN** a run is started
- **THEN** its steps SHALL run on that model

#### Scenario: Faux mode replaces Workers AI
- **GIVEN** `AGENTSCRIPT_FAUX=1`
- **WHEN** a run is started
- **THEN** its steps SHALL run on the faux provider's model and Workers AI SHALL NOT be called

### Requirement: Faux responses are queued from requests, pacing and a construction-time seed
In faux mode (local testing only) the object SHALL accept faux responses as `{ "text": string }` (assistant text) or `{ "result": { [field]: string | number | boolean } }` (a `toolUse` message calling `submit_result` with those arguments). `AGENTSCRIPT_FAUX_SEED`, a JSON array of them, MUST be queued in the constructor, before pi resumes unfinished work, only when `AGENTSCRIPT_FAUX` is `"1"`.

#### Scenario: A seeded object has its answer ready after a restart
- **GIVEN** `AGENTSCRIPT_FAUX=1` and `AGENTSCRIPT_FAUX_SEED=[{"text":"Escalated after restart."}]`
- **WHEN** the object is constructed and pi resumes an unfinished step
- **THEN** that step SHALL be answered with `Escalated after restart.`

#### Scenario: Pacing slows faux output
- **GIVEN** `AGENTSCRIPT_FAUX_TPS=4`
- **WHEN** a faux text response of 60 repetitions of `Escalating. ` is streamed
- **THEN** the step SHALL remain at phase `await` long enough for a test to kill the process mid-step

### Requirement: AGENTSCRIPT_FAUX_TPS paces faux output
When `AGENTSCRIPT_FAUX_TPS` is a finite number greater than zero, the faux provider SHALL stream at that many tokens per second; otherwise it MUST use the faux provider's default pace.

#### Scenario: An invalid pace is ignored
- **GIVEN** `AGENTSCRIPT_FAUX_TPS=0` or `AGENTSCRIPT_FAUX_TPS=abc`
- **WHEN** the object is constructed
- **THEN** the faux provider SHALL be created with no `tokensPerSecond`

### Requirement: POST /runs/<host> starts a run
A `POST` to `/runs/<host>` SHALL read a JSON body `{ source, entry?, variables?, faux? }`, call `startScript` with the object's model plus `entry` and `variables` when present, call `pi.resume()`, and answer `202` with `{ "task": <id> }`. With query `?wait=1` it MUST instead await `waitForScript` and answer `200` with `{ "task": <id>, "result": <RunResult> }`.

#### Scenario: A run is started and acknowledged
- **GIVEN** faux mode and a body with the pipeline source, entries `classify`, `gate`, `respond`, and faux responses for both model steps
- **WHEN** the client posts it to `/runs/crash`
- **THEN** the response SHALL be `202` with an integer `task`

#### Scenario: ?wait=1 returns the result
- **WHEN** the client posts a valid body to `/runs/<host>?wait=1`
- **THEN** the response SHALL be `200` with `task` and a `result` whose `kind` is `completed`, `failed` or `cut-short`

#### Scenario: A refused script is 422
- **WHEN** the client posts a body whose `source` uses a construct outside the subset
- **THEN** the response SHALL be `422` with an `error` containing `unsupported by this runtime`

#### Scenario: faux outside faux mode is 400
- **GIVEN** `AGENTSCRIPT_FAUX` unset
- **WHEN** the client posts a body carrying `faux`
- **THEN** the response SHALL be `400` with `{ "error": "faux responses need AGENTSCRIPT_FAUX=1" }`
- **AND** no task SHALL be created

### Requirement: A refused start is 422 and faux outside faux mode is 400
When `startScript` throws (the script was refused before anything ran) the start route SHALL answer `422` with `{ "error": <message> }`. A start body carrying `faux` MUST be refused with `400` and `{ "error": "faux responses need AGENTSCRIPT_FAUX=1" }` unless faux mode is on, in which case its responses are queued before the run starts.

#### Scenario: Faux responses in the body are queued in faux mode
- **GIVEN** faux mode
- **WHEN** the client posts a start body with `faux: [{ "result": { "severity": "high" } }, { "text": "ok" }]`
- **THEN** those responses SHALL answer the run's two model steps in order

### Requirement: POST /runs/<host>/faux queues faux responses
A `POST` to `/runs/<host>/faux` with a JSON array of faux responses SHALL, in faux mode, queue them, call `pi.resume()`, and answer `200` with `{ "queued": <pending response count> }`. Outside faux mode it MUST answer `400` with `{ "error": "faux responses need AGENTSCRIPT_FAUX=1" }`.

#### Scenario: Responses are queued
- **GIVEN** faux mode and an empty queue
- **WHEN** the client posts `[{"text":"a"},{"result":{"severity":"high"}}]` to `/runs/<host>/faux`
- **THEN** the response SHALL be `{ "queued": 2 }`

#### Scenario: Outside faux mode the route is refused
- **GIVEN** `AGENTSCRIPT_FAUX` unset
- **WHEN** the client posts to `/runs/<host>/faux`
- **THEN** the response SHALL be `400`

### Requirement: GET /runs/<host>/<task> reports a run's progress or outcome
A `GET` to `/runs/<host>/<task>` SHALL look up `Number(<task>)` with `pi.getTask`; an unknown task MUST answer `404` with `{ "error": "no task <task>" }`. A non-terminal task MUST answer `200` with `{ task, status, phase, step }` from the `durable/run-task` checkpoint (`step` absent at phase `next`); a terminal one `200` with `{ task, status: "terminal", outcome }`.

#### Scenario: A run mid-step reports its phase and step
- **GIVEN** a run whose second model step is streaming
- **WHEN** the client requests `GET /runs/<host>/<task>`
- **THEN** the body SHALL have `phase: "await"` and `step: 1`

#### Scenario: A finished run reports its outcome
- **WHEN** the client requests a terminal task
- **THEN** the body SHALL have `status: "terminal"` and `outcome.status: "completed"` with `outcome.result.kind`

#### Scenario: An unknown task is 404
- **WHEN** the client requests `GET /runs/<host>/999` for a task that does not exist
- **THEN** the response SHALL be `404` with `{ "error": "no task 999" }`

### Requirement: Any other request to the object is 404
A request reaching the object that matches none of the routes above SHALL answer `404` with `{ "error": "not found" }`.

#### Scenario: An unsupported method
- **WHEN** the client sends `DELETE /runs/<host>/1`
- **THEN** the response SHALL be `404` with `{ "error": "not found" }`

### Requirement: The Worker is configured for SQLite Durable Objects and Workers AI
`wrangler.jsonc` SHALL name the Worker `agentscript-cloudflare` with `main` `src/index.ts`, `compatibility_date` `2026-10-01`, compatibility flag `nodejs_compat`, an AI binding named `AI`, a Durable Object binding `HOST` for class `AgentScriptHost`, and migration tag `v1` declaring `AgentScriptHost` under `new_sqlite_classes`.

#### Scenario: The object uses SQLite storage
- **WHEN** the Worker is deployed or run with `wrangler dev`
- **THEN** `AgentScriptHost` SHALL be a SQLite-backed Durable Object class bound as `HOST`

### Requirement: A run survives the object's process being killed mid-step
On local Durable Object storage, a run SHALL survive its `workerd` process being killed with `SIGKILL` while a step is streaming, and finish after a fresh process starts on the same storage, without a new start request and without re-running the step that had already been answered.

#### Scenario: kill -9 during the second step, then restart
- **GIVEN** `wrangler dev --local --persist-to <dir>` with `AGENTSCRIPT_FAUX=1` and `AGENTSCRIPT_FAUX_TPS=4`, and the pipeline started at `/runs/crash` with faux responses `{ result: { severity: "high" } }` and a long text
- **WHEN** `GET /runs/crash/<task>` reports `phase: "await"` and `step: 1`, the process group is killed with `kill -9`, and a new `wrangler dev` starts on the same `<dir>` with `AGENTSCRIPT_FAUX_SEED=[{"text":"Escalated after restart."}]`
- **THEN** polling `GET /runs/crash/<task>` SHALL reach `status: "terminal"`
- **AND** `outcome.result.kind` SHALL be `completed`, `outcome.result.variables.urgent` SHALL be `true`, and the last step's text SHALL be `Escalated after restart.`
