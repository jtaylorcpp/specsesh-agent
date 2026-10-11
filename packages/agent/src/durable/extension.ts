/**
 * Agent Script as a pi-durable extension.
 *
 * Install `AgentScript` into a pi-durable registry (on Node, or inside Cloudflare's
 * PiHarness) and a script runs as one durable task, `agentscript.run`. The task
 * drives the core's step machine and saves the machine's state as its checkpoint
 * after every phase, so an evicted or crashed process picks the run up at the
 * step it was on.
 *
 *   next      pure: ask the step machine for the next request, or finish
 *   dispatch  create a fresh child conversation for the step, in one commit
 *   await     submit the step's prompt to it (idempotent by request ID), wait,
 *             and fold the answer back into the machine
 *
 * Each step runs in its own conversation that the task owns, so a step sees only
 * the script's system instructions, its own prompt, and the result tool. Nothing
 * from an earlier step leaks in except through variables.
 *
 * Logic lines run inside `next`, as plain code. The model never sees them and
 * gets no say in them.
 */

import {
	apply,
	next,
	start,
	type ReasoningRequest,
	type RunResult,
	type RunState,
	type StartOptions,
	type StepOutcome,
} from "../interpreter/index.js";
import type { Context, JsonValue } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import {
	configure,
	defineDoc,
	defineExtension,
	defineTask,
	defineTool,
	section,
	type ConversationId,
	type EntryId,
	type Extension,
	type JsonObject,
	type ModelRef,
	type TaskId,
	type TaskRuntime,
} from "@earendil-works/pi-durable";
import { checkResult } from "./result.js";

/** The tool a structured step offers. Its arguments are the step's result. */
export const RESULT_TOOL = "submit_result";

/** Per-step state, on the step's own conversation. */
export interface StepDoc extends JsonObject {
	/** JSON Schema of the result this step must submit; null for a text-only step. */
	schema: JsonObject | null;
	/** The accepted result, written by the tool once it passes the schema. */
	result: JsonObject | null;
}

export const AgentScriptStep = defineDoc<StepDoc>({
	kind: "agentscript.step",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ schema: null, result: null }),
});

export interface RunInput {
	readonly source: string;
	readonly options?: StartOptions;
	/** The model every step runs on; absent, steps use the owning conversation's model. */
	readonly model?: ModelRef;
}

export type RunCheckpoint =
	| { readonly phase: "next"; readonly state: RunState }
	| { readonly phase: "dispatch"; readonly state: RunState; readonly step: number }
	| {
			readonly phase: "await";
			readonly state: RunState;
			readonly step: number;
			readonly conversationId: ConversationId;
	  };

type Runtime = TaskRuntime<RunInput, RunCheckpoint, RunResult, object>;

const submitResult = defineTool({
	name: RESULT_TOOL,
	description:
		"Submit this step's result as an object with exactly the fields the system prompt lists. " +
		"Call it once; it ends the step.",
	parameters: Type.Object({}, { additionalProperties: true }),
	replay: "safe",
	execute: async (args, api, context) => {
		const doc = await api.snapshot(AgentScriptStep, api.conversationId, context);
		const problem = checkResult(doc?.schema ?? null, args);
		if (problem !== undefined) {
			// The model gets this as an error result and can call again.
			return { content: [{ type: "text", text: problem }], isError: true };
		}
		await api.commit(async (tx) => {
			(await tx.doc(AgentScriptStep, api.conversationId)).result = args as JsonObject;
		}, context);
		return { content: [{ type: "text", text: "Result recorded." }], control: { terminate: true } };
	},
});

/** Shows the model the step's result schema. Absent for a text-only step. */
const resultSection = section("result", async (input, context) => {
	const doc = await input.read.snapshot(AgentScriptStep, input.conversationId, context);
	if (doc?.schema === null || doc?.schema === undefined) return undefined;
	return (
		`Finish by calling ${RESULT_TOOL} with an object matching this JSON Schema:\n` +
		JSON.stringify(doc.schema, null, 2)
	);
});

/** Selected on every step conversation: the result tool and its section, nothing else. */
export const AgentScriptStepExtension: Extension = defineExtension({
	name: "agentscript.step",
	sections: [resultSection],
	tools: [submitResult],
});

