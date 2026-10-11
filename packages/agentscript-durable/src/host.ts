/**
 * Starting and waiting for runs from a host that holds a pi-durable Harness.
 *
 * The run task belongs to a conversation (the root one by default). Its step
 * conversations start as copies of that conversation's agent, so the model the
 * host configured there is the model every step uses unless `model` is given.
 */

import type { RunResult, StartOptions } from "@coopcli/agentscript/interpreter";
import type { Context } from "@earendil-works/chord";
import type { Conversation, Harness, ModelRef, TaskId } from "@earendil-works/pi-durable";
import { AgentScriptRun } from "./extension.js";

export interface StartScriptOptions extends StartOptions {
	/** The conversation that owns the run. Defaults to the root conversation. */
	readonly conversation?: Conversation;
	/** The model every step runs on. Defaults to the owning conversation's model. */
	readonly model?: ModelRef;
}

/** Durably create the run task and return its ID. The run starts as soon as the scheduler does. */
export async function startScript(
	harness: Harness,
	source: string,
	options: StartScriptOptions,
	context: Context,
): Promise<TaskId<RunResult>> {
	const { conversation, model, ...start } = options;
	const owner = conversation ?? (await harness.root(context));
	return owner.commit(
		(tx) =>
			tx.createTask(
				AgentScriptRun,
				{ source, options: start, ...(model !== undefined ? { model } : {}) },
				{ ownership: { kind: "conversation" } },
			),
		context,
	);
}

/** The settled run. A run that failed at a step still completes the task; its `kind` says how it ended. */
export async function waitForScript(harness: Harness, id: TaskId<RunResult>, context: Context): Promise<RunResult> {
	const settled = await harness.waitForTask(id, context);
	if (settled.state.status !== "terminal") {
		// pi-durable hands back the current record for an ID it is not tracking, e.g. a
		// task ID passed as a string. Say so instead of failing on a missing outcome.
		throw new Error(
			`agentscript run ${String(id)} is ${settled.state.status}, not finished. Task IDs are numbers; check the ID passed in.`,
		);
	}
	const outcome = settled.state.outcome;
	if (outcome.status === "completed") return outcome.result;
	throw new Error(
		`agentscript run ${id} ended ${outcome.status}: ${"error" in outcome && outcome.error ? outcome.error.message : (outcome.reason ?? "")}`,
	);
}

export async function runScript(
	harness: Harness,
	source: string,
	options: StartScriptOptions,
	context: Context,
): Promise<RunResult> {
	return waitForScript(harness, await startScript(harness, source, options, context), context);
}
