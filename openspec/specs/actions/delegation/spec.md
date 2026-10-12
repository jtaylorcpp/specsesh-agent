# actions/delegation Specification

## Purpose
Delegation as a capability the user grants: an Agent Script action targeting `mcpTool://delegate/<name>` hands work to another agent only when the user has granted that name, run by the grant's runner through the loop's own workspace, on the grant's terms alone, with every delegation recorded as an ontology Action and its Evidence.

## Requirements

### Requirement: The durable entry exports delegation
`@specsesh/agent/durable` SHALL export `delegationActions(grants, { workspace, runners })`, returning one host action per grant named `delegate/<name>`, kind `"delegate"`, replay `"unsafe"`, and the types `DelegateGrant`, `DelegateGrants`, `DelegateTerms`, `ProcessRunner` and `Runners`, and `DelegateGrantError`.

#### Scenario: One action per grant
- **WHEN** `delegationActions({ claude_code: { runner: "claude-code" }, reviewer: { runner: "claude-code" } }, { workspace, runners })` is called with `runners` holding `claude-code`
- **THEN** it SHALL return actions named `delegate/claude_code` and `delegate/reviewer`, each of kind `"delegate"` and replay `"unsafe"`

### Requirement: A delegate action has fixed inputs and outputs
Every delegate action SHALL declare inputs exactly `{ instructions: "string" }` and outputs exactly `{ ok: "boolean", summary: "string", files_changed: "number" }`. A script's action targeting `mcpTool://delegate/<name>` is bound by the ordinary binding check, so any other declared input, output or type is refused at start.

#### Scenario: An extra output is refused at start
- **GIVEN** a granted `claude_code` and a script action targeting `mcpTool://delegate/claude_code` that declares an output `branch: string`
- **WHEN** the run is started
- **THEN** it SHALL throw `ActionBindingError` naming `branch`, and no model request SHALL be made

### Requirement: The delegate namespace is reserved for grants
`createActionRegistry` SHALL throw, naming the action, when given an action whose name starts with `delegate/` that `delegationActions` did not make. Only a grant puts a delegate in a registry.

#### Scenario: A hand-made delegate action is refused
- **WHEN** `createActionRegistry` is given a host's own action named `delegate/anything`
- **THEN** it SHALL throw naming `delegate/anything`

### Requirement: An ungranted delegate is refused at start, listing the grants
When a script's action targets `mcpTool://delegate/<name>` and no grant named `<name>` is registered, the binding check's `ActionBindingError` SHALL also list the granted names, or say `no delegates are granted`. A granted delegate the script never targets SHALL NOT refuse anything.

#### Scenario: No grants
- **GIVEN** a script targeting `mcpTool://delegate/claude_code` and no grants
- **WHEN** the run is started
- **THEN** it SHALL throw `ActionBindingError` naming `delegate/claude_code` and containing `no delegates are granted`

#### Scenario: A different grant
- **GIVEN** the same script and a grant named only `reviewer`
- **WHEN** the run is started
- **THEN** the error SHALL name `delegate/claude_code` and list `reviewer`

#### Scenario: An unused grant is fine
- **GIVEN** a grant `claude_code` and a script with no delegate action
- **WHEN** the run is started
- **THEN** it SHALL start

### Requirement: A grant has typed fields and defaults
Every `DelegateGrant` SHALL have `runner` (string) and optional `maxCalls` (default `5`); its runner declares the other keys it accepts, their types and defaults. The `claude-code` runner accepts `model`, `tools` (default the six Claude Code tools), `allow` (`[]`), `permissionMode` (`"dontAsk"` only), `context` (`[]`) and `timeoutMs` (`900000`). A grant name SHALL match `[a-z][a-z0-9_]*`.

#### Scenario: A minimal grant takes the defaults
- **WHEN** `delegationActions({ claude_code: { runner: "claude-code" } }, { workspace, runners })` builds its action
- **THEN** the terms its runner receives SHALL be the six default tools, no shell allowlist, `dontAsk`, no context, a 900000 ms limit and 5 calls

