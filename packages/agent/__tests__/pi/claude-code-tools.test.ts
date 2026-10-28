import { describe, expect, it } from "vitest";
import { createModels, Type, type Message } from "@earendil-works/pi-ai";
import type { ActionResult, ReasoningRequest, StreamDelta, ToolOffer } from "../../src/interpreter/index.js";
import {
	claudeCodeProvider,
	createClaudeCodeReasoningPort,
	type BridgeHandler,
	type BridgeReply,
	type BridgeTool,
	type ProcessResult,
	type Runner,
	type ToolBridgeFactory,
} from "../../src/claude-code/index.js";
import type { PiToolCall, PiToolHost } from "../../src/pi/index.js";

const lookup: ToolOffer = {
	name: "lookup",
	description: "Look up an order.",
	inputSchema: {
		type: "object",
		properties: { id: { type: "string" }, region: { type: "string" } },
		required: ["id"],
		additionalProperties: false,
	},
	action: "orders/lookup",
	bound: {},
};

function request(tools: readonly ToolOffer[] = [lookup]): ReasoningRequest {
	return { systemInstructions: "s", prompt: "p", tools };
}

/** Records the tools and handler it was started with, and when `close` ran. */
function fakeBridge(events: string[] = []) {
	const state = { tools: [] as BridgeTool[][], handler: undefined as BridgeHandler | undefined, closed: 0 };
	const factory: ToolBridgeFactory = async (tools, handler) => {
		state.tools.push([...tools]);
		state.handler = handler;
		events.push("bridge started");
		return {
			mcpConfig: "/b/mcp.json",
			allowedTools: ["mcp__agentscript__lookup"],
			close: async () => {
				state.closed += 1;
				events.push("bridge closed");
			},
		};
	};
	return { factory, state };
}

const success: ProcessResult = { code: 0, stdout: JSON.stringify({ type: "result", subtype: "success", result: "done" }), stderr: "" };
const failure: ProcessResult = {
	code: 1,
	stdout: JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "boom" }),
	stderr: "",
};

/** Records argv, makes `calls` through the bridge's handler as Claude Code would, then answers. */
function fakeRunner(
	bridge: ReturnType<typeof fakeBridge>,
	options: { calls?: [string, Record<string, unknown>][]; result?: ProcessResult; events?: string[] } = {},
) {
	const state = { argv: [] as (readonly string[])[], replies: [] as BridgeReply[] };
	const runner: Runner = async (args) => {
		state.argv.push(args);
		for (const [name, input] of options.calls ?? []) state.replies.push(await bridge.state.handler!(name, input));
		options.events?.push("runner resolved");
		return options.result ?? success;
	};
	return { runner, state };
}

function fakeHost(result: ActionResult = { ok: true, outputs: { status: "shipped" } }) {
	const calls: PiToolCall[] = [];
	const host: PiToolHost = async (call) => {
		calls.push(call);
		return result;
	};
	return { host, calls };
}

