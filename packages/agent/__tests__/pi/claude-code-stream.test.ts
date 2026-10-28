import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReasoningRequest, StreamDelta, StreamSink, ToolOffer } from "../../src/interpreter/index.js";
import { createClaudeCodeReasoningPort, spawnRunner, type ProcessResult, type Runner } from "../../src/claude-code/claude-code.js";
import type { BridgeHandler, ToolBridgeFactory } from "../../src/claude-code/index.js";

const TEXT_STEP: ReasoningRequest = { systemInstructions: "sys", prompt: "Say hello." };
const SCHEMA_STEP: ReasoningRequest = {
	systemInstructions: "sys",
	prompt: "Pick a category.",
	outputSchema: { type: "object", properties: { category: { type: "string" } }, required: ["category"] },
};

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const blockDelta = (delta: Record<string, unknown>) =>
	line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta } });
const textDelta = (text: string) => blockDelta({ type: "text_delta", text });
const resultLine = (fields: Record<string, unknown>) =>
	line({ type: "result", subtype: "success", is_error: false, num_turns: 1, ...fields });

/** Splits stdout into chunks that cut lines in the middle. */
function chunked(stdout: string, size = 7): string[] {
	const chunks: string[] = [];
	for (let i = 0; i < stdout.length; i += size) chunks.push(stdout.slice(i, i + size));
	return chunks;
}

/** A runner that reports `stdout` in chunks through `onStdout`, if given, then resolves with it whole. */
function streamingRunner(stdout: string, rest: Partial<ProcessResult> = {}, { report = true } = {}) {
	const calls: { args: readonly string[]; streamed: boolean }[] = [];
	const runner: Runner = async (args, _input, _env, onStdout) => {
		calls.push({ args, streamed: onStdout !== undefined });
		if (report) for (const chunk of chunked(stdout)) onStdout?.(chunk);
		return { code: 0, stdout, stderr: "", ...rest };
	};
	return { runner, calls };
}

function recordingSink() {
	const deltas: StreamDelta[] = [];
	const sink: StreamSink = { onDelta: (delta) => deltas.push(delta) };
	return { sink, deltas };
}

const ofType = (deltas: readonly StreamDelta[], type: StreamDelta["type"]) => deltas.filter((d) => d.type === type);

describe("a listening claude-code step streams Claude Code's text", () => {
	it("Scenario: A listening text step streams its text", async () => {
		const stdout =
			line({ type: "system", subtype: "init" }) +
			blockDelta({ type: "thinking_delta", thinking: "" }) +
			blockDelta({ type: "signature_delta", signature: "sig" }) +
			textDelta("Hel") +
			textDelta("lo") +
			resultLine({ result: "Hello" });
		const { runner } = streamingRunner(stdout);
		const { sink, deltas } = recordingSink();
		const outcome = await createClaudeCodeReasoningPort({ runner }).reason(TEXT_STEP, sink);
		expect(deltas).toEqual([
			{ type: "text_delta", delta: "Hel" },
			{ type: "text_delta", delta: "lo" },
		]);
		expect(ofType(deltas, "thinking_delta")).toEqual([]);
		expect(outcome).toEqual({ kind: "answered", text: "Hello" });
	});

	it("Scenario: A step with no listener keeps the json argv", async () => {
		const { runner, calls } = streamingRunner(JSON.stringify({ type: "result", subtype: "success", result: "Hello" }));
		const outcome = await createClaudeCodeReasoningPort({ runner }).reason(TEXT_STEP);
		expect(outcome).toEqual({ kind: "answered", text: "Hello" });
		const { args, streamed } = calls[0]!;
		expect(args[args.indexOf("--output-format") + 1]).toBe("json");
		expect(args).not.toContain("stream-json");
		expect(args).not.toContain("--verbose");
		expect(args).not.toContain("--include-partial-messages");
		expect(streamed).toBe(false);
	});

	it("Scenario: A listening step's argv swaps only the output format", async () => {
		const structured = resultLine({ structured_output: { category: "shipping" } });
		const quiet = streamingRunner(JSON.stringify({ type: "result", subtype: "success", structured_output: { category: "shipping" } }));
		const loud = streamingRunner(structured);
		await createClaudeCodeReasoningPort({ runner: quiet.runner }).reason(SCHEMA_STEP);
		await createClaudeCodeReasoningPort({ runner: loud.runner }).reason(SCHEMA_STEP, recordingSink().sink);
		const without = [...quiet.calls[0]!.args];
		const at = without.indexOf("--output-format") + 1;
		expect(without[at]).toBe("json");
		without.splice(at, 1, "stream-json", "--verbose", "--include-partial-messages");
		expect(loud.calls[0]!.args).toEqual(without);
		expect(loud.calls[0]!.args).toContain("--json-schema");
	});
});

