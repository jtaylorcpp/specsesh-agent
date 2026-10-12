import type { Runners } from "../durable/delegation.js";
import { claudeCodeRunner } from "./claude-code-runner.js";

export { localWorkspace } from "./local-workspace.js";
export { gitSnapshot } from "./snapshot.js";
export { claudeCodeRunner, type ClaudeCodeRunnerOptions } from "./claude-code-runner.js";
// Still defined in ./durable until 3.6 moves it here.
export { builtinActions, type BuiltinActionOptions } from "../durable/builtins.js";

/** The runners a Node host grants from: `claude-code`. */
export const defaultRunners: Runners = { "claude-code": claudeCodeRunner() };
