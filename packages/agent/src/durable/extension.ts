/**
 * Agent Script as a pi-durable extension.
 *
 * Install `AgentScript` into a pi-durable registry (on Node, or inside Cloudflare's
 * PiHarness) and a script runs as one durable task, `agentscript.run`. The task
 * drives the core's step machine and saves the machine's state as its checkpoint
 * after every phase, so an evicted or crashed process picks the run up at the
 * step it was on.
 *
 *   next      pure: ask the step machine for the next request or action call, or finish
 *   dispatch  create a fresh child conversation for the step, in one commit
 *   await     submit the step's prompt to it (idempotent by request ID), wait,
 *             and fold the answer back into the machine
 *   act       record the call's intent, run the host action once, fold its result in
 *
 * Each step runs in its own conversation that the task owns, so a step sees only
 * the script's system instructions, its own prompt, the result tool and its own
 * offered action tools. Nothing from an earlier step leaks in except through
 * variables.
 *
 * Actions resolve in the host's `ActionRegistry`, installed with
 * `agentScriptExtensions({ actions, workspace })`. The plain `AgentScript` and
 * `AgentScriptStepExtension` exports carry an empty registry, so a script that
 * defines an action is refused when its run is created.
 *
 * Logic lines run inside `next`, as plain code. The model never sees them and
 * gets no say in them.
 */

import {
	apply,
	applyAction,
	next,
	start,
	type ActionResult,
	type AwaitingAction,
	type ReasoningRequest,
	type RunResult,
	type RunState,
	type StartOptions,
	type StepOutcome,
	type ToolCallRecord,
	type ToolOffer,
	type VariableValue,
} from "../interpreter/index.js";
import type { Context, JsonValue } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import {
	AssistantEntry,
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
	type Task,
	type TaskRuntime,
	type ToolRegistration,
	type Tx,
} from "@earendil-works/pi-durable";
import { type ActionRegistry, type HostAction, checkBindings } from "./actions.js";
import { checkResult } from "./result.js";

/** The tool a structured step offers. Its arguments are the step's result. */
export const RESULT_TOOL = "submit_result";

/** Per-step state, on the step's own conversation. */
export interface StepDoc extends JsonObject {
	/** JSON Schema of the result this step must submit; null for a text-only step. */
	schema: JsonObject | null;
	/** The accepted result, written by the tool once it passes the schema. */
	result: JsonObject | null;
	/** Refused `submit_result` calls; the third ends the step failed. */
	refusals: number;
}

export const AgentScriptStep = defineDoc<StepDoc>({
	kind: "agentscript.step",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ schema: null, result: null, refusals: 0 }),
});

/** A step's offered action tools and what each call ran, on the step's own conversation. */
export interface StepActionsDoc extends JsonObject {
	/** The offers as the request declared them; a call reads its bound inputs and action from here. */
	offers: JsonObject[];
	/** By call ID: the merged inputs, the host's outputs and its record. */
	calls: JsonObject;
}

export const AgentScriptStepActions = defineDoc<StepActionsDoc>({
	kind: "agentscript.step-actions",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ offers: [], calls: {} }),
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
	  }
	| { readonly phase: "act"; readonly state: RunState; readonly intent: null | { readonly replay: "safe" | "unsafe" } };

type Runtime = TaskRuntime<RunInput, RunCheckpoint, RunResult, object>;

/** Refused calls a step allows; the last one ends the step failed. */
const MAX_REFUSALS = 3;

const RESULT_DESCRIPTION =
	"Submit this step's result as an object with exactly the fields the system prompt lists. " +
	"Call it once; it ends the step.";

/**
 * A structured step's result tool. Its parameters are the step's schema, so a
 * provider that constrains output to them (`claude --json-schema`) enforces the
 * field types.
 *
 * pi validates a call against `parameters` before executing it, coercing what it
 * can (`"true"` becomes `true`) and refusing the rest without running the tool. The
 * tool has to see every call, to count refusals, and see it as the model sent it,
 * so pi is always handed a stand-in that passes and `execute` reads the call's
 * arguments from the transcript.
 */
