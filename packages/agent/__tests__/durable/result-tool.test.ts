import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, Harness as PiHarness, MemoryStorage, type ConversationId, type Harness, type TaskId } from "@earendil-works/pi-durable";
import { claudeCodeProvider } from "../../src/claude-code/claude-code-provider.js";
import type { RunResult } from "../../src/interpreter/index.js";
import { AgentScript, AgentScriptStep, AgentScriptStepExtension, RESULT_TOOL, runScript, startScript, waitForScript, type StepDoc } from "../../src/durable/index.js";
import { context, ENTRIES, openHarness, PIPELINE, setup } from "./helpers.js";

const submit = (args: Record<string, unknown>) =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, args as Parameters<typeof fauxToolCall>[1])], { stopReason: "toolUse" });

/** One judge step: the task loop's verdict fields, `met` a boolean. */
const JUDGE = `config:
    agent_name: "judge"

variables:
    met: mutable boolean = False
    unmet: mutable string = ""
    next_action: mutable string = "retry"
    question: mutable string = ""

subagent judge:
    description: "Judge the task"

    reasoning:
        instructions: ->
            | Is task 1.1 done?
            set @variables.met = @outputs.met
            set @variables.unmet = @outputs.unmet
            set @variables.next_action = @outputs.next_action
            set @variables.question = @outputs.question
`;

const JUDGE_SCHEMA = {
	type: "object",
	properties: { met: { type: "boolean" }, unmet: { type: "string" }, next_action: { type: "string" }, question: { type: "string" } },
	required: ["met", "unmet", "next_action", "question"],
	additionalProperties: false,
};

/** Run `source` on the faux provider; return the result, the requests, and each step conversation's doc and tool results. */
async function run(source: string, entry: string[], responses: Parameters<ReturnType<typeof setup>["faux"]["setResponses"]>[0]) {
	const env = setup();
	const storage = new MemoryStorage();
	const harness = await openHarness(storage, env);
	env.faux.setResponses(responses);
	const id = await startScript(harness, source, { entry, model: env.model }, context);
	const result = await waitForScript(harness, id, context);
	const steps = await stepConversations(harness, storage, id);
	await harness.close(context);
	return { env, result, steps };
}

async function stepConversations(harness: Harness, storage: MemoryStorage, id: TaskId<RunResult>) {
	const owned = await storage.scanConversations({ ownerTaskId: id }, 10, undefined, context);
	return Promise.all(
		owned.items.map(async (record) => {
			const conversation = await harness.conversation(record.id as ConversationId, context);
			const doc = await conversation!.commit(async (tx) => JSON.parse(JSON.stringify(await tx.doc(AgentScriptStep, record.id))) as StepDoc, context);
			const page = await storage.scanEntries({ conversationId: record.id, order: "ascending" }, 100, undefined, context);
			const results = page.items.flatMap((entry) =>
				(entry.model ?? []).flatMap((m) =>
					m.role === "toolResult" ? [{ isError: m.isError, text: m.content.map((b) => (b.type === "text" ? b.text : "")).join("") }] : [],
				),
			);
			return { doc, results };
		}),
	);
}

/** The tools a request's system messages added, as the provider sees them. */
function offeredTools(request: { messages: readonly unknown[] }) {
	type Added = { name: string; description: string; parameters: unknown };
	return (request.messages as { role: string; toolsAdded?: Added[] }[]).filter((m) => m.role === "system").flatMap((m) => m.toolsAdded ?? []);
}

/** The verdict the live run's judge sent, over and over: `met` as a string. */
const LIVE_RUN_ANSWER = { met: "true", unmet: "", next_action: "proceed", question: "done" };

