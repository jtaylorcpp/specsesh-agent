import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { run, type ActionResult, type StreamDelta, type ToolOffer } from "../../src/interpreter/index.js";
import {
	createPiReasoningPort,
	GEMINI_DEFAULT_BASE_URL,
	GEMINI_PROVIDER,
	geminiBaseUrl,
	geminiKeyIssue,
	registerGemini,
	type PiToolCall,
	type PiToolHost,
} from "../../src/pi/index.js";
import { callReply, startFakeGemini, textReply, type FakeGemini } from "./fake-gemini.js";

const servers: FakeGemini[] = [];
async function fake(): Promise<FakeGemini> {
	const server = await startFakeGemini();
	servers.push(server);
	return server;
}

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("pi/gemini", () => {
	it("Scenario: The constants match pi's google provider", () => {
		const models = builtinModels();

		expect(models.getProviders().map((p) => p.id)).toContain(GEMINI_PROVIDER);
		const google = models.getModels(GEMINI_PROVIDER);
		expect(google.length).toBeGreaterThan(0);
		for (const model of google) expect(model.baseUrl).toBe(GEMINI_DEFAULT_BASE_URL);
	});

	it("Scenario: The default is Google's endpoint", () => {
		vi.stubEnv("GEMINI_BASE_URL", undefined);

		expect(geminiBaseUrl()).toBe("https://generativelanguage.googleapis.com/v1beta");
	});

	it("Scenario: GEMINI_BASE_URL loses its trailing slash", () => {
		vi.stubEnv("GEMINI_BASE_URL", "http://127.0.0.1:9999/v1beta/");
		expect(geminiBaseUrl()).toBe("http://127.0.0.1:9999/v1beta");

		vi.stubEnv("GEMINI_BASE_URL", "");
		expect(geminiBaseUrl()).toBe(GEMINI_DEFAULT_BASE_URL);
	});

	it("Scenario: The option wins over GEMINI_BASE_URL", () => {
		vi.stubEnv("GEMINI_BASE_URL", "http://127.0.0.1:9999");

		expect(geminiBaseUrl({ baseUrl: "http://gateway/v1beta" })).toBe("http://gateway/v1beta");
	});

	it("Scenario: A set key and a fake URL resolve", async () => {
		const models = builtinModels();
		const env = { GEMINI_API_KEY: "test" };
		const baseUrl = "http://127.0.0.1:1/v1beta";

		const result = await registerGemini(models, { baseUrl, env });

		expect(result.ok).toBe(true);
		expect(result.ok && result.models).toBeGreaterThan(0);
		expect(result.baseUrl).toBe(baseUrl);
		expect(models.getModel("google", "gemini-3.5-flash")?.baseUrl).toBe(baseUrl);
	});

	it("Scenario: A missing key is reported, not thrown", async () => {
		vi.stubEnv("GEMINI_BASE_URL", undefined);
		const models = builtinModels();
		const env = {};

		await expect(registerGemini(models, { env })).resolves.toEqual({
			ok: false,
			baseUrl: GEMINI_DEFAULT_BASE_URL,
			reason: "GEMINI_API_KEY is not set",
		});
		expect(geminiKeyIssue(env)).toBe("GEMINI_API_KEY is not set");
	});

	it("Scenario: A forced function call becomes the structured result", async () => {
		const server = await fake();
		server.reply(callReply("submit_result", { label: "bug" }));

		const result = await run(LABEL, { port: await geminiPort(server) });

		expect(server.requests).toHaveLength(1);
		expect(server.requests[0]).toMatchObject({ path: "/v1beta/models/gemini-3.5-flash:streamGenerateContent", model: "gemini-3.5-flash", apiKey: "test" });
		const body = server.requests[0]!.body as { toolConfig?: { functionCallingConfig?: { mode?: string } } };
		expect(body.toolConfig?.functionCallingConfig?.mode).toBe("ANY");
		expect(result.kind).toBe("completed");
		expect(result.variables.label).toBe("bug");
	});

	it("Scenario: A text-only Gemini reply fails the step", async () => {
		const server = await fake();
		server.reply(textReply("just text"));

		const result = await run(LABEL, { port: await geminiPort(server) });

		expect(result.kind).toBe("failed");
		const outcome = result.steps[0]?.outcome;
		if (outcome?.kind !== "failed") throw new Error("expected a failed step");
		expect(outcome.message).toContain("received none");
		expect(result.variables.label).toBe("");
	});

	it("Scenario: A Gemini tool call is answered with a functionResponse", async () => {
		const server = await fake();
		server.reply(callReply("lookup", { key: "a" }), textReply("done"));
		const calls: PiToolCall[] = [];
		const host: PiToolHost = (call): ActionResult => {
			calls.push(call);
			return { ok: true, outputs: { value: "found" } };
		};

		const outcome = await (await geminiPort(server, host)).reason({ systemInstructions: "You look things up.", prompt: "Look up a.", tools: [LOOKUP] });

		expect(calls).toEqual([{ name: "lookup", tool: "lookup", inputs: { key: "a" } }]);
		expect(server.requests).toHaveLength(2);
		const contents = (server.requests[1]!.body as { contents: { parts?: { functionResponse?: { name?: string; response?: unknown } }[] }[] }).contents;
		const responses = contents.flatMap((content) => content.parts ?? []).flatMap((part) => (part.functionResponse === undefined ? [] : [part.functionResponse]));
		expect(responses).toHaveLength(1);
		// pi sends a successful result as its JSON text under `output`.
		expect(responses[0]).toMatchObject({ name: "lookup", response: { output: '{"value":"found"}' } });
		expect(outcome).toMatchObject({ kind: "answered", text: "done" });
		if (outcome.kind !== "answered") throw new Error("expected an answered step");
		expect(outcome.toolCalls).toHaveLength(1);
		expect(outcome.toolCalls?.[0]).toMatchObject({ name: "lookup", inputs: { key: "a" }, ok: true, outputs: { value: "found" } });
	});

	it("Scenario: A listening Gemini step streams its text", async () => {
		const server = await fake();
		server.reply(textReply("Hel", "lo"));
		const deltas: StreamDelta[] = [];

		const outcome = await (await geminiPort(server)).reason({ systemInstructions: "You greet.", prompt: "Say hello." }, { onDelta: (delta) => deltas.push(delta) });

		expect(deltas.filter((delta) => delta.type === "text_delta")).toEqual([
			{ type: "text_delta", delta: "Hel" },
			{ type: "text_delta", delta: "lo" },
		]);
		expect(outcome).toMatchObject({ kind: "answered", text: "Hello" });
	});
});

