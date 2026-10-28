import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type AssistantMessage } from "@earendil-works/pi-ai";
import {
	createRegistry,
	defineExtension,
	defineTask,
	Harness,
	MemoryStorage,
	type ModelRef,
	type Storage,
	type TaskId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { RunEvent, RunResult, VariableValue } from "../../src/interpreter/index.js";
import {
	agentScriptExtensions,
	createActionRegistry,
	RESULT_TOOL,
	startScript,
	waitForScript,
	watchScript,
	type ExecutedHostAction,
} from "../../src/durable/index.js";
import { context, HELLO, HELLO_ENTRIES, memoryHarness, openHarness, setup } from "./helpers.js";
import { SIGNATURES } from "./action-scripts.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

const REPLIES = () => [fauxAssistantMessage([fauxText("Hello, Ada.")]), fauxAssistantMessage([fauxText("Goodbye, Ada.")])];

async function collect(stream: AsyncIterable<RunEvent>, delayMs = 0): Promise<RunEvent[]> {
	const events: RunEvent[] = [];
	for await (const event of stream) {
		events.push(event);
		if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	return events;
}

/** The step and run events, as `type step`. */
function outline(events: readonly RunEvent[]): string[] {
	return events
		.filter((e) => e.type === "step_start" || e.type === "step_end" || e.type === "run_end")
		.map((e) => (e.type === "run_end" ? "run_end" : `${e.type} ${e.step}`));
}

async function started(replies: Parameters<ReturnType<typeof setup>["faux"]["setResponses"]>[0] = REPLIES()) {
	const { env, harness: opening } = memoryHarness();
	const harness = await opening;
	env.faux.setResponses(replies);
	const id = await startScript(harness, HELLO, { entry: HELLO_ENTRIES, model: env.model }, context);
	return { env, harness, id };
}

describe("watchScript", () => {
	it("Scenario: A durable run watched from the start reports every step", async () => {
		const { harness, id } = await started();
		const watch = watchScript(harness, id, context);
		harness.resume();

		const events = await collect(watch);
		const result = await watch.result;
		const waited = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(outline(events)).toEqual(["step_start 0", "step_end 0", "step_start 1", "step_end 1", "run_end"]);
		expect(result).toEqual(waited);
		expect(events.at(-1)).toEqual({ type: "run_end", result: waited });
		expect(events.find((e) => e.type === "step_end" && e.step === 0)).toMatchObject({
			subagent: "greet",
			outcome: { kind: "answered", text: "Hello, Ada." },
		});
		// Every event of a step comes between its start and its end, tagged with it.
		for (const step of [0, 1]) {
			const from = events.findIndex((e) => e.type === "step_start" && e.step === step);
			const to = events.findIndex((e) => e.type === "step_end" && e.step === step);
			const tagged = events.filter((e) => e.type !== "run_end" && e.step === step);
			expect(tagged).toEqual(events.slice(from, to + 1));
			const text = tagged.map((e) => (e.type === "text_delta" ? e.delta : "")).join("");
			expect(text).toBe(waited.steps[step]?.outcome.kind === "answered" ? waited.steps[step].outcome.text : "");
		}
	});

	it("Scenario: Attaching mid-run replays the finished steps", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let reached!: () => void;
		const secondAsked = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const { harness, id } = await started([
			fauxAssistantMessage([fauxText("Hello, Ada.")]),
			async (): Promise<AssistantMessage> => {
				reached();
				await gate;
				return fauxAssistantMessage([fauxText("Goodbye, Ada.")]);
			},
		]);
		harness.resume();
		// The second model request is made only once step 0 is applied and step 1 dispatched.
		await secondAsked;
		const record = await harness.getTask(id, context);
		expect((record?.state as { checkpoint?: { state: { steps: unknown[] } } }).checkpoint?.state.steps).toHaveLength(1);

		const watch = watchScript(harness, id, context);
		const collecting = collect(watch);
		release();
		const events = await collecting;
		const waited = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(events.slice(0, 2)).toEqual([
			{ type: "step_start", step: 0, subagent: "greet" },
			{ type: "step_end", step: 0, subagent: "greet", outcome: waited.steps[0]?.outcome },
		]);
		expect(outline(events)).toEqual(["step_start 0", "step_end 0", "step_start 1", "step_end 1", "run_end"]);
		// The replayed step carries no deltas.
		expect(events.filter((e) => e.type === "text_delta" && e.step === 0)).toEqual([]);
		expect(await watch.result).toEqual(waited);
	});

	it("Scenario: Attaching after the end yields the history", async () => {
		const { harness, id } = await started();
		const waited = await waitForScript(harness, id, context);

		const watch = watchScript(harness, id, context);
		const events = await collect(watch);
		await harness.close(context);

		expect(events).toEqual([
			{ type: "step_start", step: 0, subagent: "greet" },
			{ type: "step_end", step: 0, subagent: "greet", outcome: waited.steps[0]?.outcome },
			{ type: "step_start", step: 1, subagent: "farewell" },
			{ type: "step_end", step: 1, subagent: "farewell", outcome: waited.steps[1]?.outcome },
			{ type: "run_end", result: waited },
		]);
		expect(await watch.result).toEqual(waited);
	});

	it("Scenario: Two watchers see the same events", async () => {
		const { harness, id } = await started();
		const fast = watchScript(harness, id, context);
		const slow = watchScript(harness, id, context);
		harness.resume();

		const [quick, lagging] = await Promise.all([collect(fast), collect(slow, 5)]);
		await harness.close(context);

		expect(outline(quick)).toEqual(["step_start 0", "step_end 0", "step_start 1", "step_end 1", "run_end"]);
		expect(lagging).toEqual(quick);
	});

	it("Scenario: stop leaves the run running", async () => {
		const { harness, id } = await started();
		const watch = watchScript(harness, id, context);
		harness.resume();

		const events: RunEvent[] = [];
		for await (const event of watch) {
			events.push(event);
			if (event.type === "step_start") await watch.stop();
		}
		const waited = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(events).toEqual([{ type: "step_start", step: 0, subagent: "greet" }]);
		expect(waited.kind).toBe("completed");
		expect(waited.steps).toHaveLength(2);
	});

	it("Scenario: A watched run with and without a watcher ends the same", async () => {
		const run = async (watched: boolean): Promise<RunResult> => {
			const env = setup();
			const harness = await openHarness(new MemoryStorage(), env);
			env.faux.setResponses(REPLIES());
			const id = await startScript(harness, HELLO, { entry: HELLO_ENTRIES, model: env.model }, context);
			const watch = watched ? watchScript(harness, id, context) : undefined;
			const events = watch !== undefined ? collect(watch) : Promise.resolve([]);
			harness.resume();
			const result = await waitForScript(harness, id, context);
			await events;
			await harness.close(context);
			return result;
		};

		expect(await run(true)).toEqual(await run(false));
	});

	it("rejects result and throws from the iterator for an id that is not a run", async () => {
		const { harness } = await started();
		const missing = 9999 as TaskId<RunResult>;
		const message = await waitForScript(harness, missing, context).then(
			() => "resolved",
			(error: Error) => error.message,
		);

		const watch = watchScript(harness, missing, context);
		await expect(watch.result).rejects.toThrow(message);
		await expect(collect(watch)).rejects.toThrow(message);
		await harness.close(context);
	});

	it("rejects result and throws from the iterator for a task of another kind", async () => {
		const other = defineTask<object, { phase: "next" }, string>({
			name: "test.other",
			version: 1,
			initial: () => ({ phase: "next" }),
			phases: {
				next: async (_task, runtime, ctx) => {
					await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: "done" } }), ctx);
				},
			},
			abort: async (_task, runtime, ctx) => {
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), ctx);
			},
		});
		const env = setup();
		env.registry.install(defineExtension({ name: "test.other", tasks: [other] }));
		const harness = await openHarness(new MemoryStorage(), env);
		const root = await harness.root(context);
		const id = (await root.commit((tx) => tx.createTask(other, {}, { ownership: { kind: "conversation" } }), context)) as unknown as TaskId<RunResult>;
		const message = `task ${String(id)} is a test.other task, not agentscript.run`;

		const watch = watchScript(harness, id, context);
		await expect(watch.result).rejects.toThrow(message);
		await expect(collect(watch)).rejects.toThrow(message);
		await harness.close(context);
	});
});

