/**
 * Running a task's configured checks, shared by the task loop's gate and the group loop's check
 * phase. It sits below both so neither imports the other for it.
 */

import { DEFAULT_TIMEOUT_MS, runArgv, splitCommand } from "../durable/index.js";
import type { CheckEvidence } from "../openspec/index.js";

/** One check's result: the command as configured, its exit code and its stdout and stderr combined. */
export type CheckRun = { command: string; exitCode: number; output: string };

/** Exit code recorded for a command that could not be spawned, as a shell reports a missing command. */
export const SPAWN_FAILED_EXIT_CODE = 127;

/** The check evidence of one round: one entry per configured check, in check order. */
export function checkEvidence(runs: readonly CheckRun[]): CheckEvidence[] {
	return runs.map((r) => ({ kind: "check", command: r.command, exitCode: r.exitCode, output: r.output }));
}

/**
 * Run every check in order over the workspace, none skipped after a failure. Each command is
 * split into an argv and spawned with no shell. One that cannot start is a failure (127, the
 * spawn error as output); one that times out is a failure too (-1). Nothing here throws.
 */
export async function runGroupChecks(
	commands: readonly string[],
	workspace: string,
	signal?: AbortSignal,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CheckRun[]> {
	const runs: CheckRun[] = [];
	for (const command of commands) {
		const ran = await runArgv(splitCommand(command), { cwd: workspace, timeoutMs, signal });
		if (ran.kind === "exited") runs.push({ command, exitCode: ran.code, output: ran.output });
		else if (ran.kind === "timed-out") runs.push({ command, exitCode: -1, output: `${ran.output}\n(timed out after ${timeoutMs}ms)` });
		else runs.push({ command, exitCode: SPAWN_FAILED_EXIT_CODE, output: ran.message });
	}
	return runs;
}
