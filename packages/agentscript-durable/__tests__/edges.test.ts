import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { checkResult, RESULT_TOOL, runScript, startScript, waitForScript } from "../src/index.js";
import { context, ENTRIES, memoryHarness, PIPELINE } from "./helpers.js";

const tool = (args: Parameters<typeof fauxToolCall>[1]) =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, args)], { stopReason: "toolUse" });

describe("structured results", () => {
	it("hands a bad result back to the model, which calls again within the same step", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;
		env.faux.setResponses([tool({ severity: 3 }), tool({ severity: "high" }), fauxAssistantMessage([fauxText("ok")])]);

		const result = await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables.severity).toBe("high");
		// classify took two requests (bad call, then good), respond took one.
		expect(env.requests).toHaveLength(3);
		const retry = JSON.stringify(env.requests[1]);
		expect(retry).toContain('\\"severity\\" must be a string, got number');
	});

	it("fails the run when the model answers in text and never calls the tool", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;
		env.faux.setResponses([fauxAssistantMessage([fauxText("severity: high")])]);

		const result = await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("failed");
		expect(result.variables.severity).toBe("");
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]?.outcome).toMatchObject({ kind: "failed" });
	});
});

describe("failures", () => {
	it("reports a provider error as a failed step and ends the run there", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;
		env.faux.setResponses([tool({ severity: "high" })]); // nothing queued for step 2

		const result = await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("failed");
		expect(result.variables).toMatchObject({ severity: "high", urgent: true });
		expect(result.steps.map((s) => s.outcome.kind)).toEqual(["answered", "failed"]);
	});

	it("refuses a script outside the subset when the run is started, before any model call", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;
		const bad = PIPELINE.replace('agent_name: "pipeline"', 'agent_name: "pipeline"\n\nmodel_config:\n    model: "model://x"');
		await expect(startScript(harness, bad, { entry: ENTRIES, model: env.model }, context)).rejects.toThrow(
			/unsupported by this runtime/,
		);
		await harness.close(context);
		expect(env.requests).toHaveLength(0);
	});

	it("an aborted run ends aborted, and waitForScript says so", async () => {
		const { env, harness: opening } = memoryHarness();
		const harness = await opening;
		// No responses: step 1 never gets an answer before the abort lands.
		env.faux.setResponses([]);
		const id = await startScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		expect(["marked", "terminal"]).toContain(await harness.abortTask(id, context));
		await expect(waitForScript(harness, id, context)).rejects.toThrow(/ended aborted/);
		await harness.close(context);
	});
});

describe("checkResult", () => {
	const schema = {
		type: "object",
		properties: { severity: { type: "string" }, score: { type: "number" }, ok: { type: "boolean" } },
		required: ["severity", "score", "ok"],
	};

	it("accepts a result with every field of the right type", () => {
		expect(checkResult(schema, { severity: "high", score: 2, ok: true })).toBeUndefined();
	});

	it("names every missing field and every wrong type", () => {
		const problem = checkResult(schema, { score: "2", ok: true });
		expect(problem).toContain('missing "severity"');
		expect(problem).toContain('"score" must be a number, got string');
		expect(problem).toMatch(/Call again\.$/);
	});

	it.each([null, "high", 3, ["high"]])("rejects a non-object result: %j", (value) => {
		expect(checkResult(schema, value)).toBe("The result must be an object.");
	});

	it("refuses any result on a text-only step", () => {
		expect(checkResult(null, { a: 1 })).toMatch(/takes no structured result/);
	});
});
