import { describe, expect, it } from "vitest";
import { createModels, Type, type AssistantMessage, type Context, type Message, type ToolCall } from "@earendil-works/pi-ai";
import type { ProcessResult, Runner } from "../../src/claude-code/claude-code.js";
import { claudeCodeProvider } from "../../src/claude-code/claude-code-provider.js";
import type { BridgeHandler, BridgeReply, BridgeTool, ToolBridgeFactory } from "../../src/claude-code/tool-bridge.js";

const ok = (result: Record<string, unknown>): ProcessResult => ({
	code: 0,
	stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 }, ...result }),
	stderr: "",
});

/** A fake bridge: captures what it serves and its handler, and counts `close`. */
function fakeBridge() {
	const state = { starts: [] as (readonly BridgeTool[])[], handler: undefined as BridgeHandler | undefined, closes: 0 };
	const factory: ToolBridgeFactory = async (tools, handler) => {
		state.starts.push(tools);
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

/** A scripted runner: records each call, runs its script against the bridge's handler, then answers. */
type Script = (handler: BridgeHandler, signal: AbortSignal | undefined) => Promise<ProcessResult>;

function scriptedRunner(bridge: ReturnType<typeof fakeBridge>, script: Script) {
	const calls: { args: readonly string[]; input: string; signal: AbortSignal | undefined }[] = [];
	const runnerFor = (signal: AbortSignal | undefined): Runner => async (args, input) => {
		calls.push({ args, input, signal });
		return script(bridge.state.handler!, signal);
	};
	return { runnerFor, calls };
}

function harness(script: Script) {
	const bridge = fakeBridge();
	const runner = scriptedRunner(bridge, script);
	const models = createModels();
	models.setProvider(claudeCodeProvider({ runner: runner.runnerFor, bridge: bridge.factory }));
	return { models, bridge, runner, model: models.getModel("claude-code", "claude-haiku-4-5")! };
}

const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];
const user = (content: string): Message => ({ role: "user", content, timestamp: 0 });
const system = (toolsAdded: Context["tools"]): Message => ({ role: "system", content: "Be kind.", sections: {}, toolsAdded, timestamp: 0 }) as Message;

const lookup = { name: "lookup", description: "Finds an order.", parameters: Type.Object({ id: Type.String() }) };
const submitResult = { name: "submit_result", description: "Submit.", parameters: Type.Object({ ok: Type.Boolean() }) };

describe("With a bridge, a request offering tools runs a held claude session", () => {
	it("Scenario: A bridged request starts one session", async () => {
		const h = harness(async () => ok({ result: "done" }));
		const message = await h.models.complete(h.model, { messages: [system([lookup, submitResult]), user("Find order 7")] });

		expect(h.bridge.state.starts).toHaveLength(1);
		expect(h.bridge.state.starts[0]).toEqual([{ name: "lookup", description: "Finds an order.", inputSchema: lookup.parameters }]);
		expect(h.runner.calls).toHaveLength(1);
		const { args, input, signal } = h.runner.calls[0]!;
		expect(args).toContain("--mcp-config");
		expect(flag(args, "--max-turns")).toBe("16");
		expect(JSON.parse(flag(args, "--json-schema")!)).toEqual(JSON.parse(JSON.stringify(submitResult.parameters)));
		expect(args).not.toContain("--safe-mode");
		expect(input).toBe("Find order 7");
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(h.bridge.state.closes).toBe(1);
		expect(message.stopReason).toBe("stop");
		expect(message.content).toEqual([{ type: "text", text: "done" }]);
	});

	it("Scenario: Only submit_result is not bridged", async () => {
		const h = harness(async () => ok({ result: "{}", structured_output: { ok: true } }));
		const message = await h.models.complete(h.model, { messages: [system([submitResult]), user("Answer")] });

		expect(h.bridge.state.starts).toHaveLength(0);
		const { args } = h.runner.calls[0]!;
		expect(args).toContain("--safe-mode");
		expect(args).toContain("--json-schema");
		expect(args).not.toContain("--max-turns");
		expect(message.stopReason).toBe("toolUse");
		expect(message.content[0]).toMatchObject({ type: "toolCall", name: "submit_result", arguments: { ok: true } });
	});

	it("Scenario: An unservable name starts nothing", async () => {
		const h = harness(async () => ok({ result: "x" }));
		const spaced = { name: "has space", description: "", parameters: Type.Object({}) };
		const message = await h.models.complete(h.model, { messages: [system([spaced]), user("x")] });

		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("has space");
		expect(h.bridge.state.starts).toHaveLength(0);
		expect(h.runner.calls).toHaveLength(0);
	});
});

describe("Held calls become pi tool calls", () => {
	it("a call through the bridge is held and handed out as a toolCall with zero usage", async () => {
		let replied = false;
		const h = harness(async (handler) => {
			await handler("lookup", { id: "7" });
			replied = true;
			return ok({ result: "found it" });
		});
		const message = await h.models.complete(h.model, { messages: [system([lookup]), user("Find order 7")] });

		expect(message.stopReason).toBe("toolUse");
		expect(message.content).toHaveLength(1);
		expect(message.content[0]).toMatchObject({ type: "toolCall", name: "lookup", arguments: { id: "7" } });
		expect((message.content[0] as { id: string }).id).toMatch(/^claude-code-[0-9a-f-]{36}$/);
		expect(message.usage.totalTokens).toBe(0);
		expect(replied).toBe(false);
		expect(h.bridge.state.closes).toBe(0);
	});
});

const callsOf = (message: AssistantMessage) => message.content.filter((b): b is ToolCall => b.type === "toolCall");
const resultFor = (call: ToolCall, text: string, isError = false): Message => ({
	role: "toolResult",
	toolCallId: call.id,
	toolName: call.name,
	content: [{ type: "text", text }],
	isError,
	timestamp: 0,
});

describe("Held calls become pi tool calls and their results go back to claude", () => {
	it("Scenario: A held call is handed out, answered and continued", async () => {
		const replies: BridgeReply[] = [];
		const h = harness(async (handler) => {
			replies.push(await handler("lookup", { id: "7" }));
			return ok({ result: "found it" });
		});
		const messages = [system([lookup]), user("Find order 7")];
		const first = await h.models.complete(h.model, { messages });

		expect(first.stopReason).toBe("toolUse");
		const calls = callsOf(first);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ name: "lookup", arguments: { id: "7" } });

		const second = await h.models.complete(h.model, { messages: [...messages, first, resultFor(calls[0]!, '{"status":"shipped"}')] });

		expect(replies).toEqual([{ ok: true, text: '{"status":"shipped"}' }]);
		expect(second.stopReason).toBe("stop");
		expect(second.content).toEqual([{ type: "text", text: "found it" }]);
		expect(h.runner.calls).toHaveLength(1);
		expect(h.bridge.state.closes).toBe(1);
	});

	it("Scenario: Calls made together arrive in one message", async () => {
		const h = harness(async (handler) => {
			await Promise.all([handler("a", {}), handler("b", {})]);
			return ok({ result: "both" });
		});
		const a = { name: "a", description: "A.", parameters: Type.Object({}) };
		const b = { name: "b", description: "B.", parameters: Type.Object({}) };
		const message = await h.models.complete(h.model, { messages: [system([a, b]), user("Call both")] });

		expect(message.stopReason).toBe("toolUse");
		const calls = callsOf(message);
		expect(calls.map((c) => c.name)).toEqual(["a", "b"]);
		expect(calls[0]!.id).not.toBe(calls[1]!.id);
	});

	it("Scenario: An error result reaches claude as an error", async () => {
		const replies: BridgeReply[] = [];
		const h = harness(async (handler) => {
			replies.push(await handler("lookup", { id: "9" }));
			return ok({ result: "sorry" });
		});
		const messages = [system([lookup]), user("Find order 9")];
		const first = await h.models.complete(h.model, { messages });
		await h.models.complete(h.model, { messages: [...messages, first, resultFor(callsOf(first)[0]!, "no such order", true)] });

		expect(replies).toEqual([{ ok: false, text: "no such order" }]);
	});

	it("Scenario: A structured answer ends as a submit_result call", async () => {
		const h = harness(async (handler) => {
			await handler("lookup", { id: "7" });
			return ok({ result: "{}", structured_output: { ok: true } });
		});
		const messages = [system([lookup, submitResult]), user("Find order 7")];
		const first = await h.models.complete(h.model, { messages });
		const second = await h.models.complete(h.model, { messages: [...messages, first, resultFor(callsOf(first)[0]!, "shipped")] });

		expect(second.stopReason).toBe("toolUse");
		const calls = callsOf(second);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ name: "submit_result", arguments: { ok: true } });
	});
});

