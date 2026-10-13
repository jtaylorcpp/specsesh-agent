// Sketch of the task CLI's harness construction after this change.
// `deleteActions` comes from add-delete-file-action.
import { createAgentHarness } from "@specsesh/agent";
import { taskLoopExtensions, startTaskLoop } from "@specsesh/agent/task";

const deleteFiles = config.task.deleteFiles ?? false; // default: not granted

const harness = createAgentHarness({
  models,
  extensions: taskLoopExtensions({
    workspace,
    checks,
    allow,
    delegates,
    runners,
    deleteFiles, // true → registry also holds deleteActions(workspace)
  }),
});

// Inside taskLoopExtensions:
//   const registry = [
//     ...workspaceActions(ws),
//     ...delegationActions(delegates, { workspace: ws, runners }),
//     ...(deleteFiles ? deleteActions(ws) : []),
//   ];

const id = await startTaskLoop(harness, {
  change: { dir: changeDir },
  task: "3.6",
  script: { text: TASK_DELEGATE_AGENT },
  workspace,
  checks,
  allow,
  delegates,
  deleteFiles, // stored in the durable input so resume rebuilds the same harness
}, context);
