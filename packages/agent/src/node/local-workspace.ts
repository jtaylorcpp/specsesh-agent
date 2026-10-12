/**
 * A `Workspace` over a directory on this machine. Paths are confined to it: an
 * absolute path, a `..` escape, or a symlink whose real location leaves it is
 * refused. `exec` spawns with no shell, cwd the directory, and kills past the
 * time limit. `snapshot` is git porcelain status with a content hash per path,
 * or `undefined` outside a git repository. `list` is the files git does not
 * ignore (`git ls-files -co --exclude-standard`), or every file but `.git/`
 * outside git; `search` reads those as UTF-8 here, skipping any with a NUL byte.
 */

import { execFile, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
	DEFAULT_SEARCH_LIMIT,
	WorkspaceError,
	matchGlob,
	type ExecOptions,
	type ExecResult,
	type SearchMatch,
	type Workspace,
} from "../durable/workspace.js";
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

	async function list(glob: string): Promise<string[]> {
		return (await listAll(root)).filter((path) => matchGlob(glob, path));
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
		list,
		async search(pattern, options = {}) {
			// No `g` flag: `test` keeps no state from one line to the next. An invalid pattern rejects here.
			const regex = new RegExp(pattern);
			const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
			const matches: SearchMatch[] = [];
			if (limit <= 0) return matches;
			const paths = options.glob === undefined ? await listAll(root) : await list(options.glob);
			for (const path of paths) {
				let content: Buffer;
				try {
					content = await readFile(join(root, path));
				} catch (error) {
					const code = (error as NodeJS.ErrnoException).code;
					if (code === "ENOENT" || code === "EISDIR") continue;
					throw error;
				}
				if (content.includes(0)) continue;
				const lines = content.toString("utf8").split("\n");
				for (let i = 0; i < lines.length; i++) {
					const text = lines[i]!.endsWith("\r") ? lines[i]!.slice(0, -1) : lines[i]!;
					if (!regex.test(text)) continue;
					matches.push({ path, line: i + 1, text });
					if (matches.length >= limit) return matches;
				}
			}
			return matches;
		},
	};
}

/** Every file under `root`, relative with `/`, sorted by code unit: git's view of it when it is in a work tree. */
async function listAll(root: string): Promise<string[]> {
	const listed = await gitListFiles(root);
	const paths = listed === undefined ? await walk(root, "") : await regularFiles(root, listed);
	return paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `git ls-files -co --exclude-standard`, relative to `root`; `undefined` when git fails there (not a work tree, or no git). */
function gitListFiles(root: string): Promise<string[] | undefined> {
	return new Promise((resolvePromise) => {
		execFile(
			"git",
			["ls-files", "-co", "--exclude-standard", "-z"],
			{ cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
			(error, stdout) => resolvePromise(error === null ? stdout.split("\0").filter((path) => path !== "") : undefined),
		);
	});
}

/** The listed paths that are regular files on disk: no deleted tracked file, no submodule. */
async function regularFiles(root: string, paths: readonly string[]): Promise<string[]> {
	const kept: string[] = [];
	for (const path of paths) {
		try {
			if ((await lstat(join(root, path))).isFile()) kept.push(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return kept;
}

/** Regular files under `root/prefix`, skipping `.git` and never following a symlink. */
async function walk(root: string, prefix: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory()) {
			if (entry.name !== ".git") files.push(...(await walk(root, path)));
		} else if (entry.isFile()) files.push(path);
	}
	return files;
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
