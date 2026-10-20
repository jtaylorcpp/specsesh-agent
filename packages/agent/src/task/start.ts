/**
 * Starting a task loop: read every source, find the task, check the script
 * against the contract and the host's actions, and only then create the task.
 * A refusal creates nothing and calls no model.
 */

import { basename, resolve } from "node:path";
import { start } from "../interpreter/index.js";
import type { Context } from "@earendil-works/chord";
import type { Harness, TaskId } from "@earendil-works/pi-durable";
import { checkBindings, type DelegateGrants } from "../durable/index.js";
import { TaskId as OntologyTaskId, check, type LoopOutcome, type TaskOutcome } from "../openspec/index.js";
import { checkContract } from "./contract.js";
import { concatDeltas } from "./deltas.js";
import { TaskLoopStartError } from "./errors.js";
import type { TaskLoopInput } from "./loop-input.js";
import { OPTIONAL_TARGETS, TaskLoopTask, subagentsOf, taskLoopRegistry } from "./loop.js";
import { DEFAULT_ESCALATE_TO, DEFAULT_MAX_ITERATIONS, type TaskLoopOptions } from "./options.js";
import { readChange, readScript } from "./sources.js";
import { findTask } from "./tasks-md.js";

/** `{ delegates }` as plain JSON, for the durable input and the registry alike; `{}` when none are granted. */
export function delegatesOf(options: { readonly delegates?: DelegateGrants }): { delegates?: DelegateGrants } {
	return options.delegates !== undefined ? { delegates: structuredClone(options.delegates) } : {};
}

/** The loop's durable input, or the refusal. Reads every source once. */
export function prepareTaskLoop(options: TaskLoopOptions): TaskLoopInput {
	if (!check(OntologyTaskId, options.task)) {
		throw new TaskLoopStartError(`"${options.task}" is not a task id; task ids look like 2.4`);
	}
	const maxIterations = options.budget?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
	if (!Number.isInteger(maxIterations) || maxIterations < 1) {
		throw new TaskLoopStartError(`budget.maxIterations must be a positive integer, got ${maxIterations}`);
	}
	const script = readScript(options.script);
	const change = readChange(options.change);
	const taskText = findTask(change.tasks, options.task, change.tasksLabel);

	const deltas = concatDeltas(change.deltas);
	checkContract(script, deltas);
	// The whole document, as a run would check it: parse, lint, subset, entries.
	start(script, { entry: subagentsOf(script) });
	const checks = [...(options.checks ?? [])];
	const allow = [...(options.allow ?? [])];
	const deleteFiles = options.deleteFiles ?? false;
	checkBindings(
		script,
		taskLoopRegistry({ workspace: options.workspace, checks, allow, ...delegatesOf(options), deleteFiles }),
		undefined,
		new Set(Object.keys(OPTIONAL_TARGETS)),
	);

	return {
		task: options.task,
		...("dir" in options.change ? { change: basename(resolve(options.change.dir)) } : {}),
		taskText,
		proposal: change.proposal,
		design: change.design,
		deltas,
		...(change.tasksPath !== undefined ? { tasksPath: change.tasksPath } : {}),
		script,
		workspace: options.workspace,
		budget: { maxIterations },
		checks,
		allow,
		escalateTo: options.escalateTo ?? DEFAULT_ESCALATE_TO,
		...(options.model !== undefined ? { model: options.model } : {}),
		...delegatesOf(options),
		deleteFiles,
		...(options.worktree !== undefined ? { worktree: { path: options.worktree.path, branch: options.worktree.branch } } : {}),
		...(options.excludeChanged !== undefined ? { excludeChanged: [...options.excludeChanged] } : {}),
		carried: "",
		earlier: [],
	};
}

/** Durably create the loop task and return its ID. It runs as soon as the scheduler does. */
export async function startTaskLoop(
	harness: Harness,
	options: TaskLoopOptions,
	context: Context,
): Promise<TaskId<LoopOutcome<TaskOutcome>>> {
	const input = prepareTaskLoop(options);
	return createLoop(harness, input, context);
}

export async function createLoop(harness: Harness, input: TaskLoopInput, context: Context): Promise<TaskId<LoopOutcome<TaskOutcome>>> {
	const owner = await harness.root(context);
	const id = await owner.commit(
		(tx) => tx.createTask(TaskLoopTask, input, { ownership: { kind: "conversation" } }),
		context,
	);
	// The durable result is `{ outcome, notes }`; `waitForTaskLoop` hands back the outcome.
	return id as unknown as TaskId<LoopOutcome<TaskOutcome>>;
}
