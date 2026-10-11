# actions/registry Specification

## Purpose
The host side of Agent Script actions: named host actions with typed inputs and outputs, a replay policy and an executor, five built-ins confined to a workspace, the up-front binding check against a script's action definitions, and the ontology Action and Evidence each execution records.

## Requirements

### Requirement: A host action has a name, a kind, typed inputs and outputs, a replay policy and an executor
`HostAction` SHALL be `{ name, kind, inputs, outputs, replay, execute }`: `kind` one of `"read"`, `"edit"`, `"command"`, `"delegate"`; `inputs` and `outputs` maps from name to `"string"`, `"number"` or `"boolean"`; `replay` `"safe"` or `"unsafe"`; and `execute(inputs, { workspace, signal })` resolving to a core `ActionResult`.

#### Scenario: A host action declares everything the binding check needs
- **WHEN** the built-in `run_checks` is read
- **THEN** it SHALL have `kind` `"command"`, `inputs` `{ task_id: "string" }`, `outputs` `{ passed: "boolean", output: "string" }` and `replay` `"unsafe"`

### Requirement: An action registry maps names to host actions
`createActionRegistry(actions)` SHALL return an `ActionRegistry` keyed by `name`, and SHALL throw naming the duplicate when two actions share a name. `builtinActions({ workspace, allow, checks, timeoutMs })` SHALL return the five built-ins, `read_file`, `edit_file`, `run_command`, `run_checks` and `delegate_claude_code`, bound to that workspace; a host MAY add its own actions beside them.

#### Scenario: A duplicate name is refused
- **WHEN** `createActionRegistry` is given two actions named `run_checks`
- **THEN** it SHALL throw naming `run_checks`

### Requirement: A host installs the extensions with its registry
`agentScriptExtensions({ actions, workspace })` SHALL return the run and step extensions bound to that registry and workspace. The plain `AgentScript` and `AgentScriptStepExtension` exports SHALL behave as an empty registry, so a script that defines any action is refused by the binding check when run through them.

#### Scenario: The plain extension refuses a script with actions
- **GIVEN** a harness with the plain `AgentScript` installed
- **WHEN** a script defining `run_checks` is started
- **THEN** it SHALL be refused, naming `run_checks` as not registered

### Requirement: Bindings are checked whole before anything runs
When a run is created, every action the script defines SHALL be checked against the registry: its `mcpTool://<name>` registered, its declared input and output names exactly the registered ones, and each declared type equal to the registered type. Any mismatch SHALL refuse the run with `ActionBindingError`, naming the subagent, the action and every mismatch, before any step or action executes.

#### Scenario: An unregistered tool is refused up front
- **GIVEN** a script defining an action with `target: "mcpTool://deploy"` and a registry without `deploy`
- **WHEN** the run is started
- **THEN** it SHALL throw `ActionBindingError` naming `deploy`, and no model request SHALL be made

#### Scenario: A type mismatch is refused up front
- **GIVEN** a script declaring `run_checks` output `passed: string` while the registry declares `boolean`
- **WHEN** the run is started
- **THEN** it SHALL throw `ActionBindingError` naming `passed`, `string` and `boolean`

### Requirement: File actions are confined to the workspace
`read_file` and `edit_file` SHALL resolve `path` against the workspace and refuse, with `{ ok: false }` and a message containing `outside the workspace`, an absolute path, a path that escapes through `..`, or one whose resolved real path leaves the workspace through a symlink. A refused call SHALL read or write nothing.

#### Scenario: A parent-directory escape is refused
- **WHEN** `edit_file` is called with `path` `"../outside.txt"`
- **THEN** it SHALL answer `{ ok: false }` with `outside the workspace`, and no file SHALL be written

#### Scenario: A symlink out of the workspace is refused
- **GIVEN** `link` in the workspace pointing at `/etc`
- **WHEN** `read_file` is called with `path` `"link/passwd"`
- **THEN** it SHALL answer `{ ok: false }` with `outside the workspace`

### Requirement: read_file and edit_file read and replace a file
`read_file` SHALL be `{ path } → { content }`, kind `"read"`, replay `"safe"`. `edit_file` SHALL be `{ path, content } → { ok }`, kind `"edit"`, replay `"safe"`, replacing the file's whole content and creating missing parent directories inside the workspace. A missing file for `read_file` SHALL answer `{ ok: false }` naming it.

#### Scenario: An edit then a read round-trips
- **WHEN** `edit_file` writes `"hello"` to `src/a.ts` and `read_file` reads `src/a.ts`
- **THEN** the read SHALL answer `{ ok: true, outputs: { content: "hello" } }`

### Requirement: run_command runs an allowlisted command without a shell
`run_command` SHALL be `{ command } → { exit_code, output }`, kind `"command"`, replay `"unsafe"`. It SHALL split `command` on whitespace into an argv with no shell, so no metacharacter is interpreted; the first word MUST be on `allow`, else `{ ok: false }` with `not on the allowlist` and nothing spawned. It runs in the workspace; past `timeoutMs` it is killed and answers `{ ok: false }` with `timed out`.

#### Scenario: A chained command cannot smuggle a second command
- **GIVEN** `allow` `["pnpm"]`
- **WHEN** `run_command` is called with `pnpm test; rm -rf src`
- **THEN** `pnpm` SHALL receive `test;`, `rm`, `-rf` and `src` as arguments, and no `rm` process SHALL start

