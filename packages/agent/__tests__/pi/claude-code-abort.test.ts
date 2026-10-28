import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionResult, ReasoningRequest, ToolOffer } from "../../src/interpreter/index.js";
import {
	createClaudeCodeReasoningPort,
	type BridgeHandler,
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
		properties: { id: { type: "string" } },
		required: ["id"],
		additionalProperties: false,
	},
	action: "orders/lookup",
	bound: {},
};

const toolRequest: ReasoningRequest = { systemInstructions: "s", prompt: "p", tools: [lookup] };

/** Records how often it was started, the handler it was given, and when `close` ran. */
function fakeBridge() {
	const state = { started: 0, handler: undefined as BridgeHandler | undefined, closed: 0 };
	const factory: ToolBridgeFactory = async (_tools, handler) => {
		state.started += 1;
		state.handler = handler;
		return {
			mcpConfig: "/b/mcp.json",
			allowedTools: ["mcp__agentscript__lookup"],
			close: async () => {
				state.closed += 1;
			},
		};
	};
	return { factory, state };
}

/** A runner that records its calls and never resolves, as a `claude` that never finishes. */
function hangingRunner() {
	const state = { calls: 0 };
	const runner: Runner = () => {
		state.calls += 1;
		return new Promise<ProcessResult>(() => {});
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

/** Starts a tool step on a hanging runner and aborts once the bridge is up. */
async function abortedToolStep() {
	const controller = new AbortController();
	const bridge = fakeBridge();
	const { runner } = hangingRunner();
	const host = fakeHost();
	const port = createClaudeCodeReasoningPort({ tools: host.host, bridge: bridge.factory, runner, signal: controller.signal });
	const reasoning = port.reason(toolRequest);
	while (bridge.state.handler === undefined) await new Promise((resolve) => setTimeout(resolve, 1));
	controller.abort();
	const outcome = await reasoning;
	return { outcome, bridge, host };
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

let dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
	dirs = [];
});

describe("the claude-code port's signal", () => {
	it("Scenario: An aborted signal starts nothing", async () => {
		const controller = new AbortController();
		controller.abort();
		const bridge = fakeBridge();
		const { runner, state } = hangingRunner();
		const port = createClaudeCodeReasoningPort({
			tools: fakeHost().host,
			bridge: bridge.factory,
			runner,
			signal: controller.signal,
		});

		const outcome = await port.reason(toolRequest);

		expect(outcome.kind).toBe("failed");
		expect(outcome.kind === "failed" ? outcome.category : undefined).toBe("unrecognised");
		expect(outcome.kind === "failed" ? outcome.message : "").toMatch(/aborted/);
		expect(state.calls).toBe(0);
		expect(bridge.state.started).toBe(0);
	});

	it("Scenario: Aborting a text step kills claude", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agentscript-abort-"));
		dirs.push(dir);
		const pidFile = join(dir, "pid");
		const binary = join(dir, "claude");
		await writeFile(binary, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 30\n`);
		await chmod(binary, 0o755);
		const controller = new AbortController();
		const port = createClaudeCodeReasoningPort({ binary, signal: controller.signal });

		setTimeout(() => controller.abort(), 100);
		const started = Date.now();
		const outcome = await port.reason({ systemInstructions: "s", prompt: "p" });

		expect(Date.now() - started).toBeLessThan(2_000);
		expect(outcome.kind).toBe("failed");
		expect(outcome.kind === "failed" ? outcome.message : "").toMatch(/aborted/);
		const pid = Number((await readFile(pidFile, "utf8")).trim());
		expect(pid).toBeGreaterThan(0);
		const deadline = Date.now() + 1_000;
		while (isAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
		expect(isAlive(pid)).toBe(false);
	}, 5_000);

	it("Scenario: Aborting a tool step closes the bridge", async () => {
		const { outcome, bridge } = await abortedToolStep();

		expect(outcome.kind).toBe("failed");
		expect(outcome.kind === "failed" ? outcome.message : "").toMatch(/aborted/);
		expect(bridge.state.closed).toBe(1);
	});

	it("Scenario: A call after the abort never reaches the host", async () => {
		const { bridge, host } = await abortedToolStep();

		const reply = await bridge.state.handler!("lookup", { id: "A1" });

		expect(reply.ok).toBe(false);
		expect(reply.text).toMatch(/aborted/);
		expect(host.calls).toEqual([]);
	});
});
