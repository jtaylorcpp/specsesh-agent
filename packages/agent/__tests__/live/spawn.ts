/**
 * Spawning the runner for `pnpm test:live` so it never outlives its test. The
 * runner starts in its own process group, so its `claude` children are in it
 * too; at the time limit, or when the test ends, the whole group is killed.
 *
 * The first live run's runner outlived its test and kept calling `claude`.
 * `__tests__/task/live-limit.test.ts` drives this same code offline, with a
 * fake `claude` that never answers.
 */

import { spawn } from "node:child_process";

/** Each live run's limit: below vitest.live.config.ts's 30-minute test timeout. */
export const RUN_LIMIT_MS = 15 * 60_000;

export interface Run {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	/** The JSON lines on stderr after the resume hint. */
	readonly events: Record<string, unknown>[];
}

export interface Detached {
	/** The runner's pid, which is also its process group's id. */
	readonly pid: number;
	/** Resolves when the runner exits; rejects, after killing the group, if it reaches the limit. */
	readonly done: Promise<Run>;
}

/** Process groups started here and not yet exited. */
const running = new Set<number>();

/** SIGKILL a process group; a group already gone is fine. */
export function killGroup(pid: number): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

/** Kill every group still running. For `afterEach` and `afterAll`. */
export function killRunning(): void {
	for (const pid of running) killGroup(pid);
	running.clear();
}

/**
 * Start `command` in its own process group with stdin closed. At `limitMs` the
 * group is killed and `done` rejects with `the run was killed at the limit`.
 */
export function startDetached(
	command: string,
	args: readonly string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; limitMs: number; echo?: boolean },
): Detached {
	const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
	const pid = child.pid;
	if (pid === undefined) throw new Error(`${command} did not start`);
	running.add(pid);
	const done = new Promise<Run>((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let limited = false;
		const timer = setTimeout(() => {
			limited = true;
			killGroup(pid);
		}, options.limitMs);
		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
			if (options.echo === true) process.stderr.write(chunk);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			running.delete(pid);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			running.delete(pid);
			if (limited) {
				reject(new Error(`the run was killed at the limit of ${options.limitMs} ms, with its process group\n${stderr}`));
				return;
			}
			resolve({ code: code ?? -1, stdout, stderr, events: eventLines(stderr) });
		});
	});
	return { pid, done };
}

function eventLines(stderr: string): Record<string, unknown>[] {
	return stderr
		.trimEnd()
		.split("\n")
		.slice(1)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as Record<string, unknown>];
			} catch {
				return [];
			}
		});
}
