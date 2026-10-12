## Purpose
One typed config builds an agent host: named model closures over the runtime's environment, a workspace factory, the host's own actions, granted delegates and their runners — so a Node host and, later, a Cloudflare host differ only in the closures they pass.

## ADDED Requirements

### Requirement: The durable entry exports the config types
`@specsesh/agent/durable` SHALL export the types `ModelFactory<Env>`, `(env: Env) => { provider: Provider, model: ModelRef }`, and `AgentConfig<Env>`, `{ models: { default: ModelFactory<Env> } & Record<string, ModelFactory<Env>>, workspace: (env: Env) => Workspace, allow?, checks?, timeoutMs?, actions?: (env, workspace) => HostAction[], delegates?: DelegateGrants, runners?: Runners }`.

#### Scenario: A config without a default model does not type-check
- **WHEN** a TypeScript file declares an `AgentConfig<{}>` whose `models` lacks `default`
- **THEN** `tsc --noEmit` SHALL report an error on it

### Requirement: createAgentHarness builds a harness from a config
`@specsesh/agent/node` SHALL export `createAgentHarness(config, { storage, env, extensions?, context })`, resolving `{ harness, models, actions, workspace }`: `workspace` from `config.workspace(env)`; `actions` the registry of `workspaceActions(workspace, …)`, then `config.actions`, then `delegationActions(config.delegates, { workspace, runners })`; `harness` with the run and step extensions over `actions`, then `extensions` in order.

#### Scenario: A script runs on the config's default model in its workspace
- **GIVEN** a config whose `default` model is a faux provider answering an `edit_file` call, and `workspace: () => localWorkspace(dir)`
- **WHEN** a script with a reasoning `edit_file` action runs on the returned harness with `models.default`
- **THEN** the file SHALL change inside `dir`

#### Scenario: A host's own action sits beside the built-ins
- **GIVEN** `actions: () => [lookupAction]`
- **WHEN** the harness is created
- **THEN** `actions` SHALL hold `read_file`, `edit_file`, `run_command`, `run_checks` and `lookup`

### Requirement: Every model closure is called once and its provider registered once
`createAgentHarness` SHALL call each `ModelFactory` exactly once, in key order, with `env`, before the harness opens, and register each distinct provider once. `models` SHALL map each key to its `ModelRef`. Two factories returning different provider objects with the same provider name SHALL reject, naming both model keys.

#### Scenario: Two models on one provider
- **GIVEN** `default` and `reviewer` returning the same faux provider with different model ids
- **WHEN** the harness is created
- **THEN** each factory SHALL have been called once, the provider registered once, and `models.reviewer` SHALL be the reviewer's `ModelRef`

#### Scenario: A provider name clash is refused
- **GIVEN** `default` and `reviewer` returning two different provider objects both named `faux`
- **WHEN** the harness is created
- **THEN** it SHALL reject naming `default` and `reviewer`

### Requirement: The environment reaches every closure
`createAgentHarness` SHALL pass `options.env` unchanged to every model factory, to `config.workspace` and to `config.actions`, and read nothing else from the process environment for them.

#### Scenario: A binding-like value reaches the model factory
- **GIVEN** `env` `{ AI: fakeBinding }` and a `default` factory that builds its provider from `env.AI`
- **WHEN** the harness is created
- **THEN** the factory SHALL have received that same `fakeBinding`

### Requirement: The task CLI builds its harness from a config
`agentscript-task` SHALL build its harness with `createAgentHarness`: `models.default` from the resolved provider and model, `workspace: () => localWorkspace(<the run's workspace>)`, the resolved `checks` and `allow`, the config's `delegates` (none under `--no-delegates`), `runners: defaultRunners`, and `extensions: [TaskLoop, GroupLoop]`.

#### Scenario: A granted delegate reaches the CLI's registry
- **GIVEN** a repo config granting `claude_code`
- **WHEN** `run` builds its harness
- **THEN** its `actions` SHALL hold `delegate/claude_code`, and SHALL hold no `delegate_claude_code`