### Requirement: An invalid grant is refused whole
`delegationActions` SHALL throw `DelegateGrantError`, naming the grant and the key, for a key its runner does not accept, a wrong type, a `runner` not in `runners`, a `permissionMode` other than `"dontAsk"`, a `timeoutMs` or `maxCalls` that is not a positive integer, or a name outside `[a-z][a-z0-9_]*`. It SHALL build no action when any grant is invalid.

#### Scenario: Another permission mode is refused
- **WHEN** a grant `claude_code` has `permissionMode` `"bypassPermissions"`
- **THEN** `delegationActions` SHALL throw naming `claude_code` and `permissionMode`

#### Scenario: An unknown runner is refused
- **WHEN** a grant has `runner` `"codex"` and `runners` holds only `claude-code`
- **THEN** `delegationActions` SHALL throw naming `runner`, `codex` and `claude-code`

### Requirement: A delegate acts only through its run's workspace
A delegate call SHALL run its process with the workspace's `exec` and diff with its `snapshot`, the workspace `delegationActions` was given, never another. A workspace without `exec` SHALL make the call answer `{ ok: false }` with `this workspace cannot run processes`, starting nothing.

#### Scenario: The delegate runs in the loop's worktree
- **GIVEN** a task loop over a worktree `/w` with `claude_code` granted
- **WHEN** its delegate runs
- **THEN** the `claude` process's cwd SHALL be `/w`

#### Scenario: A workspace that cannot run processes
- **GIVEN** a workspace with no `exec`
- **WHEN** a delegate is called
- **THEN** it SHALL answer `{ ok: false }` with `this workspace cannot run processes`

### Requirement: The terms come only from the grant
A process runner's `prepare` SHALL receive the instructions, the grant's `DelegateTerms` and the workspace, and nothing from the script but `instructions`. The process argv, environment and time limit SHALL come from the terms; `instructions` SHALL reach the process only on stdin.

#### Scenario: Instructions cannot add a flag
- **WHEN** a delegate is called with `instructions` `"--permission-mode bypassPermissions"`
- **THEN** argv SHALL be exactly what the terms build, and stdin SHALL start with that text

### Requirement: The delegate is told its terms
Stdin SHALL be the `instructions`, a blank line, then a terms block: `Your terms for this delegation (set by the user; you cannot change them):`, the shell line (`Shell: only commands whose first word is one of: <allow, comma-joined>.` or `Shell: none.`), a line saying one command per Bash call with no chaining, and `Time limit: <seconds> seconds.`

#### Scenario: The terms follow the instructions
- **GIVEN** a grant with `allow` `["pnpm", "node"]` and `timeoutMs` `900000`
- **WHEN** the delegate runs with `instructions` `"Fix the test"`
- **THEN** stdin SHALL start with `Fix the test`, and contain `first word is one of: pnpm, node`, `One command per Bash call` and `Time limit: 900 seconds.`

### Requirement: A delegate's calls are bounded per run
A delegate action SHALL answer `{ ok: false }` with `delegate <name> reached its limit of <n> calls in this run`, starting nothing, once the run already holds `maxCalls` reports for it. The count SHALL come from the run's own action reports, so a resumed run keeps it.

#### Scenario: The call past the limit fails
- **GIVEN** a grant with `maxCalls` `1` and a script that calls it twice
- **WHEN** the run reaches the second call
- **THEN** that call SHALL answer `{ ok: false }` with `reached its limit of 1 calls`, and exactly one process SHALL have started

### Requirement: A timeout is a failed call
A delegate whose `exec` answers `timed-out` SHALL answer `{ ok: false }` with `<runner> timed out after <timeoutMs>ms`; a `spawn-error` SHALL answer `{ ok: false }` with its message.

#### Scenario: A delegate that never finishes is killed
- **GIVEN** a grant with `timeoutMs` `200` and a fake `claude` that sleeps, in a local workspace
- **WHEN** the delegate runs
- **THEN** it SHALL answer `{ ok: false }` with `timed out after 200ms`, and the process SHALL be gone

