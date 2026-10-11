import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { next, start, type RunResult, type RunState } from "../../src/interpreter/index.js";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage, type ConversationId, type StorageWrite, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { AgentScriptRun, RESULT_TOOL, runScript, startScript, waitForScript } from "../../src/durable/index.js";
import { context, ENTRIES, openHarness, PIPELINE, setup } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Plain Node runs the TypeScript fixtures; this hook maps their `.js` imports to `.ts`.
const TS_HOOK = join(HERE, "fixtures", "ts-resolve.mjs");
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const classified = (severity: string) =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity })], { stopReason: "toolUse" });

/** MemoryStorage that keeps every commit's writes, in order, so tests can read what was committed. */
class RecordingStorage extends MemoryStorage {
	readonly commits: StorageWrite[][] = [];
	override async commit(writes: readonly StorageWrite[], ctx: Parameters<MemoryStorage["commit"]>[1]) {
		this.commits.push([...writes]);
		return super.commit(writes, ctx);
	}
	get writes(): StorageWrite[] {
		return this.commits.flat();
	}
}

type Checkpoint = { phase: string; step?: number; conversationId?: ConversationId; state: RunState };

/** The run task's committed states: each checkpoint, then `terminal`. The scheduler's pending → running flip of a phase is one entry. */
function runTaskStates(storage: RecordingStorage): { label: string; checkpoint?: Checkpoint }[] {
	const states: { label: string; checkpoint?: Checkpoint }[] = [];
	for (const write of storage.writes) {
		if (write.type !== "task" || write.value.kind !== "agentscript.run") continue;
		const state = write.value.state;
		if (state.status === "pending") continue;
		if (state.status === "terminal") {
			states.push({ label: "terminal" });
			continue;
		}
		const checkpoint = state.checkpoint as unknown as Checkpoint;
		const label = checkpoint.step === undefined ? checkpoint.phase : `${checkpoint.phase}:${checkpoint.step}`;
		if (states.at(-1)?.label === label) continue;
		states.push({ label, checkpoint });
	}
	return states;
}

/** Run the child that dies inside one commit; it exits 137 by design. */
function crashOnCommit(dbPath: string, mode: "dispatch" | "answered"): { out: string; status: number | null } {
	try {
		const out = execFileSync(process.execPath, ["--import", TS_HOOK, join(HERE, "fixtures", "crash-on-commit-child.ts"), dbPath, mode], {
			encoding: "utf8",
			timeout: 60_000,
		});
		return { out, status: 0 };
	} catch (error) {
		const e = error as { stdout?: string; status?: number | null };
		return { out: e.stdout ?? "", status: e.status ?? null };
	}
}

function crashedDb(mode: "dispatch" | "answered") {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-phases-"));
	dirs.push(dir);
	const dbPath = join(dir, "run.sqlite");
	const child = crashOnCommit(dbPath, mode);
	expect(child.out).toContain("CRASH");
	expect(child.status).toBe(137);
	const id = Number(/TASK (\d+)/.exec(child.out)?.[1]) as TaskId<RunResult>;
	expect(Number.isInteger(id)).toBe(true);
	return { dbPath, id };
}

/** A run of the pipeline with both model steps answered, on recording storage. */
async function recordedPipeline(severity = "high") {
	const env = setup();
	const storage = new RecordingStorage();
	const harness = await openHarness(storage, env);
	env.faux.setResponses([classified(severity), fauxAssistantMessage([fauxText("Done.")])]);
	const result = await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
	await harness.close(context);
	return { env, storage, result };
}

