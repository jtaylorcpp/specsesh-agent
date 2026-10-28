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
 * Without a `bridge`, a request offering more than one tool is refused with an
 * error message rather than half-supported. With one, a request offering any
 * tool other than `submit_result` runs a held session (provider-session.ts):
 * Claude Code calls the tools through the bridge, each call is handed to pi as a
 * `toolCall`, and pi runs it.
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
import { DEFAULT_MAX_ROUNDS } from "../pi/port.js";
import {
	SERVABLE_NAME,
	claudeArgs,
	claudeCodeEnv,
	spawnRunner,
	toClaudeCodeOutcome,
	type ClaudeCodeResult,
	type ProcessResult,
	type Runner,
} from "./claude-code.js";
import { SessionRegistry, startSession, type ProviderSession, type SessionEvent } from "./provider-session.js";
import type { ToolBridgeFactory } from "./tool-bridge.js";

export const CLAUDE_CODE_API = "claude-code";
export const CLAUDE_CODE_PROVIDER_ID = "claude-code";

export interface ClaudeCodeProviderOptions {
	readonly binary?: string;
	readonly timeoutMs?: number;
	/** Where `claude` runs. Defaults to a fresh empty directory per request, removed after. Ignored with `runner`. */
	readonly cwd?: string;
	/** Replaces process spawning, for tests. Receives the request's abort signal, or a bridged session's own. */
	readonly runner?: (signal: AbortSignal | undefined) => Runner;
	/** Serves a request's tools to `claude` (`mcpBridge()` from `./node`), so Claude Code can call them through pi. */
	readonly bridge?: ToolBridgeFactory;
}

/** The structured answer's tool, by its fixed name. */
const SUBMIT_RESULT = "submit_result";

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
	const runnerFor = (signal: AbortSignal | undefined): Runner =>
		options.runner?.(signal) ?? spawnRunner(options.binary ?? "claude", options.timeoutMs ?? 300_000, signal, options.cwd);
	const sessions = new SessionRegistry();
	const stream = (model: Model<Api>, context: { messages: Message[] }, streamOptions?: StreamOptions) =>
		streamClaude(model, context.messages, { runnerFor, bridge: options.bridge, sessions, signal: streamOptions?.signal });
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

interface StreamContext {
	readonly runnerFor: (signal: AbortSignal | undefined) => Runner;
	readonly bridge: ToolBridgeFactory | undefined;
	readonly sessions: SessionRegistry;
	readonly signal: AbortSignal | undefined;
}

function streamClaude(model: Model<Api>, messages: readonly Message[], context: StreamContext): AssistantMessageEventStream {
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
	const finish = (message: AssistantMessage) => {
		if (message.stopReason === "error" || message.stopReason === "aborted") events.push({ type: "error", reason: message.stopReason, error: message });
		else events.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
		events.end(message);
	};
	const refuse = (errorMessage: string) => finish({ ...base, stopReason: "error", errorMessage });
	const aborted: AssistantMessage = { ...base, stopReason: "aborted", errorMessage: "Request was aborted" };
	/** The session's next event as a message, unless the request's signal aborts first: then the session ends and `aborted` wins. */
	const waitOn = async (session: ProviderSession, toolName: string | undefined): Promise<AssistantMessage> => {
		const signal = context.signal;
		let onAbort: (() => void) | undefined;
		const abort = new Promise<"aborted">((resolve) => {
			onAbort = () => resolve("aborted");
			if (signal?.aborted) onAbort();
			else signal?.addEventListener("abort", onAbort, { once: true });
		});
		try {
			const event = await Promise.race([session.nextEvent(), abort]);
			if (event !== "aborted" && !signal?.aborted) return messageFromEvent(base, event, toolName);
		} finally {
			signal?.removeEventListener("abort", onAbort!);
		}
		await session.end().catch(() => undefined);
		return aborted;
	};

	void (async () => {
		const tools = toolsOf(messages);
		const others = tools.filter((t) => t.name !== SUBMIT_RESULT);
		if (context.bridge !== undefined && others.length > 0) {
			const unservable = others.find((t) => !SERVABLE_NAME.test(t.name));
			if (unservable !== undefined) return refuse(`offered tool name ${unservable.name} can't be served to claude`);
			events.push({ type: "start", partial: base });
			const submit = tools.find((t) => t.name === SUBMIT_RESULT);
			const continued = continueSession(messages, context.sessions);
			if (continued !== undefined) return finish(await waitOn(continued, submit?.name));
			if (context.signal?.aborted) return finish(aborted);
			// No result names a live session: a first request, or a resumed run whose process died with the crash.
			let session: ProviderSession;
			try {
				session = await startSession({
					bridge: context.bridge,
					tools: others.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters as unknown as Record<string, unknown> })),
					invocation: {
						system: systemPromptOf(messages),
						model: model.id,
						...(submit !== undefined ? { schema: submit.parameters as unknown as Record<string, unknown> } : {}),
						maxTurns: DEFAULT_MAX_ROUNDS,
					},
					prompt: promptOf(messages),
					runnerFor: context.runnerFor,
					registry: context.sessions,
				});
			} catch (error) {
				return refuse(`could not start the tool bridge: ${error instanceof Error ? error.message : String(error)}`);
			}
			return finish(await waitOn(session, submit?.name));
		}

		if (tools.length > 1) {
			return refuse(
				`the claude-code provider runs at most one pi tool per request without a bridge; this one offered ${tools.length} (${tools.map((t) => t.name).join(", ")})`,
			);
		}
		const tool = tools[0];
		events.push({ type: "start", partial: base });

		const processResult = await context.runnerFor(context.signal)(
			claudeArgs({
				system: systemPromptOf(messages),
				model: model.id,
				...(tool !== undefined ? { schema: tool.parameters as unknown as Record<string, unknown> } : {}),
			}),
			promptOf(messages),
			claudeCodeEnv(process.env),
		);
		finish(messageFromResult(base, processResult, tool?.name));
	})();

	return events;
}

