/**
 * The four built-in host actions over a directory on this machine:
 * `workspaceActions(localWorkspace(dir), …)`. No delegate is built in; a host
 * grants one with `delegationActions`.
 *
 * `confine`, `splitCommand` and `runArgv` are here for a host writing its own
 * Node actions: the same confinement, argv split and no-shell spawn.
 */

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ActionResult } from "../interpreter/index.js";
import type { HostAction } from "../durable/actions.js";
import { workspaceActions, type WorkspaceActionOptions } from "../durable/workspace.js";
import { localWorkspace } from "./local-workspace.js";

export { splitCommand } from "../durable/workspace.js";

export interface BuiltinActionOptions extends WorkspaceActionOptions {
	/** The directory every built-in is confined to and runs in. */
	readonly workspace: string;
}

export function builtinActions({ workspace, ...options }: BuiltinActionOptions): HostAction[] {
	return workspaceActions(localWorkspace(workspace), options);
}

/**
 * Resolve `path` inside the workspace, or the refusal. Refused: an absolute path,
 * a `..` escape, and a path whose real location (through any symlink on the way,
 * up to the deepest part that exists) leaves the workspace.
 */
export function confine(workspace: string, path: string): string | ActionResult {
	const refuse = (): ActionResult => ({ ok: false, message: `${path} is outside the workspace; nothing was read or written` });
	if (path === "" || isAbsolute(path)) return refuse();
	const root = realpathSync(workspace);
	const target = resolve(workspace, path);
	if (!inside(resolve(workspace), target)) return refuse();
	let existing = target;
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) return refuse();
		existing = parent;
	}
	if (!inside(root, realpathSync(existing))) return refuse();
	return target;
}

function inside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export type Ran =
	| { kind: "exited"; code: number; output: string; stderr: string }
	| { kind: "timed-out"; output: string }
	| { kind: "spawn-error"; message: string };

interface RunOptions {
	readonly cwd: string;
	readonly timeoutMs: number;
	readonly signal?: AbortSignal | undefined;
	readonly env?: NodeJS.ProcessEnv;
	readonly stdin?: string;
	/** Keep stderr apart from stdout in `output`, instead of interleaving them. */
	readonly separate?: boolean;
}

/** Spawn an argv with no shell, collecting its output, killing it past the timeout. */
export function runArgv(argv: readonly string[], options: RunOptions): Promise<Ran> {
	const [binary, ...args] = argv;
	if (binary === undefined) return Promise.resolve({ kind: "spawn-error", message: "the command is empty" });
	return new Promise((resolvePromise) => {
		const child = spawn(binary, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let output = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, options.timeoutMs);
		const abort = () => child.kill("SIGKILL");
		options.signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => {
			if (options.separate === true) stderr += chunk.toString();
			else output += chunk.toString();
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
			resolvePromise({ kind: "spawn-error", message: error.message });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
			if (timedOut) resolvePromise({ kind: "timed-out", output });
			else resolvePromise({ kind: "exited", code: code ?? -1, output, stderr });
		});
		child.stdin.on("error", () => {});
		child.stdin.end(options.stdin ?? "");
	});
}
