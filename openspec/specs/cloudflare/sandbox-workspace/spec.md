# cloudflare/sandbox-workspace Specification

## Purpose
The Cloudflare workspace: a `Workspace` over a Cloudflare Sandbox — real files, git and process execution in a container — cloned from a per-task Artifacts fork that the agent publishes to, with the fork's token kept out of everything the agent or its records can see.

## Requirements

### Requirement: The cloudflare entry exports the sandbox workspace
`@specsesh/agent/cloudflare` SHALL export `sandboxWorkspace(sandbox, { dir, secrets? })` (each secret redacted from every output), `artifactsSandboxWorkspace(artifacts, sandbox, { repo, fork, dir })` and the types `SandboxLike` and `ArtifactsLike`. Their modules SHALL import neither `agents` nor `cloudflare:workers`.

#### Scenario: The workspace modules load in plain Node
- **WHEN** `src/cloudflare/sandbox-workspace.ts` and `src/cloudflare/artifacts.ts` are imported by a Node test
- **THEN** they SHALL load, and their imports SHALL include neither `agents` nor `cloudflare:workers`

### Requirement: SandboxLike is the slice of the Sandbox SDK the workspace uses
`SandboxLike` SHALL be `{ exec(command, { cwd?, env?, timeout?, stdin? }) → { success, stdout, stderr, exitCode }, readFile(path) → { content }, writeFile(path, content), mkdir(path, { recursive }) }`, so a Sandbox SDK instance satisfies it and tests can supply their own.

#### Scenario: A local fake satisfies SandboxLike
- **WHEN** the test fake that runs `bash -c <command>` in a temporary directory is typed as `SandboxLike`
- **THEN** it SHALL type-check, and `sandboxWorkspace` SHALL accept it

### Requirement: Sandbox reads and writes are confined to dir
`read` and `write` SHALL resolve paths against `dir`, refusing absolute paths and `..` escapes with `outside the workspace` before touching the sandbox, and refusing a path whose `realpath -m` (run through `exec`) leaves `dir`. `write` creates missing parent directories with `mkdir`.

#### Scenario: An escape never reaches the sandbox
- **WHEN** `write("../x", "y")` is called
- **THEN** it SHALL reject with `outside the workspace`, and the fake sandbox SHALL have received no call

### Requirement: Sandbox exec quotes every argument and enforces the time limit
`exec(argv, { stdin, env, timeoutMs })` SHALL send `timeout -s KILL <seconds> ` followed by every argument in POSIX single quotes, with `cwd` `dir`, so no argument is interpreted by a shell. Exit `137` from that wrapper SHALL resolve `timed-out`; a sandbox call that throws SHALL resolve `spawn-error`.

#### Scenario: A metacharacter stays an argument
- **WHEN** the workspace execs `["printf", "%s", "a; rm -rf ."]` on the local fake
- **THEN** stdout SHALL be `a; rm -rf .` and every file in the directory SHALL remain

#### Scenario: A slow command is killed
- **WHEN** the workspace execs `["sleep", "5"]` with `timeoutMs` `1000` on the local fake
- **THEN** it SHALL resolve `timed-out`

### Requirement: Sandbox snapshots, lists and searches through git
`snapshot` SHALL run `git status --porcelain=v1 -z` and hash each listed file in `dir`, resolving `undefined` outside a git repository. `list` SHALL run `git ls-files -co --exclude-standard -z` filtered by the glob; `search` SHALL read listed files and match in JavaScript, skipping NUL-byte files, as `localWorkspace` does.

#### Scenario: A delegate's change is diffed in the sandbox
- **GIVEN** a git checkout in the fake sandbox, snapshotted
- **WHEN** `src/a.ts` is written and it is snapshotted again
- **THEN** `diffSnapshots` SHALL report `src/a.ts` `modified`

### Requirement: publish commits and pushes to the checkout's remote
`publish(message)` SHALL stage everything, commit with `message` (quoted), push `HEAD` to the checkout's `origin`, and resolve `{ commit, changed }`: the new commit and `true`, or the unchanged `HEAD` and `false` when nothing was staged.

#### Scenario: Publishing reaches the remote
- **GIVEN** a fake-sandbox checkout of a local bare repository, with `src/a.ts` edited
- **WHEN** `publish("task 2.1")` is called
- **THEN** the bare repository's branch SHALL hold a commit with message `task 2.1` containing the edit

#### Scenario: Nothing to publish
- **GIVEN** a clean checkout
- **WHEN** `publish("x")` is called
- **THEN** it SHALL resolve `changed` `false` with the current `HEAD`, and create no commit

### Requirement: An Artifacts fork per task, reused after a restart
`artifactsSandboxWorkspace` SHALL take `ArtifactsLike` (`get(name)`, a repo handle with `fork(name)`, `createToken("write")` and `remote`), get the fork named `fork` or fork `repo` to create it, issue a write token for the fork only, clone it into `dir` unless `dir` already holds a checkout of that fork, and resolve the `sandboxWorkspace` over `dir`.

#### Scenario: A second build reuses the fork and the checkout
- **GIVEN** a fake Artifacts binding and the local fake sandbox
- **WHEN** `artifactsSandboxWorkspace` is called twice with the same `fork` and `dir`
- **THEN** `fork` SHALL have been called once, and the second call SHALL clone nothing

### Requirement: The fork token never leaks
The write token SHALL NOT appear in any `ExecResult` the workspace resolves, any action output or record, any event or any error message; every occurrence in sandbox output SHALL be replaced with `***` before it leaves the workspace.

#### Scenario: A failing push does not print the token
- **GIVEN** a fake sandbox whose `git push` fails printing the remote URL with the token in it
- **WHEN** `publish` rejects
- **THEN** the error message SHALL contain `***` and SHALL NOT contain the token
