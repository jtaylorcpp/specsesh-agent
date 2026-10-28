## ADDED Requirements

### Requirement: A listening step streams Claude Code's text
When `reason` is given a stream sink, the port SHALL run `claude` with `--output-format stream-json --verbose --include-partial-messages` in place of `--output-format json`, the other flags unchanged, and SHALL pass each non-empty text delta on as `text_delta` and each non-empty thinking delta as `thinking_delta`, in order. Without a sink the argv SHALL be unchanged.

#### Scenario: A listening text step streams its text
- **GIVEN** a stream sink, and a runner that reports stream-json lines with text deltas `"Hel"` and `"lo"` and an empty thinking delta, split across chunks, then a `result` line with `result: "Hello"`
- **WHEN** a text step is reasoned
- **THEN** the sink SHALL receive `text_delta` `"Hel"` then `"lo"` and no `thinking_delta`, and the step SHALL be answered with `"Hello"`

#### Scenario: A step with no listener keeps the json argv
- **GIVEN** no stream sink
- **WHEN** a text step is reasoned
- **THEN** the argv SHALL hold `--output-format json` and none of `stream-json`, `--verbose` or `--include-partial-messages`

#### Scenario: A listening step's argv swaps only the output format
- **GIVEN** a stream sink and a step with a schema
- **WHEN** it is reasoned
- **THEN** the argv SHALL equal the argv without a sink, with `json` after `--output-format` replaced by `stream-json`, `--verbose` and `--include-partial-messages`

### Requirement: A streamed step settles from its result line
A streamed step's outcome SHALL be read from the last stdout line that is a JSON object with `type` `result`, mapped as the `json` output is: text, `structured_output`, cut short at max turns, failure categories and `onResult`. A stream with no result line SHALL fail as output that is not JSON does.

#### Scenario: A structured step settles from the result line
- **GIVEN** a stream sink and a runner that reports only `input_json_delta` lines, then a `result` line with `structured_output` `{ "category": "shipping" }`
- **WHEN** a step with a schema is reasoned
- **THEN** the sink SHALL receive no `text_delta`, and the step SHALL be answered with that structured value

#### Scenario: A streamed max-turns result is cut short
- **GIVEN** a stream sink and a `result` line with `subtype` `error_max_turns` and `num_turns` `4`
- **WHEN** the step is reasoned
- **THEN** it SHALL be cut short with `turns` `4`

#### Scenario: A stream with no result line fails
- **GIVEN** a stream sink and a runner that reports text deltas, exits `1` and writes `boom` to stderr
- **WHEN** the step is reasoned
- **THEN** it SHALL fail `unknown` with `without a JSON result` and `boom`

### Requirement: A runner may report stdout as it arrives
A `Runner` SHALL take an optional fourth argument, `onStdout(chunk)`. `spawnRunner` SHALL call it with each stdout chunk as it arrives, before the process exits, and SHALL still resolve with the whole stdout. A runner that never calls it SHALL still settle the step, with no deltas.

#### Scenario: spawnRunner passes stdout on before exit
- **GIVEN** a fake binary that writes one line, waits, then writes another and exits
- **WHEN** `spawnRunner` runs it with `onStdout`
- **THEN** `onStdout` SHALL receive the first line before the process exits, and the result's `stdout` SHALL hold both lines

#### Scenario: A runner that ignores onStdout still settles
- **GIVEN** a stream sink and a runner that never calls `onStdout`, resolving with stream-json stdout ending in a `result` line
- **WHEN** a text step is reasoned
- **THEN** the sink SHALL receive no `text_delta`, and the step SHALL be answered with the result's text

### Requirement: A listening tool step streams text and reports each call once
A tool step reasoned with a stream sink SHALL stream text deltas as a text step does, and SHALL report each call only through the bridge, as `tool_call` and `tool_result`, never from the stream's `tool_use` blocks.

#### Scenario: A listening tool step streams text and its call
- **GIVEN** a stream sink, and a runner that reports a text delta, a `tool_use` block, makes one good call through the handler, then reports another text delta and a `result` line
- **WHEN** the tool step is reasoned
- **THEN** the sink SHALL receive `text_delta`, `tool_call`, `tool_result`, `text_delta` in that order, with exactly one `tool_call`

#### Scenario: A real claude streams a step's text
- **GIVEN** `pnpm test:claude-code` with a logged-in `claude`
- **WHEN** a text step is reasoned on Haiku with a stream sink
- **THEN** at least one `text_delta` SHALL arrive, and their concatenation SHALL equal the step's text