/**
 * Hands the trailing `toolResult`s (those after the last assistant message) to
 * the held calls they answer, and returns the live session they belong to.
 * Unknown ids are ignored; undefined when none names a live session.
 */
function continueSession(messages: readonly Message[], sessions: SessionRegistry): ProviderSession | undefined {
	let start = messages.length;
	while (start > 0 && messages[start - 1]?.role !== "assistant") start -= 1;
	let continued: ProviderSession | undefined;
	for (const message of messages.slice(start)) {
		if (message.role !== "toolResult") continue;
		const session = sessions.sessionOf(message.toolCallId);
		if (session?.resolve(message.toolCallId, { ok: !message.isError, text: textOf(message.content) })) continued ??= session;
	}
	return continued;
}

/** A session's event as one message: its held calls as `toolCall`s with zero usage, or the process's result. */
function messageFromEvent(base: AssistantMessage, event: SessionEvent, toolName: string | undefined): AssistantMessage {
	if (event.kind === "done") return messageFromResult(base, event.result, toolName);
	return {
		...base,
		stopReason: "toolUse",
		content: event.calls.map((call) => ({ type: "toolCall" as const, id: call.id, name: call.name, arguments: call.args as Record<string, never> })),
	};
}

/**
 * One process's result as a message: an error with diagnostics, a call to
 * `toolName` carrying the structured output when that tool was offered, or text.
 */
function messageFromResult(base: AssistantMessage, processResult: ProcessResult, toolName: string | undefined): AssistantMessage {
	const { step, parsed } = toClaudeCodeOutcome(processResult, toolName !== undefined);
	const usage = usageOf(parsed);

	if (step.kind === "failed" || step.kind === "cut-short") {
		const status = parsed?.api_error_status ?? undefined;
		return {
			...base,
			usage,
			stopReason: "error",
			errorMessage: step.kind === "failed" ? step.message : `claude stopped at its turn limit after ${step.turns} turns`,
			...(status !== undefined && status !== null
				? { diagnostics: [{ type: "claude-code", timestamp: Date.now(), error: { message: "api error", code: status } }] }
				: {}),
		};
	}

	return toolName !== undefined && step.structured !== undefined
		? {
				...base,
				usage,
				stopReason: "toolUse",
				content: [{ type: "toolCall", id: `claude-code-${Date.now()}`, name: toolName, arguments: step.structured as Record<string, never> }],
			}
		: { ...base, usage, stopReason: "stop", content: [{ type: "text", text: step.text }] };
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
