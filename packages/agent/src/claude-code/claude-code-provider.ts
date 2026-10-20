/**
 * A pi-ai provider backed by your own `claude` binary, so anything built on pi —
 * pi-durable included — can run on your Claude subscription for local work.
 *
 * Each request is one headless `claude -p --safe-mode` run (see claude-code.ts for
 * why those flags, and why Claude Code's OAuth token is never touched). The
 * request is flattened into what `claude -p` takes:
 *
 *   system messages  → --system-prompt (base content, then sections, later ones replacing earlier)
 *   the transcript   → the prompt on stdin: a lone user message as-is, otherwise a
 *                      plain-text rendering of the turns so far
 *   one offered tool → --json-schema with the tool's parameters; the structured
 *                      result comes back as a call to that tool, so pi executes it
 *
 * Claude Code runs its own tools, not pi's, so a request offering more than one
 * tool is refused with an error message rather than half-supported. That covers
 * Agent Script's steps, which offer at most `submit_result`.
 *
 * For local development. On a server, use a real provider and an API key.
 */

import {
	createAssistantMessageEventStream,
	createProvider,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Message,
	type Model,
	type Provider,
	type StreamOptions,
	type Tool,
} from "@earendil-works/pi-ai";
import {
	claudeArgs,
	claudeCodeEnv,
	spawnRunner,
	toClaudeCodeOutcome,
	type ClaudeCodeResult,
	type Runner,
} from "./claude-code.js";

export const CLAUDE_CODE_API = "claude-code";
export const CLAUDE_CODE_PROVIDER_ID = "claude-code";

