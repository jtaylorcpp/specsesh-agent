# task/headless Specification

## Purpose
Running the task agent unattended in a repository: defaults from a repo config, changes by id, the next unticked task, progress as JSON Lines, a clean-tree guard, and a status listing, so `pnpm task <change-id> <task-id>` works with no flags and no one at the keyboard.

## Requirements

### Requirement: The repo config is found by walking up
`agentscript-task` SHALL read the nearest `agentscript.config.json`, found by checking the current directory and then each parent up to the filesystem root. With none found, every value falls back to its flag or default and nothing is granted. Only the file's `task` and `delegates` objects SHALL be read; other top-level keys are ignored.

#### Scenario: A config in a parent directory is found
- **GIVEN** `agentscript.config.json` in the repo root and the CLI run from `packages/agent`
- **WHEN** `run` resolves its options
- **THEN** it SHALL use the repo root's config

#### Scenario: No config means defaults
- **GIVEN** no `agentscript.config.json` in the directory or any parent
- **WHEN** `run` is given every required flag
- **THEN** it SHALL run with the CLI defaults

#### Scenario: No config grants nothing
- **GIVEN** no `agentscript.config.json` and `--script task-delegate`
- **WHEN** `run` starts
- **THEN** it SHALL exit `2` naming `delegate/claude_code` and `no delegates are granted`

### Requirement: The task config has a fixed set of typed fields
The `task` object SHALL accept only these fields, all optional: strings `changesDir`, `db`, `provider`, `model`, `script`, `groupScript` and `worktreeDir`; string arrays `checks`, `allow` and `worktreeSetup`; positive integers `maxIterations` and `maxReworks`; booleans `requireCleanTree`, `worktree` and `deleteFiles`; and `escalateTo`, `"principal"` or `"agent"`. `deleteFiles` (default `false`, no flag or environment variable) SHALL reach `taskLoopExtensions` and `startTaskLoop`.

#### Scenario: An empty task object is valid
- **GIVEN** `{ "task": {} }`
- **WHEN** the config is read
- **THEN** it SHALL be accepted and every value SHALL fall back to its default

#### Scenario: A mistyped grant is refused
- **GIVEN** `{ "task": { "deleteFiles": "yes" } }`
- **WHEN** `run` starts
- **THEN** stderr SHALL contain the config's path and `task.deleteFiles must be a boolean`, the exit code SHALL be `2`, and no database SHALL be opened

#### Scenario: A config without the grant binds no delete
- **GIVEN** a config whose `task` has no `deleteFiles`
- **WHEN** `run` starts a loop
- **THEN** the loop's stored `deleteFiles` SHALL be `false` and its harness registry SHALL hold no `delete_file` action

#### Scenario: Resume keeps the grant the loop started with
- **GIVEN** a loop started under a config with `"deleteFiles": true`, after which `deleteFiles` is removed from the config
- **WHEN** `agentscript-task resume <loop>` runs
- **THEN** the rebuilt harness SHALL bind `delete_file`

### Requirement: An unknown or mistyped config value refuses the run
A key in `task` that is not one of its fields, or a field whose value has the wrong type, MUST make the CLI exit `2` before any database is opened, printing the config path and naming the key. It SHALL NOT fall back to a default.

#### Scenario: A misspelled key is refused
- **GIVEN** `{ "task": { "maxIteration": 3 } }`
- **WHEN** `run` starts
- **THEN** stderr SHALL name `maxIteration` and the config's path, and the exit code SHALL be `2`

#### Scenario: A wrong type is refused
- **GIVEN** `{ "task": { "checks": "pnpm test" } }`
- **WHEN** `run` starts
- **THEN** stderr SHALL name `checks`, and the exit code SHALL be `2`

### Requirement: Values resolve flag, then environment, then config, then default
Each value SHALL resolve separately: its flag when given, else its environment variable where one exists (`AGENTSCRIPT_PROVIDER`, `AGENTSCRIPT_MODEL`), else the config field, else the default: provider `anthropic`, model `claude-haiku-4-5`, script `task`, `groupScript` `group`, `maxIterations` `8`, `maxReworks` `2`, `escalateTo` `"principal"`, `requireCleanTree` `true`, `changesDir` `openspec/changes`, and no delegates.

