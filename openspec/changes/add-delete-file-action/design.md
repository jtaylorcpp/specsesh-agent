# Design: add-delete-file-action

## Context

Task loops can read, replace, list and search files and run allowlisted commands, but they cannot delete a file (gaps.md #7). Task 3.6 of add-actors-and-workspaces needed to retire a file. It was refused three times and blocked until a person ran `git rm` and answered the loop.

This change adds one built-in, `delete_file`. It deletes one file, confined to the workspace on the same terms as the existing file write. It also adds the workspace operation the action goes through, `Workspace.remove(path)`, which `localWorkspace` implements.

Two naming notes that shape the design:

- The proposal and the principal say `write_file`. The current specs call that action `edit_file` (`{ path, content } → { ok }`). This design reads "as `write_file` is" as "as `edit_file` is".
- `edit_file` is in `workspaceActions` / `builtinActions` by default, but the proposal says `delete_file` must not be granted by default. So `delete_file` is granted the way the other optional built-ins are (`searchActions`): through its own factory, which a host adds to its registry only when its config opts in. A script then still has to declare the action, and the binding check enforces that as it does today.

Files under `design/`:

- `design/mock.html`: a rendered task-loop session where `delete_file` succeeds once, then is refused for each named reason.
- `design/examples/grant-delete-file.ts`: how a host opts in.
- `design/examples/delete-file-calls.ts`: the calls and the results the agent gets back.

## How it is used

### A host opts in

`delete_file` comes from a new factory, `deleteActions(workspace)`, exported from `@specsesh/agent/durable` next to `workspaceActions` and `searchActions`. It imports no `node:` module. `builtinActions` and `workspaceActions` stay exactly as they are, still returning four actions, so a config that grants nothing new behaves the same.

```ts
// design/examples/grant-delete-file.ts (abridged)
import { createActionRegistry, deleteActions } from "@specsesh/agent/durable";
import { builtinActions, localWorkspace } from "@specsesh/agent/node";

const dir = "/work/specsesh";
const workspace = localWorkspace(dir);

const actions = createActionRegistry([
  ...builtinActions({ workspace: dir, allow: ["pnpm", "node"], checks: ["pnpm check", "pnpm test"], timeoutMs: 120_000 }),
  ...(config.grants.includes("delete_file") ? deleteActions(workspace) : []),
]);
```

A script that declares `mcpTool://delete_file` against a registry without it is refused up front by the existing binding check (`ActionBindingError` naming `delete_file`). That is how "not granted" looks to a script author.

### The action

`delete_file` is `{ path: "string" } → { ok: "boolean" }`. Its kind is `"edit"` and its replay is `"unsafe"`.

```ts
// design/examples/delete-file-calls.ts (abridged)
const [deleteFile] = deleteActions(workspace);

await deleteFile.execute({ path: "src/legacy/old-runner.ts" }, { workspace, signal });
// → { ok: true, outputs: { ok: true },
//     record: { Action { kind: "edit", refs: ["src/legacy/old-runner.ts"] },
//               DiffEvidence { path: "src/legacy/old-runner.ts", change: "deleted" } } }

await deleteFile.execute({ path: "/etc/hosts" }, ctx);        // → { ok: false } "outside the workspace"
await deleteFile.execute({ path: "../outside.txt" }, ctx);    // → { ok: false } "outside the workspace"
await deleteFile.execute({ path: "link/passwd" }, ctx);       // link → /etc: "outside the workspace"
await deleteFile.execute({ path: ".git/config" }, ctx);       // → { ok: false } "inside .git"
await deleteFile.execute({ path: "src/gone.ts" }, ctx);       // → { ok: false } "no such file: src/gone.ts"
await deleteFile.execute({ path: "src/legacy" }, ctx);        // → { ok: false } "is a directory: src/legacy"
```

A refusal is an ordinary `{ ok: false }` action result. The agent hears it like any other refused action. Nothing throws out of the loop, and a refused call deletes nothing and records no `Action`.

### The workspace operation

`Workspace` gains an optional method, `remove(path): Promise<void>`. It rejects with `WorkspaceError` and one of the messages above. `delete_file` maps that rejection to `{ ok: false }` with the same message. When a workspace has no `remove`, `delete_file` answers `{ ok: false }` with `this workspace cannot delete files`, the same pattern as `exec`, `list` and `search`.

`localWorkspace(dir).remove(path)`:

1. Refuses an absolute path, or any path with a `..` segment, with `outside the workspace`.
2. Refuses a path with a `.git` segment with `inside .git`.
3. Resolves the real path. If it leaves `dir`, it refuses with `outside the workspace`. If it lands under `dir/.git`, it refuses with `inside .git`.
4. A missing entry is refused with `no such file: <path>`. A directory (or a link to one) is refused with `is a directory: <path>`.
5. Otherwise it unlinks that one entry. If the entry is a symlink inside the workspace, the link is removed, not its target.

The session in `design/mock.html` shows these results as the loop renders them.

## Decisions

- **A separate factory, not a fifth entry in `workspaceActions`.** The proposal puts default granting out of scope. Keeping `delete_file` out of `workspaceActions` and `builtinActions` leaves their "exactly four" scenario and every existing config unchanged. It mirrors `searchActions`.
- **`remove` is optional on `Workspace`.** Other implementations (`memoryWorkspace`, durable workspaces) keep compiling. If they don't implement it, they refuse with `this workspace cannot delete files`. This change does not add `remove` to `memoryWorkspace`, because the proposal names only `localWorkspace`.
- **Kind `"edit"`, replay `"unsafe"`.** A delete changes the workspace like an edit. Unlike `edit_file`, running it again doesn't give the same result: the second run is refused with `no such file`. So on replay the recorded result is used, and the delete is not run again.
- **Record.** An `Action { kind: "edit", refs: [path] }` with one `DiffEvidence { path, change: "deleted" }`, reusing the `deleted` change `diffSnapshots` already has. A refusal records nothing.
- **Outputs `{ ok: boolean }`.** This matches `edit_file`, so a script declares the same shape for both.
- **`.git` is refused by segment and by real path**, so `src/../.git/x` (already refused for `..`) and a symlink into `.git` are both caught.
- **Only `delete_file` gets the `.git` refusal.** The current `edit_file` spec has no `.git` refusal. This change doesn't add one, since that would change `edit_file`.

## Risks

- **"Same way as `write_file`" may mean something else.** If the principal has a config-level grant list in mind that `edit_file` already goes through, the factory here would plug into that list instead. The action and workspace behaviour stay the same either way. Worth confirming at review.
- **Mismatch with `edit_file`'s confinement.** The principal believes `write_file` refuses `.git`, but the spec doesn't say so. If the code does refuse it, the specs are behind. If it doesn't, the two actions are now confined differently until someone aligns `edit_file`.
- **A race between check and unlink (TOCTOU).** A path could be swapped for a symlink or directory between the check and the unlink. The risk is the same as for `edit_file`'s write and is accepted on the same terms (single-agent workspace).
- **Deleting tracked files.** `delete_file` removes the file from the working tree only; it doesn't stage the removal. The next snapshot shows the file as `deleted`, which is what the gate and the publisher already handle.
- **Purpose text drift.** The registry spec's Purpose says "five built-ins" while listing six. The delta should restate the count (now seven, counting `list_files` and `search_files`) rather than add one more off-by-one.
