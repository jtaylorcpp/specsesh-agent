## Why

gaps.md #7: task 3.6 of add-actors-and-workspaces blocked because no action could delete a file. add-delete-file-action adds the `delete_file` action but does not grant it. Our own loops run `task-delegate`, where file work happens inside a Claude Code child that can only run pnpm and node. So `pnpm task` still has no way to retire a file. This change lets `pnpm task`'s own loops use `delete_file` when the repo config grants it. It follows add-delete-file-action.

## What Changes

- A new field under `task` in `agentscript.config.json` grants `delete_file`. When it is set, the task CLI adds `deleteActions(workspace)` to the harness it builds. When it is unset, the harness is the same as today, and configs without the field keep working.
- The bundled task scripts, `task.agent` and `task-delegate.agent`, can use `delete_file` when it is granted. If a config does not grant it, the up-front binding check must not refuse these scripts just because they mention `delete_file`.
- Under `task-delegate`, the Claude Code child still cannot delete anything. When the delegate's work retires a file, the outer step deletes it with `delete_file`.
- This repo's `agentscript.config.json` grants `delete_file`.

## Out of scope

- Letting the Claude Code child delete files, for example by allowing `rm` or `git rm`.
- Deleting directories.
- Granting `delete_file` by default.
- The `delete_file` action itself, which add-delete-file-action owns.

## Capabilities

**Modified:**
- `task/headless`: the repo config's `task` section gains the grant field, and the task CLI adds `deleteActions(workspace)` to its harness only when the field is set.
- `task/agent`: the bundled `task.agent` and `task-delegate.agent` scripts use `delete_file` when it is granted and still pass the binding check when it is not. Under `task-delegate`, the outer step deletes files the delegate's work retires.

## Impact

- Task CLI harness construction and repo-config parsing (new optional field under `task`).
- Bundled scripts `task.agent` and `task-delegate.agent`.
- This repo's `agentscript.config.json`.
- Depends on add-delete-file-action for `delete_file` and `deleteActions(workspace)`.
- Existing configs: no change in behaviour.
