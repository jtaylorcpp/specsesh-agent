// The claude-code provider's clocks. A request offering no tool but submit_result is one process,
// bounded whole by `timeoutMs`. A held session is bounded turn by turn: `timeoutMs` runs only while
// Claude Code works and stops while its calls are with pi, so the host's tools don't count; and
// `toolWaitMs` ends a session pi stopped answering, whose late answer then starts a fresh process.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModels, Type, type AssistantMessage, type Context, type Message, type ToolCall } from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";
import type { ProcessResult, Runner } from "../../src/claude-code/claude-code.js";
import {
	DEFAULT_TOOL_WAIT_MS,
	DEFAULT_TURN_TIMEOUT_MS,
	claudeCodeProvider,
	turnLimitMessage,
	turnTimeoutMessage,
	type ClaudeCodeProviderOptions,
} from "../../src/claude-code/claude-code-provider.js";
import type { BridgeHandler, ToolBridgeFactory } from "../../src/claude-code/tool-bridge.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ok = (result: string): ProcessResult => ({
	code: 0,
	stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, result }),
	stderr: "",
});
const KILLED: ProcessResult = { code: null, stdout: "", stderr: "" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves after `ms`, or with "aborted" as soon as `signal` aborts. */
const work = (ms: number, signal: AbortSignal | undefined) =>
	new Promise<"done" | "aborted">((resolve) => {
		if (signal?.aborted) return resolve("aborted");
		const timer = setTimeout(() => resolve("done"), ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			resolve("aborted");
		});
	});

function fakeBridge() {
	const state = { handler: undefined as BridgeHandler | undefined, closes: 0 };
	const factory: ToolBridgeFactory = async (tools, handler) => {
		state.handler = handler;
		return {
			mcpConfig: "/tmp/fake-mcp-config.json",
			allowedTools: tools.map((t) => `mcp__agentscript__${t.name}`),
			close: async () => {
				state.closes += 1;
			},
		};
	};
	return { factory, state };
}

/** Claude Code as a script against the bridge's handler; each process gets the next script. */
type Script = (handler: BridgeHandler, signal: AbortSignal | undefined) => Promise<ProcessResult>;

function harness(scripts: Script[], options: Omit<ClaudeCodeProviderOptions, "runner" | "bridge"> = {}) {
	const bridge = fakeBridge();
	const runs: { input: string; signal: AbortSignal | undefined }[] = [];
	const runner = (signal: AbortSignal | undefined): Runner => async (_args, input) => {
		runs.push({ input, signal });
		const script = scripts[runs.length - 1];
		if (script === undefined) throw new Error(`no script for process ${runs.length}`);
		return script(bridge.state.handler!, signal);
	};
	const models = createModels();
	models.setProvider(claudeCodeProvider({ ...options, runner, bridge: bridge.factory }));
	return { models, bridge, runs, model: models.getModel("claude-code", "claude-haiku-4-5")! };
}

const lookup = { name: "lookup", description: "Finds an order.", parameters: Type.Object({ id: Type.String() }) };
const system = (toolsAdded: Context["tools"]): Message => ({ role: "system", content: "Be kind.", sections: {}, toolsAdded, timestamp: 0 }) as Message;
const user = (content: string): Message => ({ role: "user", content, timestamp: 0 });
const callsOf = (message: AssistantMessage) => message.content.filter((b): b is ToolCall => b.type === "toolCall");
const resultFor = (call: ToolCall, text: string): Message => ({
	role: "toolResult",
	toolCallId: call.id,
	toolName: call.name,
	content: [{ type: "text", text }],
	isError: false,
	timestamp: 0,
});
const textOf = (message: AssistantMessage) => message.content.map((b) => (b.type === "text" ? b.text : "")).join("");

/** Plays pi: answers every call after `piMs` until the session ends, and returns the last message. */
async function drive(h: ReturnType<typeof harness>, piMs: number) {
	const messages: Message[] = [system([lookup]), user("Find order 7")];
	for (;;) {
		const message = await h.models.complete(h.model, { messages });
		if (message.stopReason !== "toolUse") return message;
		await sleep(piMs);
		messages.push(message, ...callsOf(message).map((call) => resultFor(call, "shipped")));
	}
}