describe("the claude-code port's tool path", () => {
	it("Scenario: tools need a bridge", () => {
		const { host } = fakeHost();
		expect(() => createClaudeCodeReasoningPort({ tools: host })).toThrow(TypeError);
		expect(() => createClaudeCodeReasoningPort({ tools: host })).toThrow(/mcpBridge/);
	});

	it("Scenario: A tool step passes the bridge's server and a turn bound", async () => {
		const events: string[] = [];
		const bridge = fakeBridge(events);
		const { runner, state } = fakeRunner(bridge, { events });
		const port = createClaudeCodeReasoningPort({ tools: fakeHost().host, bridge: bridge.factory, runner });

		const outcome = await port.reason(request());

		expect(outcome.kind).toBe("answered");
		const argv = state.argv[0]!;
		expect(argv[argv.indexOf("--mcp-config") + 1]).toBe("/b/mcp.json");
		expect(argv[argv.indexOf("--allowedTools") + 1]).toBe("mcp__agentscript__lookup");
		expect(argv[argv.indexOf("--max-turns") + 1]).toBe("16");
		expect(argv).not.toContain("--safe-mode");
		expect(bridge.state.tools).toEqual([
			[{ name: "lookup", description: lookup.description, inputSchema: lookup.inputSchema }],
		]);
		expect(events).toEqual(["bridge started", "runner resolved", "bridge closed"]);
	});

	it("Scenario: The bridge is closed when the step fails", async () => {
		const bridge = fakeBridge();
		const { runner } = fakeRunner(bridge, { result: failure });
		const port = createClaudeCodeReasoningPort({ tools: fakeHost().host, bridge: bridge.factory, runner });

		const outcome = await port.reason(request());

		expect(outcome.kind).toBe("failed");
		expect(outcome.kind === "failed" ? outcome.message : "").toContain("boom");
		expect(bridge.state.closed).toBe(1);
	});

	it("Scenario: A bridge that will not start fails the step", async () => {
		let ran = false;
		const runner: Runner = async () => {
			ran = true;
			return success;
		};
		const bridge: ToolBridgeFactory = async () => {
			throw new Error("no port");
		};
		const port = createClaudeCodeReasoningPort({ tools: fakeHost().host, bridge, runner });

		const outcome = await port.reason(request());

		expect(outcome).toMatchObject({ kind: "failed", category: "unknown" });
		expect(outcome.kind === "failed" ? outcome.message : "").toContain("could not start the tool bridge: no port");
		expect(ran).toBe(false);
	});

	it("Scenario: An unservable tool name is refused before spawning", async () => {
		const bridge = fakeBridge();
		const { runner, state } = fakeRunner(bridge);
		const port = createClaudeCodeReasoningPort({ tools: fakeHost().host, bridge: bridge.factory, runner });

		const outcome = await port.reason(request([{ ...lookup, name: "has space" }]));

		expect(outcome).toMatchObject({ kind: "failed", category: "invalid_request" });
		expect(outcome.kind === "failed" ? outcome.message : "").toContain("has space");
		expect(bridge.state.tools).toEqual([]);
		expect(state.argv).toEqual([]);
	});

	it("Scenario: A call runs on the host with bound inputs winning", async () => {
		const bridge = fakeBridge();
		const { runner, state } = fakeRunner(bridge, { calls: [["lookup", { id: "7", region: "us" }]] });
		const { host, calls } = fakeHost();
		const port = createClaudeCodeReasoningPort({ tools: host, bridge: bridge.factory, runner });

		const outcome = await port.reason(request([{ ...lookup, bound: { region: "eu" } }]));

		expect(calls).toEqual([{ name: "lookup", tool: "orders/lookup", inputs: { id: "7", region: "eu" } }]);
		expect(state.replies).toEqual([{ ok: true, text: JSON.stringify({ status: "shipped" }) }]);
		expect(outcome).toEqual({
			kind: "answered",
			text: "done",
			toolCalls: [{ name: "lookup", inputs: { id: "7", region: "eu" }, ok: true, outputs: { status: "shipped" } }],
		});
	});

	it("Scenario: Bad arguments never reach the host", async () => {
		const bridge = fakeBridge();
		const { runner, state } = fakeRunner(bridge, { calls: [["lookup", { region: "us" }]] });
		const { host, calls } = fakeHost();
		const port = createClaudeCodeReasoningPort({ tools: host, bridge: bridge.factory, runner });

		const outcome = await port.reason(request());

		expect(state.replies).toHaveLength(1);
		expect(state.replies[0]!.ok).toBe(false);
		expect(state.replies[0]!.text).toContain("missing required input");
		expect(calls).toEqual([]);
		expect(outcome.kind === "answered" ? outcome.toolCalls : undefined).toEqual([
			{ name: "lookup", inputs: { region: "us" }, ok: false, outputs: {} },
		]);
	});

	it("Scenario: A listening run sees the bridge's calls", async () => {
		const bridge = fakeBridge();
		const { runner } = fakeRunner(bridge, { calls: [["lookup", { id: "7" }]] });
		const port = createClaudeCodeReasoningPort({ tools: fakeHost().host, bridge: bridge.factory, runner });
		const deltas: StreamDelta[] = [];

		await port.reason(request([{ ...lookup, bound: { region: "eu" } }]), { onDelta: (delta) => deltas.push(delta) });

		expect(deltas).toEqual([
			{ type: "tool_call", name: "lookup", inputs: { id: "7", region: "eu" } },
			{ type: "tool_result", name: "lookup", ok: true, outputs: { status: "shipped" } },
		]);
	});

	it("an unoffered name is refused and not recorded", async () => {
		const bridge = fakeBridge();
		const { runner, state } = fakeRunner(bridge, { calls: [["other", {}]] });
		const { host, calls } = fakeHost();
		const port = createClaudeCodeReasoningPort({ tools: host, bridge: bridge.factory, runner });

		const outcome = await port.reason(request());

		expect(state.replies[0]!.ok).toBe(false);
		expect(calls).toEqual([]);
		expect(outcome.kind === "answered" ? outcome.toolCalls : undefined).toEqual([]);
	});
});

describe("A tool step's environment also drops CLAUDE_CODE_SAFE_MODE", () => {
	it("Scenario: The port and the provider spawn tool steps with it", async () => {
		const saved = process.env.CLAUDE_CODE_SAFE_MODE;
		process.env.CLAUDE_CODE_SAFE_MODE = "1";
		try {
			const envs: NodeJS.ProcessEnv[] = [];
			const capturing: Runner = async (_args, _input, env) => {
				envs.push(env);
				return success;
			};

			const port = createClaudeCodeReasoningPort({ tools: fakeHost().host, bridge: fakeBridge().factory, runner: capturing });
			await port.reason(request());
			expect(envs[0]).not.toHaveProperty("CLAUDE_CODE_SAFE_MODE");

			const models = createModels();
			models.setProvider(claudeCodeProvider({ runner: () => capturing, bridge: fakeBridge().factory }));
			const lookupTool = { name: "lookup", description: "Finds an order.", parameters: Type.Object({ id: Type.String() }) };
			const message = await models.complete(models.getModel("claude-code", "claude-haiku-4-5")!, {
				messages: [
					{ role: "system", content: "Be kind.", sections: {}, toolsAdded: [lookupTool], timestamp: 0 } as Message,
					{ role: "user", content: "Find order 7", timestamp: 0 },
				],
			});
			expect(message.stopReason).toBe("stop");
			expect(envs[1]).not.toHaveProperty("CLAUDE_CODE_SAFE_MODE");

			await createClaudeCodeReasoningPort({ runner: capturing }).reason({ systemInstructions: "s", prompt: "p" });
			expect(envs[2]!.CLAUDE_CODE_SAFE_MODE).toBe("1");
		} finally {
			if (saved === undefined) delete process.env.CLAUDE_CODE_SAFE_MODE;
			else process.env.CLAUDE_CODE_SAFE_MODE = saved;
		}
	});
});
