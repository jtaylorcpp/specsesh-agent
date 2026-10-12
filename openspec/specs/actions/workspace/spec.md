# actions/workspace Specification

## Purpose
Where an agent's work happens: a runtime-neutral `Workspace` (confined reads and writes, optional process execution, optional snapshots for diffs) that every actor in a loop — the built-in actions, delegates, the checks and the gate — goes through, with `localWorkspace` as its filesystem implementation.

## Requirements

### Requirement: The durable entry exports the workspace interface
`@specsesh/agent/durable` SHALL export the types `Workspace`, `ExecOptions`, `ExecResult` and `WorkspaceSnapshot`, `WorkspaceError`, `diffSnapshots(before, after)`, `workspaceActions(workspace, { allow, checks, timeoutMs })` and `runChecks(workspace, checks, timeoutMs)`. None of these SHALL import a `node:` module.

#### Scenario: The interface loads without Node built-ins
- **WHEN** `src/durable/workspace.ts` and its imports are scanned
- **THEN** none SHALL import a module starting with `node:`

### Requirement: A workspace reads and writes confined paths
`Workspace` SHALL have `root` (string), `read(path)` and `write(path, content)`, with optional `exec` and `snapshot`. `read` and `write` SHALL take paths relative to the workspace and reject with `WorkspaceError` containing `outside the workspace` for any path that leaves it, or `no such file` for a missing read. `write` creates missing parent directories.

#### Scenario: A write then a read round-trips
- **WHEN** a workspace writes `"hello"` to `src/a.ts` and reads `src/a.ts`
- **THEN** the read SHALL resolve to `"hello"`

### Requirement: exec runs an argv with no shell, a time limit and the given environment
`exec(argv, { stdin?, env?, timeoutMs, signal? })` SHALL run `argv[0]` with the rest as arguments and no shell, in the workspace, feeding `stdin`, with exactly `env` when given. It SHALL resolve `{ kind: "exited", code, stdout, stderr }`, `{ kind: "timed-out", stdout, stderr }` after killing a process past `timeoutMs`, or `{ kind: "spawn-error", message }`.

#### Scenario: A metacharacter is an argument
- **WHEN** a local workspace execs `["node", "-e", "console.log(process.argv.length)", ";", "rm"]`
- **THEN** it SHALL resolve `exited` with code `0`, and no `rm` process SHALL start

#### Scenario: A slow process is killed
- **WHEN** a local workspace execs a process that sleeps, with `timeoutMs` `200`
- **THEN** it SHALL resolve `timed-out`, and the process SHALL be gone

### Requirement: Snapshots diff into DiffEvidence
`snapshot()` SHALL resolve a map from path to a value that changes when the path's status or content changes, or `undefined` when the workspace has no history to diff against. `diffSnapshots(before, after)` SHALL return the changed paths sorted, each `added` (absent before), `deleted` (file absent after) or `modified`.

#### Scenario: A created and an edited file
- **GIVEN** a git workspace snapshotted, then `src/new.ts` created and tracked `src/a.ts` edited
- **WHEN** it is snapshotted again and the two are diffed
- **THEN** the result SHALL be `[{ path: "src/a.ts", change: "modified" }, { path: "src/new.ts", change: "added" }]`

### Requirement: localWorkspace implements the workspace over a directory
`@specsesh/agent/node` SHALL export `localWorkspace(dir)`: `root` is `dir`; `read` and `write` refuse absolute paths, `..` escapes and symlinks whose real path leaves `dir`; `exec` uses a child process with cwd `dir`, inheriting the process environment when no `env` is given; `snapshot` is git porcelain status with a content hash per listed path, or `undefined` outside a git repository.

#### Scenario: A symlink out of the workspace is refused
- **GIVEN** `link` in the workspace pointing at `/etc`
- **WHEN** `read("link/passwd")` is called
- **THEN** it SHALL reject with `outside the workspace`

#### Scenario: Outside git there is no snapshot
- **GIVEN** a directory that is not inside a git repository
- **WHEN** `localWorkspace(dir).snapshot()` is called
- **THEN** it SHALL resolve `undefined`

