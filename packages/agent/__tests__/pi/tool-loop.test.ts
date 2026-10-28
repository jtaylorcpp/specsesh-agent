import { describe, expect, it } from "vitest";
import { run, type ActionResult, type ReasoningRequest, type ToolOffer } from "../../src/interpreter/index.js";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	type Api,
	type Context,
	type Model,
	type Models,
	type ToolResultMessage,
} from "@earendil-works/pi-ai";
import { createPiReasoningPort, forceTool, type PiToolCall, type PiToolHost } from "../../src/pi/port.js";

/**
 * A faux-backed collection that records a copy of every context and the options
 * it is sent. `api` dresses the port's model as another wire API, so that
 * `forceTool` has something to force; the faux model still answers.
 */
function harness(api?: Api) {
	const faux = fauxProvider();
	const real = createModels();
	real.setProvider(faux.provider);
	const sent: Context[] = [];
	const options: (Record<string, unknown> | undefined)[] = [];
	const models = {
		complete: (_model, context, opts) => {
			sent.push(structuredClone(context));
			options.push(opts as Record<string, unknown> | undefined);
			return real.complete(faux.getModel(), context, opts as never);
		},
	} as Pick<Models, "complete"> as Models;
	const model: Model<Api> = api === undefined ? faux.getModel() : { ...faux.getModel(), api };
	return { faux, models, model, sent, options };
}

/** A host that records every call and answers each with `answer`. */
function recordingHost(answer: (call: PiToolCall) => ActionResult) {
	const calls: PiToolCall[] = [];
	const host: PiToolHost = async (call) => {
		calls.push(call);
		return answer(call);
	};
	return { host, calls };
}

const offer = (name: string, action: string, properties: Record<string, unknown> = { path: { type: "string" } }): ToolOffer => ({
	name,
	description: `The ${name} tool`,
	inputSchema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
	action,
	bound: {},
});

const request = (...tools: ToolOffer[]): ReasoningRequest => ({ systemInstructions: "You act.", prompt: "Do it.", tools });

const toolResults = (context: Context): ToolResultMessage[] =>
	context.messages.filter((message): message is ToolResultMessage => message.role === "toolResult");

const textOf = (message: ToolResultMessage): string =>
	message.content.map((block) => (block.type === "text" ? block.text : "")).join("");

const toolUse = (...calls: ReturnType<typeof fauxToolCall>[]) => fauxAssistantMessage(calls, { stopReason: "toolUse" });

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

describe("pi/port: A port given a tool host runs offered tools in a loop", () => {
	it("Scenario: A tool call runs on the host and its result reaches the model", async () => {
		const h = harness();
		const { host, calls } = recordingHost(() => ({ ok: true, outputs: { content: "hi" } }));
		h.faux.setResponses([
			toolUse(fauxToolCall("read", { path: "a.txt" }, { id: "call-1" })),
			fauxAssistantMessage([fauxText("Done.")]),
		]);

		const outcome = await createPiReasoningPort({ ...h, tools: host }).reason(request(offer("read", "read_file")));

		expect(calls).toEqual([{ name: "read", tool: "read_file", inputs: { path: "a.txt" } }]);
		expect(h.sent).toHaveLength(2);
		expect(h.sent[0]!.tools?.map((tool) => tool.name)).toEqual(["read"]);
		const results = toolResults(h.sent[1]!);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ toolCallId: "call-1", toolName: "read", isError: false });
		expect(textOf(results[0]!)).toBe('{"content":"hi"}');
		expect(outcome).toMatchObject({ kind: "answered", text: "Done." });
	});

	it("Scenario: A step's tool calls are recorded in call order", async () => {
		const h = harness();
		const { host } = recordingHost(
			(call): ActionResult =>
				call.name === "read" ? { ok: true, outputs: { content: "hi" } } : { ok: true, outputs: { saved: true } },
		);
		h.faux.setResponses([
			toolUse(fauxToolCall("read", { path: "a.txt" })),
			toolUse(fauxToolCall("note", { text: "seen" })),
			fauxAssistantMessage([fauxText("Done.")]),
		]);

		const outcome = await createPiReasoningPort({ ...h, tools: host }).reason(
			request(offer("read", "read_file"), offer("note", "edit_file", { text: { type: "string" } })),
		);

		expect(outcome.kind).toBe("answered");
		expect(outcome.kind === "answered" ? outcome.toolCalls : undefined).toEqual([
			{ name: "read", inputs: { path: "a.txt" }, ok: true, outputs: { content: "hi" } },
			{ name: "note", inputs: { text: "seen" }, ok: true, outputs: { saved: true } },
		]);
	});

	it("Scenario: A set on a reasoning action applies from the loop", async () => {
		const h = harness();
		const { host, calls } = recordingHost(() => ({ ok: true, outputs: { content: "hi" } }));
		h.faux.setResponses([toolUse(fauxToolCall("read", { path: "a.txt" })), fauxAssistantMessage([fauxText("Read it.")])]);

		const result = await run(READ_SCRIPT, { port: createPiReasoningPort({ ...h, tools: host }) });

		expect(result.kind).toBe("completed");
		expect(result.variables.content).toBe("hi");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ name: "read", tool: "read_file" });
	});

	it("Scenario: A request with tools and no tool host is still refused", async () => {
		const h = harness();
		h.faux.setResponses([fauxAssistantMessage([fauxText("never sent")])]);

		const outcome = await createPiReasoningPort(h).reason(request(offer("read", "read_file")));

		expect(outcome).toMatchObject({ kind: "failed", category: "invalid_request" });
		expect(h.sent).toHaveLength(0);
	});
});

