/**
 * Waiting for a loop, and answering a blocked one.
 *
 * An answer never reopens the blocked loop: its outcome stays as it ended. The
 * answer starts a new run of the same loop, its first iteration seeded with
 * the decision and numbered on from the earlier iterations, which it keeps.
 */

import type { Context } from "@earendil-works/chord";
import type { Harness, TaskId } from "@earendil-works/pi-durable";
import {
	EscalationAnswer,
	LoopOutcome,
	TaskOutcome,
	check,
	explain,
	type Escalation,
} from "../openspec/index.js";
import { EscalationAnswerError } from "./errors.js";
import type { TaskLoopInput, TaskLoopResult } from "./loop-input.js";
import { TASK_LOOP } from "./loop.js";
import { createLoop } from "./start.js";

const TaskLoopOutcome = LoopOutcome(TaskOutcome);

/** The settled loop's outcome, checked against the ontology, and its notes. */
export async function waitForTaskLoopResult(
	harness: Harness,
	id: TaskId<LoopOutcome<TaskOutcome>>,
	context: Context,
): Promise<{ outcome: LoopOutcome<TaskOutcome>; notes: string[] }> {
	const settled = await harness.waitForTask(id as unknown as TaskId<TaskLoopResult>, context);
	if (settled.state.status !== "terminal") {
		throw new Error(`task loop ${String(id)} is ${settled.state.status}, not finished. Loop IDs are numbers; check the ID passed in.`);
	}
	const outcome = settled.state.outcome;
	if (outcome.status !== "completed") {
		const why = outcome.status === "failed" ? outcome.error.message : (outcome.reason ?? "");
		throw new Error(`task loop ${id} ended ${outcome.status}: ${why}`);
	}
	return readResult(outcome.result, id);
}

/** The settled loop's `LoopOutcome<TaskOutcome>`. */
export async function waitForTaskLoop(
	harness: Harness,
	id: TaskId<LoopOutcome<TaskOutcome>>,
	context: Context,
): Promise<LoopOutcome<TaskOutcome>> {
	return (await waitForTaskLoopResult(harness, id, context)).outcome;
}

const sameEscalation = (a: Escalation | undefined, b: Escalation) =>
	a !== undefined && a.level === b.level && a.to === b.to && a.reason === b.reason && a.question === b.question;

function readResult(value: unknown, id: unknown): { outcome: LoopOutcome<TaskOutcome>; notes: string[] } {
	const { outcome, notes } = (value ?? {}) as Partial<TaskLoopResult>;
	if (!check(TaskLoopOutcome, outcome)) {
		throw new Error(`task loop ${String(id)} holds an outcome the ontology refuses: ${explain(TaskLoopOutcome, outcome).join("; ")}`);
	}
	return { outcome: outcome as LoopOutcome<TaskOutcome>, notes: Array.isArray(notes) ? notes.map(String) : [] };
}

/**
 * Answer a blocked loop's escalation. Accepted only for a loop that ended
 * `blocked`, from the escalation's recipient; otherwise rejects with
 * `EscalationAnswerError` and changes nothing. Returns the new run's ID.
 */
export async function answerEscalation(
	harness: Harness,
	id: TaskId<LoopOutcome<TaskOutcome>>,
	answer: EscalationAnswer,
	context: Context,
): Promise<TaskId<LoopOutcome<TaskOutcome>>> {
	const record = await harness.getTask(id as unknown as TaskId<TaskLoopResult>, context);
	if (record === undefined || record.kind !== TASK_LOOP) throw new EscalationAnswerError(`there is no task loop ${String(id)}`);
	if (record.state.status !== "terminal" || record.state.outcome.status !== "completed") {
		throw new EscalationAnswerError(`task loop ${id} has not ended blocked, so it has no escalation to answer`);
	}
	const { outcome } = readResult(record.state.outcome.result, id);
	if (outcome.status !== "blocked") {
		throw new EscalationAnswerError(`task loop ${id} ended ${outcome.status}, not blocked, so it has no escalation to answer`);
	}
	const escalation = outcome.escalation;
	if (answer.by !== escalation.to) {
		throw new EscalationAnswerError(`the escalation of task loop ${id} goes to the ${escalation.to}, not the ${answer.by}`);
	}
	if (!sameEscalation(answer.escalation, escalation)) {
		throw new EscalationAnswerError(`the answer is to another escalation than the one task loop ${id} ended with`);
	}
	if (!check(EscalationAnswer, answer)) {
		throw new EscalationAnswerError(`the answer is not an EscalationAnswer: ${explain(EscalationAnswer, answer).join("; ")}`);
	}
	const input = record.input as unknown as TaskLoopInput;
	return createLoop(
		harness,
		{ ...input, carried: answer.decision, earlier: outcome.iterations, answers: id as unknown as number, escalation },
		context,
	);
}
