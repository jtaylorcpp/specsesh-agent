## 1. Bind delete_file in the task loop harness

- [ ] 1.1 Add a `deleteFiles` option to `taskLoopExtensions` in `packages/agent/src/task/loop.ts` that adds `deleteActions(workspace)` when `true` and records a `delete_file` call as an `edit` action with its path in `refs`
- [ ] 1.2 In `packages/agent/src/task/start.ts`, store `deleteFiles` in the input, let an unbound `delete_file` pass (hidden from model tools, deterministic calls answer the not-granted message) and seed a declared `delete_granted`
- [ ] 1.3 Test `packages/agent/__tests__/task/loop.test.ts`: "The extensions run the loop's actions in its workspace", "The delegate configuration is stored with the loop", "A delegating script without a grant is refused at start"

## 2. Grant it from the repo config

- [ ] 2.1 Accept optional boolean `task.deleteFiles` in `packages/agent/src/task/config.ts`, refusing other types with `task.deleteFiles must be a boolean` and exit 2
- [ ] 2.2 Pass `config.task.deleteFiles ?? false` to `taskLoopExtensions` and `startTaskLoop` in `packages/agent/src/bin/agentscript-task.ts`, and rebuild `resume`/`answer` harnesses from the stored `deleteFiles`
- [ ] 2.3 Add `"deleteFiles": true` under `task` in `agentscript.config.json`
- [ ] 2.4 Test `packages/agent/__tests__/task/grant.test.ts`: "An empty task object is valid", "The delete grant is stored and bound", "A deterministic ungranted delete is retried with the message"
- [ ] 2.5 Test `packages/agent/__tests__/task/cli.test.ts`: "A mistyped grant is refused", "A config without the grant binds no delete", "Resume keeps the grant the loop started with", "The shipped config is valid"

## 3. Use delete_file in the bundled scripts

- [ ] 3.1 In `packages/agent/src/task/scripts/task.agent`, declare `delete_granted`, offer `delete_file` in act, and add orient's line `If the task retires a file, delete it with delete_file; do not empty it.` when granted
- [ ] 3.2 In `packages/agent/src/task/scripts/task-delegate.agent`, when `delete_granted` ask for `RETIRE: <path>` lines, add the `retire` step and `delete_file` call on `retire_path`, and show `Files deleted:` to the judge
- [ ] 3.3 Test `packages/agent/__tests__/task/delete-scripts.test.ts`: "Granted, orient asks for deletion", "The delegate's retired file is deleted", "One file is retired per iteration"
- [ ] 3.4 Test `packages/agent/__tests__/task/delete-scripts.test.ts`: "A model step is not offered an ungranted delete", "Not granted, orient says nothing of deletion", "Not granted, the delegate is not asked to retire"
