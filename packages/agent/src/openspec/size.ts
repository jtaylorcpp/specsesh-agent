/**
 * Size (`openspec/size`): how big a change and its tasks may be.
 *
 * A `SizeBudget` holds the limits; `changeSize` counts what a change holds, and
 * the rules report each overrun as a `ValidationReport` issue. All are pure:
 * nothing here reads a file.
 */

import { type Static } from "typebox";
import { type ValidationReport } from "./evidence.js";
import { type CapabilityPath, type Change, type Proposal, type Task, formatRef } from "./model.js";
import { Int, closed, sameValue } from "./schema.js";

// ── Budget ──────────────────────────────────────────────────────────────────

export const SizeBudget = closed({
	capabilities: Int({ minimum: 1 }),
	requirements: Int({ minimum: 1 }),
	scenarios: Int({ minimum: 1 }),
	groups: Int({ minimum: 1 }),
	tasks: Int({ minimum: 1 }),
	taskFiles: Int({ minimum: 1 }),
	taskChars: Int({ minimum: 1 }),
	testScenarios: Int({ minimum: 1 }),
});
export type SizeBudget = Static<typeof SizeBudget>;

/** The size of the changes in this repository that converged cleanly. Spread it to override a limit. */
export const DEFAULT_SIZE_BUDGET: Readonly<SizeBudget> = Object.freeze({
	capabilities: 2,
	requirements: 6,
	scenarios: 16,
	groups: 4,
	tasks: 12,
	taskFiles: 1,
	taskChars: 240,
	testScenarios: 4,
});

// ── Counting ────────────────────────────────────────────────────────────────

export const ChangeSize = closed({
	capabilities: Int({ minimum: 0 }),
	requirements: Int({ minimum: 0 }),
	scenarios: Int({ minimum: 0 }),
	groups: Int({ minimum: 0 }),
	tasks: Int({ minimum: 0 }),
});
export type ChangeSize = Static<typeof ChangeSize>;

const distinct = (all: readonly CapabilityPath[]): CapabilityPath[] =>
	all.filter((path, i) => all.findIndex((other) => sameValue(other, path)) === i);

/** The distinct capability paths of the proposal (new, then modified) and the deltas, in first-seen order. */
export function capabilityPaths(change: Change): CapabilityPath[] {
	return distinct([
		...change.proposal.capabilities.new,
		...change.proposal.capabilities.modified,
		...change.deltas.map((delta) => delta.capability),
	]);
}

/** One requirement per delta; scenarios only from ADDED and MODIFIED; groups and tasks zero when there is no task list. */
export function changeSize(change: Change): ChangeSize {
	const groups = change.tasks?.groups ?? [];
	return {
		capabilities: capabilityPaths(change).length,
		requirements: change.deltas.length,
		scenarios: change.deltas.reduce(
			(sum, delta) => sum + (delta.op === "ADDED" || delta.op === "MODIFIED" ? delta.requirement.scenarios.length : 0),
			0,
		),
		groups: groups.length,
		tasks: groups.reduce((sum, group) => sum + group.tasks.length, 0),
	};
}

// ── Rules ───────────────────────────────────────────────────────────────────

type Issue = ValidationReport["issues"][number];

const over = (count: number, limit: number, noun: string, split?: string): string =>
	`${count} ${noun}, over the budget of ${limit}.${split === undefined ? "" : ` ${split}`}`;

const splitByCapability = (paths: readonly CapabilityPath[]): string =>
	`Split it into one change per capability: ${paths.map(formatRef).join(", ")}`;

/**
 * One `WARNING` per count over its limit. Too many capabilities suggests one
 * change per capability; too many groups or tasks, one change per group.
 */
export function sizeIssues(change: Change, budget: SizeBudget = DEFAULT_SIZE_BUDGET): Issue[] {
	const size = changeSize(change);
	const byGroup = `Split it into one change per group: ${(change.tasks?.groups ?? [])
		.map((group) => `${group.number}. ${group.title}`)
		.join(", ")}`;
	const issues: Issue[] = [];
	const warn = (path: string, message: string) => issues.push({ level: "WARNING", path, message });
	if (size.capabilities > budget.capabilities) {
		warn("proposal.md", over(size.capabilities, budget.capabilities, "capabilities", splitByCapability(capabilityPaths(change))));
	}
	if (size.requirements > budget.requirements) warn("specs", over(size.requirements, budget.requirements, "requirements"));
	if (size.scenarios > budget.scenarios) warn("specs", over(size.scenarios, budget.scenarios, "scenarios"));
	if (size.groups > budget.groups) warn("tasks.md", over(size.groups, budget.groups, "groups", byGroup));
	if (size.tasks > budget.tasks) warn("tasks.md", over(size.tasks, budget.tasks, "tasks", byGroup));
	return issues;
}

/** The capability count of a proposal, before any delta exists: one `WARNING` over the limit, else `[]`. */
export function proposalSizeIssues(proposal: Proposal, budget: SizeBudget = DEFAULT_SIZE_BUDGET): Issue[] {
	const paths = distinct([...proposal.capabilities.new, ...proposal.capabilities.modified]);
	if (paths.length <= budget.capabilities) return [];
	return [
		{
			level: "WARNING",
			path: "proposal.md",
			message: over(paths.length, budget.capabilities, "capabilities", splitByCapability(paths)),
		},
	];
}

/** A path with at least one separator and an extension, such as `src/a.ts`. */
const FILE_TOKEN = /(?<![\w./@-])[\w.@-]+(?:\/[\w.@-]+)+\.\w+(?![\w/])/g;

/** The task's `files`, then each file-like token in its text, distinct and in first-seen order. */
const taskFiles = (task: Task): string[] => [...new Set([...task.files, ...(task.text.match(FILE_TOKEN) ?? [])])];

/** The distinct `scenario-named` targets; zero for a task that is not a test task. */
const claimedScenarios = (task: Task): number => {
	const targets = task.links.filter((link) => link.basis === "scenario-named").map((link) => link.target);
	return targets.filter((target, i) => targets.findIndex((other) => sameValue(other, target)) === i).length;
};

/**
 * One `WARNING` at `tasks.md#<id>` per rule the task breaks: more than
 * `taskFiles` files, more than one line, more than `taskChars` characters and,
 * for a test task, more than `testScenarios` claimed scenarios. A task naming
 * no file passes the file rule.
 */
export function taskIssues(task: Task, budget: SizeBudget = DEFAULT_SIZE_BUDGET): Issue[] {
	const issues: Issue[] = [];
	const warn = (message: string) => issues.push({ level: "WARNING", path: `tasks.md#${task.id}`, message });
	const files = taskFiles(task);
	if (files.length > budget.taskFiles) {
		warn(over(files.length, budget.taskFiles, "files", `A task changes one file; split it: ${files.join(", ")}`));
	}
	if (task.text.trimEnd().includes("\n")) warn("Spans more than one line; a task is one line.");
	if (task.text.length > budget.taskChars) warn(over(task.text.length, budget.taskChars, "characters"));
	const scenarios = claimedScenarios(task);
	if (scenarios > budget.testScenarios) {
		warn(over(scenarios, budget.testScenarios, "claimed scenarios", `A test task covers at most ${budget.testScenarios}.`));
	}
	return issues;
}
