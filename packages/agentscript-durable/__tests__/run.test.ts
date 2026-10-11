import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { RESULT_TOOL, runScript, startScript, waitForScript } from "../src/index.js";
import { context, ENTRIES, memoryHarness, openHarness, PIPELINE, setup } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

describe("startScript and waitForScript", () => {
	it("Scenario: A run can belong to a given conversation", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;
		const owner = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "low" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("ok")]),
		]);

		const id = await startScript(harness, PIPELINE, { entry: ENTRIES, model: env.model, conversation: owner }, context);
		const task = await harness.getTask(id, context);
		const root = await harness.root(context);
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(Number.isInteger(id)).toBe(true);
		expect(task?.conversationId).toBe(owner.id);
		expect(task?.conversationId).not.toBe(root.id);
		// the conversation is a handle, never stored in the task's input
		expect(Object.keys(task?.input as object).sort()).toEqual(["model", "options", "source"]);
		expect(result.kind).toBe("completed");
	});

	it("Scenario: No model means no model key", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;

		const bare = await startScript(harness, PIPELINE, { entry: ENTRIES, variables: { report: "slow" } }, context);
		const withModel = await startScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		const bareInput = (await harness.getTask(bare, context))?.input as Record<string, unknown>;
		const modelInput = (await harness.getTask(withModel, context))?.input as Record<string, unknown>;
		await harness.close(context);

		expect("model" in bareInput).toBe(false);
		expect(bareInput.options).toEqual({ entry: ENTRIES, variables: { report: "slow" } });
		expect(modelInput.model).toEqual(env.model);
	});

	it("Scenario: startScript resolves before any model request", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "low" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("ok")]),
		]);

		const id = await startScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		const created = await harness.getTask(id, context);

		expect(env.requests).toHaveLength(0);
		expect(created?.state.status).toBe("pending");
		expect(env.faux.getPendingResponseCount()).toBe(2);

		// the run proceeds only through the harness's scheduler
		await waitForScript(harness, id, context);
		await harness.close(context);
		expect(env.requests).toHaveLength(2);
	});

	it("Scenario: A run that failed at a step still resolves", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "high" })], { stopReason: "toolUse" }),
		]); // respond has nothing queued, so its provider call fails

		const id = await startScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(result.kind).toBe("failed");
		expect(result.steps.map((s) => s.outcome.kind)).toEqual(["answered", "failed"]);
	});

	it("Scenario: A string task ID is caught by name", async () => {
		// MemoryStorage refuses an unknown ID outright; SQLite matches '7' to 7 and hands back the live record.
		const dir = mkdtempSync(join(tmpdir(), "agentscript-run-"));
		dirs.push(dir);
		const env = setup();
		const harness = await openHarness(await openNodeSqliteStorage(join(dir, "run.sqlite")), env);

		const id = await startScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		const asText = String(id) as unknown as typeof id;
		const rejection = await waitForScript(harness, asText, context).then(
			() => undefined,
			(error: unknown) => (error instanceof Error ? error.message : String(error)),
		);
		await harness.close(context);

		expect(rejection).toBeDefined();
		expect(rejection).toContain(`agentscript run ${id} is `);
		expect(rejection).toContain("not finished");
		expect(rejection).toContain("Task IDs are numbers");
	});
});