#### Scenario: The environment beats the config
- **GIVEN** a config with `"model": "claude-haiku-4-5"` and `AGENTSCRIPT_MODEL=sonnet`
- **WHEN** `run` starts without `--model`
- **THEN** the model SHALL be `sonnet`

#### Scenario: Unset fields fall through independently
- **GIVEN** a config with only `"checks": ["pnpm test"]`
- **WHEN** `run` starts with `--max-iterations 5`
- **THEN** `checks` SHALL come from the config and `maxIterations` SHALL be `5`

#### Scenario: The iteration budget defaults to eight
- **GIVEN** a config with no `maxIterations`
- **WHEN** `run` starts without `--max-iterations`
- **THEN** `budget.maxIterations` SHALL be `8`

### Requirement: Config paths are relative to the config file
`changesDir`, `db`, a `script` path and each grant's `context` entry SHALL be resolved against the directory holding `agentscript.config.json`, not the current directory. The database's parent directory SHALL be created if it does not exist.

#### Scenario: The database path is anchored at the config
- **GIVEN** the repo root's config with `"db": ".agentscript/task-loops.sqlite"` and the CLI run from `packages/agent`
- **WHEN** `run` opens the database
- **THEN** it SHALL open `<repo root>/.agentscript/task-loops.sqlite`, creating `.agentscript/` if missing

#### Scenario: A grant's context is anchored at the config
- **GIVEN** the repo root's config granting `claude_code` with `"context": ["CLAUDE.md"]` and the CLI run from `packages/agent`
- **WHEN** the delegate runs
- **THEN** it SHALL be given `<repo root>/CLAUDE.md`

### Requirement: script names a bundled script or a file
A `script` value of `task` or `task-delegate` SHALL select that bundled script. Any other value SHALL be read as a path to a `.agent` file. A path that does not exist MUST refuse the run with exit `2`, naming it.

#### Scenario: A bundled name selects the bundled script
- **GIVEN** a config with `"script": "task-delegate"`
- **WHEN** `run` starts
- **THEN** the loop SHALL run the bundled `task-delegate.agent`

#### Scenario: A missing script file is refused
- **WHEN** `run` is given `--script ./nope.agent`
- **THEN** stderr SHALL name `./nope.agent`, and the exit code SHALL be `2`

### Requirement: A change is given by id or by path
`run`'s change argument SHALL be read as a path when it contains a path separator or names an existing directory, and otherwise as an id under `changesDir`. An id with no such directory MUST exit `2`, listing the open changes (the directories under `changesDir` other than `archive`).

#### Scenario: An id resolves under changesDir
- **GIVEN** `changesDir` `openspec/changes` and the change `fixture-live-task` in it
- **WHEN** the CLI runs `run fixture-live-task 1.1`
- **THEN** the loop SHALL read `openspec/changes/fixture-live-task`

#### Scenario: An unknown id lists the open changes
- **WHEN** the CLI runs `run no-such-change 1.1`
- **THEN** stderr SHALL name `no-such-change` and list the open change ids, and the exit code SHALL be `2`

### Requirement: --next picks the first unticked task
With `--next` in place of a task id, `run` SHALL select the first `- [ ] <id>` line of the change's `tasks.md`, in file order. A change with no unticked task SHALL print `no unticked task in <change>` to stdout and exit `0` without creating a loop.

#### Scenario: --next skips ticked tasks
- **GIVEN** a `tasks.md` whose `1.1` is ticked and `1.2` is not
- **WHEN** the CLI runs `run <change> --next`
- **THEN** the loop SHALL run task `1.2`

#### Scenario: A finished change exits 0 with a message
- **GIVEN** a `tasks.md` with every task ticked
- **WHEN** the CLI runs `run <change> --next`
- **THEN** stdout SHALL be `no unticked task in <change>`, the exit code SHALL be `0`, and no loop SHALL be created

### Requirement: The CLI is headless
`agentscript-task` SHALL never prompt and SHALL NOT require a terminal: it reads nothing from stdin, and behaves the same when stdin, stdout and stderr are not TTYs.

#### Scenario: It runs with no terminal
- **GIVEN** stdin closed and stdout and stderr redirected to files
- **WHEN** `run` runs a loop to its end
- **THEN** it SHALL exit with the outcome's exit code and never wait for input

