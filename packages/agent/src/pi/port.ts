/**
 * A `ReasoningPort` backed by pi-ai, so a script can run on any provider pi knows.
 *
 * Without a tool host (`tools`), one `reason()` call is one model request. The
 * port does not loop: there are no tools for the model to call except the
 * structured-result tool below, and that call ends the step rather than feeding
 * a result back, so `toOutcome` never reports `cut-short`.
 *
 * Given a tool host, a step that offers tools runs a loop (`runToolLoop`),
 * bounded by `maxRounds`; only that bound reports `cut-short`.
 *
 * Mapping, all from structured fields and never from message text:
 *
 *   stopReason "stop" / "toolUse"  → answered (structured = the result tool's arguments)
 *   stopReason "length"            → failed, max_output_tokens
 *   stopReason "error"             → failed, category from the HTTP status if pi carried one
 *   stopReason "aborted"           → failed, unrecognised ("aborted")
 *
 * A step that asked for a structured result and got only text comes back
 * `answered` with no `structured`; the interpreter, not this port, decides that
 * is a failure.
 */

import type {
	ActionResult,
	ReasoningPort,
	ReasoningRequest,
	StepOutcome,
	ToolCallRecord,
	ToolOffer,
} from "../interpreter/index.js";
import { TOOLS_NEED_DURABLE_HOST, toFailureCategory } from "../interpreter/index.js";
import type {
	AssistantMessage,
	Context,
	Model,
	Models,
	Tool,
	ToolCall,
	ToolResultMessage,
	TSchema,
	Api,
} from "@earendil-works/pi-ai";
import { categoryFromStatus } from "./categories.js";

/** The one tool a structured step offers. Its arguments are the step's result. */
export const RESULT_TOOL = "submit_result";

export interface PiReasoningPortOptions {
	/** The pi `Models` collection holding the provider for `model`. */
	readonly models: Models;
	/** The model every step runs on. */
	readonly model: Model<Api>;
	/** Output cap per step. Defaults to 4096. */
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly signal?: AbortSignal;
	/** Called with every raw assistant message, for logging usage and cost. */
	readonly onMessage?: (message: AssistantMessage) => void;
	/**
	 * Runs the tools a step offers. Without it a request offering tools is
	 * refused; with it such a request runs the tool loop.
	 */
	readonly tools?: PiToolHost;
	/** Model requests one tool-loop step may make, the settling one included. Defaults to 16. */
	readonly maxRounds?: number;
}

/** One call the tool host runs: the offer's `name`, its host `tool` (the offer's `action`) and the inputs. */
export interface PiToolCall {
	readonly name: string;
	readonly tool: string;
	readonly inputs: Record<string, unknown>;
}

export type PiToolHost = (call: PiToolCall) => Promise<ActionResult> | ActionResult;

export const DEFAULT_MAX_ROUNDS = 16;

export function createPiReasoningPort(options: PiReasoningPortOptions): ReasoningPort {
	const { models, model } = options;
	return {
		async reason(request: ReasoningRequest): Promise<StepOutcome> {
			if (request.tools !== undefined && options.tools !== undefined) {
				return runToolLoop(request, request.tools, options.tools, options);
			}
			// Single-shot: there is no loop here to feed a tool's result back.
			if (request.tools !== undefined) {
				return { kind: "failed", category: "invalid_request", message: TOOLS_NEED_DURABLE_HOST };
			}
			const context: Context = {
				systemPrompt: request.systemInstructions,
				messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }],
			};
			if (request.outputSchema !== undefined) context.tools = [resultTool(request.outputSchema)];

			const message = await models.complete(model, context, {
				maxTokens: options.maxTokens ?? 4096,
				...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
				...(options.signal !== undefined ? { signal: options.signal } : {}),
				...(request.outputSchema !== undefined ? forceTool(model) : {}),
			});
			options.onMessage?.(message);
			return toOutcome(message, request.outputSchema !== undefined);
		},
	};
}