function resultTool(schema: JsonObject): ToolRegistration {
	return defineTool({
		name: RESULT_TOOL,
		description: RESULT_DESCRIPTION,
		parameters: schema as unknown as ReturnType<typeof Type.Object>,
		replay: "safe",
		prepareArguments: () => standIn(schema),
		execute: async (_args, api, context) => {
			const verdict = await api.commit(async (tx) => {
				const args = await sentArguments(tx, api.taskId, api.callId);
				const doc = await tx.doc(AgentScriptStep, api.conversationId);
				const problem = checkResult(doc.schema ?? null, args);
				if (problem === undefined) {
					doc.result = args as JsonObject;
					return { problem, refusals: doc.refusals ?? 0 };
				}
				doc.refusals = (doc.refusals ?? 0) + 1;
				return { problem, refusals: doc.refusals };
			}, context);
			if (verdict.problem === undefined) {
				return { content: [{ type: "text", text: "Result recorded." }], control: { terminate: true } };
			}
			// The model gets this as an error result and can call again, until the last refusal ends the step.
			return {
				content: [{ type: "text", text: verdict.problem }],
				isError: true,
				...(verdict.refusals >= MAX_REFUSALS ? { control: { terminate: true } } : {}),
			};
		},
	});
}

/** The arguments of tool call `callId` as the model sent them, before pi's validation. */
async function sentArguments(tx: Tx, taskId: TaskId, callId: string): Promise<unknown> {
	const input = (await tx.task(taskId))?.input as { assistant?: EntryId } | undefined;
	const entry = input?.assistant !== undefined ? await tx.entry(AssistantEntry, input.assistant) : undefined;
	for (const message of entry?.model ?? []) {
		if (message.role !== "assistant") continue;
		for (const block of message.content) {
			if (block.type === "toolCall" && block.id === callId) return block.arguments;
		}
	}
	throw new Error(`tool call ${callId} is not in its assistant entry`);
}

/** A value that passes `schema`: each property's first allowed value when it has an `enum`, else its type at its zero. */
function standIn(schema: JsonObject): JsonObject {
	const properties = (schema["properties"] ?? {}) as Record<string, { type?: string; enum?: readonly JsonValue[] }>;
	const zero = (type: string | undefined): JsonValue => (type === "number" ? 0 : type === "boolean" ? false : "");
	return Object.fromEntries(
		Object.entries(properties).map(([field, spec]) => [field, spec.enum?.[0] ?? zero(spec.type)]),
	);
}

/** The result tool the plain step extension lists until a step registers its own. */
const openResultTool = resultTool({ type: "object", properties: {} });

/** Shows the model the step's result schema. Absent for a text-only step. */
const resultSection = section("result", async (input, context) => {
	const doc = await input.read.snapshot(AgentScriptStep, input.conversationId, context);
	if (doc?.schema === null || doc?.schema === undefined) return undefined;
	return (
		`Finish by calling ${RESULT_TOOL} with an object matching this JSON Schema:\n` +
		JSON.stringify(doc.schema, null, 2)
	);
});

/** What a host passes to install Agent Script with actions. */
export interface AgentScriptExtensionOptions {
	/** The host actions `mcpTool://<name>` targets resolve to. */
	readonly actions: ActionRegistry;
	/** The directory every action runs in and is confined to. */
	readonly workspace: string;
}

/** The two extensions a host installs, bound to one registry and workspace. */
export interface AgentScriptExtensions {
	/** Brings the `agentscript.run` task. Named `agentscript`, like the plain export. */
	readonly run: Extension;
	/** Selected on every step conversation. Named `agentscript.step`, like the plain export. */
	readonly step: Extension;
	readonly task: Task<RunInput, RunCheckpoint, RunResult, object>;
}