### Requirement: Progress is a JSON Lines stream on stderr
During `run`, `resume` and `answer`, stderr SHALL carry one JSON object per line for each event, after the `task/cli` resume hint, which stays the first stderr line. Each event SHALL have `event`, `loop` and the fields of its kind. The final outcome goes to stdout, never to this stream.

#### Scenario: Every stderr line after the hint is JSON
- **WHEN** a loop runs two iterations
- **THEN** every stderr line after the first SHALL parse as a JSON object with `event` and `loop`

### Requirement: loop-ended lists the files the loop changed
`loop-ended.changed` SHALL list, sorted, the paths whose `git status --porcelain` entry or content in the workspace differs between the loop's `task/agent` baseline and its end, except the change's `tasks.md` (its tick is `ticked`) and the database's own files. The same holds after `resume`, for a run started by `answer`, and for each task of a group. Outside a git repository it SHALL be `[]`.

#### Scenario: Only the edited file is listed
- **GIVEN** a clean git workspace
- **WHEN** a loop edits `src/a.ts`, converges and ticks its task in the workspace's `tasks.md`
- **THEN** `loop-ended.changed` SHALL be `["src/a.ts"]`

#### Scenario: A resumed loop lists edits made before the crash
- **GIVEN** a loop whose iteration 1 wrote `src/a.ts`, and whose process was killed during iteration 2
- **WHEN** `resume <loop-id>` finishes the loop, and iteration 2 writes `src/b.ts`
- **THEN** `loop-ended.changed` SHALL be `["src/a.ts", "src/b.ts"]`

#### Scenario: An answered run lists the blocked run's edits
- **GIVEN** a loop blocked after iteration 1, which wrote `src/a.ts`
- **WHEN** `answer <loop-id> --by principal --decision "…"` runs the new run, and that run writes `src/b.ts` and converges
- **THEN** the new run's `loop-ended.changed` SHALL be `["src/a.ts", "src/b.ts"]`

#### Scenario: A group's task lists only its own files
- **GIVEN** a group whose task `1.1` writes `src/a.ts` and converges, then task `1.2` writes `src/b.ts` and converges
- **WHEN** task `1.2`'s `loop-ended` is emitted
- **THEN** its `changed` SHALL be `["src/b.ts"]`

### Requirement: A dirty working tree refuses the run
Before creating a loop, `run` SHALL run `git status --porcelain` in the workspace. Non-empty output MUST exit `2`, printing at most 20 of the listed paths and how many more there are, unless `--allow-dirty` is given or `requireCleanTree` is `false`. Ignored files do not appear in that output and so never trip the guard.

#### Scenario: An uncommitted change refuses the run
- **GIVEN** a workspace with an uncommitted edit to `README.md`
- **WHEN** `run` starts without `--allow-dirty`
- **THEN** stderr SHALL list `README.md`, the exit code SHALL be `2`, and no loop SHALL be created

#### Scenario: More than 20 paths are truncated
- **GIVEN** 25 untracked files
- **WHEN** `run` refuses
- **THEN** stderr SHALL list 20 paths and say `5 more`

#### Scenario: --allow-dirty overrides the guard
- **GIVEN** a workspace with an uncommitted edit
- **WHEN** `run` starts with `--allow-dirty`
- **THEN** the loop SHALL be created

#### Scenario: The database under an ignored directory does not trip the guard
- **GIVEN** `.agentscript/` in `.gitignore` and an existing `.agentscript/task-loops.sqlite`
- **WHEN** `run` starts in an otherwise clean tree
- **THEN** the loop SHALL be created

### Requirement: Outside git the guard is skipped with a warning
When the workspace is not inside a git repository, `run` SHALL skip the clean-tree guard and emit a `warning` event whose `message` says the guard was skipped.

#### Scenario: A plain directory runs with a warning
- **GIVEN** a workspace that is not a git repository
- **WHEN** `run` starts
- **THEN** the loop SHALL be created and the stream SHALL hold a `warning` event about the skipped guard

### Requirement: The runner never commits
`agentscript-task` SHALL run only `git status`, `git rev-parse`, `git worktree add`, `git worktree list` and `git config user.name`. It SHALL NOT commit, add, stash, check out or remove anything. Its only writes are a worktree and branch it creates, the files the loop's actions change, the ticked line in `tasks.md`, and the database.

