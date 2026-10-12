## Purpose
The `agent` delegate runner: a granted delegate that is one of our own agents — an Agent Script run as a durable child task, on another of the harness's models, in the caller's workspace, with only the tools the grant names — so delegation works wherever the harness does, Cloudflare included.

## ADDED Requirements

### Requirement: The durable entry exports the agent runner
`@specsesh/agent/durable` SHALL export `agentRunner()`, a runner of kind `"agent"`, and the delegate script sources `READ_AGENT` and `EDIT_AGENT`. `@specsesh/agent/node`'s `defaultRunners` SHALL also hold `agent`, equal to `agentRunner()`. None of these SHALL import a `node:` module.

#### Scenario: The node defaults hold both runners
- **WHEN** `defaultRunners` is read
- **THEN** it SHALL hold `claude-code` of kind `"process"` and `agent` of kind `"agent"`

### Requirement: An agent grant names a model, a script, tools and a step limit
The `agent` runner SHALL accept the grant keys `model` (string, required), `script` (string, required), `tools` (string array, default `["read_file", "list_files", "search_files"]`) and `maxSteps` (positive integer, default `20`), beside the common `runner` and `maxCalls`. In code `script` is Agent Script source; the CLI resolves it as described in `task/headless`.

#### Scenario: A minimal agent grant takes the defaults
- **WHEN** a harness is built with `{ reviewer: { runner: "agent", model: "default", script: READ_AGENT } }`
- **THEN** the reviewer's tools SHALL be `read_file`, `list_files` and `search_files`, and its step limit `20`

### Requirement: An agent grant is checked against the harness when it is built
`createAgentHarness` SHALL reject with `DelegateGrantError`, naming the grant, when an agent grant's `model` is not a key of the harness's models (listing them), a tool is not in its registry or starts with `delegate/`, or its script has a diagnostic, an unsupported construct, an action outside its tools, or breaks the delegate contract.

#### Scenario: An unknown model is refused, listing the models
- **GIVEN** models `default` and `opus`, and a grant with `model` `"haiku"`
- **WHEN** the harness is built
- **THEN** it SHALL reject naming the grant, `haiku`, `default` and `opus`

#### Scenario: A delegate cannot be given a delegate
- **GIVEN** a grant `claude_code` and an agent grant whose `tools` include `delegate/claude_code`
- **WHEN** the harness is built
- **THEN** it SHALL reject naming `delegate/claude_code`

#### Scenario: A script that uses a tool it was not granted is refused
- **GIVEN** an agent grant with `tools` `["read_file"]` and `script` `EDIT_AGENT`
- **WHEN** the harness is built
- **THEN** it SHALL reject naming `edit_file`

### Requirement: A delegate script keeps the delegate contract
An agent delegate's script SHALL declare `instructions` (string), seeded with the call's `instructions`, and `ok` (boolean) and `summary` (string), read back when the child completes. A missing or mistyped one breaks the contract, naming it and its type.

#### Scenario: A script without summary is refused
- **GIVEN** an agent grant whose script does not declare `summary`
- **WHEN** the harness is built
- **THEN** it SHALL reject naming `summary` and `string`

### Requirement: A call runs the script as a durable child in the caller's workspace
A call SHALL start an `agentscript.run` child with the grant's script, `variables: { instructions }`, `entry` every subagent in source order, `model` the grant's model's `ModelRef`, `scope` the grant's tools and `maxSteps`, over the caller's registry and workspace. It waits by child id, then answers `{ ok, summary, files_changed }`.

#### Scenario: A reviewer on another model answers
- **GIVEN** a caller on model `default` and a grant `reviewer` on model `opus` running `READ_AGENT`, both faux
- **WHEN** the caller runs `@actions.review` with `instructions` `"Review src/a.ts"`
- **THEN** the child's steps SHALL run on `opus`, and the call SHALL answer the child's `ok` and `summary`

#### Scenario: An editing delegate's changes are counted
- **GIVEN** a git workspace and a grant running `EDIT_AGENT` whose faux model edits `src/a.ts`
- **WHEN** the call completes
- **THEN** `files_changed` SHALL be `1` and the record's `DiffEvidence` SHALL hold `src/a.ts` `modified`

### Requirement: A failed child is a failed call
A child that ends with `RunResult.kind` other than `"completed"`, or completes with `ok` false, SHALL make the call answer `{ ok: false }`: the child's failure message, or its `summary`.

#### Scenario: A child past its step limit fails the call
- **GIVEN** an agent grant with `maxSteps` `1` whose script takes two model steps
- **WHEN** the call runs
- **THEN** it SHALL answer `{ ok: false }` with `reached its limit of 1 steps`

### Requirement: A crash while the child runs never starts a second child
The `act` phase SHALL create the child and store its id in one commit, and every later entry SHALL wait for that stored id.

#### Scenario: Resume waits for the same child
- **GIVEN** a run checkpointed at `act` with an agent delegate's child id stored
- **WHEN** the process dies and the run resumes
- **THEN** it SHALL wait for that child and create no other, and the call SHALL complete with the child's result

### Requirement: An agent delegate is called with run only
A script that offers an agent delegate as a reasoning action SHALL be refused at start with `ActionBindingError`, naming the delegate and saying `call it with run`.

#### Scenario: A reasoning-offered agent delegate is refused
- **GIVEN** an agent grant `reviewer` and a script offering `@actions.review` under `reasoning.actions`
- **WHEN** the run is started
- **THEN** it SHALL throw `ActionBindingError` naming `delegate/reviewer` and containing `call it with run`

### Requirement: The bundled delegate scripts fit the contract
`READ_AGENT` SHALL offer `read_file`, `list_files` and `search_files` as reasoning actions to one working subagent, then set `ok` and `summary` from a structured result; `EDIT_AGENT` SHALL add `edit_file` and `run_command`. Both SHALL lint with zero diagnostics and pass the subset scan and the delegate contract.

#### Scenario: The bundled delegate scripts are clean
- **WHEN** `READ_AGENT` and `EDIT_AGENT` are analysed, scanned and contract-checked
- **THEN** each SHALL have no diagnostic, no unsupported construct and no contract problem
