Let `pnpm task`'s own loops use the `delete_file` action that add-delete-file-action adds. Follows add-delete-file-action.

- A field under `task` in `agentscript.config.json` grants it. When it is set, the task CLI adds `deleteActions(workspace)` to the harness it builds. When it is unset, nothing changes, and configs that don't grant it keep working.
- The bundled task scripts, `task.agent` and `task-delegate.agent`, can use `delete_file` when it is granted. A config that does not grant it must not be refused because a bundled script mentions it.
- Under `task-delegate`, the Claude Code child still cannot delete anything. When the delegate's work retires a file, the outer step deletes it with `delete_file`.
- This repo's `agentscript.config.json` grants it.

Why: gaps.md #7. Task 3.6 of add-actors-and-workspaces blocked because no action could delete a file. add-delete-file-action adds the action, but leaves out granting it, and our own loops run `task-delegate`, where file work happens inside a Claude Code child that can only run pnpm and node.

Out of scope: letting the Claude Code child delete files, for example by allowing `rm` or `git rm`; deleting directories; granting it by default.
