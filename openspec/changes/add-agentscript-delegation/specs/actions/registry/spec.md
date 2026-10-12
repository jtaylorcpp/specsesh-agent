## MODIFIED Requirements

### Requirement: An action registry maps names to host actions
`createActionRegistry(actions)` SHALL return an `ActionRegistry` keyed by `name`, and SHALL throw naming the duplicate when two actions share a name. `builtinActions({ workspace, allow, checks, timeoutMs })` SHALL return the four built-ins, `read_file`, `edit_file`, `run_command` and `run_checks`, bound to that workspace; a host MAY add its own actions and its grants' delegate actions (`actions/delegation`) beside them.

#### Scenario: A duplicate name is refused
- **WHEN** `createActionRegistry` is given two actions named `run_checks`
- **THEN** it SHALL throw naming `run_checks`

#### Scenario: No delegate is built in
- **WHEN** `builtinActions` is called
- **THEN** it SHALL return exactly `read_file`, `edit_file`, `run_command` and `run_checks`, and no action named `delegate_claude_code` or starting with `delegate/`

### Requirement: Every execution that changes the workspace records an Action and its Evidence
Each execution SHALL put an ontology record in its result's `record`: `edit_file` an `Action` of kind `"edit"` (refs the path) with `DiffEvidence`; `run_command` and `run_checks` an `Action` of kind `"command"` (refs the command lines) with one `CheckEvidence` per command; a delegate action the record `actions/delegation` requires. `read_file` changes nothing and records no `Action`.

#### Scenario: An edit records its diff
- **WHEN** `edit_file` creates `src/new.ts`
- **THEN** its `record` SHALL hold an `Action` `{ kind: "edit", refs: ["src/new.ts"] }` and `DiffEvidence` with `{ path: "src/new.ts", change: "added" }`

#### Scenario: A read records nothing
- **WHEN** `read_file` reads a file
- **THEN** its `record` SHALL hold no `Action` and no `Evidence`

## REMOVED Requirements

### Requirement: delegate_claude_code runs headless Claude Code inside this project's hard lines
**Reason**: The built-in delegate is retired; delegation is granted by the user.
**Migration**: "The claude-code runner keeps the hard lines" in `actions/delegation`, with the same hard lines.

### Requirement: The delegate never prompts
**Reason**: Moved with the delegate.
**Migration**: "The runner never prompts" in `actions/delegation`, with the grant's tools and allowlist.

### Requirement: The delegate's model and context are configurable
**Reason**: Model and context are now a grant's terms, not `builtinActions` options.
**Migration**: "A grant has typed fields and defaults" and "Context files are resolved and must exist" in `actions/delegation`.
