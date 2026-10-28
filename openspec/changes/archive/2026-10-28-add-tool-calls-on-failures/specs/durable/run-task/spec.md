## MODIFIED Requirements

### Requirement: A step's tool calls reach the machine in call order
When a step with offered tools settles, answered or failed, the await phase SHALL read every action tool call in the step conversation, in call order, and report them as the outcome's `toolCalls`: `name`, the merged `inputs`, `ok` (false for an error result), the host's `outputs` (`{}` for an error result), and the host's `record`. Calls to `submit_result` SHALL NOT be listed.

#### Scenario: Two shell calls are reported
- **GIVEN** an `act` step in which the model called `shell` twice and then answered
- **WHEN** the await phase folds the answer in
- **THEN** the outcome's `toolCalls` SHALL hold two `shell` entries, in order, with `ok` true and their outputs

#### Scenario: A step whose result is refused reports its calls
- **GIVEN** an `act` step in which the model called `shell` once and then had `submit_result` refused three times
- **WHEN** the await phase settles it
- **THEN** the outcome SHALL be `failed` and its `toolCalls` SHALL hold the one `shell` call