describe("claude-code/provider: timeoutMs and toolWaitMs", () => {
	it("default to five minutes a turn and an hour's wait on pi", () => {
		expect(DEFAULT_TURN_TIMEOUT_MS).toBe(300_000);
		expect(DEFAULT_TOOL_WAIT_MS).toBe(3_600_000);
	});

	it("must be positive integers of milliseconds a timer can keep", () => {
		for (const name of ["timeoutMs", "toolWaitMs"] as const) {
			for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 31]) {
				expect(() => claudeCodeProvider({ [name]: bad }), `${name} ${bad}`).toThrow(RangeError);
				expect(() => claudeCodeProvider({ [name]: bad }), `${name} ${bad}`).toThrow(`${name} must be a positive integer of milliseconds`);
			}
		}
		expect(() => claudeCodeProvider({ timeoutMs: 2 ** 31 - 1, toolWaitMs: 1 })).not.toThrow();
	});
});

describe("claude-code/provider: a held session's turn clock stops while its calls are with pi", () => {
	it("stops claude past timeoutMs of its own work, naming the limit", async () => {
		const h = harness([async (_handler, signal) => ((await work(5_000, signal)) === "aborted" ? KILLED : ok("late"))], { timeoutMs: 60 });
		const message = await drive(h, 0);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toBe(turnTimeoutMessage(60, true));
		expect(message.errorMessage).toContain("not counting the host's tools");
		expect(message.errorMessage).toContain("--turn-timeout");
		expect(h.runs[0]!.signal?.aborted).toBe(true);
		expect(h.bridge.state.closes).toBe(1);
	});

	it("doesn't count the time pi takes over a call", async () => {
		const h = harness(
			[
				async (handler, signal) => {
					await handler("lookup", { id: "7" });
					// A process its clock stopped would have died meanwhile.
					return signal?.aborted ? KILLED : ok("found it");
				},
			],
			{ timeoutMs: 80 },
		);
		// pi holds the call for several times timeoutMs, as a long test run would.
		const message = await drive(h, 400);
		expect(message.errorMessage).toBeUndefined();
		expect(textOf(message)).toBe("found it");
	});

	it("gives each turn the whole timeoutMs afresh", async () => {
		const h = harness(
			[
				async (handler, signal) => {
					for (let turn = 0; turn < 3; turn++) {
						if ((await work(60, signal)) === "aborted") return KILLED;
						await handler("lookup", { id: String(turn) });
					}
					return ok("three turns");
				},
			],
			{ timeoutMs: 150 },
		);
		// 180ms of claude's own work across the session, but never 150 in one turn.
		const message = await drive(h, 0);
		expect(message.errorMessage).toBeUndefined();
		expect(textOf(message)).toBe("three turns");
	});

	it("starts again once pi answers, and stops claude in a later turn", async () => {
		const h = harness(
			[
				async (handler, signal) => {
					await handler("lookup", { id: "7" });
					return (await work(5_000, signal)) === "aborted" ? KILLED : ok("late");
				},
			],
			{ timeoutMs: 80 },
		);
		const started = Date.now();
		const message = await drive(h, 200);
		expect(message.errorMessage).toBe(turnTimeoutMessage(80, true));
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it("keeps an answer that came as the clock fired", async () => {
		const h = harness([async () => ({ ...ok("just in time"), timedOut: true })], { timeoutMs: 60 });
		expect(textOf(await drive(h, 0))).toBe("just in time");
	});
});

describe("claude-code/provider: a held session pi stopped answering ends after toolWaitMs", () => {
	it("ends the session, and a late answer starts a fresh process on the whole transcript", async () => {
		const h = harness(
			[
				async (handler, signal) => {
					await handler("lookup", { id: "7" });
					return signal?.aborted ? KILLED : ok("first process");
				},
				async () => ok("fresh process"),
			],
			{ toolWaitMs: 60 },
		);
		const messages: Message[] = [system([lookup]), user("Find order 7")];
		const first = await h.models.complete(h.model, { messages });
		expect(first.stopReason).toBe("toolUse");

		await sleep(250);
		expect(h.runs[0]!.signal?.aborted).toBe(true);
		expect(h.bridge.state.closes).toBe(1);

		const call = callsOf(first)[0]!;
		const late = await h.models.complete(h.model, { messages: [...messages, first, resultFor(call, "shipped")] });
		expect(textOf(late)).toBe("fresh process");
		expect(h.runs).toHaveLength(2);
		expect(h.runs[1]!.input).toContain("Tool lookup returned: shipped");
	});
});

describe("claude-code/provider: a one-process request is bounded whole by timeoutMs", () => {
	it("names the limit when the runner's clock stopped claude", async () => {
		const models = createModels();
		models.setProvider(claudeCodeProvider({ runner: () => async () => ({ ...KILLED, timedOut: true }), timeoutMs: 120 }));
		const message = await models.complete(models.getModel("claude-code", "claude-haiku-4-5")!, { messages: [user("Say hi")] });
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toBe(turnTimeoutMessage(120, false));
		expect(message.errorMessage).toBe(
			"claude was stopped after 120ms without an answer (timeoutMs 120); the step ended unfinished, out of budget: raise timeoutMs (the CLI's --turn-timeout, or task.turnTimeoutMs in agentscript.config.json) to give it more",
		);
	});
});

/** A `claude` that reads stdin, then answers `result` after `ms`. */
function fakeClaude(ms: number, result: string): string {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-clock-claude-"));
	dirs.push(dir);
	const binary = join(dir, "claude");
	writeFileSync(
		binary,
		`#!${process.execPath}\nprocess.stdin.resume();\nprocess.stdin.on("end", () => setTimeout(() => process.stdout.write(${JSON.stringify(ok(result).stdout)}), ${ms}));\n`,
	);
	chmodSync(binary, 0o755);
	return binary;
}

describe("claude-code/provider: with a real process", () => {
	it("stops a one-process request at timeoutMs", async () => {
		const models = createModels();
		models.setProvider(claudeCodeProvider({ binary: fakeClaude(10_000, "never"), timeoutMs: 200 }));
		const started = Date.now();
		const message = await models.complete(models.getModel("claude-code", "claude-haiku-4-5")!, { messages: [user("Say hi")] });
		expect(message.errorMessage).toBe(turnTimeoutMessage(200, false));
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it("lets a held session outlive timeoutMs while pi has its call", async () => {
		const bridge = fakeBridge();
		const models = createModels();
		// The process takes 1000ms; only the 100ms or so before its call and the time after pi answers count.
		models.setProvider(claudeCodeProvider({ binary: fakeClaude(1_000, "outlived"), bridge: bridge.factory, timeoutMs: 600 }));
		const model = models.getModel("claude-code", "claude-haiku-4-5")!;
		const messages: Message[] = [system([lookup]), user("Find order 7")];
		const pending = models.complete(model, { messages });
		while (bridge.state.handler === undefined) await sleep(1);
		void bridge.state.handler("lookup", { id: "7" });
		const first = await pending;
		expect(first.stopReason).toBe("toolUse");
		await sleep(800);
		const last = await models.complete(model, { messages: [...messages, first, resultFor(callsOf(first)[0]!, "shipped")] });
		expect(last.errorMessage).toBeUndefined();
		expect(textOf(last)).toBe("outlived");
	});
});

describe("claude-code/provider: a step a limit ended is not retried", () => {
	// pi-ai retries errors by their text: "timeout", or a number holding "500", would match.
	it("pi-ai never classes either limit's message as retryable, whatever the numbers", () => {
		const failed = (errorMessage: string) => ({ stopReason: "error", errorMessage }) as AssistantMessage;
		expect(isRetryableAssistantError(failed("claude timed out (timeoutMs 1500)")), "the probe itself").toBe(true);
		for (const n of [1, 429, 500, 1500, 5030, 300_000]) {
			expect(isRetryableAssistantError(failed(turnTimeoutMessage(n, true))), `held ${n}`).toBe(false);
			expect(isRetryableAssistantError(failed(turnTimeoutMessage(n, false))), `one process ${n}`).toBe(false);
			expect(isRetryableAssistantError(failed(turnLimitMessage(n, n))), `turns ${n}`).toBe(false);
			expect(isRetryableAssistantError(failed(turnLimitMessage(n, undefined))), `turns ${n}, limit unknown`).toBe(false);
		}
	});
});
