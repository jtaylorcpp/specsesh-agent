/**
 * The change loop's guard, run before anything is created: a refused build
 * leaves no loop behind.
 *
 *   validate    openspec validate <change> --strict --json   → the first ERROR or WARNING refuses
 *   approvals   approvals.json present?                       → every SPEC_STAGES entry, every sha256 matches
 *   unclaimed   delta scenarios no task quotes by exact name  → kept for the outcome, never refused
 *
 * A change written by hand has no `approvals.json` and is not refused for it.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioRef } from "../openspec/index.js";
import { ApprovalsFileError } from "./errors.js";
import { APPROVALS_FILE, readApprovals, staleApprovals } from "./spec-approvals.js";
import type { StageContext } from "./spec-stage.js";
import { SPEC_STAGES } from "./spec-stages.js";
import { openspecDeltas, openspecValidate } from "./stages/openspec-cli.js";
import { readTaskList, scenarioNames, withClaims } from "./stages/tasks-gate.js";

export type ChangeGuard = { readonly ok: false; readonly refusal: string } | { readonly ok: true; readonly unclaimedAtStart: ScenarioRef[] };

/**
 * Why `change` may not build, or the delta scenarios no task in `tasks.md` quotes. `run`
 * runs a command in the workspace, as a stage's gate is given it. Reads only: it writes
 * nothing and creates no task.
 */
export async function buildRefusal(change: string, changeDir: string, run: StageContext["run"]): Promise<ChangeGuard> {
	const issue = (await openspecValidate(run, change)).find((i) => i.level === "ERROR" || i.level === "WARNING");
	if (issue !== undefined) return { ok: false, refusal: `change ${change} is not valid: ${issue.path}: ${issue.message}` };

	const stale = approvalRefusal(change, changeDir);
	if (stale !== undefined) return { ok: false, refusal: stale };

	const shown = await openspecDeltas(run, change);
	const first = shown.issues[0];
	if (first !== undefined) return { ok: false, refusal: `change ${change}: ${first.message}` };
	return { ok: true, unclaimedAtStart: unclaimedAtStart(readTasksMd(changeDir), scenarioNames(shown.deltas)) };
}

/** The first unapproved stage or changed file, in `SPEC_STAGES` order; none when `approvals.json` does not exist. */
function approvalRefusal(change: string, changeDir: string): string | undefined {
	if (!existsSync(join(changeDir, APPROVALS_FILE))) return undefined;
	try {
		const { approvals } = readApprovals(changeDir);
		// Every spec stage, as the stages a build follows: the check a stage's own start makes.
		for (const { name } of SPEC_STAGES) {
			const [first] = staleApprovals({ name: "build", owns: [], after: [name] }, changeDir);
			if (first !== undefined) return `change ${change} is not as approved: ${first.message}`;
			if (approvals.find((entry) => entry.stage === name)?.approved !== true) {
				return `change ${change} is not as approved: the ${name} stage of ${change} is not approved; run it and approve it first`;
			}
		}
		return undefined;
	} catch (error) {
		if (error instanceof ApprovalsFileError) return `change ${change}: ${error.message}`;
		throw error;
	}
}

/** The scenarios no task quotes by exact name, in delta order: the plan stage's claim rule. */
export function unclaimedAtStart(tasksMd: string, scenarios: readonly ScenarioRef[]): ScenarioRef[] {
	const claimed = readTaskList(tasksMd).tasks.flatMap((task) => withClaims(task, scenarios).links.map((link) => link.target));
	return scenarios.filter((scenario) => !claimed.includes(scenario));
}

function readTasksMd(changeDir: string): string {
	const path = join(changeDir, "tasks.md");
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}
