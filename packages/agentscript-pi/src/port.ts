/**
 * A `ReasoningPort` backed by pi-ai, so a script can run on any provider pi knows.
 *
 * One `reason()` call is one model request. This port does not loop: there are
 * no tools for the model to call except the structured-result tool below, and
 * that call ends the step rather than feeding a result back. So the port never
 * reports `cut-short` — that outcome belongs to an implementation with its own
 * round bound, and this one has none.
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

import type { ReasoningPort, ReasoningRequest, StepOutcome } from "@coopcli/agentscript/interpreter";
import { toFailureCategory } from "@coopcli/agentscript/interpreter";
import type { AssistantMessage, Context, Model, Models, Tool, TSchema, Api } from "@earendil-works/pi-ai";
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
}

export function createPiReasoningPort(options: PiReasoningPortOptions): ReasoningPort {
	const { models, model } = options;
	return {
		async reason(request: ReasoningRequest): Promise<StepOutcome> {
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
