import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { RESULT_TOOL, runScript } from "../src/index.js";
import { context, ENTRIES, memoryHarness, PIPELINE } from "./helpers.js";

describe("a script run as a pi-durable task", () => {
	it("runs every step, with logic between them, and returns the variables", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "high" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("On it, urgently.")]),
		]);

		const result = await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables).toEqual({ report: "it crashes", severity: "high", urgent: true });
		expect(result.steps.map((s) => s.subagent)).toEqual(["classify", "respond"]);
		expect(result.steps[1]?.request.prompt).toBe("Write an urgent reply about: it crashes");
		expect(result.steps[1]?.outcome).toEqual({ kind: "answered", text: "On it, urgently." });
	});

	it("gives each step a fresh conversation: its own prompt, the system block, and only the tools it needs", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "low" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Thanks.")]),
		]);
		await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		await harness.close(context);

		expect(env.requests).toHaveLength(2);
		// pi-durable sends the system prompt as a leading system message with named
		// sections and the tools it adds, ahead of the transcript.
		type SystemMessage = { role: string; sections?: Record<string, string>; toolsAdded?: { name: string }[] };
		const parts = (i: number) => {
			const messages = env.requests[i]!.messages as unknown as ({ role: string; content?: unknown } & SystemMessage)[];
			const system = messages.filter((m) => m.role === "system");
			return {
				sections: Object.assign({}, ...system.map((m) => m.sections ?? {})) as Record<string, string>,
				tools: system.flatMap((m) => m.toolsAdded ?? []).map((t) => t.name),
				users: messages.filter((m) => m.role === "user").map((m) => String(m.content)),
				all: JSON.stringify(messages),
			};
		};
		const classify = parts(0);
		const respond = parts(1);

		// The system block is its own section, never inside the user message.
		expect(classify.sections.instructions).toContain("You triage bug reports.");
		expect(respond.sections.instructions).toContain("You triage bug reports.");
		expect(classify.users.join()).not.toContain("You triage bug reports.");

		// Only the structured step sees the result tool and its schema.
		expect(classify.tools).toEqual([RESULT_TOOL]);
		expect(classify.sections.result).toContain('"severity"');
		expect(respond.tools).toEqual([]);
		expect(respond.sections.result).toBeUndefined();

		// Fresh context: each step's transcript is exactly its own prompt.
		expect(classify.users).toEqual(["Classify: it crashes"]);
		expect(respond.users).toEqual(["Write a routine reply about: it crashes"]);
		expect(respond.all).not.toContain("Classify:");
	});
});
