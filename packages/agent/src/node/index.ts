import { agentRunner } from "../durable/agent-runner.js";
import type { Runners } from "../durable/delegation.js";

export { localWorkspace } from "./local-workspace.js";
export { gitSnapshot } from "./snapshot.js";
export { builtinActions, confine, runArgv, splitCommand, type BuiltinActionOptions, type Ran } from "./builtins.js";

/** The runners a Node host grants from: `agent`. A host adds its own process runners beside it. */
export const defaultRunners: Runners = { agent: agentRunner() };