#### Scenario: An unlisted command is refused
- **WHEN** `run_command` is called with `curl example.com` and `allow` `["pnpm"]`
- **THEN** it SHALL answer `{ ok: false }` with `not on the allowlist`, spawning nothing

#### Scenario: A failing command is a result, not a refusal
- **WHEN** an allowlisted command exits 1
- **THEN** `run_command` SHALL answer `{ ok: true, outputs: { exit_code: 1, output } }`

### Requirement: run_checks passes only when every configured check exits 0
`run_checks` SHALL be `{ task_id } → { passed, output }`, kind `"command"`, replay `"unsafe"`. It SHALL run each configured `checks` command in order, the same way as `run_command` but without the allowlist, and answer `passed` `true` only when every one exited 0 and none timed out. `output` SHALL hold each command and its output. No checks configured SHALL answer `{ ok: false }` with `no checks configured`, never a vacuous pass.

#### Scenario: One failing check fails the set
- **GIVEN** `checks` `["pnpm check", "pnpm test"]`, where `pnpm test` exits 1
- **WHEN** `run_checks` runs
- **THEN** it SHALL answer `passed` `false`, with both commands named in `output`

#### Scenario: No checks is not a pass
- **GIVEN** no `checks`
- **WHEN** `run_checks` runs
- **THEN** it SHALL answer `{ ok: false }` with `no checks configured`

### Requirement: delegate_claude_code runs headless Claude Code inside this project's hard lines
`delegate_claude_code` SHALL be `{ instructions } → { ok, summary }`, kind `"delegate"`, replay `"unsafe"`. It SHALL run `claude -p --safe-mode` with file and shell tools and no prompts (see "The delegate never prompts"), in the workspace, never with `--bare`, with `ANTHROPIC_API_KEY` and `CLAUDECODE` removed from its environment, and SHALL never read, copy or forward Claude Code's OAuth token. `summary` is Claude Code's result text.

#### Scenario: The delegate's argv and environment keep the hard lines
- **WHEN** `delegate_claude_code` builds its process
- **THEN** argv SHALL contain `-p` and `--safe-mode` and SHALL NOT contain `--bare` or `--tools ""`
- **AND** the child environment SHALL contain neither `ANTHROPIC_API_KEY` nor `CLAUDECODE`, and its cwd SHALL be the workspace

### Requirement: Every execution that changes the workspace records an Action and its Evidence
Each execution SHALL put an ontology record in its result's `record`: `edit_file` an `Action` of kind `"edit"` (refs the path) with `DiffEvidence`; `run_command` and `run_checks` an `Action` of kind `"command"` (refs the command lines) with one `CheckEvidence` per command; `delegate_claude_code` an `Action` of kind `"delegate"` with `CheckEvidence` for the Claude Code process. `read_file` changes nothing and records no `Action`.

#### Scenario: An edit records its diff
- **WHEN** `edit_file` creates `src/new.ts`
- **THEN** its `record` SHALL hold an `Action` `{ kind: "edit", refs: ["src/new.ts"] }` and `DiffEvidence` with `{ path: "src/new.ts", change: "added" }`

#### Scenario: A read records nothing
- **WHEN** `read_file` reads a file
- **THEN** its `record` SHALL hold no `Action` and no `Evidence`

### Requirement: The delegate never prompts
`delegate_claude_code` SHALL pass `--tools Read,Edit,Write,Glob,Grep,Bash`, `--permission-mode dontAsk`, `--output-format json` and `--no-session-persistence`, and `--allowedTools` listing `Read`, `Edit`, `Write`, `Glob`, `Grep` and one `Bash(<word>:*)` per `allow` entry, in order. A tool use outside that list is denied by Claude Code, never prompted.

#### Scenario: The allowlist becomes Bash patterns
- **GIVEN** the allowlist `["pnpm", "node"]`
- **WHEN** `delegate_claude_code` builds its argv
- **THEN** `--allowedTools` SHALL be followed by `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash(pnpm:*)`, `Bash(node:*)`
- **AND** argv SHALL contain `--permission-mode` followed by `dontAsk`

#### Scenario: An empty allowlist allows no shell
- **GIVEN** the allowlist `[]`
- **WHEN** `delegate_claude_code` builds its argv
- **THEN** `--allowedTools` SHALL list only the five file tools

### Requirement: The delegate's model and context are configurable
`builtinActions` SHALL take `delegateModel` and `delegateContext`. `delegate_claude_code` SHALL pass `--model <delegateModel>` when it is set, and one `--append-system-prompt-file <path>` per `delegateContext` entry, in order, each resolved against the workspace. A context file that does not exist SHALL make the action answer `{ ok: false }` naming it, without starting Claude Code.

#### Scenario: Context files reach the delegate
- **GIVEN** `delegateContext` `["CLAUDE.md"]` and `delegateModel` `"sonnet"`
- **WHEN** `delegate_claude_code` builds its argv
- **THEN** argv SHALL contain `--model` followed by `sonnet` and `--append-system-prompt-file` followed by the workspace's `CLAUDE.md`

#### Scenario: A missing context file fails the action
- **GIVEN** `delegateContext` `["MISSING.md"]`
- **WHEN** `delegate_claude_code` runs
- **THEN** it SHALL answer `{ ok: false }` naming `MISSING.md`, and no `claude` process SHALL start