#### Scenario: A converged loop leaves its work uncommitted
- **WHEN** a loop converges in a git workspace
- **THEN** `git log` SHALL show the same HEAD as before the run, and the loop's edits SHALL be uncommitted

### Requirement: --worktree runs the loop in a new git worktree
With `--worktree` or config `worktree: true`, `run` SHALL create a worktree `<worktreeDir>/<change-id>-<task-id>` on a new branch `task/<change-id>/<task-id>` from `HEAD` (`git worktree add -b`) and run the loop there: the workspace, the change and config paths inside the repo resolve to the same place in the worktree. `worktreeDir` SHALL default to `../<repo-dir-name>-worktrees` from the repo root. Outside git it MUST exit `2`.

#### Scenario: A task runs in its own worktree
- **GIVEN** this repo at a clean `HEAD` and change `add-task-agent` committed
- **WHEN** `agentscript-task run add-task-agent 2.4 --worktree --db task-2.4.sqlite` converges
- **THEN** the worktree `../agentscript-worktrees/add-task-agent-2.4` SHALL exist on branch `task/add-task-agent/2.4`, hold the edits and the ticked line, and the main tree's `HEAD` and files SHALL be unchanged

### Requirement: A worktree is never reused or clobbered by run
`run --worktree` MUST exit `2` before creating anything when the branch `task/<change-id>/<task-id>` or the worktree path already exists, naming which. It MUST also exit `2` when the change does not exist at `HEAD`, saying the worktree starts from `HEAD`.

#### Scenario: An existing branch refuses the run
- **GIVEN** a branch `task/add-task-agent/2.4` already exists
- **WHEN** `run add-task-agent 2.4 --worktree --db t.sqlite` starts
- **THEN** stderr SHALL name the branch, the exit code SHALL be `2`, and no worktree or loop SHALL be created

#### Scenario: An uncommitted change refuses worktree mode
- **GIVEN** a change directory that exists in the working tree but not at `HEAD`
- **WHEN** `run <that change> 1.1 --worktree --db t.sqlite` starts
- **THEN** the exit code SHALL be `2` and stderr SHALL say the change is not committed at `HEAD`

### Requirement: Worktree setup runs before the loop
In worktree mode, `run` SHALL run each `worktreeSetup` command in the worktree, in order, before creating the loop. A non-zero exit MUST end the run with exit `1`, naming the command, and leave the worktree in place for inspection.

#### Scenario: A failing setup command leaves the worktree
- **GIVEN** `worktreeSetup: ["node -e process.exit(3)"]`
- **WHEN** `run --worktree --db t.sqlite` reaches setup
- **THEN** the exit code SHALL be `1`, stderr SHALL name the command, and the worktree SHALL remain

### Requirement: In worktree mode the main tree may be dirty
In worktree mode the clean-tree guard SHALL apply to the new worktree, not the main tree. Uncommitted changes in the main tree SHALL NOT refuse the run; they SHALL produce a `warning` event giving their count, because they are absent from the worktree.

#### Scenario: Working in the main tree while a task runs
- **GIVEN** an uncommitted edit to `README.md` in the main tree
- **WHEN** `run add-task-agent 2.4 --worktree --db t.sqlite` starts
- **THEN** the loop SHALL be created and the stream SHALL hold a `warning` event saying `1` uncommitted change is not in the worktree

### Requirement: Worktree mode requires an explicit database
`run --worktree` MUST be given `--db` on the command line; the config's `db` SHALL NOT be used in worktree mode. Without `--db` it MUST exit `2` before creating anything, saying worktree mode needs `--db`.

#### Scenario: A worktree run without --db is refused
- **GIVEN** this repo's config, which sets `db`
- **WHEN** `run add-task-agent 2.4 --worktree` starts with no `--db`
- **THEN** the exit code SHALL be `2`, stderr SHALL say worktree mode needs `--db`, and no worktree or loop SHALL be created

### Requirement: Worktree tasks can run in parallel
Several `run --worktree` processes for different tasks, each with its own `--db`, SHALL run at the same time, each in its own worktree and database, sharing nothing but the git repository.

#### Scenario: Two tasks run at once
- **WHEN** `run add-task-agent 2.3 --worktree --db a.sqlite` and `run add-task-agent 2.4 --worktree --db b.sqlite` run concurrently
- **THEN** both SHALL complete, each in its own worktree and branch, and neither database SHALL hold the other's loop