describe("The initial checkpoint is the step machine's first state", () => {
	it("Scenario: A valid script creates a task at phase next", async () => {
		const env = setup();
		const harness = await openHarness(new MemoryStorage(), env);
		const id = await startScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		const task = await harness.getTask(id, context);
		await harness.close(context);

		expect(task?.kind).toBe("agentscript.run");
		const checkpoint = (task?.state as { checkpoint?: Checkpoint }).checkpoint;
		expect(checkpoint?.phase).toBe("next");
		expect(checkpoint?.state.cursor).toBe(0);
		expect(checkpoint?.state.steps).toEqual([]);
		expect(checkpoint?.state.awaiting).toBeUndefined();
		expect(checkpoint?.state.variables).toEqual({ report: "it crashes", severity: "", urgent: false });
		expect(env.requests).toHaveLength(0);
	});
});

describe("Checkpoints have exactly three phases", () => {
	it("Scenario: A two-model-step script walks the phases in order", async () => {
		const { storage, result } = await recordedPipeline();

		expect(result.steps.map((s) => s.subagent)).toEqual(["classify", "respond"]);
		// gate is logic only: it never gets a dispatch or an await of its own.
		expect(runTaskStates(storage).map((s) => s.label)).toEqual([
			"next",
			"dispatch:0",
			"await:0",
			"next",
			"dispatch:1",
			"await:1",
			"next",
			"terminal",
		]);
	});
});

describe("The step number is the index of the step being run", () => {
	it("Scenario: The first and second model steps are numbered 0 and 1", async () => {
		const { storage } = await recordedPipeline();

		const steps = runTaskStates(storage)
			.filter((s) => s.checkpoint?.phase === "dispatch" || s.checkpoint?.phase === "await")
			.map((s) => ({ phase: s.checkpoint?.phase, step: s.checkpoint?.step, awaiting: s.checkpoint?.state.awaiting?.subagent }));
		expect(steps).toEqual([
			{ phase: "dispatch", step: 0, awaiting: "classify" },
			{ phase: "await", step: 0, awaiting: "classify" },
			{ phase: "dispatch", step: 1, awaiting: "respond" },
			{ phase: "await", step: 1, awaiting: "respond" },
		]);
		// step is state.steps.length at the moment `next` produced the request.
		for (const s of runTaskStates(storage)) {
			if (s.checkpoint?.step !== undefined) expect(s.checkpoint.step).toBe(s.checkpoint.state.steps.length);
		}
	});
});

describe("The next phase asks the step machine and either finishes or schedules a dispatch", () => {
	it("Scenario: A completed task carries no rewritten source", async () => {
		const { result, storage } = await recordedPipeline();

		expect(result.kind).toBe("completed");
		expect("updatedSource" in result).toBe(false);
		const terminal = storage.writes.find(
			(w) => w.type === "task" && w.value.kind === "agentscript.run" && w.value.state.status === "terminal",
		);
		expect(terminal).toBeDefined();
		const outcome = (terminal as Extract<StorageWrite, { type: "task" }>).value.state.outcome as { result: object };
		expect("updatedSource" in outcome.result).toBe(false);
	});
});

