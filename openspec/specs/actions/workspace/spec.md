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

### Requirement: A workspace may publish
`Workspace` SHALL allow an optional `publish(message)`, resolving `{ commit: string, changed: boolean }` after recording the workspace's changes in its history of record. `localWorkspace` SHALL NOT implement it, because the local runner never commits.

#### Scenario: A local workspace cannot publish
- **WHEN** `localWorkspace(dir)` is read
- **THEN** it SHALL have no `publish`

### Requirement: memoryWorkspace holds files in memory
`@specsesh/agent/durable` SHALL export `memoryWorkspace(files?)`: a `Workspace` whose `root` is `memory:`, whose `read` and `write` use an in-memory map seeded from `files` (refusing absolute paths and `..` escapes with `outside the workspace`), with `list` and `search` over the map, and with no `exec`, `snapshot` or `publish`.

#### Scenario: An in-memory edit round-trips
- **WHEN** `memoryWorkspace({ "a.txt": "1" })` writes `"2"` to `a.txt` and reads it
- **THEN** the read SHALL resolve `"2"`, and the workspace SHALL have no `exec`

### Requirement: A workspace may remove a file
`Workspace` SHALL allow an optional `remove(path): Promise<void>`. It deletes one file at a workspace-relative path and rejects with `WorkspaceError` when it refuses. `delete_file` SHALL do every delete through `remove`. If the workspace has no `remove`, `delete_file` SHALL answer `{ ok: false }` with `this workspace cannot delete files` and delete nothing. `memoryWorkspace` SHALL NOT implement `remove`.

#### Scenario: delete_file uses the workspace it was given
- **GIVEN** an in-memory workspace that has a `remove` and records its calls
- **WHEN** `delete_file` is called with `path` `"a.txt"`
- **THEN** the workspace SHALL have recorded exactly one `remove("a.txt")`

#### Scenario: Deleting needs remove
- **GIVEN** `memoryWorkspace({ "a.txt": "1" })`
- **WHEN** `delete_file` is called with `path` `"a.txt"`
- **THEN** it SHALL answer `{ ok: false }` with `this workspace cannot delete files`, and `read("a.txt")` SHALL still resolve `"1"`

### Requirement: localWorkspace refuses a remove outside the workspace or inside .git
`localWorkspace(dir).remove(path)` SHALL first reject with `WorkspaceError` containing `outside the workspace` for an absolute path, a path with a `..` segment, or a path whose real path leaves `dir`. Failing that, it SHALL reject with `inside .git` for a path with a `.git` segment or whose real path is under `dir/.git`. A rejected call SHALL delete nothing.

#### Scenario: Absolute and parent-directory paths are refused
- **WHEN** `remove("/etc/hosts")` and `remove("../outside.txt")` are called
- **THEN** each SHALL reject with `outside the workspace`, and no file SHALL be deleted

#### Scenario: A symlink out of the workspace is refused
- **GIVEN** `link` in the workspace pointing at `/etc`
- **WHEN** `remove("link/passwd")` is called
- **THEN** it SHALL reject with `outside the workspace`, and `/etc/passwd` SHALL still exist

#### Scenario: A path inside .git is refused
- **WHEN** `remove(".git/config")` is called
- **THEN** it SHALL reject with `inside .git`, and `.git/config` SHALL still exist

#### Scenario: A symlink into .git is refused
- **GIVEN** `gitlink` in the workspace pointing at `dir/.git`
- **WHEN** `remove("gitlink/config")` is called
- **THEN** it SHALL reject with `inside .git`, and `.git/config` SHALL still exist

### Requirement: localWorkspace removes exactly one existing non-directory entry
After the confinement checks, `localWorkspace(dir).remove(path)` SHALL reject with `WorkspaceError` containing `no such file: <path>` for a missing entry, and `is a directory: <path>` for a directory or a symlink to one, deleting nothing. Otherwise it SHALL unlink exactly that one entry. For a symlink whose real path is inside `dir`, it SHALL remove the link and leave the target unchanged.

#### Scenario: A directory is refused
- **GIVEN** a directory `src/legacy` and a symlink `legacylink` pointing at it
- **WHEN** `remove("src/legacy")` and `remove("legacylink")` are called
- **THEN** they SHALL reject with `is a directory: src/legacy` and `is a directory: legacylink`, and both SHALL still exist

#### Scenario: A symlink inside the workspace is removed, not its target
- **GIVEN** `alias.ts` in the workspace pointing at `src/a.ts`
- **WHEN** `remove("alias.ts")` is called
- **THEN** `alias.ts` SHALL no longer exist, and `src/a.ts` SHALL still exist with its content unchanged