### Requirement: A database is held by one live process
`run`, `resume` and `answer` SHALL take an exclusive lock, a file `<db>.lock` holding the process id, before opening the database, and release it on exit. When another live process holds the lock they MUST exit `2`, naming that pid. A lock whose process is no longer alive SHALL be taken over, with a `warning` event.

#### Scenario: A second process on the same database is refused
- **GIVEN** a running loop on `a.sqlite`
- **WHEN** another `run … --db a.sqlite` starts
- **THEN** it SHALL exit `2` naming the holder's pid, and the first loop SHALL be unaffected

#### Scenario: A stale lock is taken over
- **GIVEN** `a.sqlite.lock` naming a process that no longer exists
- **WHEN** `run … --db a.sqlite` starts
- **THEN** the run SHALL proceed and the stream SHALL hold a `warning` event about the stale lock

### Requirement: The loop remembers its worktree
A loop run in worktree mode SHALL record `worktree: { path, branch }` in its database. `resume` and `status`, given the same `--db`, SHALL use it: `resume` runs in that path, `status` shows the branch. The final output SHALL print the path, the branch, `git -C <path> diff` and `git worktree remove <path>`.

#### Scenario: Resume finds the worktree
- **GIVEN** a worktree-mode loop whose process died
- **WHEN** `agentscript-task resume <loop> --db <same db>` runs from the main tree
- **THEN** the loop SHALL continue with the worktree as its workspace

#### Scenario: The output says how to review and remove
- **WHEN** a worktree-mode loop ends
- **THEN** stdout SHALL contain the worktree path, `task/<change-id>/<task-id>`, `git -C <path> diff` and `git worktree remove <path>`

### Requirement: status lists the loops in the database
`agentscript-task status` SHALL print one line per loop in the database, task and group loops alike, newest first: its id, change, task (or `group <n>`), status and iteration count. The status is `running`, `interrupted` (by the owner rule), `converged`, `blocked`, `exhausted` or `failed`. A loop that is `blocked` or has ended is never shown as `interrupted`. With no loops, `status` SHALL print `no loops in <db>` and exit `0`.

#### Scenario: Two loops are listed newest first
- **GIVEN** loop `1` converged and loop `2` blocked
- **WHEN** `status` runs
- **THEN** the first line SHALL describe loop `2` as `blocked` and the second loop `1` as `converged`

#### Scenario: An empty database
- **WHEN** `status` runs on a database with no loops
- **THEN** stdout SHALL be `no loops in <db>` and the exit code SHALL be `0`

#### Scenario: A group loop and its task loops are listed
- **GIVEN** a group loop for group `1` that ran task loops for `1.1` and `1.2`
- **WHEN** `status` runs
- **THEN** it SHALL list the group loop as `group 1` and each task loop with its task id

#### Scenario: An interrupted loop is marked and a blocked one is not
- **GIVEN** task loop `10` with no outcome whose owner's process is dead and no `<db>.lock`, and loop `12` blocked on an escalation
- **WHEN** `status` runs
- **THEN** loop `10`'s line SHALL show `interrupted` and loop `12`'s line SHALL show `blocked`

### Requirement: The live run never outlives its test
`pnpm test:live` SHALL give each run a time limit below its test timeout, and on reaching it, or when the test ends for any reason, MUST kill the runner and every process it started (its process group), so no model call continues after the test.

#### Scenario: A stalled live run is killed with its children
- **GIVEN** a live run whose loop does not finish within the limit
- **WHEN** the limit is reached
- **THEN** the runner and its `claude` children SHALL be gone, and the test SHALL fail saying the run was killed at the limit

### Requirement: This repo ships a config for its own tasks
The repository root SHALL hold `agentscript.config.json` configuring this repo's own tasks: the `claude-code` provider running `task-delegate` on Opus, a `claude_code` delegate granted on Opus, this repo's checks and allowlist, a gitignored database, a prefer-offline install as worktree setup (pnpm keeps one store per filesystem, so a worktree elsewhere may need to download), and the `delete_file` grant. It SHALL hold exactly the values the scenario lists.

