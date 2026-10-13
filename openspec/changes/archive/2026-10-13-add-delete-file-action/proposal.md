## Why

Task loops have no way to delete a file (gaps.md #7). Task 3.6 of add-actors-and-workspaces needed to retire a file. No built-in action can delete one, and the command allowlist only covers pnpm and node. The agent was refused three times and the task blocked. A person then ran `git rm` and answered the loop. A loop should be able to delete a file it owns inside its workspace, with the same limits that already apply to `write_file`.

## What Changes

- Add a new built-in action, `delete_file`, next to `write_file`. It takes a workspace-relative path and deletes that one file.
- `delete_file` uses the same confinement as `write_file`. It refuses:
  - absolute paths
  - paths that contain `..`
  - paths that resolve outside the workspace
  - anything under `.git`
- If the path does not exist, or is a directory, the action is refused. The agent is told why, as with any refused action. The loop never crashes.
- Hosts grant `delete_file` the same way they grant `write_file`. It is only available when a config opts in.
- The `Workspace` gains a confined file delete. Both the action and `localWorkspace` use it. Like every other actor, the action goes through the workspace.
- Each `delete_file` call is recorded as an ontology Action with its Evidence, like the other built-ins.

## Out of scope

- Deleting directories, whether empty or recursive.
- Moving or renaming files.
- Any change to the command allowlist.
- Granting `delete_file` by default. A config must opt in.

## Capabilities

**Modified:**
- `actions/registry`: a sixth built-in, `delete_file`: its inputs, outputs, refusals, how it is granted, and the Action and Evidence it records.
- `actions/workspace`: a confined delete of a single file on `Workspace`, implemented by `localWorkspace`.

## Impact

- Code: the built-in actions in the actions registry, the `Workspace` interface and `localWorkspace`. This also covers any other `Workspace` implementation that must provide or refuse the new delete.
- Configs: no behaviour changes until a config grants `delete_file`.
- Unblocks task loops that need to retire a file, like task 3.6 of add-actors-and-workspaces, without a person stepping in.
