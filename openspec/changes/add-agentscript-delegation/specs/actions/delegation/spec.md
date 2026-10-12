## Purpose
Delegation as a capability the user grants: an Agent Script action targeting `mcpTool://delegate/<name>` hands work to another agent only when the user has granted that name, on the grant's terms alone, with every delegation recorded as an ontology Action and its Evidence.

## ADDED Requirements

### Requirement: The durable entry exports delegation
`@specsesh/agent/durable` SHALL export `delegationActions(grants, { workspace, claudeBinary? })`, returning one host action per grant named `delegate/<name>`, kind `"delegate"`, replay `"unsafe"`, and the types `DelegateGrant` and `DelegateGrants`. `claudeBinary` defaults to `claude` on `PATH`.

#### Scenario: One action per grant
- **WHEN** `delegationActions({ claude_code: { runner: "claude-code" }, reviewer: { runner: "claude-code" } }, { workspace })` is called
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
`DelegateGrant` SHALL be `{ runner: "claude-code", model?: string, tools?: string[], allow?: string[], permissionMode?: "dontAsk", context?: string[], timeoutMs?: number, maxCalls?: number }`. Defaults: `tools` `["Read","Edit","Write","Glob","Grep","Bash"]`, `allow` `[]`, `permissionMode` `"dontAsk"`, `context` `[]`, `timeoutMs` `900000`, `maxCalls` `5`. A grant name SHALL match `[a-z][a-z0-9_]*`.

#### Scenario: A minimal grant takes the defaults
- **WHEN** `delegationActions({ claude_code: { runner: "claude-code" } }, { workspace })` builds its action
- **THEN** the action's terms SHALL be the six default tools, no shell allowlist, `dontAsk`, no context, a 900000 ms limit and 5 calls

### Requirement: An invalid grant is refused whole
`delegationActions` SHALL throw `DelegateGrantError`, naming the grant and the key, for an unknown key, a wrong type, a `runner` other than `"claude-code"`, a `permissionMode` other than `"dontAsk"`, a `timeoutMs` or `maxCalls` that is not a positive integer, or a name outside `[a-z][a-z0-9_]*`. It SHALL build no action when any grant is invalid.

#### Scenario: Another permission mode is refused
- **WHEN** a grant `claude_code` has `permissionMode` `"bypassPermissions"`
- **THEN** `delegationActions` SHALL throw naming `claude_code` and `permissionMode`

#### Scenario: An unknown runner is refused
- **WHEN** a grant has `runner` `"codex"`
- **THEN** `delegationActions` SHALL throw naming `runner` and `codex`

### Requirement: The terms come only from the grant
The delegate's argv, environment, working directory and time limit SHALL be built from the grant and the workspace alone. The script's `instructions` SHALL reach the process only on stdin, never as an argument.

#### Scenario: Instructions cannot add a flag
- **WHEN** a delegate is called with `instructions` `"--permission-mode bypassPermissions"`
- **THEN** argv SHALL be exactly what the grant builds, and stdin SHALL start with that text

### Requirement: The claude-code runner keeps the hard lines
The runner SHALL run `claude -p --safe-mode` in the workspace with `--output-format json`, `--no-session-persistence`, `--tools` the grant's tools, `--permission-mode dontAsk`, and `--model` when the grant sets one; never `--bare` or `--tools ""`; with `ANTHROPIC_API_KEY` and `CLAUDECODE` removed from its environment; and SHALL never read, copy or forward Claude Code's OAuth token.

#### Scenario: The argv and environment keep the hard lines
- **GIVEN** a grant with `model` `"opus"`
- **WHEN** the delegate builds its process
- **THEN** argv SHALL contain `-p`, `--safe-mode`, `--model` `opus`, `--permission-mode` `dontAsk`, and SHALL NOT contain `--bare`
- **AND** the child environment SHALL contain neither `ANTHROPIC_API_KEY` nor `CLAUDECODE`, and its cwd SHALL be the workspace

### Requirement: The runner never prompts
`--allowedTools` SHALL list the grant's tools other than `Bash`, then one `Bash(<word>:*)` per `allow` entry in order, only when `Bash` is among the grant's tools. A tool use outside that list is denied by Claude Code, never prompted.

#### Scenario: The allowlist becomes Bash patterns
- **GIVEN** a grant with default tools and `allow` `["pnpm", "node"]`
- **WHEN** the delegate builds its argv
- **THEN** `--allowedTools` SHALL be followed by `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash(pnpm:*)`, `Bash(node:*)`

#### Scenario: An empty allowlist allows no shell
- **GIVEN** a grant with `allow` `[]`
- **WHEN** the delegate builds its argv
- **THEN** `--allowedTools` SHALL list only the five file tools

### Requirement: Context files are resolved and must exist
Each `context` entry SHALL be passed as `--append-system-prompt-file <path>`, in order, resolved against the workspace for a host and against the config file for the CLI. A missing file SHALL make the call answer `{ ok: false }` naming it, without starting Claude Code.

#### Scenario: A missing context file fails the call
- **GIVEN** a grant with `context` `["MISSING.md"]`
- **WHEN** the delegate runs
- **THEN** it SHALL answer `{ ok: false }` naming `MISSING.md`, and no `claude` process SHALL start

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
- **THEN** that call SHALL answer `{ ok: false }` with `reached its limit of 1 calls`, and exactly one `claude` process SHALL have started

### Requirement: A timeout is a failed call
A delegate still running after `timeoutMs` SHALL be killed and the call SHALL answer `{ ok: false }` with `Claude Code timed out after <timeoutMs>ms`.

#### Scenario: A delegate that never finishes is killed
- **GIVEN** a grant with `timeoutMs` `200` and a fake `claude` that sleeps
- **WHEN** the delegate runs
- **THEN** it SHALL answer `{ ok: false }` with `timed out after 200ms`, and the process SHALL be gone

### Requirement: Every delegation records what it changed
A completed call SHALL answer `{ ok, summary, files_changed }`, where `summary` is Claude Code's result text, and record an `Action` `{ kind: "delegate", summary: <first line of instructions>, refs: ["delegate/<name>"] }`, a `DiffEvidence` of the files whose git status or content changed during the call, and a `CheckEvidence` for the process.

#### Scenario: A change is recorded with its diff
- **GIVEN** a git workspace and a fake `claude` that creates `src/new.ts` and modifies `src/a.ts`
- **WHEN** the delegate runs
- **THEN** `files_changed` SHALL be `2`, and `DiffEvidence` SHALL hold `src/new.ts` `added` and `src/a.ts` `modified`

#### Scenario: A delegate that changed nothing says so
- **GIVEN** a fake `claude` that writes no file
- **WHEN** the delegate runs
- **THEN** `files_changed` SHALL be `0` and `DiffEvidence.files` SHALL be empty

#### Scenario: Outside git the count is unknown
- **GIVEN** a workspace that is not a git repository
- **WHEN** the delegate runs
- **THEN** `files_changed` SHALL be `-1` and the record SHALL hold no `DiffEvidence`