### Requirement: The built-ins are defined over a workspace
`workspaceActions(workspace, { allow, checks, timeoutMs })` SHALL return `read_file`, `edit_file`, `run_command` and `run_checks` with the behaviour `actions/registry` specifies, performing every read, write and process through `workspace`. When `workspace` has no `exec`, `run_command` and `run_checks` SHALL answer `{ ok: false }` with `this workspace cannot run commands`.

#### Scenario: The built-ins use the workspace they were given
- **GIVEN** an in-memory workspace recording its calls
- **WHEN** `edit_file` writes `src/a.ts` and `run_command` runs `pnpm test`
- **THEN** the workspace SHALL have recorded one `write("src/a.ts", …)` and one `exec(["pnpm", "test"], …)`

#### Scenario: Commands need exec
- **GIVEN** a workspace with no `exec`
- **WHEN** `run_checks` runs
- **THEN** it SHALL answer `{ ok: false }` with `this workspace cannot run commands`

### Requirement: The loop's checks run through the workspace
The task loop's gate and the group loop's check SHALL run their checks with `runChecks(workspace, checks, timeoutMs)` over the loop's workspace: each check argv-split, in order, through `exec`. Without `exec` they SHALL fail with `this workspace cannot run commands`, never pass.

#### Scenario: The gate's checks go through the workspace
- **GIVEN** a task loop whose workspace records its `exec` calls and checks `["pnpm test"]`
- **WHEN** a judge answers `met` `True`
- **THEN** the gate SHALL have called `exec(["pnpm", "test"], …)` on that workspace

### Requirement: A workspace may list and search
`Workspace` SHALL allow two optional methods: `list(glob)`, resolving the workspace's file paths matching `glob` (relative, sorted), and `search(pattern, { glob?, limit? })`, resolving `{ path, line, text }` for each line matching the regular expression `pattern` in those files, at most `limit` (default `200`), in path then line order.

#### Scenario: A search finds lines in matching files
- **GIVEN** a workspace with `src/a.ts` holding `export const a = 1;` on line 3
- **WHEN** `search("const a", { glob: "src/**/*.ts" })` is called
- **THEN** it SHALL resolve `[{ path: "src/a.ts", line: 3, text: "export const a = 1;" }]`

### Requirement: localWorkspace lists and searches, honouring .gitignore in git
`localWorkspace` SHALL implement `list` and `search`. Inside a git repository the listed files SHALL be the tracked and untracked files git does not ignore; outside git, every file under the directory except `.git/`. Search SHALL read files as UTF-8 in JavaScript and skip files containing a NUL byte.

#### Scenario: An ignored file is not listed
- **GIVEN** a git workspace with `.gitignore` holding `dist/`, and files `src/a.ts` and `dist/a.js`
- **WHEN** `list("**/*")` is called
- **THEN** it SHALL include `src/a.ts` and SHALL NOT include `dist/a.js`

### Requirement: list_files and search_files are built-ins over list and search
`searchActions(workspace)` SHALL return `list_files` (`{ glob } → { paths }`, newline-joined) and `search_files` (`{ pattern, glob } → { matches }`, one `<path>:<line>: <text>` per line), kind `"read"`, replay `"safe"`, recording no `Action`. A workspace without `list` or `search` SHALL answer `{ ok: false }` with `this workspace cannot list files` or `cannot search files`.

#### Scenario: search_files formats matches
- **GIVEN** the workspace from "A search finds lines in matching files"
- **WHEN** `search_files` is called with `pattern` `"const a"` and `glob` `"src/**/*.ts"`
- **THEN** it SHALL answer `{ ok: true, outputs: { matches: "src/a.ts:3: export const a = 1;" } }`

#### Scenario: Search needs a searchable workspace
- **GIVEN** a workspace without `search`
- **WHEN** `search_files` is called
- **THEN** it SHALL answer `{ ok: false }` with `cannot search files`
