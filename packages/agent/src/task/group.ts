/**
 * Starting a group loop, the part that needs no harness: the group's options, every
 * source read once into the durable input, and the group found in tasks.md.
 * A refusal creates nothing and calls no model.
 */

import { readFileSync } from "node:fs";
import type { ModelRef } from "@earendil-works/pi-durable";
import type { Recipient } from "../openspec/index.js";
import { concatDeltas } from "./deltas.js";
import { TaskLoopStartError } from "./errors.js";
import {
	BUNDLED_SCRIPTS,
	DEFAULT_ESCALATE_TO,
	DEFAULT_MAX_ITERATIONS,
	type LoopWorktree,
	type Source,
	type TaskLoopOptions,
} from "./options.js";
import { readChange, readScript, readSource } from "./sources.js";

export const DEFAULT_MAX_REWORKS = 2;

/** The task-loop options with a group in place of the task, a judge script and a rework budget. */
export type GroupLoopOptions = Omit<TaskLoopOptions, "task" | "budget"> & {
	/** The group's number: the `2` of `## 2. Title` and of `2.1`. */
	readonly group: number;
	/** The group judge's Agent Script. Defaults to the bundled `group.agent`. */
	readonly groupScript?: Source;
	readonly budget?: { readonly maxIterations?: number; readonly maxReworks?: number };
};

/** The options with every default filled and the numbers checked. */
export interface ResolvedGroupOptions extends Omit<GroupLoopOptions, "groupScript" | "budget"> {
	readonly groupScript: Source | { readonly bundled: "group" };
	readonly budget: { readonly maxIterations: number; readonly maxReworks: number };
}

export interface GroupTask {
	readonly id: string;
	readonly text: string;
	readonly ticked: boolean;
}

export interface FoundGroup {
	readonly number: number;
	readonly title: string;
	readonly tasks: readonly GroupTask[];
}

/** The durable input of `agentscript.group-loop`: every source already read into text. */
export interface GroupLoopInput {
	readonly group: number;
	readonly groupTitle: string;
	/** The group's task lines, in file order. */
	readonly tasks: readonly GroupTask[];
	readonly proposal: string;
	readonly design: string;
	/** Every delta, concatenated with capability headings. */
	readonly deltas: string;
	readonly tasksText: string;
	/** Absolute; set only when tasks.md came from a file, which only then is ticked. */
	readonly tasksPath?: string;
	/** The task script every child task loop runs. */
	readonly script: string;
	readonly groupScript: string;
	readonly workspace: string;
	readonly budget: { readonly maxIterations: number; readonly maxReworks: number };
	readonly checks: readonly string[];
	readonly allow: readonly string[];
	readonly escalateTo: Recipient;
	readonly model?: ModelRef;
	readonly delegateModel?: string;
	readonly delegateContext?: readonly string[];
	readonly worktree?: LoopWorktree;
}

function positiveInteger(name: string, value: unknown): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new TaskLoopStartError(`${name} must be a positive integer, got ${String(value)}`);
	}
	return value;
}

/** Validate the numbers and fill the defaults. */
export function resolveGroupOptions(options: GroupLoopOptions): ResolvedGroupOptions {
	const group = positiveInteger("group", options.group);
	const maxIterations = positiveInteger("budget.maxIterations", options.budget?.maxIterations ?? DEFAULT_MAX_ITERATIONS);
	const maxReworks = positiveInteger("budget.maxReworks", options.budget?.maxReworks ?? DEFAULT_MAX_REWORKS);
	return { ...options, group, groupScript: options.groupScript ?? { bundled: "group" }, budget: { maxIterations, maxReworks } };
}

/** The group judge script's text: the given source, or the bundled `group.agent`. */
function readGroupScript(script: ResolvedGroupOptions["groupScript"]): string {
	if ("bundled" in script) return readFileSync(BUNDLED_SCRIPTS.group, "utf8");
	return readSource(script);
}

const GROUP_HEADING = /^## (\d+)\.\s*(.*)$/;

/**
 * The group's heading and task lines. An unknown number refuses, listing every group
 * the file holds; a group without task lines refuses too.
 */
export function findGroup(tasksText: string, n: number, label = "tasks.md"): FoundGroup {
	const lines = tasksText.split(/\r?\n/);
	const numbers: number[] = [];
	let title: string | undefined;
	let inGroup = false;
	const taskLine = new RegExp(`^\\s*- \\[( |x|X)\\] (${n}\\.\\d+)\\b\\s*(.*)$`);
	const tasks: GroupTask[] = [];
	for (const line of lines) {
		if (line.startsWith("## ")) {
			const heading = GROUP_HEADING.exec(line);
			if (heading !== null) numbers.push(Number(heading[1]));
			inGroup = heading !== null && Number(heading[1]) === n && title === undefined;
			if (inGroup) title = (heading as RegExpExecArray)[2] as string;
			continue;
		}
		if (!inGroup) continue;
		const m = taskLine.exec(line);
		if (m !== null) tasks.push({ id: m[2] as string, text: m[3] as string, ticked: m[1] !== " " });
	}
	if (title === undefined) {
		throw new TaskLoopStartError(`no group ${n} in ${label}; groups: ${numbers.length > 0 ? numbers.join(", ") : "none"}`);
	}
	if (tasks.length === 0) throw new TaskLoopStartError(`group ${n} has no tasks`);
	return { number: n, title, tasks };
}

/** Read every source once and find the group. Nothing is read again after this. */
export function readGroupInput(options: ResolvedGroupOptions): GroupLoopInput {
	const script = readScript(options.script);
	const groupScript = readGroupScript(options.groupScript);
	const change = readChange(options.change);
	const found = findGroup(change.tasks, options.group, change.tasksLabel);
	return {
		group: found.number,
		groupTitle: found.title,
		tasks: found.tasks,
		proposal: change.proposal,
		design: change.design,
		deltas: concatDeltas(change.deltas),
		tasksText: change.tasks,
		...(change.tasksPath !== undefined ? { tasksPath: change.tasksPath } : {}),
		script,
		groupScript,
		workspace: options.workspace,
		budget: { maxIterations: options.budget.maxIterations, maxReworks: options.budget.maxReworks },
		checks: [...(options.checks ?? [])],
		allow: [...(options.allow ?? [])],
		escalateTo: options.escalateTo ?? DEFAULT_ESCALATE_TO,
		...(options.model !== undefined ? { model: options.model } : {}),
		...(options.delegateModel !== undefined ? { delegateModel: options.delegateModel } : {}),
		...(options.delegateContext !== undefined ? { delegateContext: [...options.delegateContext] } : {}),
		...(options.worktree !== undefined ? { worktree: { path: options.worktree.path, branch: options.worktree.branch } } : {}),
	};
}

/**
 * Every refusal that needs no harness, in order: the options, the sources, the group,
 * the checks. Returns the durable input; a refusal means nothing was created.
 */
export function validateGroupStart(options: GroupLoopOptions): GroupLoopInput {
	const input = readGroupInput(resolveGroupOptions(options));
	if (input.checks.length === 0) throw new TaskLoopStartError("a group needs at least one check");
	return input;
}