#### Scenario: The shipped config is valid
- **WHEN** the repo's `agentscript.config.json` is read
- **THEN** it SHALL be accepted; `task` SHALL be exactly `changesDir` `openspec/changes`, `db` `.agentscript/task-loops.sqlite`, `provider` `claude-code`, `model` `opus`, `script` `task-delegate`, `checks` `["pnpm check", "pnpm test"]`, `allow` `["pnpm", "node"]`, `maxIterations` `8`, `escalateTo` `principal`, `requireCleanTree` `true`, `worktreeSetup` `["pnpm install --frozen-lockfile --prefer-offline"]` and `deleteFiles` `true`
- **AND** `delegates` SHALL be exactly `{ claude_code: { runner: "claude-code", model: "opus", allow: ["pnpm", "node"], context: ["CLAUDE.md"] } }`

### Requirement: The repo wires the runner in
The root `package.json` SHALL have a `task` script `node packages/specsesh/bin/specsesh.js task`, so `pnpm task <change-id> <task-id>` runs `specsesh task` with `run` implied, and a `test:live` script running the live run. `.gitignore` SHALL list `.agentscript/`. `CLAUDE.md` SHALL have a section on running a task: the command, `--next`, `status`, answering an escalation, and that the runner never commits.

#### Scenario: The database directory is ignored
- **WHEN** `.gitignore` is read
- **THEN** it SHALL contain a line `.agentscript/`

#### Scenario: pnpm task runs specsesh task
- **WHEN** the root `package.json` is read
- **THEN** `scripts.task` SHALL be `node packages/specsesh/bin/specsesh.js task`
- **AND** `node packages/specsesh/bin/specsesh.js task status --db <missing>` SHALL print `no loops in <missing>` and exit `0`

#### Scenario: The old task bin prints the specsesh usage
- **GIVEN** a build of `packages/agent`
- **WHEN** `node packages/agent/dist/bin/agentscript-task.js` runs with no arguments
- **THEN** it SHALL exit `2` and stderr SHALL equal what `node packages/specsesh/bin/specsesh.js task` prints

### Requirement: An opt-in live run proves it works on this repo
`pnpm test:live` SHALL copy the repo to a temp directory, commit it in a fresh git repository, add a fixture change `fixture-live-task` whose task `1.1` replaces a named stale comment and whose check asserts the new text, then run `agentscript-task run fixture-live-task 1.1` with the repo config. It is never part of `pnpm test`.

#### Scenario: The live run converges and ticks the task
- **GIVEN** `claude` logged in
- **WHEN** `pnpm test:live` runs
- **THEN** the run SHALL exit `0`, emit `loop-ended` with `status` `"converged"`, tick `1.1` in the fixture's `tasks.md`, and list only the target file in `changed`

#### Scenario: Without a Claude login the live run skips
- **GIVEN** `claude` is missing or not logged in
- **WHEN** `pnpm test:live` runs
- **THEN** it SHALL skip and say why, not fail

### Requirement: A task loop streams six event kinds
A task loop's events SHALL be:
- `loop-started` with `change`, `task`, `script`, `at`;
- `iteration-started` with `iteration`, `at`;
- `action` with `iteration`, `kind`, `summary`, `refs`;
- `evidence` with `iteration`, `kind` and the evidence's own fields;
- `verdict` with `iteration`, `met`, `unmet`, `next`;
- `loop-ended` with `status`, `iterations`, `ticked`, `changed`.

`at` is ISO-8601. A `warning` event with `message` MAY appear.

#### Scenario: A converged loop's stream
- **WHEN** a loop converges on iteration 1
- **THEN** the events SHALL include, in order, `loop-started`, `iteration-started` with `iteration` `1`, at least one `verdict` with `met` `true`, and `loop-ended` with `status` `"converged"`

#### Scenario: A check becomes an evidence event
- **WHEN** an iteration's `run_checks` runs `pnpm test` and it exits `1`
- **THEN** the stream SHALL hold an `evidence` event with `kind` `"check"`, `command` `"pnpm test"` and `exitCode` `1`

### Requirement: A group loop streams four more event kinds
A group loop SHALL add `group-started` with `change`, `group`, `tasks` (the ids), `at`; `group-check` with `commands` (`{ command, exitCode }[]`) and `passed`; `rework` with `task` and `reason`; and `group-ended` with `status`, `tasks` (`{ task, status, runs }[]`) and `changed`. Task events inside a group SHALL carry `group`, and `loop` SHALL be the task loop's id.

