import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, streamRun, type RunEvent } from "../../src/interpreter/index.js";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	type AssistantMessage,
	type Models,
} from "@earendil-works/pi-ai";
import { createPiReasoningPort, RESULT_TOOL, type PiToolHost } from "../../src/pi/port.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRIAGE = readFileSync(join(PKG_DIR, "examples", "triage.agent"), "utf8");

const TEXT_ONLY = `config:
    agent_name: "echo"

subagent say:
    description: "Say something"

    reasoning:
        instructions: ->
            | Say hello.
`;

/** One subagent offering `read`, whose output `content` is set on the variable. */
const READ_SCRIPT = `config:
    agent_name: "reader"

variables:
    content: mutable string = ""

subagent act:
    description: "Act"

    actions:
        read_file:
            description: "Read a file"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"

    reasoning:
        instructions: ->
            | Read the file.
        actions:
            read: @actions.read_file
                with path = ...
                set @variables.content = @outputs.content
`;

/**
 * A faux-backed collection that counts its `complete()` and `stream()` calls.
 * The faux provider streams each reply in chunks of one token, four characters,
 * so `Hello there.` always arrives as three deltas.
 */
function harness() {
	const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
	const real = createModels();
	real.setProvider(faux.provider);
	const calls = { complete: 0, stream: 0 };
	const models = {
		complete: (model, context, options) => {
			calls.complete += 1;
			return real.complete(model, context, options);
		},
		stream: (model, context, options) => {
			calls.stream += 1;
			return real.stream(model, context, options);
		},
	} as Pick<Models, "complete" | "stream"> as Models;
	return { faux, models, model: faux.getModel(), calls };
}

async function collect(stream: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
	const events: RunEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

const triageReplies = (): AssistantMessage[] => [
	fauxAssistantMessage(
		[fauxText("Filing it."), fauxToolCall(RESULT_TOOL, { severity: "medium", summary: "Crashes outside git." })],
		{ stopReason: "toolUse" },
	),
];

describe("pi/port: A streamed request forwards text and thinking deltas", () => {
	it("Scenario: Deltas concatenate to the step's text", async () => {
		const h = harness();
		h.faux.setResponses([fauxAssistantMessage([fauxText("Hello there.")])]);

		const stream = streamRun(TEXT_ONLY, { port: createPiReasoningPort(h) });
		const events = await collect(stream);
		const result = await stream.result;

		const deltas = events.filter((e) => e.type === "text_delta" && e.step === 0);
		expect(deltas).toHaveLength(3);
		const joined = deltas.map((e) => (e.type === "text_delta" ? e.delta : "")).join("");
		const outcome = result.steps[0]!.outcome;
		expect(outcome.kind).toBe("answered");
		expect(joined).toBe(outcome.kind === "answered" ? outcome.text : undefined);
		expect(joined).toBe("Hello there.");
	});

	it("Scenario: Streamed and unstreamed runs agree", async () => {
		const plain = harness();
		plain.faux.setResponses(triageReplies());
		const unstreamed = await run(TRIAGE, { port: createPiReasoningPort(plain) });

		const streamed = harness();
		streamed.faux.setResponses(triageReplies());
		const stream = streamRun(TRIAGE, { port: createPiReasoningPort(streamed) });
		await collect(stream);

		expect(unstreamed.kind).toBe("completed");
		expect(streamed.calls).toEqual({ complete: 0, stream: 1 });
		expect(await stream.result).toEqual(unstreamed);
	});

	it("Scenario: An unstreamed step never calls stream", async () => {
		const h = harness();
		h.faux.setResponses([fauxAssistantMessage([fauxText("Hello there.")])]);

		const result = await run(TEXT_ONLY, { port: createPiReasoningPort(h) });

		expect(result.kind).toBe("completed");
		expect(h.calls.stream).toBe(0);
		expect(h.calls.complete).toBe(1);
	});
});

describe("pi/port: The tool loop reports each call and its result", () => {
	it("Scenario: A tool call is reported around its execution", async () => {
		const h = harness();
		const order: string[] = [];
		const host: PiToolHost = async () => {
			order.push("host");
			return { ok: true, outputs: { content: "hi" } };
		};
		h.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "a.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Read it.")]),
		]);

		const stream = streamRun(READ_SCRIPT, {
			port: createPiReasoningPort({ ...h, tools: host }),
			onEvent: (event) => {
				if (event.type === "tool_call" || event.type === "tool_result") order.push(event.type);
			},
		});
		const events = await collect(stream);
		const result = await stream.result;

		expect(result.kind).toBe("completed");
		expect(order).toEqual(["tool_call", "host", "tool_result"]);
		const types = events.map((e) => e.type).filter((t) => t !== "text_delta" && t !== "thinking_delta");
		expect(types).toEqual(["step_start", "tool_call", "tool_result", "step_end", "run_end"]);
		expect(events.find((e) => e.type === "tool_call")).toEqual({
			type: "tool_call",
			name: "read",
			inputs: { path: "a.txt" },
			step: 0,
			subagent: "act",
		});
		expect(events.find((e) => e.type === "tool_result")).toEqual({
			type: "tool_result",
			name: "read",
			ok: true,
			outputs: { content: "hi" },
			step: 0,
			subagent: "act",
		});
	});
});
