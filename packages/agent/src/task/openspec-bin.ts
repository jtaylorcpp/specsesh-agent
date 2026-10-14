/**
 * Which `openspec` the runner uses and whether it is new enough. The project's own copy
 * (`node_modules/.bin`) wins over `PATH`; each workspace is resolved, and its `--version` run, once
 * per process. A missing openspec is not refused here: the gates that need it report it themselves.
 */

import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";

/** The oldest openspec the runner supports. */
export const OPENSPEC_MIN_VERSION = "1.14.1";

/** A resolved openspec: its absolute path, its `x.y.z` version (null when unreadable) and where it was found. */
export interface OpenspecBin {
	path: string;
	version: string | null;
	source: "project" | "path";
}

export interface OpenspecRun {
	code: number | null;
	stdout: string;
	stderr: string;
}

const WINDOWS = process.platform === "win32";
const NAMES = WINDOWS ? ["openspec", "openspec.cmd"] : ["openspec"];
const VERSION = /(\d+)\.(\d+)\.(\d+)/;

/** Keyed by the absolute workspace; the promise is stored so concurrent calls share one `--version`. */
const cache = new Map<string, Promise<OpenspecBin | null>>();

/** The workspace's openspec, or null when neither its `node_modules/.bin` nor `PATH` has one. */
export function resolveOpenspec(workspace: string): Promise<OpenspecBin | null> {
	const key = resolve(workspace);
	let found = cache.get(key);
	if (found === undefined) {
		found = locate(key);
		cache.set(key, found);
	}
	return found;
}

/** Forget every resolved openspec, so the next call looks again. */
export function resetOpenspecCache(): void {
	cache.clear();
}

/** `openspec <version> at <path>`, `openspec (version unknown) at <path>`, or `openspec not found`. */
export function describeOpenspec(bin: OpenspecBin | null): string {
	if (bin === null) return "openspec not found";
	return `openspec ${bin.version ?? "(version unknown)"} at ${bin.path}`;
}

/** Refuses an openspec older than `OPENSPEC_MIN_VERSION` or of unknown version; a missing one is ok. */
export async function checkOpenspec(
	workspace: string,
): Promise<{ ok: true; bin: OpenspecBin | null } | { ok: false; message: string }> {
	const bin = await resolveOpenspec(workspace);
	if (bin === null) return { ok: true, bin };
	const version = bin.version === null ? undefined : parseVersion(bin.version);
	if (version === undefined || compareVersions(version, parseVersion(OPENSPEC_MIN_VERSION)!) < 0) {
		return { ok: false, message: `${describeOpenspec(bin)} is below the minimum supported version ${OPENSPEC_MIN_VERSION}` };
	}
	return { ok: true, bin };
}

/** Run `bin` with `args` in `cwd`, telemetry off. Never rejects: a spawn error is `code: null` with its text in stderr. */
export function runOpenspec(bin: OpenspecBin, args: readonly string[], options: { cwd: string }): Promise<OpenspecRun> {
	return new Promise((resolvePromise) => {
		let stdout = "";
		let stderr = "";
		const child = spawn(bin.path, args, { cwd: options.cwd, env: openspecEnv(), shell: usesShell(bin.path) });
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
		child.on("error", (error) => resolvePromise({ code: null, stdout, stderr: stderr + error.message }));
		child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
	});
}

async function locate(workspace: string): Promise<OpenspecBin | null> {
	const project = await firstExisting([join(workspace, "node_modules", ".bin")]);
	if (project !== undefined) return { path: project, version: await readVersion(project), source: "project" };
	const dirs = (process.env.PATH ?? "").split(delimiter).filter((dir) => dir !== "").map((dir) => resolve(dir));
	const onPath = await firstExisting(dirs);
	if (onPath !== undefined) return { path: onPath, version: await readVersion(onPath), source: "path" };
	return null;
}

/** The first `<dir>/<name>` that is executable (or, on Windows, exists). */
async function firstExisting(dirs: readonly string[]): Promise<string | undefined> {
	for (const dir of dirs) {
		for (const name of NAMES) {
			const candidate = join(dir, name);
			try {
				await access(candidate, WINDOWS ? constants.F_OK : constants.X_OK);
				return candidate;
			} catch {
				// not here
			}
		}
	}
	return undefined;
}

/** The first `x.y.z` that `<path> --version` prints, or null when there is none or it cannot start. */
function readVersion(path: string): Promise<string | null> {
	return new Promise((resolvePromise) => {
		execFile(path, ["--version"], { env: openspecEnv(), encoding: "utf8", shell: usesShell(path) }, (error, stdout, stderr) => {
			if (error !== null && typeof (error as NodeJS.ErrnoException).code === "string") return resolvePromise(null);
			resolvePromise(VERSION.exec(`${stdout}${stderr}`)?.[0] ?? null);
		});
	});
}

function openspecEnv(): NodeJS.ProcessEnv {
	return { ...process.env, OPENSPEC_TELEMETRY: "0" };
}

/** A `.cmd` shim runs only through the shell on Windows. */
function usesShell(path: string): boolean {
	return WINDOWS && path.endsWith(".cmd");
}

/** `[major, minor, patch]` from the first `x.y.z` in `version`; suffixes are ignored. */
function parseVersion(version: string): [number, number, number] | undefined {
	const match = VERSION.exec(version);
	return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: readonly number[], b: readonly number[]): number {
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) return a[i]! - b[i]!;
	}
	return 0;
}
