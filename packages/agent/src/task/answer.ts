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
	AMENDMENT_APPLIED,
	EscalationAnswer,
	LoopOutcome,
	TaskOutcome,
	check,
	explain,
	type Escalation,
} from "../openspec/index.js";
import { EscalationAnswerError } from "./errors.js";
import type { Baseline, TaskLoopInput, TaskLoopResult } from "./loop-input.js";
import { TASK_LOOP } from "./loop.js";
import { createLoop } from "./start.js";

const TaskLoopOutcome = LoopOutcome(TaskOutcome);

/** The settled loop's outcome, checked against the ontology, and its notes. */
export async function waitForTaskLoopResult(
	harness: Harness,
	id: TaskId<LoopOutcome<TaskOutcome>>,
	context: Context,
): Promise<{ outcome: LoopOutcome<TaskOutcome>; notes: string[]; since?: Baseline }> {
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

/** A stored baseline: an object of strings. */
const isBaseline = (value: unknown): value is Record<string, string> =>
	typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string");

const sameEscalation = (a: Escalation | undefined, b: Escalation) =>
	a !== undefined && a.level === b.level && a.to === b.to && a.reason === b.reason && a.question === b.question;

/** The result's outcome, checked, its notes, and its baseline when it has one. */
function readResult(value: unknown, id: unknown): { outcome: LoopOutcome<TaskOutcome>; notes: string[]; since?: Baseline } {
	const { outcome, notes, since } = (value ?? {}) as Partial<TaskLoopResult>;
	if (!check(TaskLoopOutcome, outcome)) {
		throw new Error(`task loop ${String(id)} holds an outcome the ontology refuses: ${explain(TaskLoopOutcome, outcome).join("; ")}`);
	}
	return {
		outcome: outcome as LoopOutcome<TaskOutcome>,
		notes: Array.isArray(notes) ? notes.map(String) : [],
		...(since === null || isBaseline(since) ? { since } : {}),
	};
}

/**
 * Answer a blocked loop's escalation. Accepted only for a loop that ended
 * `blocked`, from the escalation's recipient, and for `"amendment-applied"`
 * only from the principal on an escalation with an amendment; otherwise
 * rejects with `EscalationAnswerError` and changes nothing. Returns the new
 * run's ID.
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
	const { outcome, since } = readResult(record.state.outcome.result, id);
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
	// The amendment rule is judged against the escalation the loop stored, not the answer's copy.
	const stored = { ...answer, escalation };
	if (!check(EscalationAnswer, stored)) {
		throw new EscalationAnswerError(`the answer to task loop ${id} is refused: ${explain(EscalationAnswer, stored).join("; ")}`);
	}
	const input = record.input as unknown as TaskLoopInput;
	return createLoop(
		harness,
		// The blocked loop's baseline, so the new run measures `changed` from the very first run's start.
		{
			...input,
			carried: carriedFor(stored),
			earlier: outcome.iterations,
			answers: id as unknown as number,
			escalation,
			...(since !== undefined ? { since } : {}),
		},
		context,
	);
}

/**
 * The decision, or for `"amendment-applied"` the amendment's delta and its full new text,
 * then each feedback item's finding message, as the loop carries a finding (`openspec/loops`).
 */
function carriedFor({ escalation, decision, feedback }: EscalationAnswer): string {
	const amendment = escalation.amendment;
	const head =
		decision !== AMENDMENT_APPLIED || amendment === undefined
			? decision
			: `The principal applied your amendment to ${amendment.delta}. That delta now reads:\n\n${amendment.text}`;
	return [head, ...feedback.map((item) => item.from.message)].join("\n\n");
}
