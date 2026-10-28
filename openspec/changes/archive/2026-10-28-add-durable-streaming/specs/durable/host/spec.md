## ADDED Requirements

### Requirement: watchScript streams a durable run's RunEvents
`@specsesh/agent/durable` SHALL export `watchScript(harness, id, context)`, returning an async iterable of `RunEvent`s, a `result` promise that settles as `waitForScript(harness, id, context)` would, and `stop()`. It SHALL import no `node:` module. Steps, actions and `run_end` SHALL come in the order `run` reports them, and iteration ends after `run_end`.

#### Scenario: A durable run watched from the start reports every step
- **GIVEN** a two-step script started with `startScript` and watched before `harness.resume()`
- **WHEN** the run completes
- **THEN** the step and run events SHALL be `step_start`, `step_end`, `step_start`, `step_end`, `run_end`, and `result` SHALL equal `waitForScript`'s

#### Scenario: A step's deltas join to its text
- **GIVEN** a faux model streaming `Hello there.` and a throttled progress policy
- **WHEN** the run is watched from the start
- **THEN** the step's `text_delta`s joined SHALL equal its outcome's text

#### Scenario: A tool step reports its call and result
- **GIVEN** a durable host whose registry offers `read`, and a model that calls it, then answers
- **WHEN** the run is watched
- **THEN** `tool_call` and then `tool_result` for `read` SHALL come between that step's `step_start` and `step_end`

### Requirement: A late watcher receives the run's history first
A watcher attached to a started run SHALL first receive `step_start` and `step_end` for every applied step, and `action_start` and `action_end` for every settled action, without deltas, then the in-flight step's `step_start` and its text so far as one `text_delta`, then live events. A watcher of a finished run SHALL receive the history and `run_end`.

#### Scenario: Attaching mid-run replays the finished steps
- **GIVEN** a two-step run whose first step has been applied
- **WHEN** `watchScript` attaches
- **THEN** it SHALL first yield step 0's `step_start` and `step_end`, then step 1's events and `run_end`

#### Scenario: Attaching after the end yields the history
- **WHEN** `watchScript` attaches to a completed run
- **THEN** it SHALL yield every step's `step_start` and `step_end`, then `run_end`, and end

### Requirement: Watching never changes the run
Watchers SHALL only read. Several watchers MAY attach to one run, each receiving every event independently and buffered. `stop()` SHALL end that watcher's iterator and detach it, leaving the run and other watchers unaffected. An id naming another kind of task SHALL reject `result` and throw from the iterator with `task <id> is a <kind> task, not agentscript.run`.

#### Scenario: Two watchers see the same events
- **WHEN** two watchers follow one run, one reading slowly
- **THEN** both SHALL yield the same event sequence

#### Scenario: stop leaves the run running
- **WHEN** a watcher calls `stop()` mid-run
- **THEN** its iterator SHALL end and the run SHALL still complete, as `waitForScript` shows

#### Scenario: A watched run with and without a watcher ends the same
- **WHEN** the same script runs on the same faux replies once watched and once not
- **THEN** both `waitForScript` results SHALL be equal
