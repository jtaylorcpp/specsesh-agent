## ADDED Requirements

### Requirement: delete_file deletes one workspace file
`deleteActions(workspace)` SHALL return exactly one action, `delete_file`: inputs `{ path: "string" }`, outputs `{ ok: "boolean" }`, kind `"edit"`, replay `"unsafe"`. It SHALL delete through `workspace.remove(path)` and answer `{ ok: true, outputs: { ok: true } }`. When `remove` rejects, it SHALL answer `{ ok: false }` with the rejection's message and SHALL NOT throw.

#### Scenario: delete_file declares everything the binding check needs
- **WHEN** the action returned by `deleteActions(workspace)` is read
- **THEN** it SHALL have `name` `"delete_file"`, `kind` `"edit"`, `inputs` `{ path: "string" }`, `outputs` `{ ok: "boolean" }` and `replay` `"unsafe"`

#### Scenario: A file is deleted
- **GIVEN** `localWorkspace(dir)` where `src/legacy/old-runner.ts` exists
- **WHEN** `delete_file` is called with `path` `"src/legacy/old-runner.ts"`
- **THEN** it SHALL answer `{ ok: true, outputs: { ok: true } }`, and `src/legacy/old-runner.ts` SHALL no longer exist

#### Scenario: Deleting a missing file is refused, not thrown
- **GIVEN** the workspace after "A file is deleted"
- **WHEN** `delete_file` is called again with `path` `"src/legacy/old-runner.ts"`
- **THEN** it SHALL answer `{ ok: false }` with `no such file: src/legacy/old-runner.ts`, and nothing SHALL throw

### Requirement: delete_file is available only when a host grants it
`builtinActions` and `workspaceActions` SHALL NOT return `delete_file`. A host grants it by adding `deleteActions(workspace)` to its registry. `deleteActions` SHALL be exported from `@specsesh/agent/durable` and SHALL NOT import a `node:` module. A script that defines `mcpTool://delete_file` with a registry that lacks it SHALL be refused by the binding check with `ActionBindingError` naming `delete_file`.

#### Scenario: An ungranted delete_file is refused up front
- **GIVEN** a registry built only from `builtinActions`
- **WHEN** a script defining an action with `target: "mcpTool://delete_file"` is started
- **THEN** it SHALL throw `ActionBindingError` naming `delete_file`, no step SHALL run and no model request SHALL be made

#### Scenario: A granted delete_file binds
- **GIVEN** a registry built from `builtinActions` plus `deleteActions(workspace)`
- **WHEN** a script defining `mcpTool://delete_file` with input `path: string` and output `ok: boolean` is started
- **THEN** the binding check SHALL raise no `ActionBindingError`

#### Scenario: The factory loads without Node built-ins
- **WHEN** the module defining `deleteActions` and its imports are scanned
- **THEN** none SHALL import a module starting with `node:`

### Requirement: delete_file records the deletion and nothing on refusal
A successful `delete_file` SHALL put in its result's `record` an `Action` `{ kind: "edit", refs: [path] }` and exactly one `DiffEvidence` `{ path, change: "deleted" }`. A refused `delete_file` SHALL record no `Action` and no `Evidence`.

#### Scenario: A delete records its diff
- **WHEN** `delete_file` deletes `src/legacy/old-runner.ts`
- **THEN** its `record` SHALL hold an `Action` `{ kind: "edit", refs: ["src/legacy/old-runner.ts"] }` and one `DiffEvidence` `{ path: "src/legacy/old-runner.ts", change: "deleted" }`

#### Scenario: A refusal records nothing
- **WHEN** `delete_file` is called with `path` `"../outside.txt"`
- **THEN** it SHALL answer `{ ok: false }` with `outside the workspace`, and its `record` SHALL hold no `Action` and no `Evidence`

