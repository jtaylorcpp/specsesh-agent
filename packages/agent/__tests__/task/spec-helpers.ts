/**
 * Spec-loop fixtures: a stage script keeping the contract, a stage defined
 * here, a faux-model harness with the loop installed over that stage, and a
 * direct start of the bare task (no `startSpecLoop`).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage, defineExtension, type Harness, type Storage, type TaskId } from "@earendil-works/pi-durable";
import Type from "typebox";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { LoopOutcome } from "../../src/openspec/index.js";
import { closed } from "../../src/openspec/schema.js";
import { SPEC_LOOP, specLoopTask, type SpecLoopInput, type SpecLoopResult } from "../../src/task/spec-loop.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { openHarness, setup } from "../durable/helpers.js";
import { context, temp } from "./helpers.js";

/** A spec loop's whole outcome, its result included; the loop itself checks it without the result. */
export const SpecLoopOutcome = LoopOutcome(
	closed({ change: Type.String({ minLength: 1 }), stage: Type.String({ minLength: 1 }), files: Type.Array(Type.String()), approved: Type.Boolean() }),
);

/** The stage contract and one step reading every seeded variable. */
export const STAGE_SCRIPT = `config:
    agent_name: "stage"

variables:
    change_id: mutable string = ""
    stage: mutable string = ""
    intent: mutable string = ""
    approved: mutable string = ""
    current: mutable string = ""
    base: mutable string = ""
    carried: mutable string = ""
    iteration: mutable number = 1
    files: mutable string = ""
    summary: mutable string = ""
    next_action: mutable string = "review"
    question: mutable string = ""

subagent draft:
    description: "Draft the stage"

    reasoning:
        instructions: ->
            | Stage {!@variables.stage} of {!@variables.change_id}, iteration {!@variables.iteration}: {!@variables.intent}
            | Current: {!@variables.current}
            | Base: {!@variables.base}
            | Carried: {!@variables.carried}
            set @variables.files = @outputs.files
            set @variables.summary = @outputs.summary
            set @variables.next_action = @outputs.next_action
            set @variables.question = @outputs.question
`;

/** The stage script's answer: a bundle, and what it reads back beside it. */
export const draft = (files: string, nextAction = "review", question = "", summary = "drafted") =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { files, summary, next_action: nextAction, question })], { stopReason: "toolUse" });

export function proposalStage(gate: SpecStage["gate"] = () => []): SpecStage {
	return { name: "proposal", owns: ["proposal.md"], script: { text: STAGE_SCRIPT }, gate };
}

/** A workspace holding an empty `openspec/changes/<change>/`. */
export function specWorkspace(change = "add-thing"): { workspace: string; changeDir: string } {
	const workspace = temp("spec-ws-");
	const changeDir = join(workspace, "openspec", "changes", change);
	mkdirSync(changeDir, { recursive: true });
	return { workspace, changeDir };
}

/** A faux-model harness running the spec loop over `stages`. */
export async function specHarness(stages: readonly SpecStage[], storage: Storage = new MemoryStorage()) {
	const env = setup();
	const task = specLoopTask((name) => stages.find((stage) => stage.name === name));
	env.registry.install(defineExtension({ name: SPEC_LOOP, tasks: [task] }));
	const harness = await openHarness(storage, env);
	return { env, harness, task, storage };
}

/** Creates the bare loop task, owned by the root conversation. */
export async function startBare(
	harness: Harness,
	task: ReturnType<typeof specLoopTask>,
	input: Partial<SpecLoopInput> & Pick<SpecLoopInput, "workspace" | "stage">,
): Promise<TaskId<SpecLoopResult>> {
	const owner = await harness.root(context);
	const full: SpecLoopInput = {
		change: "add-thing",
		script: STAGE_SCRIPT,
		intent: "Make the thing",
		approved: [],
		budget: { maxIterations: 8 },
		escalateTo: "principal",
		changesDir: join(input.workspace, "openspec", "changes"),
		...input,
	};
	return owner.commit((tx) => tx.createTask(task, full, { ownership: { kind: "conversation" } }), context);
}

export async function waitForOutcome(harness: Harness, id: TaskId<SpecLoopResult>) {
	const settled = await harness.waitForTask(id, context);
	if (settled.state.status !== "terminal" || settled.state.outcome.status !== "completed") {
		throw new Error(`spec loop ${id} did not complete: ${JSON.stringify(settled.state)}`);
	}
	return settled.state.outcome.result.outcome;
}

/** Start, run to the end and close: the outcome, and every model request's prompt. */
export async function runSpecLoop(
	stage: SpecStage,
	responses: Parameters<ReturnType<typeof setup>["faux"]["setResponses"]>[0],
	input: Partial<SpecLoopInput> = {},
) {
	const { workspace, changeDir } = specWorkspace();
	const { env, harness, task, storage } = await specHarness([stage]);
	env.faux.setResponses(responses);
	const id = await startBare(harness, task, { workspace, stage: { name: stage.name, owns: stage.owns }, model: env.model, ...input });
	harness.resume();
	try {
		const outcome = await waitForOutcome(harness, id);
		const runs = (await storage.scanTasks({ kind: "agentscript.run" }, 100, undefined, context)).items;
		return { outcome, env, changeDir, workspace, runs };
	} finally {
		await harness.close(context);
	}
}
