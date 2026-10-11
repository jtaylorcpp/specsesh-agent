/**
 * The group loop's entry points for a host: start, wait, answer, and the extensions to
 * install. Thin: the loop itself is `GroupLoopTask` in `group.ts`.
 */

import type { Context } from "@earendil-works/chord";
import type { Extension, Harness, TaskId } from "@earendil-works/pi-durable";
import { start } from "../interpreter/index.js";
import { checkBindings } from "../durable/index.js";
import { GroupOutcome, LoopOutcome, check, explain } from "../openspec/index.js";
import { checkContract } from "./contract.js";
import {
	GroupLoop,
	GroupLoopTask,
	validateGroupStart,
	type GroupLoopOptions,
	type GroupLoopResult,
} from "./group.js";
import { checkGroupContract } from "./group-judge.js";
import { subagentsOf, taskLoopExtensions, taskLoopRegistry, type TaskLoopActionOptions } from "./loop.js";

export { GroupLoop };

const GroupLoopOutcome = LoopOutcome(GroupOutcome);

/** `GroupLoop` plus the three extensions `taskLoopExtensions` returns for the same options. */
export function groupLoopExtensions(options: TaskLoopActionOptions): readonly [Extension, Extension, Extension, Extension] {
	const [loop, run, step] = taskLoopExtensions(options);
	return [GroupLoop, loop, run, step];
}

/**
 * Durably create the group loop and return its ID. Every refusal (options, sources, group,
 * checks, both scripts) comes first and creates nothing.
 */
export async function startGroupLoop(
	harness: Harness,
	options: GroupLoopOptions,
	context: Context,
): Promise<TaskId<LoopOutcome<GroupOutcome>>> {
	const input = validateGroupStart(options);

	checkGroupContract(input.groupScript);
	start(input.groupScript, { entry: subagentsOf(input.groupScript) });
	// The children are task loops, so the task script keeps the task-script contract.
	checkContract(input.script);
	start(input.script, { entry: subagentsOf(input.script) });
	checkBindings(
		input.script,
		taskLoopRegistry({ workspace: input.workspace, checks: [...input.checks], allow: [...input.allow] }),
	);

	const owner = await harness.root(context);
	const id = await owner.commit((tx) => tx.createTask(GroupLoopTask, input, { ownership: { kind: "conversation" } }), context);
	return id as unknown as TaskId<LoopOutcome<GroupOutcome>>;
}

export function readResult(value: unknown, id: unknown): { outcome: LoopOutcome<GroupOutcome>; notes: string[] } {
	const { outcome, notes } = (value ?? {}) as Partial<GroupLoopResult>;
	if (!check(GroupLoopOutcome, outcome)) {
		throw new Error(`group loop ${String(id)} holds an outcome the ontology refuses: ${explain(GroupLoopOutcome, outcome).join("; ")}`);
	}
	return { outcome: outcome as LoopOutcome<GroupOutcome>, notes: Array.isArray(notes) ? notes.map(String) : [] };
}

/** The settled group loop's `LoopOutcome<GroupOutcome>`, checked against the ontology. */
export async function waitForGroupLoop(
	harness: Harness,
	id: TaskId<LoopOutcome<GroupOutcome>>,
	context: Context,
): Promise<LoopOutcome<GroupOutcome>> {
	const settled = await harness.waitForTask(id as unknown as TaskId<GroupLoopResult>, context);
	if (settled.state.status !== "terminal") {
		throw new Error(`group loop ${String(id)} is ${settled.state.status}, not finished. Loop IDs are numbers; check the ID passed in.`);
	}
	const outcome = settled.state.outcome;
	if (outcome.status !== "completed") {
		const why = outcome.status === "failed" ? outcome.error.message : (outcome.reason ?? "");
		throw new Error(`group loop ${id} ended ${outcome.status}: ${why}`);
	}
	return readResult(outcome.result, id).outcome;
}
