/**
 * Every git command the task runner runs, and nothing else: `status`,
 * `rev-parse`, `worktree add`, `worktree list` and `config user.name` (a read,
 * never a write). It never commits, adds,
 * stashes, checks out or removes anything. `git()` refuses any other
 * subcommand, so a slip here fails loudly instead of touching the repository.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export { changedBetween, repoRoot, snapshot, status, type StatusEntry } from "../node/snapshot.js";

/** The only git invocations the runner may make. */
export const ALLOWED_GIT = ["status", "rev-parse", "worktree add", "worktree list", "config user.name"] as const;

export interface GitResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

/** Run one allowed git command in `cwd`. Any other subcommand throws before spawning. */
export function git(args: readonly string[], cwd: string): GitResult {
	const [first, second] = args;
	// `config` only as the two-word read `config user.name`: a value or a flag would make it a write.
	const allowed = first === "worktree"
		? `worktree ${second ?? ""}`
		: first === "config"
			? (args.length === 2 ? `config ${second ?? ""}` : "config")
			: (first ?? "");
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

/** `git config user.name` in `cwd`, trimmed; undefined when unset, empty, or `cwd` is not usable. */
export function gitUserName(cwd: string): string | undefined {
	if (!existsSync(cwd)) return undefined;
	let ran: GitResult;
	try {
		ran = git(["config", "user.name"], cwd);
	} catch {
		return undefined;
	}
	const name = ran.stdout.trim();
	return ran.code === 0 && name !== "" ? name : undefined;
}

/** `git worktree add -b <branch> <path> HEAD`. */
export function addWorktree(cwd: string, branch: string, path: string): void {
	const ran = git(["worktree", "add", "-b", branch, path, "HEAD"], cwd);
	if (ran.code !== 0) throw new Error(`git worktree add -b ${branch} ${path} HEAD failed: ${ran.stderr.trim()}`);
}
