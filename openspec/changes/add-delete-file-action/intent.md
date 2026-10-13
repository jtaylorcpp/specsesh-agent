Add a `delete_file` built-in action for task loops, confined to the workspace exactly as `write_file` is: it refuses absolute paths, paths containing `..`, paths that resolve outside the workspace, and anything under `.git`. Deleting a file that does not exist, or a directory, is a refused action the agent hears about, never a crash. It is granted the same way `write_file` is, so a config opts in.

Why: gaps.md #7. Task 3.6 of add-actors-and-workspaces blocked after three refused attempts, because no action can delete a file a task retires and the command allowlist is pnpm/node. A person ran `git rm` and answered the loop.

Out of scope: deleting directories, moving or renaming files, and any change to the command allowlist.