describe("pi/port: A failed or unknown call is answered to the model as an error", () => {
	it("Scenario: A host failure is fed back and the loop goes on", async () => {
		const h = harness();
		const host: PiToolHost = () => {
			throw new Error("disk full");
		};
		h.faux.setResponses([toolUse(fauxToolCall("read", { path: "a.txt" })), fauxAssistantMessage([fauxText("Sorry.")])]);

		const outcome = await createPiReasoningPort({ ...h, tools: host }).reason(request(offer("read", "read_file")));

		const results = toolResults(h.sent[1]!);
		expect(results).toHaveLength(1);
		expect(results[0]!.isError).toBe(true);
		expect(textOf(results[0]!)).toContain("disk full");
		expect(outcome.kind).toBe("answered");
		expect(outcome.kind === "answered" ? outcome.toolCalls : undefined).toEqual([
			{ name: "read", inputs: { path: "a.txt" }, ok: false, outputs: {} },
		]);
	});

	it("Scenario: An unoffered tool name is not recorded", async () => {
		const h = harness();
		const { host, calls } = recordingHost(() => ({ ok: true, outputs: { content: "hi" } }));
		h.faux.setResponses([toolUse(fauxToolCall("delete", { path: "a.txt" })), fauxAssistantMessage([fauxText("Fine.")])]);

		const outcome = await createPiReasoningPort({ ...h, tools: host }).reason(request(offer("read", "read_file")));

		const results = toolResults(h.sent[1]!);
		expect(results).toHaveLength(1);
		expect(results[0]!.isError).toBe(true);
		expect(textOf(results[0]!)).toBe('no tool named "delete" is offered on this step');
		expect(calls).toHaveLength(0);
		expect(outcome.kind).toBe("answered");
		expect(outcome.kind === "answered" ? outcome.toolCalls : undefined).toEqual([]);

		// The same through run(): the unoffered call does not fail the step.
		const r = harness();
		r.faux.setResponses([toolUse(fauxToolCall("delete", { path: "a.txt" })), fauxAssistantMessage([fauxText("Fine.")])]);
		const result = await run(READ_SCRIPT, { port: createPiReasoningPort({ ...r, tools: host }) });
		expect(result.kind).toBe("completed");
		expect(calls).toHaveLength(0);
	});
});

describe("pi/port: A call is checked against its offer and its bound inputs merged", () => {
	it("Scenario: Bound inputs override the model's arguments", async () => {
		const h = harness();
		const { host, calls } = recordingHost(() => ({ ok: true, outputs: {} }));
		h.faux.setResponses([
			toolUse(fauxToolCall("edit", { content: "x", path: "b.txt" })),
			fauxAssistantMessage([fauxText("Done.")]),
		]);
		const edit: ToolOffer = {
			name: "edit",
			description: "Edit a file",
			// The bound `path` is not offered to the model, but a model may send it anyway.
			inputSchema: {
				type: "object",
				properties: { content: { type: "string" }, path: { type: "string" } },
				required: ["content"],
				additionalProperties: false,
			},
			action: "edit_file",
			bound: { path: "a.txt" },
		};

		const outcome = await createPiReasoningPort({ ...h, tools: host }).reason(request(edit));

		expect(calls).toEqual([{ name: "edit", tool: "edit_file", inputs: { content: "x", path: "a.txt" } }]);
		expect(outcome.kind === "answered" ? outcome.toolCalls?.[0]?.inputs : undefined).toEqual({
			content: "x",
			path: "a.txt",
		});
	});

	it("Scenario: A call with a wrong type never reaches the host", async () => {
		const h = harness();
		const { host, calls } = recordingHost(() => ({ ok: true, outputs: {} }));
		h.faux.setResponses([
			toolUse(fauxToolCall("count", { count: "three" })),
			fauxAssistantMessage([fauxText("Sorry.")]),
		]);

		const outcome = await createPiReasoningPort({ ...h, tools: host }).reason(
			request(offer("count", "count_things", { count: { type: "number" } })),
		);

		expect(calls).toHaveLength(0);
		const results = toolResults(h.sent[1]!);
		expect(results).toHaveLength(1);
		expect(results[0]!.isError).toBe(true);
		expect(textOf(results[0]!)).toContain("count");
		expect(outcome.kind === "answered" ? outcome.toolCalls : undefined).toEqual([
			{ name: "count", inputs: { count: "three" }, ok: false, outputs: {} },
		]);
	});
});

