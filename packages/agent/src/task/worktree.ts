/**
 * Worktree mode: the task runs in a new git worktree on its own branch, from
 * `HEAD`, so the main tree stays untouched and several tasks can run at once.
 *
 *   path   = <worktreeDir>/<change-id>-<task-id>   (default ../<repo-dir-name>-worktrees)
 *   branch = task/<change-id>/<task-id>
 *
 * A worktree is never reused or clobbered: an existing branch or path refuses
 * the run. Neither is one ever removed here: the runner leaves it for review.
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { splitCommand } from "../durable/index.js";
import { addWorktree, branchExists, existsAtHead, insideGit, repoRoot, worktreePaths } from "./git.js";

/** Worktree mode refused before anything was created. Exit 2. */
export class WorktreeRefusedError extends Error {
	override readonly name = "WorktreeRefusedError";
}

export interface WorktreePlan {
	/** The main working tree's root. */
	readonly repo: string;
	readonly path: string;
	readonly branch: string;
}

/** Where the worktree for this task goes, and its branch. Refuses outside git. */
export function planWorktree(options: { cwd: string; changeId: string; taskId: string; worktreeDir?: string }): WorktreePlan {
	if (!insideGit(options.cwd)) {
		throw new WorktreeRefusedError(`worktree mode needs a git repository, and ${options.cwd} is not inside one`);
	}
	const repo = repoRoot(options.cwd);
	const dir = options.worktreeDir ?? resolve(repo, "..", `${basename(repo)}-worktrees`);
	return { repo, path: join(dir, `${options.changeId}-${options.taskId}`), branch: `task/${options.changeId}/${options.taskId}` };
}

const real = (path: string) => (existsSync(path) ? realpathSync(path) : resolve(path));

/** `path` relative to the repository root, or undefined when it lies outside it. */
export function inRepo(repo: string, path: string): string | undefined {
	const rel = relative(real(repo), real(path));
	if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
	return rel.split(sep).join("/");
}

/** The same place inside the worktree, for a path inside the repository; any other path as it is. */
export function rebase(plan: WorktreePlan, path: string): string {
	const rel = inRepo(plan.repo, path);
	return rel === undefined ? path : join(plan.path, rel);
}

/** Refuse when the branch or path exists, or the change is not committed at `HEAD`. Creates nothing. */
export function checkWorktree(plan: WorktreePlan, changeDir: string): void {
	if (branchExists(plan.repo, plan.branch)) {
		throw new WorktreeRefusedError(`the branch ${plan.branch} already exists; run never reuses a task branch`);
	}
	if (existsSync(plan.path) || worktreePaths(plan.repo).some((path) => resolve(path) === resolve(plan.path))) {
		throw new WorktreeRefusedError(`the worktree path ${plan.path} already exists; run never reuses or clobbers one`);
	}
	const rel = inRepo(plan.repo, changeDir);
	if (rel === undefined || !existsAtHead(plan.repo, rel)) {
		throw new WorktreeRefusedError(
			`the change ${changeDir} is not committed at HEAD, and the worktree starts from HEAD; commit it first`,
		);
	}
}

/** `git worktree add -b <branch> <path> HEAD`. */
export function createWorktree(plan: WorktreePlan): void {
	addWorktree(plan.repo, plan.branch, plan.path);
}

export type SetupResult = { readonly ok: true } | { readonly ok: false; readonly command: string; readonly code: number; readonly output: string };

/** Run each setup command in the worktree, in order, without a shell; stop at the first failure. */
export function runSetup(commands: readonly string[], cwd: string): SetupResult {
	for (const command of commands) {
		const [binary, ...args] = splitCommand(command);
		if (binary === undefined) continue;
		const ran = spawnSync(binary, args, { cwd, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 });
		const code = ran.error !== undefined ? -1 : (ran.status ?? -1);
		if (code !== 0) {
			const output = ran.error !== undefined ? `could not start: ${ran.error.message}` : `${ran.stdout}${ran.stderr}`;
			return { ok: false, command, code, output };
		}
	}
	return { ok: true };
}