/** One model step answering in text. */
const GREET = `config:
    agent_name: "greet"

system:
    instructions: "You greet people."

subagent greet:
    description: "Say hello"

    reasoning:
        instructions: ->
            | Say hello.
`;

/** One model step offering `read` (read_file bound to the model's `path`). */
const READER = `config:
    agent_name: "reader"

system:
    instructions: "You read files."

variables:
    content: mutable string = ""

subagent look:
    description: "Read a file"

    actions:
        read_file:
            description: "Read a file in the workspace"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"

    reasoning:
        instructions: ->
            | Read notes.txt and say what it holds.
        actions:
            read: @actions.read_file
                with path = ...
                set @variables.content = @outputs.content
`;

const STORAGES: [string, () => Promise<Storage>][] = [
	["memory", async () => new MemoryStorage()],
	["node SQLite", () => openNodeSqliteStorage(join(temp("agentscript-watch-"), "run.sqlite"))],
];

/**
 * A harness over a faux provider that streams each reply in 4-character chunks,
 * 50 ms apart, committing partials every 20 ms, with Agent Script over `actions`.
 */
async function streamingHarness(storage: Storage, actions: ExecutedHostAction[] = []) {
	const faux = fauxProvider({ tokenSize: { min: 1, max: 1 }, tokensPerSecond: 20 });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	const installed = agentScriptExtensions({ actions: createActionRegistry(actions), workspace: temp("agentscript-ws-") });
	registry.install(installed.run);
	registry.install(installed.step);
	const fauxModel = faux.getModel();
	const model: ModelRef = { provider: fauxModel.provider, modelId: fauxModel.id };
	const harness = await Harness.open(storage, { models, registry, settings: { progress: { partialIntervalMs: 20 } } }, context);
	return { faux, harness, model };
}