describe("a streamed claude-code step settles from its result line", () => {
	it("Scenario: A structured step settles from the result line", async () => {
		const stdout =
			blockDelta({ type: "input_json_delta", partial_json: '{"categ' }) +
			blockDelta({ type: "input_json_delta", partial_json: 'ory":"shipping"}' }) +
			resultLine({ result: "", structured_output: { category: "shipping" } });
		const { runner } = streamingRunner(stdout);
		const { sink, deltas } = recordingSink();
		const outcome = await createClaudeCodeReasoningPort({ runner }).reason(SCHEMA_STEP, sink);
		expect(ofType(deltas, "text_delta")).toEqual([]);
		expect(outcome).toEqual({ kind: "answered", text: "", structured: { category: "shipping" } });
	});

	it("Scenario: A streamed max-turns result is cut short", async () => {
		const stdout = textDelta("half") + resultLine({ subtype: "error_max_turns", is_error: true, num_turns: 4, result: "half" });
		const { runner } = streamingRunner(stdout);
		const outcome = await createClaudeCodeReasoningPort({ runner }).reason(TEXT_STEP, recordingSink().sink);
		expect(outcome).toMatchObject({ kind: "cut-short", turns: 4 });
	});

	it("Scenario: A stream with no result line fails", async () => {
		const { runner } = streamingRunner(textDelta("Hel") + textDelta("lo"), { code: 1, stderr: "boom" });
		const outcome = await createClaudeCodeReasoningPort({ runner }).reason(TEXT_STEP, recordingSink().sink);
		expect(outcome.kind).toBe("failed");
		if (outcome.kind !== "failed") return;
		expect(outcome.category).toBe("unknown");
		expect(outcome.message).toContain("without a JSON result");
		expect(outcome.message).toContain("boom");
	});
});

const lookup: ToolOffer = {
	name: "lookup",
	description: "Look up an order.",
	inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
	action: "orders/lookup",
	bound: {},
};

/** Keeps the handler it was started with, as the tool tests' fake bridge does. */
function fakeBridge() {
	const state = { handler: undefined as BridgeHandler | undefined };
	const factory: ToolBridgeFactory = async (_tools, handler) => {
		state.handler = handler;
		return { mcpConfig: "/b/mcp.json", allowedTools: ["mcp__agentscript__lookup"], close: async () => {} };
	};
	return { factory, state };
}