describe("The dispatch phase creates one fresh task-owned conversation per step in one commit", () => {
	it("Scenario: A crash during dispatch leaves no orphan conversation", async () => {
		const { dbPath, id } = crashedDb("dispatch");

		// The dying commit never landed: the task still waits to dispatch, and owns nothing.
		const storage = await openNodeSqliteStorage(dbPath);
		const env = setup();
		env.faux.setResponses([classified("high"), fauxAssistantMessage([fauxText("Escalated.")])]);
		const harness = await openHarness(storage, env);
		const stranded = (await harness.getTask(id, context))?.state as { checkpoint?: Checkpoint };
		expect(stranded.checkpoint).toMatchObject({ phase: "dispatch", step: 0 });
		const ownedBefore = await storage.scanConversations({ ownerTaskId: id }, 10, undefined, context);
		expect(ownedBefore.items).toEqual([]);

		harness.resume();
		const result = await waitForScript(harness, id, context);
		const ownedAfter = await storage.scanConversations({ ownerTaskId: id }, 10, undefined, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables).toMatchObject({ severity: "high", urgent: true });
		// one conversation per model step, none left over from the lost dispatch
		expect(ownedAfter.items).toHaveLength(2);
	}, 90_000);

	it("creates the conversation and checkpoints await in one commit", async () => {
		const { storage } = await recordedPipeline();

		const creating = storage.commits.filter((writes) => writes.some((w) => w.type === "conversation" && w.value.owner?.taskId !== undefined));
		expect(creating).toHaveLength(2);
		for (const writes of creating) {
			const created = writes.flatMap((w) => (w.type === "conversation" ? [w.value.id] : []));
			const checkpoints = writes.flatMap((w) =>
				w.type === "task" && w.value.kind === "agentscript.run" ? [w.value.state.checkpoint as unknown as Checkpoint] : [],
			);
			expect(checkpoints).toHaveLength(1);
			expect(checkpoints[0]?.phase).toBe("await");
			expect(created).toEqual([checkpoints[0]?.conversationId]);
		}
	});

	it("Scenario: Each step gets its own conversation", async () => {
		const { storage } = await recordedPipeline();

		const conversations = storage.writes.flatMap((w) =>
			w.type === "conversation" && w.value.owner?.taskId !== undefined ? [w.value] : [],
		);
		expect(conversations).toHaveLength(2);
		expect(new Set(conversations.map((c) => c.id)).size).toBe(2);
		expect(new Set(conversations.map((c) => c.owner?.taskId)).size).toBe(1);
	});

	it("Scenario: Dispatch with nothing awaiting is an error", async () => {
		const state = start(PIPELINE, { entry: ENTRIES });
		expect(state.awaiting).toBeUndefined();
		const task = { input: { source: PIPELINE }, state: { checkpoint: { phase: "dispatch", state, step: 0 } } };
		const phases = AgentScriptRun.definition.phases as unknown as Record<string, (...args: unknown[]) => Promise<void>>;

		await expect(phases.dispatch!(task, {}, context)).rejects.toThrow(/^dispatch reached with no step awaiting$/);
	});
});

describe("A step conversation is configured with the script's system block, the step extension, and only the tools the step needs", () => {
	it("Scenario: Without a model in the input, no model is configured", async () => {
		const env = setup();
		const harness = await openHarness(new MemoryStorage(), env);
		env.faux.setResponses([fauxAssistantMessage([fauxText("never asked")])]);
		const hello = 'config:\n    agent_name: "a"\n\nsystem:\n    instructions: "x"\n\nsubagent s:\n    description: "d"\n    reasoning:\n        instructions: ->\n            | hi\n';

		const id = await startScript(harness, hello, {}, context);
		const task = await harness.getTask(id, context);
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect("model" in (task?.input as object)).toBe(false);
		// Nothing was configured and the conversation has no default model of its own.
		expect(result.kind).toBe("failed");
		expect(result.steps[0]?.outcome).toEqual({
			kind: "failed",
			category: "unknown",
			message: "the step was not answered: no_model",
		});
		expect(env.requests).toHaveLength(0);
	});
});

