## Why

The first live run of the task runner, on 2026-10-11, burned the principal's subscription for over 30 minutes on a task that had already succeeded. Two defects in the durable step, found by reading the run's database:

1. **The result tool told the model nothing about types.** `submit_result` is registered with an empty, permissive object schema. The claude-code provider hands a tool's schema to `claude --json-schema`, so Claude was constrained by nothing, and the judge sent `met: "true"`, a string, where the step wanted a boolean.
2. **A refused result was retried forever.** `submit_result` refused it ("`met` must be a boolean, got string. Call again."), and the model sent the same thing again, about every 5 seconds, with no bound. The bound had been parked as a known gap.

## What Changes

- **On a structured step, the result tool's parameters are the step's own schema.** A provider that constrains output to a tool's parameters (`claude --json-schema`, API constrained sampling) now enforces the field types. The tool keeps validating with `checkResult` as a defence.
- **Refused results are bounded.** After 3 refused `submit_result` calls in one step, the step settles failed (category `unknown`), naming the last problem, and makes no further model request.

## Out of scope

- Making the model's value choices valid. For example, a `next_action` of `proceed` is a string and passes the schema; the task loop already maps an unknown value to a failed contract.

## Capabilities

- **Modified:** `durable/run-task`.

## Impact

- `packages/agent/src/durable/extension.ts`, its tests, and a regression test that reproduces the live run's exact failure: a provider that answers `met: "true"` forever.
