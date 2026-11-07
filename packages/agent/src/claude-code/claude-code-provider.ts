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
	/**
	 * How long `claude` may work on its own before it is stopped. A request offering no tool but
	 * `submit_result` is one process, and this bounds it whole. A held session (a step offering
	 * tools) is bounded turn by turn: from the start, or from when its last call was answered, until
	 * it makes its next call or ends. Its clock stops while its calls are with pi, so the host's
	 * tools don't count. Defaults to `DEFAULT_TURN_TIMEOUT_MS`. Reaching it ends the step with an
	 * error that names it.
	 */
	readonly timeoutMs?: number;
	/**
	 * How long a held session waits for pi to answer the calls it handed out, from the last answer,
	 * before it ends, so a run that stopped answering doesn't keep `claude` running. An answer that
	 * comes later starts a fresh process on the whole transcript, as after a crash. Defaults to
	 * `DEFAULT_TOOL_WAIT_MS`.
	 */
	readonly toolWaitMs?: number;
	/** Where `claude` runs. Defaults to a fresh empty directory per request, removed after. Ignored with `runner`. */
	readonly cwd?: string;
	/** Replaces process spawning, for tests. Receives the request's abort signal, or a bridged session's own. */
	readonly runner?: (signal: AbortSignal | undefined) => Runner;
	/** Serves a request's tools to `claude` (`mcpBridge()` from `./mcp`), so Claude Code can call them through pi. */
	readonly bridge?: ToolBridgeFactory;
	/**
	 * `--max-turns` for a held session (a step offering tools): Claude Code's own bound on its
	 * turns, each one model reply and the tool calls in it. Defaults to `DEFAULT_TOOL_STEP_TURNS`.
	 * Reaching it ends the step with an error that names the limit.
	 */
	readonly maxTurns?: number;
	/**
	 * Model ids to serve beside `CLAUDE_CODE_MODELS`, so `Models.getModel("claude-code", id)` finds
	 * them: any id `claude --model` accepts, such as `claude-sonnet-4-5`. `claude` judges each when a
	 * step runs. More can be added later with `serveClaudeCodeModels`.
	 */
	readonly models?: readonly string[];
}

/** A held session's default `--max-turns`: room for a coding step's reads, edits and test runs. */
export const DEFAULT_TOOL_STEP_TURNS = 100;

/** The default `timeoutMs`: five minutes for one reply (one process, or one turn of a held session). */
export const DEFAULT_TURN_TIMEOUT_MS = 300_000;

/** The default `toolWaitMs`: an hour, beyond any built-in tool's own limit, so it only ends abandoned sessions. */
export const DEFAULT_TOOL_WAIT_MS = 3_600_000;

/** The longest delay `setTimeout` keeps; anything longer fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

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

/** The ids each provider built by `claudeCodeProvider` serves beyond `CLAUDE_CODE_MODELS`. */
const SERVED = new WeakMap<Provider<Api>, Map<string, Model<typeof CLAUDE_CODE_API>>>();

/**
 * Lets a provider built by `claudeCodeProvider` serve more model ids (`claudeCodeModel(id)` for
 * each), so a run can name one the provider doesn't list. `claude --model` judges each id when a
 * step runs. Answers false, adding nothing, for any other provider. Empty ids are skipped.
 */
export function serveClaudeCodeModels(provider: Provider<Api>, ids: readonly string[]): boolean {
	const served = SERVED.get(provider);
	if (served === undefined) return false;
	for (const id of ids) {
		if (id === "" || served.has(id) || CLAUDE_CODE_MODELS.some((m) => m.id === id)) continue;
		served.set(id, claudeCodeModel(id));
	}
	return true;
}

