/**
 * Retrying a loop that ended `failed` or `exhausted` (#47): a step that hit Claude Code's turn or
 * time limit, a provider error, a budget run out. As with an answer, the loop isn't reopened: its
 * outcome stays as it ended, and a new run of the same loop starts. It is seeded with why the last
 * run ended, numbers on from its iterations with a fresh budget, and keeps its baseline, so
 * `changed` still covers every run. It runs on this process's provider limits, so a retry can
 * take a higher `--max-turns` or `--turn-timeout`. A blocked loop is answered, not retried.
 */

import type { Context } from "@earendil-works/chord";
import type { Harness, TaskId } from "@earendil-works/pi-durable";
import type { GroupOutcome, LoopOutcome, TaskOutcome } from "../openspec/index.js";
import { readResult as readTaskResult } from "./answer.js";
import { LoopRetryError } from "./errors.js";
import { readResult as readGroupResult } from "./group-api.js";
import { GROUP_LOOP, GroupLoopTask, encodeCheckpoint, type GroupCheckpoint, type GroupEntry, type GroupLoopInput, type GroupLoopResult } from "./group.js";
import type { TaskLoopInput, TaskLoopResult } from "./loop-input.js";
import { TASK_LOOP } from "./loop.js";
import { createLoop } from "./start.js";

/** The statuses a retry starts again from. */
const RETRYABLE: readonly string[] = ["failed", "exhausted"];

/** What a retried run is seeded with: how the last run ended, and that its work is still there. */
export function retryCarried(status: string, notes: readonly string[]): string {
	const why = notes.length > 0 ? `: ${notes.join("; ")}` : "";
	return `The last run of this loop ended ${status}${why}. Its changes are still in the workspace: carry on from them.`;
}

/** The terminal record of loop `id` of `kind`, refused unless it ended with an outcome. */
async function endedRecord(harness: Harness, id: unknown, kind: string, label: string, context: Context) {
	const record = await harness.getTask(id as TaskId<unknown>, context);
	if (record === undefined || record.kind !== kind) throw new LoopRetryError(`there is no ${label} ${String(id)}`);
	if (record.state.status !== "terminal") {
		throw new LoopRetryError(`${label} ${String(id)} has not ended (it is ${record.state.status}); resume it instead`);
	}
	if (record.state.outcome.status !== "completed") {
		throw new LoopRetryError(`${label} ${String(id)} ended ${record.state.outcome.status}, with no outcome to retry from`);
	}
	return { input: record.input, result: record.state.outcome.result };
}

function refuseUnlessRetryable(label: string, id: unknown, status: string): void {
	if (RETRYABLE.includes(status)) return;
	const instead = status === "blocked" ? "; answer it instead" : "";
	throw new LoopRetryError(`${label} ${String(id)} ended ${status}, not failed or exhausted, so there is nothing to retry${instead}`);
}

/**
 * Retry a task loop that ended `failed` or `exhausted`. Rejects with `LoopRetryError`, changing
 * nothing, for any other loop. Returns the new run's ID.
 */
export async function retryTaskLoop(
	harness: Harness,
	id: TaskId<LoopOutcome<TaskOutcome>>,
	context: Context,
): Promise<TaskId<LoopOutcome<TaskOutcome>>> {
	const ended = await endedRecord(harness, id, TASK_LOOP, "task loop", context);
	const { outcome, notes, since } = readTaskResult(ended.result as TaskLoopResult, id);
	refuseUnlessRetryable("task loop", id, outcome.status);
	// A retry is not an answer: it carries no escalation of its own.
	const { answers: _answers, escalation: _escalation, retries: _retries, ...input } = ended.input as unknown as TaskLoopInput;
	return createLoop(
		harness,
		{
			...input,
			carried: retryCarried(outcome.status, notes),
			earlier: outcome.iterations,
			retries: id as unknown as number,
			...(since !== undefined ? { since } : {}),
		},
		context,
	);
}

/**
 * The checkpoint a retried group run starts from. The task that didn't converge runs again
 * first, seeded with `carried`, then the tasks the group hadn't reached; with none (the judge or
 * the group check ended it), the group check runs again. Entries and iterations are kept, so the
 * task's `runs` goes on; the reworks start again from 0, a fresh budget as a task loop's retry has.
 */
export function retryCheckpoint(
	input: Pick<GroupLoopInput, "tasks">,
	outcome: LoopOutcome<GroupOutcome>,
	carried: string,
): GroupCheckpoint {
	const tasks = (outcome.result as unknown as GroupOutcome | undefined)?.tasks ?? [];
	const entries = tasks.map((t) => ({ task: t.task, outcome: t.outcome, runs: t.runs })) as GroupEntry[];
	const iterations = [...outcome.iterations];
	const unconverged = tasks.find((t) => t.outcome.status !== "converged")?.task;
	if (unconverged === undefined) return { phase: "check", queue: [], entries, reworks: 0, iterations, decision: carried };
	const unreached = input.tasks.map((t) => t.id).filter((task) => task !== unconverged && !entries.some((e) => e.task === task));
	return { phase: "next", queue: [unconverged, ...unreached], entries, reworks: 0, iterations, carried };
}

/**
 * Retry a group loop that ended `failed` or `exhausted`. Rejects with `LoopRetryError`, changing
 * nothing, for any other loop. Returns the new run's ID.
 */
export async function retryGroupLoop(
	harness: Harness,
	id: TaskId<LoopOutcome<GroupOutcome>>,
	context: Context,
): Promise<TaskId<LoopOutcome<GroupOutcome>>> {
	const ended = await endedRecord(harness, id, GROUP_LOOP, "group loop", context);
	const { outcome, notes } = readGroupResult(ended.result as GroupLoopResult, id);
	refuseUnlessRetryable("group loop", id, outcome.status);
	const input = ended.input as unknown as GroupLoopInput;
	const retried: GroupLoopInput = {
		...input,
		resume: { checkpoint: encodeCheckpoint(retryCheckpoint(input, outcome, retryCarried(outcome.status, notes))), retries: id as unknown as number },
	};
	const owner = await harness.root(context);
	const created = await owner.commit((tx) => tx.createTask(GroupLoopTask, retried, { ownership: { kind: "conversation" } }), context);
	return created as unknown as TaskId<LoopOutcome<GroupOutcome>>;
}