describe("Results that name no live session start a fresh process", () => {
	it("Scenario: A resumed transcript goes to a fresh process", async () => {
		const h = harness(async () => ok({ result: "shipped" }));
		const call: ToolCall = { type: "toolCall", id: "claude-code-old", name: "lookup", arguments: { id: "7" } };
		const prior: AssistantMessage = {
			role: "assistant",
			content: [call],
			api: h.model.api,
			provider: h.model.provider,
			model: h.model.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "toolUse",
			timestamp: 0,
		};
		const message = await h.models.complete(h.model, {
			messages: [system([lookup]), user("Find order 7"), prior, resultFor(call, '{"status":"shipped"}')],
		});

		expect(h.runner.calls).toHaveLength(1);
		expect(h.runner.calls[0]!.input).toContain("[called lookup with");
		expect(h.runner.calls[0]!.input).toContain("Tool lookup returned:");
		expect(message.content).toEqual([{ type: "text", text: "shipped" }]);
	});
});

describe("An aborted request ends its session", () => {
	it("Scenario: Aborting kills the held process", async () => {
		const h = harness(
			(_handler, signal) =>
				new Promise<ProcessResult>((resolve) =>
					signal!.addEventListener("abort", () => resolve({ code: null, stdout: "", stderr: "killed" }), { once: true }),
				),
		);
		const controller = new AbortController();
		const pending = h.models.complete(h.model, { messages: [system([lookup]), user("Find order 7")] }, { signal: controller.signal });
		await new Promise((resolve) => setTimeout(resolve, 10));
		controller.abort();
		const message = await pending;

		expect(message.stopReason).toBe("aborted");
		expect(h.runner.calls).toHaveLength(1);
		expect(h.runner.calls[0]!.signal?.aborted).toBe(true);
		expect(h.bridge.state.closes).toBe(1);
	});
});