export interface ClaudeCodeProviderOptions {
	readonly binary?: string;
	readonly timeoutMs?: number;
	/** Where `claude` runs. Defaults to a fresh empty directory per request, removed after. Ignored with `runner`. */
	readonly cwd?: string;
	/** Replaces process spawning, for tests. Receives the request's abort signal. */
	readonly runner?: (signal: AbortSignal | undefined) => Runner;
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function chatModel(id: string, name: string): Model<typeof CLAUDE_CODE_API> {
	return {
		id,
		name,
		api: CLAUDE_CODE_API,
		provider: CLAUDE_CODE_PROVIDER_ID,
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: ZERO_COST,
		contextWindow: 200_000,
		maxTokens: 32_000,
	};
}

/** Ids `claude --model` accepts. Anything else can still be used through `claudeCodeModel(id)`. */
export const CLAUDE_CODE_MODELS = [
	chatModel("claude-haiku-4-5", "Claude Haiku 4.5 (via Claude Code)"),
	chatModel("haiku", "Claude Code's current Haiku"),
	chatModel("sonnet", "Claude Code's current Sonnet"),
	chatModel("opus", "Claude Code's current Opus"),
];

export function claudeCodeModel(id: string): Model<typeof CLAUDE_CODE_API> {
	return CLAUDE_CODE_MODELS.find((m) => m.id === id) ?? chatModel(id, `${id} (via Claude Code)`);
}

export function claudeCodeProvider(options: ClaudeCodeProviderOptions = {}): Provider<typeof CLAUDE_CODE_API> {
	const runnerFor =
		options.runner ?? ((signal) => spawnRunner(options.binary ?? "claude", options.timeoutMs ?? 300_000, signal, options.cwd));
	const stream = (model: Model<Api>, context: { messages: Message[] }, streamOptions?: StreamOptions) =>
		streamClaude(model, context.messages, runnerFor(streamOptions?.signal));
	return createProvider({
		id: CLAUDE_CODE_PROVIDER_ID,
		name: "Claude Code (your subscription)",
		auth: { apiKey: { name: "Claude Code login", resolve: async () => ({ auth: {} }) } },
		models: CLAUDE_CODE_MODELS,
		api: { stream, streamSimple: stream },
	});
}

/** The system prompt pi described: base content, then sections in order, later messages replacing by name. */
export function systemPromptOf(messages: readonly Message[]): string {
	const base: string[] = [];
	const sections = new Map<string, string>();
	for (const message of messages) {
		if (message.role !== "system") continue;
		const content = textOf(message.content);
		if (content !== "") base.push(content);
		for (const [name, value] of Object.entries(message.sections ?? {})) {
			if (value === null) sections.delete(name);
			else sections.set(name, value);
		}
	}
	return [...base, ...sections.values()].join("\n\n");
}

export function toolsOf(messages: readonly Message[]): Tool[] {
	return messages.flatMap((m) => (m.role === "system" ? (m.toolsAdded ?? []) : []));
}

/** The conversation as one prompt. A single user turn is passed through untouched. */
export function promptOf(messages: readonly Message[]): string {
	const turns = messages.filter((m) => m.role !== "system");
	if (turns.length === 1 && turns[0]?.role === "user") return textOf(turns[0].content);
	const lines = turns.map((m) => {
		switch (m.role) {
			case "user":
				return `User: ${textOf(m.content)}`;
			case "assistant":
				return `Assistant: ${m.content
					.map((b) => (b.type === "text" ? b.text : b.type === "toolCall" ? `[called ${b.name} with ${JSON.stringify(b.arguments)}]` : ""))
					.join("")}`;
			case "toolResult":
				return `Tool ${m.toolName} ${m.isError ? "returned an error" : "returned"}: ${textOf(m.content)}`;
			default:
				return "";
		}
	});
	return `${lines.join("\n\n")}\n\nContinue from here as the assistant.`;
}

function textOf(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
}

function streamClaude(model: Model<Api>, messages: readonly Message[], runner: Runner): AssistantMessageEventStream {
	const events = createAssistantMessageEventStream();
	const base: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...ZERO_COST, total: 0 } },
		stopReason: "pending",
		timestamp: Date.now(),
	};

	void (async () => {
		const tools = toolsOf(messages);
		if (tools.length > 1) {
			const error = { ...base, stopReason: "error" as const, errorMessage: `the claude-code provider runs at most one pi tool per request; this one offered ${tools.length} (${tools.map((t) => t.name).join(", ")})` };
			events.push({ type: "error", reason: "error", error });
			events.end(error);
			return;
		}
		const tool = tools[0];
		events.push({ type: "start", partial: base });

		const processResult = await runner(
			claudeArgs({
				system: systemPromptOf(messages),
				model: model.id,
				...(tool !== undefined ? { schema: tool.parameters as unknown as Record<string, unknown> } : {}),
			}),
			promptOf(messages),
			claudeCodeEnv(process.env),
		);
		const { step, parsed } = toClaudeCodeOutcome(processResult, tool !== undefined);
		const usage = usageOf(parsed);

		if (step.kind === "failed" || step.kind === "cut-short") {
			const status = parsed?.api_error_status ?? undefined;
			const error: AssistantMessage = {
				...base,
				usage,
				stopReason: "error",
				errorMessage: step.kind === "failed" ? step.message : `claude stopped at its turn limit after ${step.turns} turns`,
				...(status !== undefined && status !== null
					? { diagnostics: [{ type: "claude-code", timestamp: Date.now(), error: { message: "api error", code: status } }] }
					: {}),
			};
			events.push({ type: "error", reason: "error", error });
			events.end(error);
			return;
		}

		const message: AssistantMessage =
			tool !== undefined && step.structured !== undefined
				? {
						...base,
						usage,
						stopReason: "toolUse",
						content: [{ type: "toolCall", id: `claude-code-${Date.now()}`, name: tool.name, arguments: step.structured as Record<string, never> }],
					}
				: { ...base, usage, stopReason: "stop", content: [{ type: "text", text: step.text }] };
		events.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
		events.end(message);
	})();

	return events;
}

function usageOf(parsed: ClaudeCodeResult | undefined): AssistantMessage["usage"] {
	const input = parsed?.usage?.input_tokens ?? 0;
	const output = parsed?.usage?.output_tokens ?? 0;
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		// What Claude Code reports. Notional on a subscription.
		cost: { ...ZERO_COST, total: parsed?.total_cost_usd ?? 0 },
	};
}
