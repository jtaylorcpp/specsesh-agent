## 1. Workspace remove

- [x] 1.1 In `packages/agent/src/durable/workspace.ts`, add the optional `remove(path): Promise<void>` to `Workspace`, rejecting with `WorkspaceError`, and leave `memoryWorkspace` without it
- [x] 1.2 In `packages/agent/src/node/local-workspace.ts`, implement `remove`: the absolute/`..`/real-path refusal, then `.git` segment/real-path, then missing and directory refusals, then unlink the one entry (a link, not its target)
- [x] 1.3 In `packages/agent/__tests__/node/local-workspace.test.ts`, test "Absolute and parent-directory paths are refused", "A symlink out of the workspace is refused", "A path inside .git is refused" and "A symlink into .git is refused"
- [x] 1.4 In `packages/agent/__tests__/node/local-workspace.test.ts`, test "A directory is refused" and "A symlink inside the workspace is removed, not its target"

## 2. delete_file action

- [x] 2.1 In `packages/agent/src/durable/actions.ts`, add `deleteActions(workspace)` returning `delete_file` (kind edit, replay unsafe) that calls `remove`, records Action and DiffEvidence `deleted` on success, and turns refusals into `{ ok: false }`
- [x] 2.2 In `packages/agent/src/durable/index.ts`, export `deleteActions` next to `workspaceActions` and `searchActions`
- [x] 2.3 Create `packages/agent/__tests__/durable/delete-actions.test.ts` testing "delete_file declares everything the binding check needs", "delete_file uses the workspace it was given" and "Deleting needs remove"
- [x] 2.4 In `packages/agent/__tests__/durable/delete-actions.test.ts`, test "An ungranted delete_file is refused up front", "A granted delete_file binds" and "The factory loads without Node built-ins"
- [x] 2.5 Create `packages/agent/__tests__/node/delete-file.test.ts` testing against `localWorkspace` "A file is deleted", "Deleting a missing file is refused, not thrown", "A delete records its diff" and "A refusal records nothing"

## 3. Documentation

- [x] 3.1 In `guides/04-actions.md`, document `delete_file`: its shape, its refusals, and that a host grants it by adding `deleteActions(workspace)` to its registry