#### Scenario: A group's stream
- **WHEN** a two-task group converges with its check passing
- **THEN** the events SHALL include, in order, `group-started`, the task events for `1.1` and `1.2` each with `group` `1`, a `group-check` with `passed` `true`, and `group-ended` with `status` `"converged"`

### Requirement: A group runs in one worktree
With `--worktree`, a group SHALL run in one worktree `<worktreeDir>/<change-id>-<group>` on branch `task/<change-id>/<group>`, under the same rules as a task's worktree: never reused or clobbered, the change committed at `HEAD`, setup before the loop, an explicit `--db`, and the worktree remembered for `resume` and `status`. Every task loop of the group SHALL run in that worktree.

#### Scenario: A group runs in its own worktree
- **WHEN** `run add-group-loop 2 --worktree --db group-2.sqlite` converges
- **THEN** the worktree `../agentscript-worktrees/add-group-loop-2` SHALL exist on branch `task/add-group-loop/2`, holding every task's edits and ticks, and the main tree SHALL be unchanged

### Requirement: groupScript names a bundled script or a file
A `groupScript` value of `group` SHALL select the bundled `group.agent`. Any other value SHALL be read as a path to a `.agent` file. A path that does not exist MUST refuse the run with exit `2`, naming it.

#### Scenario: A missing group script is refused
- **WHEN** `run fixture-live-task 1 --db loops.sqlite --group-script ./nope.agent` starts
- **THEN** stderr SHALL name `./nope.agent`, and the exit code SHALL be `2`

### Requirement: The live run also proves a group
`pnpm test:live` SHALL also run a fixture change with a two-task group, headless on the repo config, under the same time limit and process-group kill as the task run, and expect exit `0`, a `group-ended` event with `status` `"converged"`, and both tasks ticked.

#### Scenario: A live group converges
- **WHEN** `pnpm test:live` runs the group fixture
- **THEN** the group SHALL converge with both of its tasks ticked

### Requirement: The delegates config is a map of grants checked whole
A top-level `delegates` object SHALL map grant names to `DelegateGrant` objects (`actions/delegation`). An invalid grant MUST make the CLI exit `2` before any database is opened, printing the config path and naming the grant and the key. The resolved grants SHALL reach the loop as `delegates`.

#### Scenario: A misspelled grant key is refused
- **GIVEN** `{ "delegates": { "claude_code": { "runner": "claude-code", "modle": "opus" } } }`
- **WHEN** `run` starts
- **THEN** stderr SHALL name `claude_code`, `modle` and the config's path, and the exit code SHALL be `2`

#### Scenario: Grants reach the loop
- **GIVEN** a config granting `claude_code` with `model` `"opus"`
- **WHEN** `run` starts a loop
- **THEN** the loop's stored `delegates` SHALL hold `claude_code` with `model` `"opus"`

### Requirement: The retired delegate fields are refused, saying where they moved
A `task` object holding `delegateModel` or `delegateContext` MUST make the CLI exit `2` before any database is opened, naming the key and saying `moved: grant a delegate under "delegates" instead`.

#### Scenario: An old config is refused with directions
- **GIVEN** `{ "task": { "delegateModel": "sonnet" } }`
- **WHEN** `run` starts
- **THEN** stderr SHALL name `delegateModel` and contain `grant a delegate under "delegates" instead`, and the exit code SHALL be `2`

### Requirement: The repo config may name more models
A top-level `models` object SHALL map names to `{ provider, model }`, each resolved like the run's own provider and model, becoming `createAgentHarness` model factories beside `default` (the run's resolved provider and model). A name of `default`, an unknown provider, or an unknown key MUST exit `2` naming it.

#### Scenario: A named model reaches the harness
- **GIVEN** a config with `"models": { "reviewer": { "provider": "anthropic", "model": "claude-haiku-4-5" } }`
- **WHEN** `run` builds its harness
- **THEN** its `models` SHALL hold `default` and `reviewer`

#### Scenario: Redefining default is refused
- **GIVEN** a config with `"models": { "default": { "provider": "anthropic", "model": "x" } }`
- **WHEN** `run` starts
- **THEN** stderr SHALL name `default` and the exit code SHALL be `2`