export function claudeCodeProvider(options: ClaudeCodeProviderOptions = {}): Provider<typeof CLAUDE_CODE_API> {
	const maxTurns = options.maxTurns ?? DEFAULT_TOOL_STEP_TURNS;
	if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new RangeError(`maxTurns must be a positive integer, got ${maxTurns}`);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
	const toolWaitMs = options.toolWaitMs ?? DEFAULT_TOOL_WAIT_MS;
	for (const [name, ms] of [["timeoutMs", timeoutMs], ["toolWaitMs", toolWaitMs]] as const) {
		if (!Number.isInteger(ms) || ms < 1 || ms > MAX_TIMER_MS) {
			throw new RangeError(`${name} must be a positive integer of milliseconds, at most ${MAX_TIMER_MS}, got ${ms}`);
		}
	}
	// A held session's runner has no clock: the session's own clocks stop it.
	const runnerFor = (signal: AbortSignal | undefined, clock: number | undefined): Runner =>
		options.runner?.(signal) ?? spawnRunner(options.binary ?? "claude", clock, signal, options.cwd);
	const sessions = new SessionRegistry();
	const limits = { maxTurns, timeoutMs, toolWaitMs };
	const stream = (model: Model<Api>, context: { messages: Message[] }, streamOptions?: StreamOptions) =>
		streamClaude(model, context.messages, { runnerFor, bridge: options.bridge, sessions, limits, signal: streamOptions?.signal });
	const listed = createProvider({
		id: CLAUDE_CODE_PROVIDER_ID,
		name: "Claude Code (your subscription)",
		auth: { apiKey: { name: "Claude Code login", resolve: async () => ({ auth: {} }) } },
		models: CLAUDE_CODE_MODELS,
		api: { stream, streamSimple: stream },
	});
	// pi-ai finds a model in its provider's list, so the ids served beyond the four are listed too.
	const served = new Map<string, Model<typeof CLAUDE_CODE_API>>();
	const provider: Provider<typeof CLAUDE_CODE_API> = {
		...listed,
		getModels: () => [...listed.getModels(), ...served.values()],
		getAllModels: () => [...(listed.getAllModels?.() ?? listed.getModels()), ...served.values()],
	};
	SERVED.set(provider as Provider<Api>, served);
	serveClaudeCodeModels(provider as Provider<Api>, options.models ?? []);
	return provider;
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

/** The provider's bounds on `claude`, as given or defaulted. */
interface Limits {
	/** A held session's `--max-turns`. */
	readonly maxTurns: number;
	readonly timeoutMs: number;
	readonly toolWaitMs: number;
}

interface StreamContext {
	/** A runner on `signal`, stopping each process past `clock` ms, or never when undefined. */
	readonly runnerFor: (signal: AbortSignal | undefined, clock: number | undefined) => Runner;
	readonly bridge: ToolBridgeFactory | undefined;
	readonly sessions: SessionRegistry;
	readonly limits: Limits;
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
			if (event !== "aborted" && !signal?.aborted) return messageFromEvent(base, event, toolName, context.limits);
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
						maxTurns: context.limits.maxTurns,
					},
					prompt: promptOf(messages),
					runnerFor: (signal) => context.runnerFor(signal, undefined),
					registry: context.sessions,
					clocks: { turnTimeoutMs: context.limits.timeoutMs, toolWaitMs: context.limits.toolWaitMs },
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

		const processResult = await context.runnerFor(context.signal, context.limits.timeoutMs)(
			claudeArgs({
				system: systemPromptOf(messages),
				model: model.id,
				...(tool !== undefined ? { schema: tool.parameters as unknown as Record<string, unknown> } : {}),
			}),
			promptOf(messages),
			claudeCodeEnv(process.env),
		);
		finish(messageFromResult(base, processResult, tool?.name, { timeoutMs: context.limits.timeoutMs }));
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
function messageFromEvent(base: AssistantMessage, event: SessionEvent, toolName: string | undefined, limits: Limits): AssistantMessage {
	if (event.kind === "done") return messageFromResult(base, event.result, toolName, { maxTurns: limits.maxTurns, timeoutMs: limits.timeoutMs, held: true });
	return {
		...base,
		stopReason: "toolUse",
		content: event.calls.map((call) => ({ type: "toolCall" as const, id: call.id, name: call.name, arguments: call.args as Record<string, never> })),
	};
}

/** The limits a process ran under, named when it stopped at one; `held` for a held session. */
interface RanUnder {
	readonly maxTurns?: number;
	readonly timeoutMs: number;
	readonly held?: boolean;
}

/**
 * One process's result as a message: an error with diagnostics, a call to
 * `toolName` carrying the structured output when that tool was offered, or text.
 * A process that stopped at a limit in `limits` fails naming it; one that
 * answered before its clock stopped it keeps its answer.
 */
function messageFromResult(base: AssistantMessage, processResult: ProcessResult, toolName: string | undefined, limits: RanUnder): AssistantMessage {
	const { step, parsed } = toClaudeCodeOutcome(processResult, toolName !== undefined);
	const usage = usageOf(parsed);

	if (step.kind === "failed" || step.kind === "cut-short") {
		const status = parsed?.api_error_status ?? undefined;
		return {
			...base,
			usage,
			stopReason: "error",
			errorMessage:
				step.kind === "cut-short"
					? turnLimitMessage(step.turns, limits.maxTurns)
					: processResult.timedOut === true
						? turnTimeoutMessage(limits.timeoutMs, limits.held === true)
						: step.message,
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

/**
 * The step a limit ended: unfinished, and "out of budget". pi-ai picks the errors to retry by their
 * text, and would retry one naming `timeoutMs`, or any number holding "500"; "out of budget" is on
 * its never-retry list, which it checks first. Retrying a step on the limit it just reached would
 * only reach it again, so it fails once, saying how to raise the limit.
 */
const OUT_OF_BUDGET = "the step ended unfinished, out of budget";

/** Why a step ended at Claude Code's turn limit, and, when the limit is known, how to raise it. */
export function turnLimitMessage(turns: number, maxTurns: number | undefined): string {
	const stopped = `claude stopped at its turn limit after ${turns} turns`;
	return maxTurns === undefined
		? `${stopped}; ${OUT_OF_BUDGET}`
		: `${stopped} (maxTurns ${maxTurns}); ${OUT_OF_BUDGET}: raise maxTurns (the CLI's --max-turns, or task.maxTurns in agentscript.config.json) to give it more`;
}

/** Why a step ended when a clock stopped `claude`, and how to give it more time. */
export function turnTimeoutMessage(timeoutMs: number, held: boolean): string {
	const stopped = held
		? `claude was stopped after working ${timeoutMs}ms on one turn without calling a tool or finishing (timeoutMs ${timeoutMs}, not counting the host's tools)`
		: `claude was stopped after ${timeoutMs}ms without an answer (timeoutMs ${timeoutMs})`;
	return `${stopped}; ${OUT_OF_BUDGET}: raise timeoutMs (the CLI's --turn-timeout, or task.turnTimeoutMs in agentscript.config.json) to give it more`;
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
