/**
 * What a task loop changed since it started: the baseline its first iteration takes of the
 * gate's workspace, and the `changed` seed measured from it.
 *
 * The baseline is plain JSON (path → snapshot value, sorted), so it rides in the checkpoint
 * and the result; `null` records a workspace that cannot snapshot. Snapshots are advisory:
 * one that throws counts as none, never as a loop failure.
 */

import { dirname } from "node:path";
import type { Workspace, WorkspaceSnapshot } from "../durable/index.js";
import { changedBetween, insideGit, repoRoot } from "./git.js";
import type { Baseline, TaskLoopInput } from "./loop-input.js";
import { inRepo } from "./worktree.js";

/** Seeded as `changed` when the loop has no baseline to measure from. */
export const CHANGED_UNKNOWN = "(unknown)";

/** The workspace's snapshot now, or `undefined` when it has none, answers none, or throws. */
export async function snapshotOf(workspace: Workspace): Promise<WorkspaceSnapshot | undefined> {
	try {
		return await workspace.snapshot?.();
	} catch {
		return undefined;
	}
}

/** A snapshot as a baseline: a path-sorted object, or `null` for no snapshot. */
export function baselineOf(snapshot: WorkspaceSnapshot | undefined): Baseline {
	if (snapshot === undefined) return null;
	return Object.fromEntries([...snapshot].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The repository-relative paths `changed` leaves out: `excludeChanged`, and the change's
 * tasks.md, relative to the workspace's root and, inside git, to its repository's root.
 */
function excluded(input: Pick<TaskLoopInput, "tasksPath" | "excludeChanged">, workspace: Workspace): Set<string> {
	const paths = new Set(input.excludeChanged ?? []);
	const tasks = input.tasksPath;
	if (tasks !== undefined) {
		const roots = [workspace.root];
		try {
			if (insideGit(dirname(tasks))) roots.push(repoRoot(dirname(tasks)));
		} catch {
			// No git to ask: the workspace's root alone.
		}
		for (const root of roots) {
			const rel = inRepo(root, tasks);
			if (rel !== undefined) paths.add(rel);
		}
	}
	return paths;
}

/** Sorted paths changed between `since` and `now`, less the exclusions; `undefined` when either is missing. */
export function changedSince(
	input: Pick<TaskLoopInput, "tasksPath" | "excludeChanged">,
	workspace: Workspace,
	since: Baseline,
	now: WorkspaceSnapshot | undefined,
): string[] | undefined {
	if (since === null || now === undefined) return undefined;
	return changedBetween(new Map(Object.entries(since)), new Map(now), excluded(input, workspace));
}

/** The `changed` seed: one path per line, `""` for none, or `(unknown)`. */
export function changedSeed(changed: readonly string[] | undefined): string {
	return changed === undefined ? CHANGED_UNKNOWN : changed.join("\n");
}