const LABEL = `config:
    agent_name: "labeller"

system:
    instructions: |
        You label issues.

variables:
    label: mutable string = ""

subagent classify:
    description: "Label the issue"

    reasoning:
        instructions: ->
            | Label this issue: the app crashes on start.
            set @variables.label = @outputs.label
`;

const LOOKUP: ToolOffer = {
	name: "lookup",
	description: "Look a key up",
	inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false },
	action: "lookup",
	bound: {},
};

/**
 * A pi port on `google/gemini-3.5-flash`, pointed at the fake server the way the CLI does it.
 * pi's `envApiKeyAuth` reads `GEMINI_API_KEY` from the process at request time, so it is stubbed too.
 */
async function geminiPort(server: FakeGemini, tools?: PiToolHost) {
	vi.stubEnv("GEMINI_API_KEY", "test");
	const models = builtinModels();
	const registered = await registerGemini(models, { baseUrl: server.url, env: { GEMINI_API_KEY: "test" } });
	expect(registered.ok).toBe(true);
	const model = models.getModel(GEMINI_PROVIDER, "gemini-3.5-flash");
	if (model === undefined) throw new Error("gemini-3.5-flash did not resolve");
	return createPiReasoningPort({ models, model, ...(tools !== undefined ? { tools } : {}) });
}