describe("The await phase submits the prompt idempotently and folds the answer into the machine", () => {
	it("Scenario: A re-run await phase does not start a second model turn", async () => {
		const { dbPath, id } = crashedDb("answered");

		const storage = await openNodeSqliteStorage(dbPath);
		const env = setup();
		// Only respond's answer: a second classify turn would take it, answer in text, and fail the run.
		env.faux.setResponses([fauxAssistantMessage([fauxText("Escalated.")])]);
		const harness = await openHarness(storage, env);
		const stranded = (await harness.getTask(id, context))?.state as { checkpoint?: Checkpoint };
		// The model already answered step 0, but the commit that folds it in was lost.
		expect(stranded.checkpoint).toMatchObject({ phase: "await", step: 0 });
		const requestId = `agentscript:${id}:0`;
		const conversationId = stranded.checkpoint?.conversationId as ConversationId;
		const submitted = await storage.submissionByRequest(conversationId, requestId, context);
		expect(submitted?.id).toBeDefined();

		harness.resume();
		const result = await waitForScript(harness, id, context);
		const again = await storage.submissionByRequest(conversationId, requestId, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.steps.map((s) => s.subagent)).toEqual(["classify", "respond"]);
		expect(result.steps[0]?.outcome).toMatchObject({ kind: "answered", structured: { severity: "high" } });
		// The same submission came back, and the only model request was respond's.
		expect(again?.id).toBe(submitted?.id);
		expect(env.requests).toHaveLength(1);
		expect(JSON.stringify(env.requests[0])).toContain("Write an urgent reply about: it crashes");
	}, 90_000);

	it("Scenario: Await with nothing awaiting is an error", async () => {
		const state = start(PIPELINE, { entry: ENTRIES });
		const task = {
			input: { source: PIPELINE },
			state: { checkpoint: { phase: "await", state, step: 0, conversationId: 1 } },
		};
		const phases = AgentScriptRun.definition.phases as unknown as Record<string, (...args: unknown[]) => Promise<void>>;

		await expect(phases.await!(task, {}, context)).rejects.toThrow(/^await reached with no step awaiting$/);
	});
});

describe("A step that was not answered maps to a failed outcome", () => {
	it("Scenario: A provider error settles as a failed step", async () => {
		const env = setup();
		const harness = await openHarness(new MemoryStorage(), env);
		env.faux.setResponses([classified("high")]); // nothing queued for respond: the provider errors
		const result = await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		await harness.close(context);

		const outcome = result.steps[1]?.outcome;
		expect(outcome).toMatchObject({ kind: "failed", category: "unknown" });
		expect(outcome?.kind === "failed" && outcome.message.startsWith("the step was not answered:")).toBe(true);
	});

	it("Scenario: A missing step conversation is a failed step", async () => {
		const requested = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (requested.type !== "request") throw new Error("expected the pipeline to ask for a step");
		const task = {
			input: { source: PIPELINE, options: { entry: ENTRIES } },
			state: { checkpoint: { phase: "await", state: requested.state, step: 0, conversationId: 999 } },
		};
		let committed: { checkpoint: { phase: string; state: RunState } } | undefined;
		const runtime = {
			taskId: 1,
			conversation: async () => undefined,
			commit: async (change: () => typeof committed) => {
				committed = change();
			},
		};
		const phases = AgentScriptRun.definition.phases as unknown as Record<string, (...args: unknown[]) => Promise<void>>;

		await phases.await!(task, runtime, context);

		expect(committed?.checkpoint.phase).toBe("next");
		expect(committed?.checkpoint.state.stopped).toBe("failed");
		expect(committed?.checkpoint.state.steps[0]?.outcome).toEqual({
			kind: "failed",
			category: "unknown",
			message: "step conversation 999 is missing",
		});
	});
});

describe("The agentscript.step doc holds each step's schema and accepted result", () => {
	/** The step docs as first committed, in creation order. */
	async function stepDocsAtDispatch() {
		const { storage } = await recordedPipeline();
		return storage.writes.flatMap((w) =>
			w.type === "document.create" && w.record.kind === "agentscript.step" ? [w.content.value] : [],
		);
	}

	it("Scenario: A fresh step conversation starts empty and gets its schema at dispatch", async () => {
		const docs = await stepDocsAtDispatch();

		expect(docs[0]).toEqual({
			schema: {
				type: "object",
				properties: { severity: { type: "string" } },
				required: ["severity"],
				additionalProperties: false,
			},
			result: null,
		});
	});

	it("Scenario: A text-only step's doc has no schema", async () => {
		const docs = await stepDocsAtDispatch();

		expect(docs).toHaveLength(2);
		expect(docs[1]).toEqual({ schema: null, result: null });
	});
});
