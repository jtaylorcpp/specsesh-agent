/**
 * The change loop's entry points for a host: start, wait, answer, and the extensions to
 * install. Thin: the loop itself is `ChangeLoopTask` in `change-loop.ts`, and the guard
 * `buildRefusal` in `change-guard.ts`.
 */

import { basename, resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Extension, Harness, JsonObject, TaskId } from "@earendil-works/pi-durable";
import { start } from "../interpreter/index.js";
import { checkBindings } from "../durable/index.js";
import { localWorkspace } from "../node/index.js";
import { ChangeOutcome, EscalationAnswer, LoopOutcome, check, explain, type Escalation, type GroupOutcome } from "../openspec/index.js";
import { CHANGE_LOOP_TASK, type ChangeLoopOptions } from "./change-input.js";
import { buildRefusal } from "./change-guard.js";
import {
	ChangeLoop,
	ChangeLoopTask,
	boundChangeLoop,
	encodeChangeCheckpoint,
	readChangeInput,
	resumeChangeCheckpoint,
	type ChangeLoopInput,
	type ChangeLoopResult,
} from "./change-loop.js";
import { CHECK_TIMEOUT_MS, SPAWN_FAILED_EXIT_CODE, type CheckRun } from "./checks.js";
import { checkContract } from "./contract.js";
import { EscalationAnswerError, TaskLoopStartError } from "./errors.js";
import { answerGroupEscalation } from "./group-answer.js";
import { groupLoopExtensions, readResult } from "./group-api.js";
import { checkGroupContract } from "./group-judge.js";
import { boundWorkspace, subagentsOf, taskLoopRegistry, type TaskLoopActionOptions } from "./loop.js";
import type { StageContext } from "./spec-stage.js";

export type { ChangeLoopOptions };
export { ChangeLoop };

const ChangeLoopOutcome = LoopOutcome(ChangeOutcome);

/** `ChangeLoop` (its check bound to a given `Workspace`) plus the four extensions `groupLoopExtensions` returns for the same options. */
export function changeLoopExtensions(options: TaskLoopActionOptions): readonly [Extension, Extension, Extension, Extension, Extension] {
	const bound = boundWorkspace(options);
	return [bound === undefined ? ChangeLoop : boundChangeLoop(bound), ...groupLoopExtensions(options)];
}

/** The guard's `run`: argv, no shell, in the directory the loop works in. `close` runs `openspec` through it too. */
export function guardRun(dir: string): StageContext["run"] {
	const workspace = localWorkspace(dir);
	return async (argv): Promise<CheckRun> => {
		const command = argv.join(" ");
		if (workspace.exec === undefined) return { command, exitCode: SPAWN_FAILED_EXIT_CODE, output: "this workspace cannot run commands" };
		const ran = await workspace.exec(argv, { timeoutMs: CHECK_TIMEOUT_MS });
		if (ran.kind === "exited") return { command, exitCode: ran.code, output: ran.stdout + ran.stderr };
		if (ran.kind === "timed-out") return { command, exitCode: -1, output: `${ran.stdout}${ran.stderr}\n(timed out after ${CHECK_TIMEOUT_MS}ms)` };
		return { command, exitCode: SPAWN_FAILED_EXIT_CODE, output: `(could not start: ${ran.message})` };
	};
}

/**
 * The loop's durable input, or the refusal: the guard (strict validation, then the approvals,
 * then the unclaimed scenarios), the sources, then both scripts, as `startGroupLoop` checks them.
 * Runs only `openspec`, and creates nothing.
 */
export async function prepareChangeLoop(options: ChangeLoopOptions): Promise<ChangeLoopInput> {
	if (!("dir" in options.change)) {
		throw new TaskLoopStartError("a change loop needs the change's directory: openspec validates it by id");
	}
	const changeDir = resolve(options.change.dir);
	const guard = await buildRefusal(basename(changeDir), changeDir, guardRun(options.worktree?.path ?? options.workspace));
	if (!guard.ok) throw new TaskLoopStartError(`${guard.refusal}; the loop was not started`);

	const input = readChangeInput(options, guard.unclaimedAtStart);
	checkGroupContract(input.groupScript);
	start(input.groupScript, { entry: subagentsOf(input.groupScript) });
	// The grandchildren are task loops, so the task script keeps the task-script contract.
	checkContract(input.script, input.deltas);
	start(input.script, { entry: subagentsOf(input.script) });
	checkBindings(
		input.script,
		taskLoopRegistry({
			workspace: input.workspace,
			checks: [...input.checks],
			allow: [...input.allow],
			...(input.delegates !== undefined ? { delegates: input.delegates } : {}),
		}),
	);
	return input;
}

/** Durably create the change loop and return its ID. Every refusal comes first and creates nothing. */
export async function startChangeLoop(
	harness: Harness,
	options: ChangeLoopOptions,
	context: Context,
): Promise<TaskId<LoopOutcome<ChangeOutcome>>> {
	const input = await prepareChangeLoop(options);
	const owner = await harness.root(context);
	const id = await owner.commit((tx) => tx.createTask(ChangeLoopTask, input, { ownership: { kind: "conversation" } }), context);
	return id as unknown as TaskId<LoopOutcome<ChangeOutcome>>;
}