/** The events between step `step`'s `step_start` and `step_end`, both excluded. */
function within(events: readonly RunEvent[], step: number): RunEvent[] {
	const from = events.findIndex((e) => e.type === "step_start" && e.step === step);
	const to = events.findIndex((e) => e.type === "step_end" && e.step === step);
	expect(from).toBeGreaterThanOrEqual(0);
	expect(to).toBeGreaterThan(from);
	return events.slice(from + 1, to);
}

describe.each(STORAGES)("watchScript live events on %s storage", (_name, open) => {
	it("Scenario: A step's deltas join to its text", async () => {
		const { faux, harness, model } = await streamingHarness(await open());
		faux.setResponses([fauxAssistantMessage([fauxText("Hello there.")])]);
		const id = await startScript(harness, GREET, { model }, context);
		const watch = watchScript(harness, id, context);
		harness.resume();

		const events = await collect(watch);
		const waited = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(waited.kind).toBe("completed");
		const outcome = waited.steps[0]?.outcome;
		expect(outcome).toMatchObject({ kind: "answered", text: "Hello there." });
		const deltas = within(events, 0).filter((e) => e.type === "text_delta");
		// More than one: the conversation's commits arrived live, not only the outcome's catch-up at `step_end`.
		expect(deltas.length).toBeGreaterThan(1);
		expect(deltas.map((e) => (e.type === "text_delta" ? e.delta : "")).join("")).toBe(
			outcome?.kind === "answered" ? outcome.text : undefined,
		);
		expect(events.filter((e) => e.type === "text_delta")).toEqual(deltas);
	});

	it("Scenario: A tool step reports its call and result", async () => {
		const calls: Readonly<Record<string, VariableValue>>[] = [];
		const read: ExecutedHostAction = {
			name: "read_file",
			...SIGNATURES.read_file,
			execute: async (inputs) => {
				calls.push(inputs);
				return { ok: true, outputs: { content: "remember the milk" } };
			},
		};
		const { faux, harness, model } = await streamingHarness(await open(), [read]);
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "notes.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("It says to remember the milk.")]),
		]);
		const id = await startScript(harness, READER, { model }, context);
		const watch = watchScript(harness, id, context);
		harness.resume();

		const events = await collect(watch);
		const waited = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(waited.kind).toBe("completed");
		expect(calls).toEqual([{ path: "notes.txt" }]);
		const step = within(events, 0);
		const tools = step.filter((e) => e.type === "tool_call" || e.type === "tool_result");
		expect(tools).toEqual([
			{ type: "tool_call", name: "read", inputs: { path: "notes.txt" }, step: 0, subagent: "look" },
			{ type: "tool_result", name: "read", ok: true, outputs: { content: "remember the milk" }, step: 0, subagent: "look" },
		]);
		// As the step's `toolCalls` record it.
		const recorded = waited.steps[0]?.outcome.kind === "answered" ? waited.steps[0].outcome.toolCalls : undefined;
		expect(recorded).toEqual([{ name: "read", inputs: { path: "notes.txt" }, ok: true, outputs: { content: "remember the milk" } }]);
		expect(events.filter((e) => e.type === "tool_call" || e.type === "tool_result")).toEqual(tools);
		expect(events.some((e) => (e.type === "tool_call" || e.type === "tool_result") && e.name === RESULT_TOOL)).toBe(false);
	});
});
