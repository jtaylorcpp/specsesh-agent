import { describe, expect, it } from "vitest";
import { TOOLS_NEED_DURABLE_HOST, type ReasoningRequest } from "../../src/interpreter/index.js";
import { createModels, fauxProvider, type Models } from "@earendil-works/pi-ai";
import { createClaudeCodeReasoningPort, type Runner } from "../../src/claude-code/claude-code.js";
import { createPiReasoningPort } from "../../src/pi/port.js";

/** A step offering one tool, as the interpreter composes it for a reasoning-action entry. */
const TOOL_REQUEST: ReasoningRequest = {
	systemInstructions: "You act.",
	prompt: "Edit the file.",
	tools: [
		{
			name: "edit",
			description: "Replace a file",
			inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"], additionalProperties: false },
			action: "edit_file",
			bound: { path: "NOTES.md" },
		},
	],
};

describe("core/reasoning-port: A port that cannot run tools refuses a request that offers them", () => {
	it("Scenario: The pi port refuses a tool request", async () => {
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		let requests = 0;
		const counting = new Proxy(models, {
			get(target, prop, receiver) {
				const value = Reflect.get(target, prop, receiver);
				if (typeof value !== "function") return value;
				return (...args: unknown[]) => {
					if (prop === "complete" || prop === "stream" || prop === "completeSimple" || prop === "streamSimple") requests += 1;
					return (value as (...a: unknown[]) => unknown).apply(target, args);
				};
			},
		}) as Models;
		const port = createPiReasoningPort({ models: counting, model: faux.getModel() });

		const outcome = await port.reason(TOOL_REQUEST);

		expect(outcome).toEqual({ kind: "failed", category: "invalid_request", message: TOOLS_NEED_DURABLE_HOST });
		expect(TOOLS_NEED_DURABLE_HOST).toContain("durable host");
		expect(requests).toBe(0);
	});

	it("the claude-code port refuses a tool request without spawning claude", async () => {
		const calls: unknown[] = [];
		const runner: Runner = async (...args) => {
			calls.push(args);
			return { code: 0, stdout: "{}", stderr: "" };
		};
		const outcome = await createClaudeCodeReasoningPort({ runner }).reason(TOOL_REQUEST);
		expect(outcome).toEqual({ kind: "failed", category: "invalid_request", message: TOOLS_NEED_DURABLE_HOST });
		expect(calls).toHaveLength(0);
	});
});