describe("pi/port: A structured step ends on submit_result or one forced settling request", () => {
	const schema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };
	const structuredRequest = (...tools: ToolOffer[]): ReasoningRequest => ({ ...request(...tools), outputSchema: schema });

	it("Scenario: submit_result after a tool call ends the step", async () => {
		const h = harness("anthropic-messages");
		const { host } = recordingHost(() => ({ ok: true, outputs: { content: "hi" } }));
		h.faux.setResponses([
			toolUse(fauxToolCall("read", { path: "a.txt" })),
			toolUse(fauxToolCall("submit_result", { summary: "ok" })),
			fauxAssistantMessage([fauxText("never sent")]),
		]);

		const outcome = await createPiReasoningPort({ ...h, tools: host }).reason(structuredRequest(offer("read", "read_file")));

		expect(outcome).toMatchObject({ kind: "answered", structured: { summary: "ok" } });
		expect(outcome.kind === "answered" ? outcome.toolCalls : undefined).toHaveLength(1);
		expect(h.sent).toHaveLength(2);
		expect(h.sent[0]!.tools?.map((tool) => tool.name)).toEqual(["read", "submit_result"]);
		// Nothing is forced while the model may still call the step's tools.
		expect(h.options.every((options) => options?.toolChoice === undefined)).toBe(true);
	});

	it("Scenario: A model that stops without a result is asked once, forced", async () => {
		const h = harness("anthropic-messages");
		const { host } = recordingHost(() => ({ ok: true, outputs: { content: "hi" } }));
		h.faux.setResponses([
			toolUse(fauxToolCall("read", { path: "a.txt" })),
			fauxAssistantMessage([fauxText("All read.")]),
			toolUse(fauxToolCall("submit_result", { summary: "settled" })),
		]);

		const outcome = await createPiReasoningPort({ ...h, tools: host }).reason(structuredRequest(offer("read", "read_file")));

		expect(h.sent).toHaveLength(3);
		expect(h.sent[2]!.tools?.map((tool) => tool.name)).toEqual(["submit_result"]);
		expect(h.options[2]).toMatchObject(forceTool(h.model));
		expect(h.options[2]?.toolChoice).toEqual({ type: "tool", name: "submit_result" });
		expect(h.options[1]?.toolChoice).toBeUndefined();
		expect(outcome).toMatchObject({ kind: "answered", structured: { summary: "settled" } });
		expect(outcome.kind === "answered" ? outcome.toolCalls : undefined).toHaveLength(1);
	});
});

describe("pi/port: maxRounds bounds a step's model requests", () => {
	it("Scenario: A model that never stops calling tools is cut short", async () => {
		const h = harness();
		const { host, calls } = recordingHost(() => ({ ok: true, outputs: { content: "hi" } }));
		h.faux.setResponses(Array.from({ length: 5 }, (_, i) => toolUse(fauxToolCall("read", { path: `${i}.txt` }))));

		const outcome = await createPiReasoningPort({ ...h, tools: host, maxRounds: 3 }).reason(
			request(offer("read", "read_file")),
		);

		expect(h.sent).toHaveLength(3);
		expect(calls).toHaveLength(3);
		expect(outcome).toMatchObject({ kind: "cut-short", turns: 3 });
		expect(outcome.kind === "cut-short" ? outcome.toolCalls : undefined).toEqual(
			[0, 1, 2].map((i) => ({ name: "read", inputs: { path: `${i}.txt` }, ok: true, outputs: { content: "hi" } })),
		);
	});

	it("Scenario: An error reply mid-loop fails the step", async () => {
		const h = harness();
		const { host } = recordingHost(() => ({ ok: true, outputs: { content: "hi" } }));
		h.faux.setResponses([
			toolUse(fauxToolCall("read", { path: "a.txt" })),
			fauxAssistantMessage([], { stopReason: "error", errorMessage: "slow down" }),
			fauxAssistantMessage([fauxText("never sent")]),
		]);
		// The faux provider carries no diagnostics, so the HTTP status is attached to its reply here.
		const models = {
			complete: async (model, context, options) => {
				const reply = await h.models.complete(model, context, options);
				return reply.stopReason === "error"
					? { ...reply, diagnostics: [{ type: "request", timestamp: 0, error: { message: "x", code: 429 } }] }
					: reply;
			},
		} as Pick<Models, "complete"> as Models;

		const outcome = await createPiReasoningPort({ ...h, models, tools: host }).reason(request(offer("read", "read_file")));

		expect(h.sent).toHaveLength(2);
		expect(outcome).toMatchObject({ kind: "failed", category: "rate_limit" });
		expect(outcome.kind === "failed" ? outcome.toolCalls : undefined).toEqual([
			{ name: "read", inputs: { path: "a.txt" }, ok: true, outputs: { content: "hi" } },
		]);
	});
});
