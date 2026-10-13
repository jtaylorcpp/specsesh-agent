// A host that opts a config into delete_file.
// delete_file is never in builtinActions/workspaceActions; it is added only when granted.
// pnpm task's own wiring of this factory is the follow-up change add-delete-file-grant.
import { createActionRegistry, deleteActions, agentScriptExtensions } from "@specsesh/agent/durable";
import { builtinActions, localWorkspace } from "@specsesh/agent/node";

interface LoopConfig {
  dir: string;
  allow: string[];
  checks: string[];
  timeoutMs: number;
  grants: string[]; // e.g. ["delete_file"]
}

export function hostFor(config: LoopConfig) {
  const workspace = localWorkspace(config.dir);

  const actions = createActionRegistry([
    ...builtinActions({
      workspace: config.dir,
      allow: config.allow,
      checks: config.checks,
      timeoutMs: config.timeoutMs,
    }),
    ...(config.grants.includes("delete_file") ? deleteActions(workspace) : []),
  ]);

  return agentScriptExtensions({ actions, workspace });
}

// Opted in:
export const granted = hostFor({
  dir: "/work/specsesh",
  allow: ["pnpm", "node"],
  checks: ["pnpm check", "pnpm test"],
  timeoutMs: 120_000,
  grants: ["delete_file"],
});

// Not opted in: a script declaring mcpTool://delete_file is refused with
// ActionBindingError naming delete_file before anything runs.
export const notGranted = hostFor({
  dir: "/work/specsesh",
  allow: ["pnpm", "node"],
  checks: ["pnpm check", "pnpm test"],
  timeoutMs: 120_000,
  grants: [],
});
