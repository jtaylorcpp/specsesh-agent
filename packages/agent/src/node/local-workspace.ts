/**
 * A `Workspace` over a directory on this machine. Paths are confined to it: an
 * absolute path, a `..` escape, or a symlink whose real location leaves it is
 * refused. `exec` spawns with no shell, cwd the directory, and kills past the
 * time limit. `snapshot` is git porcelain status with a content hash per path,
 * or `undefined` outside a git repository.
 */

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { WorkspaceError, type ExecOptions, type ExecResult, type Workspace } from "../durable/workspace.js";
import { gitSnapshot } from "./snapshot.js";

export function localWorkspace(dir: string): Workspace {
	const root = resolve(dir);

	/** The absolute target of `path`, or `WorkspaceError("outside the workspace")`. */
	function resolveInside(path: string): string {
		const refuse = () => new WorkspaceError("outside the workspace", path);
		if (path === "" || isAbsolute(path)) throw refuse();
		const target = resolve(root, path);
		if (!inside(root, target)) throw refuse();
		// The deepest part that exists, through any symlink on the way, must stay inside too.
		let existing = target;
		while (!existsSync(existing)) {
			const parent = dirname(existing);
			if (parent === existing) throw refuse();
			existing = parent;
		}
		if (!inside(realpathSync(root), realpathSync(existing))) throw refuse();
		return target;
	}

	return {
		root: dir,
		async read(path) {
			const target = resolveInside(path);
			try {
				return await readFile(target, "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new WorkspaceError("no such file", path);
				throw error;
			}
		},
		async write(path, content) {
			const target = resolveInside(path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, content);
		},
		exec: (argv, options) => exec(root, argv, options),
		snapshot: () => gitSnapshot(root),
	};
}

function inside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Spawn an argv with no shell in `cwd`, with exactly `env` when given, killing it past the timeout or on abort. */
function exec(cwd: string, argv: readonly string[], options: ExecOptions): Promise<ExecResult> {
	const [binary, ...args] = argv;
	if (binary === undefined) return Promise.resolve({ kind: "spawn-error", message: "the command is empty" });
	return new Promise((resolvePromise) => {
		const child = spawn(binary, args, { cwd, env: options.env ?? process.env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let killed = false;
		const kill = () => {
			killed = true;
			child.kill("SIGKILL");
		};
		const timer = setTimeout(kill, options.timeoutMs);
		if (options.signal?.aborted === true) kill();
		else options.signal?.addEventListener("abort", kill, { once: true });
		const settle = (result: ExecResult) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", kill);
			resolvePromise(result);
		};
		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
		child.on("error", (error) => settle({ kind: "spawn-error", message: error.message }));
		child.on("close", (code) => {
			if (killed) settle({ kind: "timed-out", stdout, stderr });
			else settle({ kind: "exited", code: code ?? -1, stdout, stderr });
		});
		child.stdin.on("error", () => {});
		child.stdin.end(options.stdin ?? "");
	});
}