/**
 * The tool loop: offer the step's tools (and the result tool on a structured
 * step), run each call on the host and feed its result back, until the model
 * answers with no tool call or calls `submit_result`. A structured step that
 * never submitted gets one settling request offering only the result tool,
 * forced.
 */
async function runToolLoop(
	request: ReasoningRequest,
	offers: readonly ToolOffer[],
	host: PiToolHost,
	options: PiReasoningPortOptions,
): Promise<StepOutcome> {
	const { models, model } = options;
	const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
	const structuredStep = request.outputSchema !== undefined;
	const byName = new Map(offers.map((offer) => [offer.name, offer]));
	const requestOptions = {
		maxTokens: options.maxTokens ?? 4096,
		...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
		...(options.signal !== undefined ? { signal: options.signal } : {}),
	};

	const context: Context = {
		systemPrompt: request.systemInstructions,
		messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }],
		tools: [
			...offers.map((offer) => ({
				name: offer.name,
				description: offer.description,
				parameters: offer.inputSchema as unknown as TSchema,
			})),
			...(request.outputSchema !== undefined ? [resultTool(request.outputSchema)] : []),
		],
	};

	const toolCalls: ToolCallRecord[] = [];
	let rounds = 0;
	let last: AssistantMessage | undefined;
	let structured: { value: unknown } | undefined;
	let stillCalling = false;

	while (rounds < maxRounds) {
		const reply = await models.complete(model, context, requestOptions);
		rounds += 1;
		options.onMessage?.(reply);
		last = reply;
		if (reply.stopReason === "length" || reply.stopReason === "aborted" || reply.stopReason === "error") {
			return toOutcome(reply, structuredStep);
		}
		context.messages.push(reply);

		const calls = reply.content.filter((block): block is ToolCall => block.type === "toolCall");
		for (const call of calls) {
			if (structuredStep && call.name === RESULT_TOOL) {
				// Only the first submission counts; the step ends after this reply.
				structured ??= { value: call.arguments };
				continue;
			}
			const offer = byName.get(call.name);
			if (offer === undefined) {
				// Not recorded: a recorded unoffered call fails the step, and the model can recover.
				context.messages.push(toolResult(call, `no tool named "${call.name}" is offered on this step`, true));
				continue;
			}
			const problems = checkArguments(offer.inputSchema, call.arguments);
			if (problems.length > 0) {
				// Never reaches the host: the model is told what was wrong and can call again.
				context.messages.push(toolResult(call, problems.join("; "), true));
				toolCalls.push({ name: offer.name, inputs: call.arguments, ok: false, outputs: {} });
				continue;
			}
			// Bound inputs win over the model's, as under the durable host.
			const inputs = { ...call.arguments, ...offer.bound };
			let result: ActionResult;
			try {
				result = await host({ name: offer.name, tool: offer.action, inputs });
			} catch (error) {
				result = { ok: false, message: error instanceof Error ? error.message : String(error) };
			}
			context.messages.push(
				result.ok
					? toolResult(call, JSON.stringify(result.outputs), false)
					: toolResult(call, result.message, true),
			);
			toolCalls.push({
				name: offer.name,
				inputs,
				ok: result.ok,
				outputs: result.ok ? result.outputs : {},
				...(result.record !== undefined ? { record: result.record } : {}),
			});
		}

		stillCalling = calls.length > 0 && structured === undefined;
		if (!stillCalling) break;
	}

	const text = textOf(last);
	if (stillCalling) return { kind: "cut-short", text, turns: maxRounds };

	if (structuredStep && structured === undefined) {
		// The settling request counts toward the bound too.
		if (rounds >= maxRounds) return { kind: "cut-short", text, turns: maxRounds };
		const settling: Context = { ...context, tools: [resultTool(request.outputSchema!)] };
		const reply = await models.complete(model, settling, { ...requestOptions, ...forceTool(model) });
		options.onMessage?.(reply);
		const outcome = toOutcome(reply, true);
		return outcome.kind === "answered" ? { ...outcome, toolCalls } : outcome;
	}

	return {
		kind: "answered",
		text,
		...(structured !== undefined ? { structured: structured.value } : {}),
		toolCalls,
	};
}

