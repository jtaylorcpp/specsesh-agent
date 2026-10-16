## Purpose

Picking which tests to run when a minor task of a change closes: a bundled Agent Script, a runner that never throws and never invents a test path, a deterministic sibling pre-filter, the shared `TestPick` shape and `testPattern`, and the `agentscript-task pick-tests` command.

## ADDED Requirements

### Requirement: The bundled ci-test-pick script picks from the task, its scenarios and the changed files
The package SHALL bundle `ci-test-pick.agent` declaring string variables `task_id`, `task_text`, `scenarios`, `changed_files`, `test_files`, `diff`, `siblings` and `pick`. One step SHALL show the inputs and set `pick` from its structured result. The prompt SHALL say to pick only paths from `test_files` and SHALL show the diff only when `diff` is non-empty.

#### Scenario: The picker script shows the task and reads back one pick
- **GIVEN** `pickTests` on a recording port with `task_text` `"Add retries"`, `scenarios` `"Retries back off"` and `test_files` `"src/a.test.ts"`
- **WHEN** it runs
- **THEN** exactly one step SHALL be requested, its prompt SHALL contain `Add retries`, `Retries back off` and `src/a.test.ts`, and its output schema SHALL have the property `pick`

#### Scenario: The diff is shown only when given
- **GIVEN** two runs of `pickTests` on recording ports, one with `diff` `"+retry()"` and one without `diff`
- **WHEN** each runs
- **THEN** the first prompt SHALL contain `+retry()` and the second SHALL NOT contain `Diff`

### Requirement: pickTests answers a checked pick drawn only from the repository's test files
`pickTests(input, options)` SHALL parse `pick` as JSON, check it against `TestPick`, drop every test path not in `test_files` (compared after trimming and removing a leading `./`) with its reason, dedupe `tests`, `names` and `reasons` by test, and answer `{ ok: true, pick }`.

#### Scenario: A valid pick is returned
- **GIVEN** `test_files` `"src/a.test.ts\nsrc/b.test.ts"` and a port answering `pick` `{"tests":["src/b.test.ts"],"names":["retries"],"reasons":[{"test":"src/b.test.ts","why":"imports b"}]}`
- **WHEN** `pickTests` runs
- **THEN** it SHALL answer `ok` `true` with `tests` `["src/b.test.ts"]`, `names` `["retries"]` and that reason

#### Scenario: An invented test path is dropped
- **GIVEN** `test_files` `"src/a.test.ts"` and a pick naming `src/a.test.ts` and `src/made-up.test.ts`, each with a reason
- **WHEN** `pickTests` runs
- **THEN** `tests` SHALL be `["src/a.test.ts"]` and no reason SHALL name `src/made-up.test.ts`

#### Scenario: Duplicate tests and names are removed
- **GIVEN** a pick naming `./src/a.test.ts` and `src/a.test.ts`, and the name `retries` twice
- **WHEN** `pickTests` runs
- **THEN** `tests` SHALL be `["src/a.test.ts"]` and `names` `["retries"]`

### Requirement: A test beside a changed file is always picked
Before the model runs, `pickTests` SHALL add every file of `test_files` that is a sibling of a changed file: same stem, in the same directory or its `__tests__`, `tests` or `test` subdirectory, named `<stem>.test.*`, `<stem>.spec.*`, `<stem>_test.*` or `test_<stem>.*`. A changed file in `test_files` SHALL be picked. Siblings come first, even when the model omits them.

#### Scenario: Sibling tests are added by the pre-filter
- **GIVEN** `changed_files` `"src/a.ts\npkg/foo.go\nlib/mod.py"`, `test_files` holding `src/a.test.ts`, `pkg/foo_test.go`, `lib/test_mod.py` and `src/other.test.ts`, and a pick naming no tests and the name `x`
- **WHEN** `pickTests` runs
- **THEN** `tests` SHALL be `["src/a.test.ts","pkg/foo_test.go","lib/test_mod.py"]`, and the script's `siblings` SHALL list them

#### Scenario: A changed test file is picked
- **GIVEN** `changed_files` `"src/b.test.ts"`, which is in `test_files`, and a pick naming no tests and the name `x`
- **WHEN** `pickTests` runs
- **THEN** `tests` SHALL contain `src/b.test.ts`

### Requirement: pickTests never throws
`pickTests` SHALL answer `{ ok: false, reason }`, never throw, when the output is not JSON or fails `TestPick`, when the run does not complete or the port throws, when `timeoutMs` passes first, when `test_files` is empty (with no model call), or when the pick has no tests and no names.

#### Scenario: Invalid JSON answers ok false
- **GIVEN** a port answering `pick` `"not json"`
- **WHEN** `pickTests` runs
- **THEN** it SHALL answer `ok` `false` with a `reason` containing `JSON`

#### Scenario: A pick that fails the TestPick schema answers ok false
- **GIVEN** a port answering `pick` `{"tests":"src/a.test.ts"}`
- **WHEN** `pickTests` runs
- **THEN** it SHALL answer `ok` `false` with a `reason` containing `TestPick`

#### Scenario: A timeout answers ok false
- **GIVEN** a port that never answers and `timeoutMs` `20`
- **WHEN** `pickTests` runs
- **THEN** it SHALL answer `ok` `false` with a `reason` containing `timed out`

#### Scenario: A provider failure answers ok false
- **GIVEN** one port answering a failed step `rate_limit` and another that throws
- **WHEN** `pickTests` runs on each
- **THEN** both SHALL answer `ok` `false` without throwing

#### Scenario: No test files answers ok false without a model call
- **GIVEN** `test_files` `""`
- **WHEN** `pickTests` runs on a recording port
- **THEN** it SHALL answer `ok` `false` and the port SHALL have no request

### Requirement: testPattern joins regex-escaped test names
`./openspec` SHALL export the TypeBox schemas `TestPick` and `TestReason` and `testPattern(names)`, which SHALL escape each name's regular-expression metacharacters and `/`, and join the names with `|`; for no names it SHALL answer `""`. `./task` SHALL re-export `testPattern`.

#### Scenario: Names are escaped and joined
- **WHEN** `testPattern(["retries (backoff)", "a.b|c"])` is called
- **THEN** it SHALL answer `retries \(backoff\)|a\.b\|c`, and that pattern SHALL match `a.b|c` but not `aXb|c`

#### Scenario: No names give an empty pattern
- **WHEN** `testPattern([])` is called
- **THEN** it SHALL answer `""`

### Requirement: agentscript-task pick-tests runs the picker from a JSON file
`agentscript-task pick-tests --input <file.json> [--provider <id>] [--model <id>] [--timeout <ms>]` SHALL run `pickTests` on the file's input and print on stdout `{ ok: true, pick, pattern }` (exit 0) or `{ ok: false, reason }` (exit 1). A missing `--input` or an unreadable file SHALL exit 2.

#### Scenario: pick-tests prints the pick as JSON
- **GIVEN** an input file whose `test_files` is `"src/a.test.ts"`, and a faux model answering `pick` with that test and the name `retries`
- **WHEN** `agentscript-task pick-tests --input <file>` runs on that model
- **THEN** it SHALL exit 0 and print JSON with `ok` `true`, `pick.tests` `["src/a.test.ts"]` and `pattern` `retries`

#### Scenario: pick-tests without --input prints usage
- **WHEN** `agentscript-task pick-tests` runs with no `--input`
- **THEN** it SHALL exit 2 and print usage on stderr