describe("The result tool's parameters are the step's schema", () => {
	it("Scenario: The provider sees the step's types", async () => {
		const { env, result } = await run(JUDGE, ["judge"], [submit({ met: true, unmet: "", next_action: "retry", question: "" })]);

		expect(result.kind).toBe("completed");
		const tools = offeredTools(env.requests[0]!);
		expect(tools.map((t) => t.name)).toEqual([RESULT_TOOL]);
		expect(tools[0]!.parameters).toEqual(JUDGE_SCHEMA);
		expect((tools[0]!.parameters as typeof JUDGE_SCHEMA).properties.met.type).toBe("boolean");
		expect(tools[0]!.description).toBe(
			"Submit this step's result as an object with exactly the fields the system prompt lists. Call it once; it ends the step.",
		);
		const live = AgentScriptStepExtension.tools?.find((t) => t.name === RESULT_TOOL);
		expect(live?.replay).toBe("safe");
	});

	it("the claude-code provider hands that schema to claude as --json-schema", async () => {
		// A fake `claude` that records its argv and answers a verdict.
		const dir = mkdtempSync(join(tmpdir(), "result-tool-claude-"));
		try {
			const bin = join(dir, "claude");
			const log = join(dir, "argv.json");
			writeFileSync(
				bin,
				`#!${process.execPath}
const fs = require("node:fs");
try { fs.readFileSync(0, "utf8"); } catch {}
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { met: true, unmet: "", next_action: "retry", question: "" } }));
`,
			);
			chmodSync(bin, 0o755);
			const models = createModels();
			models.setProvider(claudeCodeProvider({ binary: bin }));
			const registry = createRegistry();
			registry.install(AgentScript);
			registry.install(AgentScriptStepExtension);
			const harness = await PiHarness.open(new MemoryStorage(), { models, registry }, context);
			const result = await runScript(harness, JUDGE, { entry: ["judge"], model: { provider: "claude-code", modelId: "claude-haiku-4-5" } }, context);
			await harness.close(context);

			const argv = JSON.parse(readFileSync(log, "utf8")) as string[];
			expect(JSON.parse(argv[argv.indexOf("--json-schema") + 1]!)).toEqual(JUDGE_SCHEMA);
			expect(result.kind).toBe("completed");
			expect(result.variables.met).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("each structured step offers its own schema; a text-only step offers none", async () => {
		const { env } = await run(PIPELINE, ENTRIES, [submit({ severity: "low" }), fauxAssistantMessage([fauxText("ok")])]);

		expect(offeredTools(env.requests[0]!)[0]!.parameters).toEqual({
			type: "object",
			properties: { severity: { type: "string" } },
			required: ["severity"],
			additionalProperties: false,
		});
		expect(offeredTools(env.requests[1]!)).toEqual([]);
	});

	it("Scenario: A wrongly typed field still reaches the tool's own check", async () => {
		// pi would coerce 3 to "3" against the schema; the tool must see the 3 the model sent.
		const { result, steps } = await run(PIPELINE, ENTRIES, [submit({ severity: 3 }), submit({ severity: "high" }), fauxAssistantMessage([fauxText("ok")])]);

		expect(steps[0]!.results[0]).toEqual({ isError: true, text: 'The result was not recorded: "severity" must be a string, got number. Call again.' });
		expect(result.variables.severity).toBe("high");
	});

	it("Scenario: A call pi's own validation would refuse is the tool's refusal", async () => {
		// Missing a field, and a value pi cannot coerce: pi would answer without running the tool.
		const { result, steps } = await run(JUDGE, ["judge"], [
			submit({}),
			submit({ met: "yes", unmet: "", next_action: "retry", question: "" }),
			submit({ met: true, unmet: "", next_action: "retry", question: "", extra: 1 }),
		]);

		expect(steps[0]!.results.map((r) => r.text)).toEqual([
			'The result was not recorded: missing "met"; missing "unmet"; missing "next_action"; missing "question". Call again.',
			'The result was not recorded: "met" must be a boolean, got string. Call again.',
			"Result recorded.",
		]);
		expect(steps[0]!.doc.refusals).toBe(2);
		expect(result.kind).toBe("completed");
		expect(result.variables.met).toBe(true);
	});
});

describe("Refused results are bounded per step", () => {
	it("Scenario: A model that never fixes its result stops after three tries", async () => {
		// The live run of 2026-10-11: the judge sent this every 5 s for 30 minutes. Answered forever here.
		const { env, result, steps } = await run(JUDGE, ["judge"], Array.from({ length: 20 }, () => submit(LIVE_RUN_ANSWER)));

		expect(env.requests).toHaveLength(3);
		expect(result.kind).toBe("failed");
		const outcome = result.steps[0]?.outcome;
		expect(outcome).toMatchObject({ kind: "failed", category: "unknown" });
		const message = outcome?.kind === "failed" ? outcome.message : "";
		expect(message).toContain("refused 3 times");
		expect(message).toContain('"met" must be a boolean');
		expect(message).toBe(
			`the step's result was refused 3 times; last: The result was not recorded: "met" must be a boolean, got string. Call again.`,
		);
		expect(steps[0]!.doc).toMatchObject({ result: null, refusals: 3 });
		expect(steps[0]!.results).toHaveLength(3);
	});

	it("refusals count per step: two refusals, then an accepted result, completes", async () => {
		const good = submit({ met: true, unmet: "", next_action: "retry", question: "" });
		const { env, result, steps } = await run(JUDGE, ["judge"], [submit(LIVE_RUN_ANSWER), submit(LIVE_RUN_ANSWER), good]);

		expect(env.requests).toHaveLength(3);
		expect(result.kind).toBe("completed");
		expect(steps[0]!.doc).toMatchObject({ refusals: 2, result: { met: true } });
	});
});

describe("submit_result records an accepted result or hands the problem back", () => {
	it("Scenario: A bad result is handed back and the model retries within the same step", async () => {
		const { env, result, steps } = await run(PIPELINE, ENTRIES, [submit({ severity: 3 }), submit({ severity: "high" }), fauxAssistantMessage([fauxText("ok")])]);

		expect(JSON.stringify(env.requests[1])).toContain('\\"severity\\" must be a string, got number');
		expect(result.variables.severity).toBe("high");
		expect(env.requests).toHaveLength(3);
		// The refusal wrote nothing but the count.
		expect(steps[0]!.doc).toMatchObject({ refusals: 1, result: { severity: "high" } });
	});

	it("Scenario: An accepted result ends the step", async () => {
		const { env, steps } = await run(PIPELINE, ENTRIES, [submit({ severity: "low" }), fauxAssistantMessage([fauxText("ok")])]);

		expect(steps[0]!.results).toEqual([{ isError: false, text: "Result recorded." }]);
		expect(steps[0]!.doc).toMatchObject({ result: { severity: "low" }, refusals: 0 });
		// control.terminate ended classify's turn: one request for it, one for respond.
		expect(env.requests).toHaveLength(2);
	});
});
