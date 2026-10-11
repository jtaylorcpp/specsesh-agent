import { describe, expect, it } from "vitest";
import { createModels, Type, type Context, type Message } from "@earendil-works/pi-ai";
import type { ProcessResult, Runner } from "../src/claude-code.js";
import { claudeCodeModel, claudeCodeProvider, promptOf, systemPromptOf } from "../src/claude-code-provider.js";

const ok = (result: Record<string, unknown>): ProcessResult => ({
	code: 0,
	stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001, ...result }),
	stderr: "",
});

function harness(...answers: ProcessResult[]) {
	const calls: { args: readonly string[]; input: string; env: NodeJS.ProcessEnv }[] = [];
	const runner: Runner = async (args, input, env) => {
		calls.push({ args, input, env });
		return answers[Math.min(calls.length - 1, answers.length - 1)]!;
	};
	const models = createModels();
	models.setProvider(claudeCodeProvider({ runner: () => runner }));
	return { models, calls, model: models.getModel("claude-code", "claude-haiku-4-5")! };
}

const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];
const user = (content: string): Message => ({ role: "user", content, timestamp: 0 });
const system = (sections: Record<string, string | null>, content = "", toolsAdded?: Context["tools"]): Message =>
	({ role: "system", content, sections, ...(toolsAdded ? { toolsAdded } : {}), timestamp: 0 }) as Message;

describe("the claude-code pi provider", () => {
	it("is registered with Haiku and answers a plain prompt as text", async () => {
		const h = harness(ok({ result: "Hello!" }));
		const message = await h.models.complete(h.model, { messages: [system({ instructions: "<instructions>\nBe kind.\n</instructions>" }), user("Say hi")] });
		expect(message.stopReason).toBe("stop");
		expect(message.content).toEqual([{ type: "text", text: "Hello!" }]);
		expect(message.usage).toMatchObject({ input: 10, output: 5, totalTokens: 15 });

		const { args, input, env } = h.calls[0]!;
		expect(flag(args, "--model")).toBe("claude-haiku-4-5");
		expect(flag(args, "--system-prompt")).toContain("Be kind.");
		expect(args).toContain("--safe-mode");
		expect(args).not.toContain("--json-schema");
		expect(input).toBe("Say hi");
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
	});

	it("turns a single offered tool into --json-schema and returns a call to it", async () => {
		const h = harness(ok({ result: "{}", structured_output: { greeting: "Hello, World!" } }));
		const tool = { name: "submit_result", description: "d", parameters: Type.Object({ greeting: Type.String() }) };
		const message = await h.models.complete(h.model, { messages: [system({}, "", [tool]), user("Greet")] });
		expect(message.stopReason).toBe("toolUse");
		expect(message.content[0]).toMatchObject({ type: "toolCall", name: "submit_result", arguments: { greeting: "Hello, World!" } });
		expect(JSON.parse(flag(h.calls[0]!.args, "--json-schema")!)).toMatchObject({ properties: { greeting: { type: "string" } } });
	});

	it("refuses a request offering more than one tool, without spawning", async () => {
		const h = harness(ok({ result: "x" }));
		const t = (name: string) => ({ name, description: "", parameters: Type.Object({}) });
		const message = await h.models.complete(h.model, { messages: [system({}, "", [t("a"), t("b")]), user("x")] });
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toMatch(/at most one pi tool.*a, b/);
		expect(h.calls).toHaveLength(0);
	});

	it("reports an API error with its status, for the port's category mapping", async () => {
		const h = harness(ok({ is_error: true, api_error_status: 429, result: "rate limited" }));
		const message = await h.models.complete(h.model, { messages: [user("x")] });
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toBe("rate limited");
		expect(message.diagnostics?.[0]?.error?.code).toBe(429);
	});

	it("reports a missing claude binary as an error message", async () => {
		const h = harness({ code: null, stdout: "", stderr: "", spawnError: new Error("spawn claude ENOENT") });
		const message = await h.models.complete(h.model, { messages: [user("x")] });
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toMatch(/ENOENT/);
	});

	it("accepts any model id claude --model takes", () => {
		expect(claudeCodeModel("claude-sonnet-4-5")).toMatchObject({ provider: "claude-code", id: "claude-sonnet-4-5" });
	});
});

describe("flattening", () => {
	it("builds the system prompt from content then sections, later sections replacing earlier ones", () => {
		const prompt = systemPromptOf([
			system({ a: "<a>one</a>", b: "<b>two</b>" }, "Base."),
			user("hi"),
			system({ a: "<a>ONE</a>", b: null }),
		]);
		expect(prompt).toBe("Base.\n\n<a>ONE</a>");
	});

	it("renders a multi-turn transcript, including a tool error, for a retry", () => {
		const prompt = promptOf([
			system({}),
			user("Greet"),
			{ role: "assistant", content: [{ type: "toolCall", id: "1", name: "submit_result", arguments: { greeting: 3 } }] } as unknown as Message,
			{ role: "toolResult", toolCallId: "1", toolName: "submit_result", content: [{ type: "text", text: "must be a string" }], isError: true, timestamp: 0 } as Message,
		]);
		expect(prompt).toContain("User: Greet");
		expect(prompt).toContain('[called submit_result with {"greeting":3}]');
		expect(prompt).toContain("Tool submit_result returned an error: must be a string");
		expect(prompt).toMatch(/Continue from here as the assistant\.$/);
	});
});
