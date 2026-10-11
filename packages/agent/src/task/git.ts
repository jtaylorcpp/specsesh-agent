/**
 * Every git command the task runner runs, and nothing else: `status`,
 * `rev-parse`, `worktree add` and `worktree list`. It never commits, adds,
 * stashes, checks out or removes anything. `git()` refuses any other
 * subcommand, so a slip here fails loudly instead of touching the repository.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The only git invocations the runner may make. */
export const ALLOWED_GIT = ["status", "rev-parse", "worktree add", "worktree list"] as const;

export interface GitResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

/** Run one allowed git command in `cwd`. Any other subcommand throws before spawning. */
export function git(args: readonly string[], cwd: string): GitResult {
	const [first, second] = args;
	const allowed = first === "worktree" ? `worktree ${second ?? ""}` : (first ?? "");
	if (!(ALLOWED_GIT as readonly string[]).includes(allowed)) {
		throw new Error(`the task runner never runs "git ${args.join(" ")}"; it may run only ${ALLOWED_GIT.join(", ")}`);
	}
	const ran = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (ran.error !== undefined) throw new Error(`git could not start: ${ran.error.message}`);
	return { code: ran.status ?? 1, stdout: ran.stdout, stderr: ran.stderr };
}

/** Whether `cwd` is inside a git working tree. */
export function insideGit(cwd: string): boolean {
	if (!existsSync(cwd)) return false;
	const ran = git(["rev-parse", "--is-inside-work-tree"], cwd);
	return ran.code === 0 && ran.stdout.trim() === "true";
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

/** Whether the local branch exists. */
export function branchExists(cwd: string, branch: string): boolean {
	return git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd).code === 0;
}

/** Whether `path` (repository-relative) exists in the commit at `HEAD`. */
export function existsAtHead(cwd: string, path: string): boolean {
	return git(["rev-parse", "--verify", "--quiet", `HEAD:${path}`], cwd).code === 0;
}

/** The paths of every worktree git knows, the main one included. */
export function worktreePaths(cwd: string): string[] {
	const ran = git(["worktree", "list", "--porcelain"], cwd);
	if (ran.code !== 0) throw new Error(`git worktree list failed: ${ran.stderr.trim()}`);
	return ran.stdout
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => line.slice("worktree ".length));
}

/** `git worktree add -b <branch> <path> HEAD`. */
export function addWorktree(cwd: string, branch: string, path: string): void {
	const ran = git(["worktree", "add", "-b", branch, path, "HEAD"], cwd);
	if (ran.code !== 0) throw new Error(`git worktree add -b ${branch} ${path} HEAD failed: ${ran.stderr.trim()}`);
}
