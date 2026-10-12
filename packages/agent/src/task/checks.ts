/**
 * Running a task's configured checks, shared by the task loop's gate and the group loop's check
 * phase. It sits below both so neither imports the other for it.
 */

import { DEFAULT_TIMEOUT_MS, runChecks, type Workspace } from "../durable/index.js";
import { NO_EXEC } from "../durable/workspace.js";
import type { CheckEvidence } from "../openspec/index.js";

/** One check's result: the command as configured, its exit code and its stdout and stderr combined. */
export type CheckRun = { command: string; exitCode: number; output: string };

/** Exit code recorded for a command that could not be spawned, as a shell reports a missing command. */
export const SPAWN_FAILED_EXIT_CODE = 127;

/** Per command before it is killed: the loops' check timeout. */
export const CHECK_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

/** The check evidence of one round: one entry per configured check, in check order. */
export function checkEvidence(runs: readonly CheckRun[]): CheckEvidence[] {
	return runs.map((r) => ({ kind: "check", command: r.command, exitCode: r.exitCode, output: r.output }));
}

/**
 * Run every check in order through the workspace with `runChecks`, none skipped after a failure.
 * A workspace with no `exec` runs none: each check is a failure (127) whose output is
 * `this workspace cannot run commands`, so a round is never met without running its checks.
 */
export async function runLoopChecks(
	workspace: Workspace,
	commands: readonly string[],
	signal?: AbortSignal,
	timeoutMs = CHECK_TIMEOUT_MS,
): Promise<CheckRun[]> {
	if (workspace.exec === undefined) return commands.map((command) => ({ command, exitCode: SPAWN_FAILED_EXIT_CODE, output: NO_EXEC }));
	const ran = await runChecks(workspace, commands, timeoutMs, signal);
	return ran.evidence.map((e) => ({ command: e.command, exitCode: e.exitCode, output: e.output }));
}
