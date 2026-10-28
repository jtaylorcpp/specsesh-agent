## ADDED Requirements

### Requirement: registryHost adapts a registry to a one-shot run
`@specsesh/agent/durable` SHALL export `registryHost(registry, { workspace, signal? })`, returning `{ actionHost, toolHost }`: `actionHost` for `run()`'s `actionHost`, `toolHost` for the pi port's `tools`. Both SHALL run `call.tool`'s `execute(inputs, { workspace, signal })` and answer its result. It SHALL import no `node:` module.

#### Scenario: A registered tool runs through both hosts
- **GIVEN** a registry holding `echo` (`{ text } → { text }`)
- **WHEN** `actionHost` and `toolHost` are each called for tool `echo` with `{ text: "hi" }`
- **THEN** each SHALL answer `{ ok: true, outputs: { text: "hi" } }`
- **AND** `execute` SHALL have received the given `workspace`

### Requirement: registryHost refuses what it cannot run, and never throws
For a tool not in the registry, `registryHost`'s hosts SHALL answer `{ ok: false }` with `mcpTool://<tool> is not registered on this host`. For a durable action they SHALL answer `ok: false` with `<tool> runs only in a durable host`. An `execute` that throws, or answers outputs whose names or types differ from the declared ones, SHALL become `ok: false` with that message.

#### Scenario: An unregistered tool is refused
- **WHEN** either host is called for `nowhere`
- **THEN** it SHALL answer `ok` `false` with `mcpTool://nowhere is not registered on this host`

#### Scenario: Wrong outputs are refused
- **GIVEN** `echo` declared with output `text: string` whose `execute` answers `{ text: 3 }`
- **WHEN** it is called
- **THEN** the host SHALL answer `ok` `false` naming `text`
