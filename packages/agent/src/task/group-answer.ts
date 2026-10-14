/**
 * Answering a blocked group loop. As for a task loop, the answer never reopens the
 * blocked loop: its outcome stays as it ended, and a new run of the group starts from a
 * checkpoint rebuilt out of that outcome (a terminal task keeps none).
 */

import type { Context } from "@earendil-works/chord";
import type { Harness, TaskId } from "@earendil-works/pi-durable";
import { AMENDMENT_APPLIED, EscalationAnswer, check, explain, type Escalation, type GroupOutcome, type LoopOutcome } from "../openspec/index.js";
import { concatDeltas } from "./deltas.js";
import { EscalationAnswerError, TaskLoopStartError } from "./errors.js";
import { GROUP_LOOP, GroupLoopTask, blockedBy, encodeCheckpoint, type GroupCheckpoint, type GroupEntry, type GroupLoopInput, type GroupLoopResult } from "./group.js";
import { readResult } from "./group-api.js";
import { readChange } from "./sources.js";

/**
 * The change's deltas as they are on disk now, read as the start read them, so the judge's
 * `deltas` and its `amend_path` choices show the applied amendment.
 */
function rereadDeltas(changeDir: string): string {
	try {
		return concatDeltas(readChange({ dir: changeDir }).deltas);
	} catch (error) {
		if (error instanceof TaskLoopStartError) throw new EscalationAnswerError(`cannot re-read the deltas: ${error.message.replace(/; the loop was not started$/, "")}`);
		throw error;
	}
}

const sameEscalation =(a: Escalation | undefined, b: Escalation) =>
	a !== undefined && a.level === b.level && a.to === b.to && a.reason === b.reason && a.question === b.question;

/**
 * The checkpoint the answering run starts from.
 *
 * A task block reruns that task first, with the decision as its `carried`, then the tasks the
 * group had not reached. A judge block reruns the check, holding the decision for the judge.
 * Both keep the entries (so the blocked task's `runs` goes on from where it was), the
 * iterations, and the reworks used: those are the iterations whose feedback was `rework-task`.
 */
export function resumeCheckpoint(
	input: Pick<GroupLoopInput, "tasks">,
	outcome: LoopOutcome<GroupOutcome>,
	decision: string,
): GroupCheckpoint {
	const entries = (outcome.result?.tasks ?? []).map((t) => ({ task: t.task, outcome: t.outcome, runs: t.runs })) as GroupEntry[];
	const iterations = [...outcome.iterations];
	const reworks = iterations.filter((i) => i.feedback.some((f) => f.action === "rework-task")).length;
	const blocking = blockedBy(outcome as unknown as GroupLoopResult["outcome"]);
	if (blocking === null) return { phase: "check", queue: [], entries, reworks, iterations, decision };
	const unreached = input.tasks.map((t) => t.id).filter((id) => id !== blocking && !entries.some((e) => e.task === id));
	return { phase: "next", queue: [blocking, ...unreached], entries, reworks, iterations, carried: decision };
}

/**
 * Answer a blocked group loop's escalation. Accepted only for a loop that ended `blocked`,
 * from the escalation's recipient; otherwise rejects with `EscalationAnswerError` and
 * changes nothing. Returns the new run's ID.
 *
 * `amendment-applied` to a judge block with an amendment first re-reads the change's deltas,
 * so the rerun judge sees the amended text; to a judge block without one, it is a plain decision.
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
	if (!sameEscalation(answer.escalation, escalation)) {
		throw new EscalationAnswerError(`the answer is to another escalation than the one group loop ${id} ended with`);
	}
	// A judge block without an amendment takes `amendment-applied` as a plain decision.
	const judgeBlock = blockedBy(outcome as unknown as GroupLoopResult["outcome"]) === null;
	const plain = judgeBlock && escalation.amendment === undefined && answer.decision === AMENDMENT_APPLIED;
	const checked = plain ? { ...answer, decision: "" } : answer;
	if (!check(EscalationAnswer, checked)) {
		throw new EscalationAnswerError(`the answer is not an EscalationAnswer: ${explain(EscalationAnswer, checked).join("; ")}`);
	}
	const input = record.input as unknown as GroupLoopInput;
	const applied = judgeBlock && escalation.amendment !== undefined && answer.decision === AMENDMENT_APPLIED;
	const resumed: GroupLoopInput = {
		...input,
		...(applied && input.changeDir !== undefined ? { deltas: rereadDeltas(input.changeDir) } : {}),
		resume: { checkpoint: encodeCheckpoint(resumeCheckpoint(input, outcome, answer.decision)), answers: id as unknown as number },
	};
	const owner = await harness.root(context);
	const created = await owner.commit((tx) => tx.createTask(GroupLoopTask, resumed, { ownership: { kind: "conversation" } }), context);
	return created as unknown as TaskId<LoopOutcome<GroupOutcome>>;
}
