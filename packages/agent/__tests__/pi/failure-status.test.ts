import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { ActionResult, StreamDelta, ToolOffer } from "../../src/interpreter/index.js";
import { createPiReasoningPort, ollamaProvider, type PiToolHost } from "../../src/pi/index.js";
import { startStatusServer, type StatusServer } from "./status-server.js";

const servers: StatusServer[] = [];
async function serve(status: number): Promise<StatusServer> {
	const server = await startStatusServer(status);
	servers.push(server);
	return server;
}

beforeEach(() => {
	vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
	vi.stubEnv("OPENAI_API_KEY", "test-key");
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(servers.splice(0).map((s) => s.close()));
});

const STEP = { systemInstructions: "You are terse.", prompt: "Say one word." };

describe("pi/port: the recorded HTTP status", () => {
	it("Scenario: A 429 on the Anthropic wire is a rate limit", async () => {
		const server = await serve(429);
		const { models, model } = pointed("anthropic", "claude-haiku-4-5", server.origin);

		const outcome = await createPiReasoningPort({ models, model }).reason(STEP);

		expect(server.requests).toBeGreaterThan(0);
		expect(outcome).toMatchObject({ kind: "failed", category: "rate_limit" });
	});

	it("Scenario: A 401 on the OpenAI wire is an authentication failure", async () => {
		const server = await serve(401);
		const { models, model } = pointed("openai", "gpt-4o-mini", `${server.origin}/v1`);

		const outcome = await createPiReasoningPort({ models, model }).reason(STEP);

		expect(server.requests).toBeGreaterThan(0);
		expect(outcome).toMatchObject({ kind: "failed", category: "authentication_failed" });
	});

	it("Scenario: A 500 from Ollama is a server error", async () => {
		const server = await serve(500);
		const models = builtinModels();
		models.setProvider(ollamaProvider({ models: ["tiny:1b"] }));
		const model = { ...required(models.getModel("ollama", "tiny:1b")), baseUrl: `${server.origin}/v1` };

		const outcome = await createPiReasoningPort({ models, model }).reason(STEP);

		expect(server.requests).toBeGreaterThan(0);
		expect(outcome).toMatchObject({ kind: "failed", category: "server_error" });
	});

	it("Scenario: A tool-loop round keeps its status", async () => {
		const server = await serve(429);
		const { models, model } = pointed("anthropic", "claude-haiku-4-5", server.origin);
		const host: PiToolHost = (): ActionResult => ({ ok: true, outputs: { value: "found" } });

		const outcome = await createPiReasoningPort({ models, model, tools: host }).reason({ ...STEP, tools: [LOOKUP] });

		expect(server.requests).toBeGreaterThan(0);
		expect(outcome).toMatchObject({ kind: "failed", category: "rate_limit" });
	});

	it("Scenario: A streamed step keeps its status", async () => {
		const server = await serve(429);
		const { models, model } = pointed("anthropic", "claude-haiku-4-5", server.origin);
		const deltas: StreamDelta[] = [];

		const outcome = await createPiReasoningPort({ models, model }).reason(STEP, { onDelta: (delta) => deltas.push(delta) });

		expect(server.requests).toBeGreaterThan(0);
		expect(outcome).toMatchObject({ kind: "failed", category: "rate_limit" });
	});
});

const LOOKUP: ToolOffer = {
	name: "lookup",
	description: "Look a key up",
	inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false },
	action: "lookup",
	bound: {},
};

/** A builtin model with its `baseUrl` pointed at the status server. */
function pointed(provider: string, id: string, baseUrl: string): { models: Models; model: Model<Api> } {
	const models = builtinModels();
	return { models, model: { ...required(models.getModel(provider, id)), baseUrl } };
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("model did not resolve");
	return value;
}
