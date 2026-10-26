import { afterEach, describe, expect, it, vi } from "vitest";
import { createModels, type Message } from "@earendil-works/pi-ai";
import { run } from "../../src/interpreter/index.js";
import { createPiReasoningPort, ollamaBaseUrl, ollamaModel, ollamaProvider, registerOllama } from "../../src/pi/index.js";
import { closedPortUrl, startFakeOllama, type FakeOllama } from "./fake-ollama.js";

const user = (content: string): Message => ({ role: "user", content, timestamp: 0 });

const servers: FakeOllama[] = [];
async function fake(options: Parameters<typeof startFakeOllama>[0]): Promise<FakeOllama> {
	const server = await startFakeOllama(options);
	servers.push(server);
	return server;
}

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("pi/ollama", () => {
	it("Scenario: A step reaches the server's chat endpoint", async () => {
		const server = await fake({ models: [], reply: { text: "hello" } });
		const models = createModels();
		models.setProvider(ollamaProvider({ baseUrl: server.url, models: ["tiny:1b"] }));
		const model = models.getModel("ollama", "tiny:1b")!;

		const message = await models.complete(model, { messages: [user("Say hello")] });

		const chats = server.requests.filter((r) => r.method === "POST" && r.path === "/v1/chat/completions");
		expect(chats).toHaveLength(1);
		expect((chats[0]!.body as { model: string }).model).toBe("tiny:1b");
		expect(message.stopReason).toBe("stop");
		expect(message.content).toEqual([{ type: "text", text: "hello" }]);
	});

	it("Scenario: No credential is needed", async () => {
		for (const key of ["OPENAI_API_KEY", "OLLAMA_API_KEY", "ANTHROPIC_API_KEY"]) vi.stubEnv(key, undefined);
		const models = createModels();
		models.setProvider(ollamaProvider());

		await expect(models.getAuth("ollama")).resolves.not.toBeUndefined();
	});

	it("Scenario: The default is localhost", () => {
		vi.stubEnv("OLLAMA_HOST", undefined);
		expect(ollamaBaseUrl()).toBe("http://localhost:11434");
	});

	it("Scenario: OLLAMA_HOST without a scheme gets one", () => {
		vi.stubEnv("OLLAMA_HOST", "127.0.0.1:9999/");
		expect(ollamaBaseUrl()).toBe("http://127.0.0.1:9999");
	});

	it("Scenario: The option wins over OLLAMA_HOST", () => {
		vi.stubEnv("OLLAMA_HOST", "127.0.0.1:9999");
		expect(ollamaBaseUrl({ baseUrl: "http://box:11434" })).toBe("http://box:11434");
	});

	it("Scenario: A refresh lists the pulled models", async () => {
		const server = await fake({ models: ["qwen3:8b", "llama3.2:3b"] });
		const models = createModels();
		models.setProvider(ollamaProvider({ baseUrl: server.url }));

		const { errors } = await models.refresh({ providers: ["ollama"], allowNetwork: true, force: true });

		expect(errors.get("ollama")).toBeUndefined();
		expect(models.getModels("ollama").map((m) => m.id)).toEqual(["qwen3:8b", "llama3.2:3b"]);
	});

	it("Scenario: Any id makes a model", () => {
		vi.stubEnv("OLLAMA_HOST", undefined);
		const model = ollamaModel("mistral:7b");
		expect(model).toMatchObject({
			id: "mistral:7b",
			provider: "ollama",
			api: "openai-completions",
			baseUrl: "http://localhost:11434/v1",
		});
	});

	it("Scenario: A reachable server's models resolve", async () => {
		const server = await fake({ models: ["qwen3:8b"] });
		const models = createModels();

		const result = await registerOllama(models, { baseUrl: server.url });

		expect(result).toEqual({ ok: true, baseUrl: server.url, models: 1 });
		expect(models.getModel("ollama", "qwen3:8b")).toBeDefined();
	});

	it("Scenario: An unreachable server is reported, not thrown", async () => {
		const baseUrl = await closedPortUrl();
		const models = createModels();

		const pending = registerOllama(models, { baseUrl });
		await expect(pending).resolves.toBeDefined();
		const result = await pending;

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an unreachable server");
		expect(result.baseUrl).toBe(baseUrl);
		expect(typeof result.reason).toBe("string");
		expect(result.reason).not.toBe("");
		expect(models.getProvider("ollama")).toBeDefined();
		expect(models.getModels("ollama")).toHaveLength(0);
	});

	it("Scenario: A forced tool call becomes the structured result", async () => {
		const server = await fake({ models: ["tiny:1b"], reply: { toolCall: { arguments: { label: "bug" } } } });
		const port = await ollamaPort(server);

		const result = await run(LABEL, { port });

		expect(result.kind).toBe("completed");
		expect(result.variables.label).toBe("bug");
		const chats = server.requests.filter((r) => r.method === "POST" && r.path === "/v1/chat/completions");
		expect(chats).toHaveLength(1);
		const body = chats[0]!.body as Record<string, unknown> & { messages: { role: string }[] };
		expect(body.model).toBe("tiny:1b");
		expect(body.tool_choice).toEqual({ type: "function", function: { name: "submit_result" } });
		// The compat flags reach the wire: no store, no developer role, max_tokens.
		expect(body).not.toHaveProperty("store");
		expect(body).not.toHaveProperty("max_completion_tokens");
		expect(body).toHaveProperty("max_tokens");
		expect(body.messages.map((m) => m.role)).not.toContain("developer");
	});

	it("Scenario: A text-only reply fails the step", async () => {
		const server = await fake({ models: ["tiny:1b"], reply: { text: "label: bug" } });
		const port = await ollamaPort(server);

		const result = await run(LABEL, { port });

		expect(result.kind).toBe("failed");
		const outcome = result.steps[0]?.outcome;
		if (outcome?.kind !== "failed") throw new Error("expected a failed step");
		expect(outcome.message).toContain("received none");
		expect(result.variables.label).toBe("");
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

/** A pi port on the fake server's `tiny:1b`, registered the way the CLI does it. */
async function ollamaPort(server: FakeOllama) {
	const models = createModels();
	const registered = await registerOllama(models, { baseUrl: server.url });
	expect(registered.ok).toBe(true);
	const model = models.getModel("ollama", "tiny:1b");
	if (model === undefined) throw new Error("tiny:1b did not resolve");
	return createPiReasoningPort({ models, model });
}