export function readChangeResult(value: unknown, id: unknown): ChangeLoopResult {
	const result = (value ?? {}) as Partial<ChangeLoopResult>;
	if (!check(ChangeLoopOutcome, result.outcome)) {
		throw new Error(`change loop ${String(id)} holds an outcome the ontology refuses: ${explain(ChangeLoopOutcome, result.outcome).join("; ")}`);
	}
	return {
		outcome: result.outcome as ChangeLoopResult["outcome"],
		notes: Array.isArray(result.notes) ? result.notes.map(String) : [],
		blocked: result.blocked ?? null,
	};
}

/** The settled change loop's `LoopOutcome<ChangeOutcome>`, checked against the ontology. */
export async function waitForChangeLoop(
	harness: Harness,
	id: TaskId<LoopOutcome<ChangeOutcome>>,
	context: Context,
): Promise<LoopOutcome<ChangeOutcome>> {
	const settled = await harness.waitForTask(id as unknown as TaskId<ChangeLoopResult>, context);
	if (settled.state.status !== "terminal") {
		throw new Error(`change loop ${String(id)} is ${settled.state.status}, not finished. Loop IDs are numbers; check the ID passed in.`);
	}
	const outcome = settled.state.outcome;
	if (outcome.status !== "completed") {
		const why = outcome.status === "failed" ? outcome.error.message : (outcome.reason ?? "");
		throw new Error(`change loop ${id} ended ${outcome.status}: ${why}`);
	}
	return readChangeResult(outcome.result, id).outcome;
}

const sameEscalation = (a: Escalation | undefined, b: Escalation) =>
	a !== undefined && a.level === b.level && a.to === b.to && a.reason === b.reason && a.question === b.question;

/**
 * Answer a blocked change loop's escalation. Accepted only for a loop that ended `blocked`,
 * from the escalation's recipient; otherwise rejects with `EscalationAnswerError` and
 * changes nothing. The blocked group's loop is answered with `answerGroupEscalation`, and a
 * new change run, carrying the entries, awaits that group's new run and goes on with the queue.
 * Returns the new change run's ID.
 */
export async function answerChangeEscalation(
	harness: Harness,
	id: TaskId<LoopOutcome<ChangeOutcome>>,
	answer: EscalationAnswer,
	context: Context,
): Promise<TaskId<LoopOutcome<ChangeOutcome>>> {
	const record = await harness.getTask(id as unknown as TaskId<ChangeLoopResult>, context);
	if (record === undefined || record.kind !== CHANGE_LOOP_TASK) throw new EscalationAnswerError(`there is no change loop ${String(id)}`);
	if (record.state.status !== "terminal" || record.state.outcome.status !== "completed") {
		throw new EscalationAnswerError(`change loop ${id} has not ended blocked, so it has no escalation to answer`);
	}
	const result = readChangeResult(record.state.outcome.result, id);
	const { outcome } = result;
	if (outcome.status !== "blocked") {
		throw new EscalationAnswerError(`change loop ${id} ended ${outcome.status}, not blocked, so it has no escalation to answer`);
	}
	const escalation: Escalation = outcome.escalation;
	if (answer.by !== escalation.to) {
		throw new EscalationAnswerError(`the escalation of change loop ${id} goes to the ${escalation.to}, not the ${answer.by}`);
	}
	if (!sameEscalation(answer.escalation, escalation)) {
		throw new EscalationAnswerError(`the answer is to another escalation than the one change loop ${id} ended with`);
	}
	if (!check(EscalationAnswer, answer)) {
		throw new EscalationAnswerError(`the answer is not an EscalationAnswer: ${explain(EscalationAnswer, answer).join("; ")}`);
	}
	if (result.blocked === null) throw new EscalationAnswerError(`change loop ${id} names no blocked group to answer`);

	// The group loop ended with its own escalation, at level "group" or below: answer that one.
	const groupLoop = result.blocked.loop as unknown as TaskId<LoopOutcome<GroupOutcome>>;
	const groupRecord = await harness.getTask(groupLoop as unknown as TaskId<JsonObject>, context);
	if (groupRecord?.state.status !== "terminal" || groupRecord.state.outcome.status !== "completed") {
		throw new EscalationAnswerError(`group loop ${String(groupLoop)} of change loop ${id} has not ended blocked`);
	}
	const blocked = readResult(groupRecord.state.outcome.result, groupLoop).outcome;
	if (blocked.status !== "blocked") {
		throw new EscalationAnswerError(`group loop ${String(groupLoop)} of change loop ${id} ended ${blocked.status}, not blocked`);
	}
	const groupRun = await answerGroupEscalation(harness, groupLoop, { ...answer, escalation: blocked.escalation }, context);

	const input = record.input as unknown as ChangeLoopInput;
	const resumed: ChangeLoopInput = {
		...input,
		resume: { checkpoint: encodeChangeCheckpoint(resumeChangeCheckpoint(input, result, groupRun as unknown as TaskId)), answers: id as unknown as number },
	};
	const owner = await harness.root(context);
	const created = await owner.commit((tx) => tx.createTask(ChangeLoopTask, resumed, { ownership: { kind: "conversation" } }), context);
	return created as unknown as TaskId<LoopOutcome<ChangeOutcome>>;
}
