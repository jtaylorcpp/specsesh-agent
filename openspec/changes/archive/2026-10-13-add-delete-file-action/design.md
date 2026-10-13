# Design: add-delete-file-action

## Context

Task loops can read, replace, list and search files. They can also run allowlisted commands. They cannot delete a file (gaps.md #7). Task 3.6 of add-actors-and-workspaces needed to retire a file. The agent was refused three times and the task blocked until a person ran `git rm` and answered the loop.

This change adds one built-in action, `delete_file`. It deletes one file and is confined to the workspace on the same terms as the existing file write. It also adds the workspace operation the action goes through, `Workspace.remove(path)`, which `localWorkspace` implements.

Two naming notes shape the design:

- The proposal and the principal say `write_file`. The current specs call that action `edit_file` (`{ path, content } → { ok }`). This design reads "as `write_file` is" as "as `edit_file` is".
- `edit_file` is in `workspaceActions` and `builtinActions` by default, but the proposal says `delete_file` must not be granted by default. So `delete_file` is granted the way the other optional built-ins are (`searchActions`). It comes from its own factory, `deleteActions(workspace)`, and a host adds it to its registry only when its config opts in. A script still has to declare the action, and the binding check enforces that as it does today.

Files under `design/`:

- `design/mock.html`: a rendered task-loop session. `delete_file` succeeds once, then is refused for each named reason. It also shows the "not granted" and "workspace without remove" flows.
- `design/examples/grant-delete-file.ts`: how a host opts in.
- `design/examples/delete-file-calls.ts`: the calls and the results the agent gets back.

## How it is used

### A host opts in

`delete_file` comes from a new factory, `deleteActions(workspace)`. It is exported from `@specsesh/agent/durable` next to `workspaceActions` and `searchActions`, and it imports no `node:` module. `builtinActions` and `workspaceActions` stay exactly as they are and still return four actions, so a config that grants nothing new behaves the same.

`deleteActions` is the factory that the follow-up change `add-delete-file-grant` wires into pnpm task's own loops (see Risks). This change only provides the factory and shows how a generic host would use it.

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

Suppose a script declares `mcpTool://delete_file` but the registry does not have it. The existing binding check refuses the run up front with an `ActionBindingError` naming `delete_file`. That is how "not granted" looks to a script author.

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

A refusal is an ordinary `{ ok: false }` action result, and the agent hears it like any other refused action. Nothing throws out of the loop. A refused call deletes nothing and records no `Action`.

### The workspace operation

`Workspace` gains an optional method, `remove(path): Promise<void>`. It rejects with `WorkspaceError` carrying one of the messages above, and `delete_file` turns that rejection into `{ ok: false }` with the same message. When a workspace has no `remove`, `delete_file` answers `{ ok: false }` with `this workspace cannot delete files`. This is the same pattern as `exec`, `list` and `search`.

`localWorkspace(dir).remove(path)`:

1. Refuses an absolute path, or any path with a `..` segment, with `outside the workspace`.
2. Refuses a path with a `.git` segment with `inside .git`.
3. Resolves the real path. If it leaves `dir`, it refuses with `outside the workspace`. If it lands under `dir/.git`, it refuses with `inside .git`.
4. Refuses a missing entry with `no such file: <path>`. Refuses a directory, or a link to one, with `is a directory: <path>`.
5. Otherwise, it unlinks that one entry. If the entry is a symlink inside the workspace, it removes the link, not the target.

`design/mock.html` shows these results as the loop renders them.

## Decisions

- **A separate factory, not a fifth entry in `workspaceActions`.** The proposal puts default granting out of scope. Keeping `delete_file` out of `workspaceActions` and `builtinActions` leaves their "exactly four" scenario and every existing config unchanged. This mirrors `searchActions`, and it gives the follow-up `add-delete-file-grant` one factory to wire in.
- **`remove` is optional on `Workspace`.** Other implementations, such as `memoryWorkspace` and durable workspaces, keep compiling. Any that don't implement `remove` refuse with `this workspace cannot delete files`. This change does not add `remove` to `memoryWorkspace`, because the proposal names only `localWorkspace`.
- **Kind `"edit"`, replay `"unsafe"`.** A delete changes the workspace the way an edit does. Unlike `edit_file`, running it a second time gives a different result: it is refused with `no such file`. So on replay the recorded result is used and the delete does not run again.
- **Record.** A successful delete records an `Action { kind: "edit", refs: [path] }` with one `DiffEvidence { path, change: "deleted" }`, reusing the `deleted` change that `diffSnapshots` already has. A refusal records nothing.
- **Outputs `{ ok: boolean }`.** This matches `edit_file`, so a script declares the same shape for both.
- **`.git` is refused both by path segment and by real path.** This catches `src/../.git/x`, which is already refused for `..`, and also a symlink into `.git`.
- **Only `delete_file` gets the `.git` refusal.** The current `edit_file` spec has no `.git` refusal. This change doesn't add one, because that would change `edit_file`.

## Risks

- **Granting to pnpm task's own loops is a follow-up change.** That work is `add-delete-file-grant`, which is being drafted now. In it, a task config field grants `delete_file`, the task CLI adds `deleteActions(workspace)` to its registry, and the bundled `task` and `task-delegate` scripts can use the action. Under `task-delegate`, the Claude Code child never deletes; the outer step does. This change only provides `deleteActions`, the factory the follow-up wires in. Until the follow-up lands, task 3.6-style loops run by pnpm task still cannot delete a file.
- **Mismatch with `edit_file`'s confinement.** The principal believes `write_file` refuses `.git`, but the spec doesn't say so. If the code does refuse it, the specs are out of date. If it doesn't, the two actions are confined differently until someone aligns `edit_file`.
- **A race between check and unlink (TOCTOU).** A path could be swapped for a symlink or directory between the check and the unlink. `edit_file`'s write has the same risk, and it is accepted here on the same terms: the workspace has a single agent.
- **Deleting tracked files.** `delete_file` removes the file from the working tree only and doesn't stage the removal. The next snapshot shows the file as `deleted`, which the gate and the publisher already handle.
- **Purpose text drift.** The registry spec's Purpose says "five built-ins" but lists six. The delta should state the new count (seven, counting `list_files` and `search_files`) rather than add another off-by-one.