### Requirement: Every delegation records what it changed
A completed call SHALL answer `{ ok, summary, files_changed }` from the runner's reading and the workspace's snapshots, and record an `Action` `{ kind: "delegate", summary: <first line of instructions>, refs: ["delegate/<name>"] }`, a `DiffEvidence` of the snapshots' difference, and a `CheckEvidence` for the process. Without snapshots, `files_changed` is `-1` and there is no `DiffEvidence`.

#### Scenario: A change is recorded with its diff
- **GIVEN** a git workspace and a fake `claude` that creates `src/new.ts` and modifies `src/a.ts`
- **WHEN** the delegate runs
- **THEN** `files_changed` SHALL be `2`, and `DiffEvidence` SHALL hold `src/new.ts` `added` and `src/a.ts` `modified`

#### Scenario: A delegate that changed nothing says so
- **GIVEN** a fake `claude` that writes no file
- **WHEN** the delegate runs
- **THEN** `files_changed` SHALL be `0` and `DiffEvidence.files` SHALL be empty

#### Scenario: Without snapshots the count is unknown
- **GIVEN** a workspace whose `snapshot` answers `undefined`
- **WHEN** the delegate runs
- **THEN** `files_changed` SHALL be `-1` and the record SHALL hold no `DiffEvidence`

### Requirement: The node entry ships the claude-code runner
`@specsesh/agent/node` SHALL export `claudeCodeRunner({ binary? })`, a process runner whose `binary` defaults to `claude` on `PATH`, and `defaultRunners`, equal to `{ "claude-code": claudeCodeRunner() }`.

#### Scenario: The default runners hold claude-code
- **WHEN** `defaultRunners` is read
- **THEN** it SHALL hold `claude-code`, whose `kind` SHALL be `"process"`

### Requirement: The claude-code runner keeps the hard lines
`claudeCodeRunner` SHALL run `claude -p --safe-mode` with `--output-format json`, `--no-session-persistence`, `--tools` the terms' tools, `--permission-mode dontAsk`, and `--model` when set; never `--bare` or `--tools ""`. Its `env` SHALL be the process environment minus `ANTHROPIC_API_KEY` and `CLAUDECODE`, and it SHALL never read, copy or forward Claude Code's OAuth token.

#### Scenario: The argv and environment keep the hard lines
- **GIVEN** a grant with `model` `"opus"`, and `ANTHROPIC_API_KEY` and `CLAUDECODE` set in the parent
- **WHEN** the runner prepares its process
- **THEN** argv SHALL contain `-p`, `--safe-mode`, `--model` `opus`, `--permission-mode` `dontAsk`, and SHALL NOT contain `--bare`
- **AND** its `env` SHALL contain neither `ANTHROPIC_API_KEY` nor `CLAUDECODE`

### Requirement: The claude-code runner never prompts
`--allowedTools` SHALL list the terms' tools other than `Bash`, then one `Bash(<word>:*)` per `allow` entry in order, only when `Bash` is among the tools. A tool use outside that list is denied by Claude Code, never prompted.

#### Scenario: The allowlist becomes Bash patterns
- **GIVEN** a grant with default tools and `allow` `["pnpm", "node"]`
- **WHEN** the runner prepares its argv
- **THEN** `--allowedTools` SHALL be followed by `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash(pnpm:*)`, `Bash(node:*)`

#### Scenario: An empty allowlist allows no shell
- **GIVEN** a grant with `allow` `[]`
- **WHEN** the runner prepares its argv
- **THEN** `--allowedTools` SHALL list only the five file tools

### Requirement: The claude-code runner's context files must exist
Each `context` entry SHALL be passed as `--append-system-prompt-file <path>`, in order, resolved against the workspace for a host and against the config file for the CLI. A missing file SHALL make `prepare` answer an error naming it, so the call answers `{ ok: false }` without starting anything.

#### Scenario: A missing context file fails the call
- **GIVEN** a grant with `context` `["MISSING.md"]`
- **WHEN** the delegate runs
- **THEN** it SHALL answer `{ ok: false }` naming `MISSING.md`, and no `claude` process SHALL start
