## ADDED Requirements

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
