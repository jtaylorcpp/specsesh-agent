import { agentRunner } from "../durable/agent-runner.js";
import type { Runners } from "../durable/delegation.js";
import { claudeCodeRunner } from "./claude-code-runner.js";

export { localWorkspace } from "./local-workspace.js";
export { gitSnapshot } from "./snapshot.js";
export { claudeCodeRunner, type ClaudeCodeRunnerOptions } from "./claude-code-runner.js";
export { builtinActions, confine, runArgv, splitCommand, type BuiltinActionOptions, type Ran } from "./builtins.js";

/** The runners a Node host grants from: `claude-code` and `agent`. */
export const defaultRunners: Runners = { "claude-code": claudeCodeRunner(), agent: agentRunner() };