### Requirement: An agent grant's script is a bundled name or a path
In the repo config, an agent grant's `script` of `read` or `edit` SHALL select `READ_AGENT` or `EDIT_AGENT`; any other value SHALL be a path resolved against the config file's directory and read once. A path that does not exist MUST exit `2` naming it.

#### Scenario: A bundled delegate script by name
- **GIVEN** a grant `{ "runner": "agent", "model": "reviewer", "script": "read" }`
- **WHEN** `run` builds its harness
- **THEN** the grant's script SHALL be `READ_AGENT`

### Requirement: A spec loop streams its own event kinds
A spec loop's events, each with `loop`, SHALL be `stage-started` with `change`, `stage`, `script`, `at`; one `stage-draft` per gate round with `draft`, `written` and `issues`; `stage-review` with `files` and `question`, or `stage-question` with `question`; and `stage-ended` with `status`, `drafts` and `approved`. They SHALL be JSON Lines on stderr after the resume hint.

#### Scenario: A proposal's stream
- **WHEN** a proposal stage reaches review on its second draft
- **THEN** the events SHALL be, in order, `stage-started`, two `stage-draft` with `draft` `1` and `2`, `stage-review` naming `proposal.md`, and `stage-ended` with `status` `"blocked"` and `drafts` `2`

#### Scenario: An approval's stream
- **WHEN** a review is answered `approve`
- **THEN** the events SHALL be `stage-started` then `stage-ended` with `status` `"converged"`, `drafts` `0` and `approved` `true`

#### Scenario: A question is its own event
- **WHEN** a stage's script asks a question
- **THEN** the stream SHALL hold `stage-question` with that question, and no `stage-review`

### Requirement: The live run also drafts a proposal
`pnpm test:live` SHALL also run `agentscript-task spec fixture-live-spec --intent <one line>` in its copy of the repo, with the repo config. It is never part of `pnpm test`, and skips as the task live run does.

#### Scenario: The live proposal reaches review clean
- **GIVEN** `claude` logged in
- **WHEN** `pnpm test:live` runs
- **THEN** the spec run SHALL exit `0`, emit `stage-review`, and leave a `proposal.md` on which `proposalStage.gate` reports no `ERROR` or `WARNING`

### Requirement: Each loop records its owner, and a dead owner makes it interrupted
A process starting or resuming a loop SHALL write `(loop_id, pid, boot_at)` to table `loop_owner` (key `loop_id`), `boot_at` being the boot time in ms, rounded to the second. Nested loops get the same owner. Without taking the lock, a loop with no outcome and not blocked SHALL be `interrupted` unless `<db>.lock` names its owner's live pid and `boot_at` is within 2 s of the current boot time. A loop without an owner row is `interrupted` only when no live process holds the lock.

#### Scenario: run records the owner
- **WHEN** `run` starts loop `5`
- **THEN** `loop_owner` SHALL hold a row for loop `5` with the process's pid and a `boot_at` within 1 s of `Date.now() - os.uptime() * 1000`, rounded to the second, and `status` SHALL show loop `5` as `running`

#### Scenario: A live lock on another loop does not hide a dead one
- **GIVEN** live pid `200` holding `<db>.lock` and running loop `15`, loop `11` running with owner pid `100`, and loop `3` running with no owner row
- **WHEN** `status` runs
- **THEN** loop `11` SHALL be `interrupted`, and loops `15` and `3` SHALL be `running`

#### Scenario: A reboot is caught despite a reused pid
- **GIVEN** loop `11` running with owner pid `4242` and a `boot_at` 60 s before the current boot time, and `<db>.lock` naming live pid `4242`
- **WHEN** `status` runs
- **THEN** loop `11` SHALL be `interrupted`

### Requirement: The CLI leaves its database out of changed
`run` SHALL start every task, group and change loop with `excludeChanged` set to the database's own files that lie inside the repository: the database file and its `-wal`, `-shm` and `.lock` files. A script's seeded `changed` so never lists them.

#### Scenario: A database in the repository is not seeded as changed
- **GIVEN** a clean git workspace, `--db runs.sqlite` at its root (not ignored), and a script declaring `changed` whose iteration 1 writes `src/a.ts` and ends unmet
- **WHEN** iteration 2 starts
- **THEN** its run SHALL be seeded with `changed` `"src/a.ts"`