describe("a listening claude-code tool step streams text and reports each call once", () => {
	it("Scenario: A listening tool step streams text and its call", async () => {
		const bridge = fakeBridge();
		const before =
			textDelta("Let me look.") +
			line({
				type: "stream_event",
				event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "mcp__agentscript__lookup", input: {} } },
			}) +
			blockDelta({ type: "input_json_delta", partial_json: '{"id":"A1"}' });
		const after = textDelta(" Done.") + resultLine({ result: "Let me look. Done.", num_turns: 2 });
		const argv: (readonly string[])[] = [];
		const runner: Runner = async (args, _input, _env, onStdout) => {
			argv.push(args);
			for (const chunk of chunked(before)) onStdout?.(chunk);
			await bridge.state.handler!("lookup", { id: "A1" });
			for (const chunk of chunked(after)) onStdout?.(chunk);
			return { code: 0, stdout: before + after, stderr: "" };
		};
		const host = async () => ({ ok: true as const, outputs: { status: "shipped" } });
		const { sink, deltas } = recordingSink();
		const port = createClaudeCodeReasoningPort({ tools: host, bridge: bridge.factory, runner });

		const outcome = await port.reason({ systemInstructions: "s", prompt: "p", tools: [lookup] }, sink);

		const seen = deltas.filter((d) => d.type === "text_delta" || d.type === "tool_call" || d.type === "tool_result");
		expect(seen.map((d) => d.type)).toEqual(["text_delta", "tool_call", "tool_result", "text_delta"]);
		expect(ofType(deltas, "tool_call")).toEqual([{ type: "tool_call", name: "lookup", inputs: { id: "A1" } }]);
		expect(ofType(deltas, "text_delta")).toEqual([
			{ type: "text_delta", delta: "Let me look." },
			{ type: "text_delta", delta: " Done." },
		]);
		expect(outcome).toMatchObject({ kind: "answered", text: "Let me look. Done." });
		expect(outcome.toolCalls).toHaveLength(1);
		expect(argv[0]).toContain("stream-json");
	});
});

describe("a runner may report stdout as it arrives", () => {
	it("Scenario: spawnRunner passes stdout on before exit", async () => {
		const binary = join(mkdtempSync(join(tmpdir(), "agentscript-fake-claude-")), "claude");
		writeFileSync(
			binary,
			`#!${process.execPath}\nprocess.stdout.write("first\\n");\nsetTimeout(() => { process.stdout.write("second\\n"); }, 300);\n`,
		);
		chmodSync(binary, 0o755);
		const received: { chunk: string; at: number }[] = [];
		const result = await spawnRunner(binary, 5000)([], "", process.env, (chunk) => {
			received.push({ chunk, at: Date.now() });
		});
		const exitedAt = Date.now();
		// The first line arrives on its own, well before the process writes the second and exits.
		expect(received[0]!.chunk).toBe("first\n");
		expect(exitedAt - received[0]!.at).toBeGreaterThanOrEqual(200);
		expect(received.map((r) => r.chunk).join("")).toBe("first\nsecond\n");
		expect(result).toMatchObject({ code: 0, stdout: "first\nsecond\n" });
	});

	it("Scenario: A runner that ignores onStdout still settles", async () => {
		const stdout = textDelta("Hel") + textDelta("lo") + resultLine({ result: "Hello" });
		const { runner } = streamingRunner(stdout, {}, { report: false });
		const { sink, deltas } = recordingSink();
		const outcome = await createClaudeCodeReasoningPort({ runner }).reason(TEXT_STEP, sink);
		expect(ofType(deltas, "text_delta")).toEqual([]);
		expect(outcome).toEqual({ kind: "answered", text: "Hello" });
	});
});

describe("a settled step's late stdout", () => {
	it("deltas a process reports after an abort never reach the sink", async () => {
		const controller = new AbortController();
		let late: ((chunk: string) => void) | undefined;
		const runner: Runner = (_args, _input, _env, onStdout) => {
			late = onStdout;
			onStdout?.(textDelta("before"));
			controller.abort();
			// Never settles: the port resolves on the abort, not on the process.
			return new Promise<ProcessResult>(() => {});
		};
		const { sink, deltas } = recordingSink();
		const outcome = await createClaudeCodeReasoningPort({ runner, signal: controller.signal }).reason(TEXT_STEP, sink);
		late?.(textDelta("after"));
		expect(outcome.kind).toBe("failed");
		expect(deltas).toEqual([{ type: "text_delta", delta: "before" }]);
	});
});
