/**
 * The tasks stage: drafts `tasks.md` from the approved deltas, seeded with the
 * paths `git ls-files` tracks in the workspace. The loop seeds `approved` with
 * the proposal's, the design's and the specs' files. The gate is `tasks-gate`'s
 * list, claim and size rules over `openspec show`'s scenarios.
 */

import { fileURLToPath } from "node:url";
import { taskIssues } from "../../openspec/index.js";
import { BUNDLED_SCRIPTS } from "../options.js";
import type { SpecStage, StageContext, StageIssue } from "../spec-stage.js";
import { openspecDeltas } from "./openspec-cli.js";
import { readTaskList, scenarioNames, taskBudgetIssues, unclaimed, withClaims } from "./tasks-gate.js";

/** How many tracked paths `base` holds before it is cut. */
export const BASE_PATH_LIMIT = 3000;

/** The first `limit` paths, one per line, then a line saying how many more were cut, if any. */
export function capPaths(paths: readonly string[], limit: number = BASE_PATH_LIMIT): string {
	if (paths.length <= limit) return paths.join("\n");
	const cut = paths.length - limit;
	return [...paths.slice(0, limit), `… ${cut} more file${cut === 1 ? "" : "s"} cut`].join("\n");
}

/** `git ls-files` in the workspace, capped; empty outside git or when the command cannot run. */
export async function trackedFiles(run: StageContext["run"]): Promise<string> {
	let ran;
	try {
		ran = await run(["git", "ls-files"]);
	} catch {
		return "";
	}
	if (ran.exitCode !== 0) return "";
	return capPaths(ran.output.split(/\r?\n/).filter((line) => line !== ""));
}

/**
 * The list's own issues, each task's `taskIssues` with its quoted scenarios as claims,
 * the scenarios no task claims, then the groups and tasks budget. When `openspec show`
 * fails, its `ERROR` stands in for the deltas and no scenario is unclaimed.
 */
export async function tasksGate({ changeId, files, run }: StageContext): Promise<StageIssue[]> {
	const list = readTaskList(files["tasks.md"] ?? "");
	const shown = await openspecDeltas(run, changeId);
	const scenarios = scenarioNames(shown.deltas);
	return [
		...list.issues,
		...shown.issues,
		...list.tasks.flatMap((task) => taskIssues(withClaims(task, scenarios))),
		...unclaimed(scenarios, list.tasks),
		...taskBudgetIssues(list),
	];
}

export const tasksStage: SpecStage = {
	name: "tasks",
	owns: ["tasks.md"],
	after: ["specs"],
	script: { path: fileURLToPath(BUNDLED_SCRIPTS.specPlan) },
	seed: async ({ run }) => ({ base: await trackedFiles(run) }),
	gate: tasksGate,
};
