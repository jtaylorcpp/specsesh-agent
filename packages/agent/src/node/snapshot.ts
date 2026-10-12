/**
 * Git snapshots of a working tree: each path `git status` lists, with its
 * porcelain code and a content hash. Read-only: the only git commands here are
 * `status` and `rev-parse`, and any other throws before spawning.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceSnapshot } from "../durable/workspace.js";

const READ_ONLY_GIT = ["status", "rev-parse"];

function git(args: readonly string[], cwd: string): { code: number; stdout: string; stderr: string } {
	if (!READ_ONLY_GIT.includes(args[0] ?? "")) throw new Error(`snapshots never run "git ${args.join(" ")}"`);
	const ran = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (ran.error !== undefined) throw new Error(`git could not start: ${ran.error.message}`);
	return { code: ran.status ?? 1, stdout: ran.stdout, stderr: ran.stderr };
}

/** The working tree's top directory. */
export function repoRoot(cwd: string): string {
	const ran = git(["rev-parse", "--show-toplevel"], cwd);
	if (ran.code !== 0) throw new Error(`${cwd} is not inside a git repository: ${ran.stderr.trim()}`);
	return ran.stdout.trim();
}

export interface StatusEntry {
	/** The two-letter porcelain code, e.g. ` M` or `??`. */
	readonly code: string;
	/** Relative to the repository root, with `/`. */
	readonly path: string;
}

/** `git status --porcelain`, every untracked file listed. Ignored files never appear. */
export function status(cwd: string): StatusEntry[] {
	const ran = git(["status", "--porcelain", "-z", "--untracked-files=all"], cwd);
	if (ran.code !== 0) throw new Error(`git status failed in ${cwd}: ${ran.stderr.trim()}`);
	const fields = ran.stdout.split("\0");
	const entries: StatusEntry[] = [];
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i] as string;
		if (field.length < 4) continue;
		const code = field.slice(0, 2);
		entries.push({ code, path: field.slice(3) });
		// A rename or copy is followed by its source path.
		if (code.includes("R") || code.includes("C")) i++;
	}
	return entries;
}

/** Each listed path's porcelain code and content hash, so a further edit to an already-modified file still shows. */
export function snapshot(cwd: string): Map<string, string> {
	const root = repoRoot(cwd);
	const entries = new Map<string, string>();
	for (const { code, path } of status(cwd)) {
		const file = join(root, path);
		const hash =
			existsSync(file) && statSync(file).isFile() ? createHash("sha256").update(readFileSync(file)).digest("hex") : "-";
		entries.set(path, `${code}:${hash}`);
	}
	return entries;
}

/** Sorted paths whose entry differs between the two snapshots, minus `exclude` (repository-relative). */
export function changedBetween(before: Map<string, string>, after: Map<string, string>, exclude: ReadonlySet<string>): string[] {
	const paths = new Set([...before.keys(), ...after.keys()]);
	return [...paths].filter((path) => before.get(path) !== after.get(path) && !exclude.has(path)).sort();
}

/** `snapshot(dir)`, or `undefined` when `dir` is not inside a git working tree. Paths are relative to the repository root. */
export async function gitSnapshot(dir: string): Promise<WorkspaceSnapshot | undefined> {
	if (!existsSync(dir)) return undefined;
	const inside = git(["rev-parse", "--is-inside-work-tree"], dir);
	if (inside.code !== 0 || inside.stdout.trim() !== "true") return undefined;
	return snapshot(dir);
}