/**
 * The run and step extensions bound to a registry of host actions and a
 * workspace. Install both in place of the plain exports.
 */
export function agentScriptExtensions(options: AgentScriptExtensionOptions): AgentScriptExtensions {
	return createExtensions(options.actions, options.workspace);
}

function createExtensions(registry: ActionRegistry, workspace: string): AgentScriptExtensions {
	/**
	 * The offered action tools, by name. pi-durable resolves a conversation's
	 * tools by name against the selected extensions at each use, and offer names
	 * come from the script, so the step extension's tool list is read live from
	 * here. Filled from the request at dispatch and again at the start of every
	 * await phase, which a resumed process runs before the step can go on.
	 * Executing a call reads the offer from the step's own doc, never from here.
	 */
	const offerTools = new Map<string, ToolRegistration>();
	/** The result tool, live the same way: parameters from the latest structured request. */
	let liveResult = openResultTool;

	/** The step's tools, registered live: its result tool (structured steps only), then its offers. */
	const register = (request: ReasoningRequest): ToolRegistration[] => {
		const tools: ToolRegistration[] = [];
		if (request.outputSchema !== undefined) {
			liveResult = resultTool(request.outputSchema as JsonObject);
			tools.push(liveResult);
		}
		for (const offer of request.tools ?? []) {
			const tool = offerTool(offer, registry, workspace);
			offerTools.set(offer.name, tool);
			tools.push(tool);
		}
		return tools;
	};

	const step: Extension = defineExtension({
		name: "agentscript.step",
		sections: [resultSection],
		tools: [openResultTool],
	});
	Object.defineProperty(step, "tools", {
		get: () => [liveResult, ...offerTools.values()],
		enumerable: true,
	});

	const task = defineTask<RunInput, RunCheckpoint, RunResult>({
		name: "agentscript.run",
		version: 1,
		initial: (input) => {
			const state = start(input.source, input.options);
			// Checked whole, when the run is created: nothing has executed yet.
			checkBindings(input.source, registry);
			return { phase: "next", state };
		},
		phases: {
			next: async (task, runtime, context) => {
				const step = next(task.input.source, task.state.checkpoint.state);
				await runtime.commit(
					() =>
						step.type === "done"
							? { status: "terminal", outcome: { status: "completed", result: step.result } }
							: step.type === "action"
								? { status: "running", checkpoint: { phase: "act", state: step.state, intent: null } }
								: {
										status: "running",
										checkpoint: { phase: "dispatch", state: step.state, step: step.state.steps.length },
									},
					context,
				);
			},
			dispatch: async (task, runtime, context) => {
				const { state, step } = task.state.checkpoint;
				const request = awaitingRequest(state);
				if (request === undefined) throw new Error("dispatch reached with no step awaiting");
				const tools = register(request);
				await runtime.commit(async (tx) => {
					const child = await tx.createConversation({ ownership: { kind: "task", taskId: runtime.taskId } });
					await configureStep(tx, child.id, request, tools, task.input.model);
					return { status: "running", checkpoint: { phase: "await", state, step, conversationId: child.id } };
				}, context);
			},
			await: async (task, runtime, context) => {
				const { state, step, conversationId } = task.state.checkpoint;
				const request = awaitingRequest(state);
				if (request === undefined) throw new Error("await reached with no step awaiting");
				register(request);
				const outcome = await answerStep(runtime, conversationId, request, step, context);
				const after = apply(task.input.source, state, outcome);
				await runtime.commit(() => ({ status: "running", checkpoint: { phase: "next", state: after } }), context);
			},
			act: async (task, runtime, context) => {
				const { state, intent } = task.state.checkpoint;
				const awaiting = state.awaiting;
				if (awaiting === undefined || !("call" in awaiting)) throw new Error("act reached with no action awaiting");
				const { call } = awaiting as AwaitingAction;
				const action = registry.get(call.tool);
				let result: ActionResult;
				if (action === undefined) {
					result = { ok: false, message: `mcpTool://${call.tool} is not registered on this host` };
				} else if (intent === null) {
					// The intent lands before anything runs, so a crash mid-call is seen on resume.
					await runtime.commit(
						() => ({ status: "running", checkpoint: { phase: "act", state, intent: { replay: action.replay } } }),
						context,
					);
					result = await execute(action, call.inputs, workspace, runtime.signal);
				} else if (intent.replay === "safe") {
					result = await execute(action, call.inputs, workspace, runtime.signal);
				} else {
					result = { ok: false, message: `${call.action} was interrupted and not re-run` };
				}
				const after = applyAction(task.input.source, state, result);
				await runtime.commit(() => ({ status: "running", checkpoint: { phase: "next", state: after } }), context);
			},
		},
		abort: async (_task, runtime, context) => {
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), context);
		},
	});

	const run: Extension = defineExtension({ name: "agentscript", tasks: [task] });
	return { run, step, task };
}

