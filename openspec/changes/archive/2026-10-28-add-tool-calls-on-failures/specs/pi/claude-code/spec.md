## MODIFIED Requirements

### Requirement: Calls through the bridge are checked, run on the host and recorded
The bridge handler SHALL refuse an unoffered name unrecorded, and refuse arguments failing `checkToolArguments` with `ok: false`, recorded with `outputs: {}`. Otherwise it SHALL call the host with `{ name, tool: offer.action, inputs: { ...args, ...offer.bound } }`, a throw being `ok: false`, and answer `JSON.stringify(outputs)` or the message. Once the bridge has started, every outcome of the step SHALL carry every recorded call in arrival order as `toolCalls`.

#### Scenario: A call runs on the host with bound inputs winning
- **GIVEN** an offer `lookup` for action `orders/lookup` with bound `{ region: "eu" }`, and a runner that calls the handler with `lookup` and `{ id: "7", region: "us" }` before answering `done`
- **WHEN** the request is reasoned
- **THEN** the host SHALL be called with `{ name: "lookup", tool: "orders/lookup", inputs: { id: "7", region: "eu" } }`
- **AND** the step SHALL be answered `done` with one `toolCalls` entry carrying those inputs and the host's outputs

#### Scenario: Bad arguments never reach the host
- **GIVEN** a runner that calls the handler with an offered tool and a missing required input
- **WHEN** the request is reasoned
- **THEN** the handler SHALL answer `ok: false` with `missing required input`, the host SHALL not be called, and `toolCalls` SHALL hold one entry with `ok: false` and `outputs: {}`

#### Scenario: A listening run sees the bridge's calls
- **GIVEN** a stream sink passed to `reason`, and a runner that makes one good call through the handler
- **WHEN** the request is reasoned
- **THEN** the sink SHALL receive `tool_call` with the merged inputs, then `tool_result` with `ok: true` and the outputs

#### Scenario: A tool step that fails keeps its calls
- **GIVEN** a runner that makes one good call through the handler, then reports `{ is_error: true, result: "boom" }`
- **WHEN** the request is reasoned
- **THEN** the step SHALL be failed with `boom`, and `toolCalls` SHALL hold that call with the host's outputs
