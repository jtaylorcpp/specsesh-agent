/**
 * Answering a blocked spec loop. As for a task loop, the answer never reopens
 * the blocked run: it starts a new run of the same loop.
 *
 *   review, "approve"   (trimmed, any case) a run with `approve: true`: it drafts
 *                       nothing, records the approval and ends converged
 *   review, anything    a draft carrying `The principal asked for: <decision>`
 *   question, anything  the same, even "approve": a question approves nothing
 *
 * A draft keeps the blocked run's iterations and numbers on from them; its
 * `current` is read from disk, as every iteration's is. Only a named principal
 * answers a review, and a refused answer starts nothing and writes nothing.
 */

import type { Context } from "@earendil-works/chord";
import type { Harness, JsonObject, TaskId, TaskRecord } from "@earendil-works/pi-durable";
import type { LoopOutcome } from "../openspec/index.js";
import { ApprovalsFileError, EscalationAnswerError } from "./errors.js";
import { readApprovals } from "./spec-approvals.js";
import { readSpecOutcome } from "./spec-api.js";
import { SPEC_LOOP, SpecLoopTask, changeDirOf, type SpecLoopInput, type SpecLoopResult, type StageOutcome } from "./spec-loop.js";

/** Any JSON value; pi-durable exports `JsonObject` but not its value type. */
type JsonValue = JsonObject[string];

export interface SpecLoopAnswer {
	readonly by: "principal" | "agent";
	/** Who answered; required to answer a review. */
	readonly principal?: string;
	/** `approve` to approve a review; anything else is carried into the next draft. */
	readonly decision: string;
}

/**
 * Answer a blocked spec loop: approve its stage, or carry the decision into a new draft.
 * Rejects with `EscalationAnswerError`, starting nothing, for a loop that is not a blocked
 * spec loop, a review answered by anyone but a named principal, or a malformed `approvals.json`.
 * Returns the new run's ID, for `waitForSpecLoop`.
 */
export async function answerSpecLoop(
	harness: Harness,
	id: TaskId<LoopOutcome<StageOutcome>>,
	answer: SpecLoopAnswer,
	context: Context,
): Promise<TaskId<LoopOutcome<StageOutcome>>> {
	const record = await harness.getTask(id as unknown as TaskId<SpecLoopResult>, context);
	const next = specAnswerInput(record, id, answer);
	const owner = await harness.root(context);
	const created = await owner.commit((tx) => tx.createTask(SpecLoopTask, next, { ownership: { kind: "conversation" } }), context);
	return created as unknown as TaskId<LoopOutcome<StageOutcome>>;
}

/**
 * The input of the run that answers spec loop `id`, read from its `record`, or the refusal
 * (`EscalationAnswerError`). Creates nothing, so a refusal leaves everything as it was;
 * `answerSpecLoop` and the draft loop's `answer` phase both start the run it returns.
 */
export function specAnswerInput(
	record: TaskRecord<JsonValue, JsonValue, SpecLoopResult> | undefined,
	id: unknown,
	answer: SpecLoopAnswer,
): SpecLoopInput {
	if (record === undefined || record.kind !== SPEC_LOOP) throw new EscalationAnswerError(`there is no spec loop ${String(id)}`);
	if (record.state.status !== "terminal" || record.state.outcome.status !== "completed") {
		throw new EscalationAnswerError(`spec loop ${id} has not ended blocked, so it has no escalation to answer`);
	}
	const outcome = readSpecOutcome(record.state.outcome.result, id);
	if (outcome.status !== "blocked") {
		throw new EscalationAnswerError(`spec loop ${id} ended ${outcome.status}, not blocked, so it has no escalation to answer`);
	}
	const input = record.input as unknown as SpecLoopInput;
	const stage = `the ${input.stage.name} stage of ${input.change}`;
	const { answers: _answers, carried: _carried, earlier: _earlier, approve: _approve, principal: _principal, notes: _notes, ...base } = input;

	if (outcome.escalation.reason === "review") {
		const principal = answer.principal?.trim() ?? "";
		if (answer.by !== "principal" || principal === "") {
			throw new EscalationAnswerError(`only the principal answers the review of ${stage}, and the answer must name them as principal`);
		}
		try {
			readApprovals(changeDirOf(input));
		} catch (error) {
			if (!(error instanceof ApprovalsFileError)) throw error;
			throw new EscalationAnswerError(`the review of ${stage} cannot be answered: ${error.message}`);
		}
		return answer.decision.trim().toLowerCase() === "approve"
			? { ...base, approve: true, principal, notes: "", answers: id as unknown as number }
			: carry(base, outcome, answer.decision, id);
	}
	return carry(base, outcome, answer.decision, id);
}

function carry(base: SpecLoopInput, outcome: LoopOutcome<StageOutcome>, decision: string, id: unknown): SpecLoopInput {
	return { ...base, approve: false, carried: `The principal asked for: ${decision}`, earlier: outcome.iterations, answers: id as number };
}