/**
 * Every problem with a call's arguments against its offer's input schema,
 * which `composeToolOffers` always builds as a closed object of scalar
 * properties: a missing required key, an extra key, or a mismatched JSON type.
 */
function checkArguments(schema: Readonly<Record<string, unknown>>, args: Record<string, unknown>): string[] {
	const properties = (schema.properties ?? {}) as Record<string, { type?: unknown }>;
	const required = (schema.required ?? []) as readonly string[];
	const problems: string[] = [];
	for (const key of required) {
		if (!(key in args)) problems.push(`missing required input "${key}"`);
	}
	for (const [key, value] of Object.entries(args)) {
		const property = properties[key];
		if (property === undefined) {
			problems.push(`unexpected input "${key}"`);
			continue;
		}
		if (typeof property.type === "string" && !matchesType(property.type, value)) {
			problems.push(`input "${key}" must be ${property.type}`);
		}
	}
	return problems;
}

function matchesType(type: string, value: unknown): boolean {
	switch (type) {
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "integer":
			return Number.isInteger(value);
		case "boolean":
			return typeof value === "boolean";
		default:
			return true;
	}
}

function toolResult(call: ToolCall, text: string, isError: boolean): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: call.id,
		toolName: call.name,
		content: [{ type: "text", text }],
		isError,
		timestamp: Date.now(),
	};
}

function textOf(message: AssistantMessage | undefined): string {
	return (message?.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function resultTool(schema: Record<string, unknown>): Tool {
	return {
		name: RESULT_TOOL,
		description:
			"Submit this step's result. Call this exactly once with every field filled; it is the only way the result is recorded.",
		// The interpreter's schema is plain JSON Schema, which is what a TypeBox schema is at runtime.
		parameters: schema as unknown as TSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
	};
}

/**
 * Provider-specific options that force the result tool. pi's provider-neutral
 * `toolChoice` only offers "auto" | "none", so each wire API is named here; an
 * API not listed falls back to the provider's default and relies on the tool
 * description.
 */
export function forceTool(model: Model<Api>): Record<string, unknown> {
	switch (model.api) {
		case "anthropic-messages":
			return { toolChoice: { type: "tool", name: RESULT_TOOL } };
		case "openai-completions":
			return { toolChoice: { type: "function", function: { name: RESULT_TOOL } } };
		case "openai-responses":
		case "azure-openai-responses":
			return { toolChoice: { type: "function", name: RESULT_TOOL } };
		case "bedrock-converse-stream":
			return { toolChoice: { type: "tool", name: RESULT_TOOL } };
		case "google-generative-ai":
		case "google-vertex":
		case "mistral-conversations":
			return { toolChoice: "any" };
		default:
			return {};
	}
}

export function toOutcome(message: AssistantMessage, wantsStructured: boolean): StepOutcome {
	const text = message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");

	switch (message.stopReason) {
		case "stop":
		case "toolUse": {
			if (!wantsStructured) return { kind: "answered", text };
			const call = message.content.find((block) => block.type === "toolCall" && block.name === RESULT_TOOL);
			return call !== undefined && call.type === "toolCall"
				? { kind: "answered", text, structured: call.arguments }
				: { kind: "answered", text };
		}
		case "length":
			return {
				kind: "failed",
				category: "max_output_tokens",
				message: message.errorMessage ?? "the model hit its output token limit",
			};
		case "aborted":
			return {
				kind: "failed",
				category: toFailureCategory("aborted"),
				message: message.errorMessage ?? "the request was aborted",
			};
		default: {
			const status = message.diagnostics?.map((d) => d.error?.code).find((code) => code !== undefined);
			return {
				kind: "failed",
				category: toFailureCategory(categoryFromStatus(status)),
				message: message.errorMessage ?? `the request ended with stopReason "${message.stopReason}"`,
			};
		}
	}
}
