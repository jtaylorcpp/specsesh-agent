/**
 * The group loop's entry points for a host: start, wait, answer, and the extensions to
 * install. Thin: the loop itself is `GroupLoopTask` in `group.ts`.
 */

import type { Context } from "@earendil-works/chord";
import type { Extension, Harness, TaskId } from "@earendil-works/pi-durable";
import { start } from "../interpreter/index.js";
import { checkBindings } from "../durable/index.js";
import {
	EscalationAnswer,
	GroupOutcome,
	LoopOutcome,
	check,
	explain,
	type Escalation,
} from "../openspec/index.js";
import { checkContract } from "./contract.js";
import { EscalationAnswerError } from "./errors.js";
import {
	GROUP_LOOP,
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

function readResult(value: unknown, id: unknown): { outcome: LoopOutcome<GroupOutcome>; notes: string[] } {
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

/**
 * Answer a blocked group loop's escalation. Rejects with `EscalationAnswerError` for a loop
 * that did not end `blocked`, or an answer not `by` the escalation's recipient.
 *
 * It does not yet start the resumed run: `GroupLoopInput` and the loop's `initial` carry no
 * decision, no earlier entries and no starting phase, so a new run cannot begin at the
 * blocked task or at the judge. That arrives with task 2.5 (`group-answer.ts`).
 */
export async function answerGroupEscalation(
	harness: Harness,
	id: TaskId<LoopOutcome<GroupOutcome>>,
	answer: EscalationAnswer,
	context: Context,
): Promise<TaskId<LoopOutcome<GroupOutcome>>> {
	const record = await harness.getTask(id as unknown as TaskId<GroupLoopResult>, context);
	if (record === undefined || record.kind !== GROUP_LOOP) throw new EscalationAnswerError(`there is no group loop ${String(id)}`);
	if (record.state.status !== "terminal" || record.state.outcome.status !== "completed") {
		throw new EscalationAnswerError(`group loop ${id} has not ended blocked, so it has no escalation to answer`);
	}
	const { outcome } = readResult(record.state.outcome.result, id);
	if (outcome.status !== "blocked") {
		throw new EscalationAnswerError(`group loop ${id} ended ${outcome.status}, not blocked, so it has no escalation to answer`);
	}
	const escalation: Escalation = outcome.escalation;
	if (answer.by !== escalation.to) {
		throw new EscalationAnswerError(`the escalation of group loop ${id} goes to the ${escalation.to}, not the ${answer.by}`);
	}
	if (!check(EscalationAnswer, answer)) {
		throw new EscalationAnswerError(`the answer is not an EscalationAnswer: ${explain(EscalationAnswer, answer).join("; ")}`);
	}
	throw new EscalationAnswerError(
		`group loop ${id} is blocked and the answer is valid, but resuming a group loop is not implemented yet (task 2.5)`,
	);
}