export const AgentScriptRun = defineTask<RunInput, RunCheckpoint, RunResult>({
	name: "agentscript.run",
	version: 1,
	initial: (input) => ({ phase: "next", state: start(input.source, input.options) }),
	phases: {
		next: async (task, runtime, context) => {
			const step = next(task.input.source, task.state.checkpoint.state);
			await runtime.commit(
				() =>
					step.type === "done"
						? { status: "terminal", outcome: { status: "completed", result: step.result } }
						: {
								status: "running",
								checkpoint: { phase: "dispatch", state: step.state, step: step.state.steps.length },
							},
				context,
			);
		},
		dispatch: async (task, runtime, context) => {
			const { state, step } = task.state.checkpoint;
			const request = state.awaiting?.request;
			if (request === undefined) throw new Error("dispatch reached with no step awaiting");
			await runtime.commit(async (tx) => {
				const child = await tx.createConversation({ ownership: { kind: "task", taskId: runtime.taskId } });
				await configureStep(tx, child.id, request, task.input.model);
				return { status: "running", checkpoint: { phase: "await", state, step, conversationId: child.id } };
			}, context);
		},
		await: async (task, runtime, context) => {
			const { state, step, conversationId } = task.state.checkpoint;
			const request = state.awaiting?.request;
			if (request === undefined) throw new Error("await reached with no step awaiting");
			const outcome = await answerStep(runtime, conversationId, request, step, context);
			const after = apply(task.input.source, state, outcome);
			await runtime.commit(() => ({ status: "running", checkpoint: { phase: "next", state: after } }), context);
		},
	},
	abort: async (_task, runtime, context) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), context);
	},
});

/** The extension a host installs. */
export const AgentScript: Extension = defineExtension({
	name: "agentscript",
	tasks: [AgentScriptRun],
});

async function configureStep(
	tx: Parameters<Parameters<Runtime["commit"]>[0]>[0],
	conversationId: ConversationId,
	request: ReasoningRequest,
	model: ModelRef | undefined,
): Promise<void> {
	await configure(tx, conversationId, {
		...(model !== undefined ? { model } : {}),
		extensions: [AgentScriptStepExtension],
		tools: request.outputSchema !== undefined ? [submitResult] : [],
		instructions: request.systemInstructions,
	});
	const doc = await tx.doc(AgentScriptStep, conversationId);
	doc.schema = (request.outputSchema as JsonObject | undefined) ?? null;
}

/**
 * Submit the step's prompt and turn the settled submission into a StepOutcome.
 * The request ID makes this safe to repeat after a crash: the same submission
 * comes back instead of a second one.
 */
async function answerStep(
	runtime: Runtime,
	conversationId: ConversationId,
	request: ReasoningRequest,
	step: number,
	context: Context,
): Promise<StepOutcome> {
	const conversation = await runtime.conversation(conversationId, context);
	if (conversation === undefined) {
		return { kind: "failed", category: "unknown", message: `step conversation ${conversationId} is missing` };
	}
	const submission = await conversation.submit(
		{ type: "input", content: request.prompt, requestId: `agentscript:${runtime.taskId}:${step}` },
		context,
	);
	const settled = await submission.wait(context);
	if (settled.status !== "done" || settled.answer === undefined) {
		return {
			kind: "failed",
			category: "unknown",
			message: `the step was not answered: ${settled.reason ?? settled.status}${detailText(settled.detail)}`,
		};
	}

	const doc = await runtime.snapshot(AgentScriptStep, conversationId, context);
	const text = await answerText(runtime, conversationId, settled.answer, context);
	if (request.outputSchema !== undefined && doc?.result !== null && doc?.result !== undefined) {
		return { kind: "answered", text, structured: doc.result };
	}
	return { kind: "answered", text };
}

/**
 * The answer's text, read from the step conversation's transcript: the text
 * blocks of the assistant messages in the answer entry. Tool calls are skipped;
 * a structured step's result comes from the step doc, never from this text.
 */
async function answerText(
	runtime: Runtime,
	conversationId: ConversationId,
	answer: EntryId,
	context: Context,
): Promise<string> {
	const view = await runtime.context(conversationId, context);
	const entry = view.entries.find((e) => e.id === answer);
	const messages = entry?.model ?? [];
	return messages
		.filter((m) => m.role === "assistant")
		.flatMap((m) => (m.role === "assistant" ? m.content : []))
		.filter((block) => block.type === "text")
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
}

function detailText(detail: JsonValue | undefined): string {
	return detail === undefined ? "" : ` (${JSON.stringify(detail)})`;
}

export type { TaskId };