/** Run a host action once; a throw becomes a failed result carrying its message. */
async function execute(
	action: HostAction,
	inputs: Readonly<Record<string, VariableValue>>,
	workspace: string,
	signal: AbortSignal | undefined,
): Promise<ActionResult> {
	try {
		return await action.execute(inputs, { workspace, ...(signal !== undefined ? { signal } : {}) });
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * One offered action as a pi-durable tool: named and described as the offer
 * says, its parameters the model-filled inputs, its replay policy the action's.
 * A call merges the offer's bound inputs into the model's arguments, runs the
 * host action, and records what ran in the step doc for the await phase.
 */
function offerTool(offer: ToolOffer, registry: ActionRegistry, workspace: string): ToolRegistration {
	return defineTool({
		name: offer.name,
		description: offer.description,
		// The interpreter's schema is plain JSON Schema, which is what a TypeBox schema is at runtime.
		parameters: offer.inputSchema as unknown as ReturnType<typeof Type.Object>,
		replay: registry.get(offer.action)?.replay ?? "unsafe",
		execute: async (args, api, context) => {
			// The offer this conversation's step declared, durable in its own doc.
			const doc = await api.snapshot(AgentScriptStepActions, api.conversationId, context);
			const declared = (doc?.offers ?? []).find((o) => o["name"] === offer.name) as unknown as ToolOffer | undefined;
			const live = declared ?? offer;
			const inputs = { ...(args as Record<string, VariableValue>), ...live.bound };
			const host = registry.get(live.action);
			const result: ActionResult =
				host === undefined
					? { ok: false, message: `mcpTool://${live.action} is not registered on this host` }
					: await execute(host, inputs, workspace, context.abortSignal);
			const outputs = result.ok ? { ...result.outputs } : {};
			await api.commit(async (tx) => {
				const step = await tx.doc(AgentScriptStepActions, api.conversationId);
				step.calls = {
					...(step.calls ?? {}),
					[api.callId]: {
						name: offer.name,
						inputs,
						outputs,
						...(result.record !== undefined ? { record: result.record as JsonObject } : {}),
					},
				};
			}, context);
			if (!result.ok) return { content: [{ type: "text", text: result.message }], isError: true };
			return { content: [{ type: "text", text: JSON.stringify(outputs) }] };
		},
	});
}

function awaitingRequest(state: RunState): ReasoningRequest | undefined {
	const awaiting = state.awaiting;
	return awaiting !== undefined && "request" in awaiting ? awaiting.request : undefined;
}

const plain = createExtensions(new Map(), ".");

export const AgentScriptRun: Task<RunInput, RunCheckpoint, RunResult, object> = plain.task;

/** Selected on every step conversation: the result tool and its section, and no action tools. */
export const AgentScriptStepExtension: Extension = plain.step;

/** The extension a host installs when it provides no actions. */
export const AgentScript: Extension = plain.run;

async function configureStep(
	tx: Parameters<Parameters<Runtime["commit"]>[0]>[0],
	conversationId: ConversationId,
	request: ReasoningRequest,
	tools: readonly ToolRegistration[],
	model: ModelRef | undefined,
): Promise<void> {
	await configure(tx, conversationId, {
		...(model !== undefined ? { model } : {}),
		// Stored by name: whichever `agentscript.step` the host installed.
		extensions: [AgentScriptStepExtension],
		tools: [...tools],
		instructions: request.systemInstructions,
	});
	const doc = await tx.doc(AgentScriptStep, conversationId);
	doc.schema = (request.outputSchema as JsonObject | undefined) ?? null;
	if (request.tools !== undefined) {
		const actions = await tx.doc(AgentScriptStepActions, conversationId);
		actions.offers = request.tools.map((offer) => ({ ...offer }) as unknown as JsonObject);
	}
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
	if (request.outputSchema !== undefined && (doc?.result ?? null) === null && (doc?.refusals ?? 0) >= MAX_REFUSALS) {
		return {
			kind: "failed",
			category: "unknown",
			message: `the step's result was refused ${MAX_REFUSALS} times; last: ${await lastRefusal(runtime, conversationId, context)}`,
		};
	}
	const text = await answerText(runtime, conversationId, settled.answer, context);
	const toolCalls =
		request.tools !== undefined
			? await actionCalls(runtime, conversationId, await runtime.snapshot(AgentScriptStepActions, conversationId, context), context)
			: undefined;
	return {
		kind: "answered",
		text,
		...(request.outputSchema !== undefined && doc?.result !== null && doc?.result !== undefined
			? { structured: doc.result }
			: {}),
		...(toolCalls !== undefined ? { toolCalls } : {}),
	};
}

/** The text of the step conversation's last `submit_result` error result. */
async function lastRefusal(runtime: Runtime, conversationId: ConversationId, context: Context): Promise<string> {
	const view = await runtime.context(conversationId, context);
	const refused = view.entries
		.flatMap((entry) => entry.model ?? [])
		.filter((message) => message.role === "toolResult" && message.toolName === RESULT_TOOL && message.isError)
		.at(-1);
	return refused?.role === "toolResult"
		? refused.content.map((block) => (block.type === "text" ? block.text : "")).join("")
		: "";
}

/**
 * Every action tool call in the step conversation, in call order: the merged
 * inputs, whether it succeeded, the host's outputs (`{}` for an error result)
 * and its record.
 * `submit_result` is not an action and is never listed.
 */
async function actionCalls(
	runtime: Runtime,
	conversationId: ConversationId,
	doc: StepActionsDoc | undefined,
	context: Context,
): Promise<ToolCallRecord[]> {
	const view = await runtime.context(conversationId, context);
	const messages = view.entries.flatMap((entry) => entry.model ?? []);
	const errors = new Set<string>();
	for (const message of messages) {
		if (message.role === "toolResult" && message.isError) errors.add(message.toolCallId);
	}
	const calls: ToolCallRecord[] = [];
	const seen = new Set<string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const block of message.content) {
			if (block.type !== "toolCall" || block.name === RESULT_TOOL || seen.has(block.id)) continue;
			seen.add(block.id);
			const ran = doc?.calls?.[block.id] as
				| { inputs?: Record<string, unknown>; outputs?: Record<string, unknown>; record?: unknown }
				| undefined;
			const offer = (doc?.offers ?? []).find((o) => o["name"] === block.name) as unknown as ToolOffer | undefined;
			const inputs = ran?.inputs ?? { ...block.arguments, ...(offer?.bound ?? {}) };
			const ok = !errors.has(block.id) && ran?.outputs !== undefined;
			const outputs = ok ? (ran?.outputs ?? {}) : {};
			calls.push({ name: block.name, inputs, ok, outputs, ...(ran?.record !== undefined ? { record: ran.record } : {}) });
		}
	}
	return calls;
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
