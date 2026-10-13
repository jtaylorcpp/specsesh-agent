import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Models } from "@earendil-works/pi-ai";
import { Harness, MemoryStorage, type Storage, type TaskId } from "@earendil-works/pi-durable";
import type { Escalation, LoopOutcome } from "../../src/openspec/index.js";
import * as task from "../../src/task/index.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import { SPEC_LOOP, type SpecLoopInput } from "../../src/task/spec-loop.js";
import type { SpecStage, StageContext, StageIssue } from "../../src/task/spec-stage.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context } from "./helpers.js";
import { STAGE_SCRIPT, draft, specWorkspace } from "./spec-helpers.js";

afterEach(cleanTemps);

/** Every owned file is present and not empty: a gate with no `openspec` binary. */
const present = ({ files }: StageContext): StageIssue[] =>
	Object.keys(files).length > 0 && Object.values(files).every((text) => text.trim() !== "")
		? []
		: [{ level: "ERROR", path: ".", message: "an owned file is missing or empty" }];

/** A gate no draft passes, so the stage's loop runs out of budget. */
const never = (): StageIssue[] => [{ level: "ERROR", path: "design.md", message: "never good enough" }];

const stage = (name: string, owns: string[], after?: string, gate: SpecStage["gate"] = present): SpecStage => ({
	name,
	owns,
	script: { text: STAGE_SCRIPT },
	...(after !== undefined ? { after: [after] } : {}),
	gate,
});

const stages = [stage("proposal", ["proposal.md"]), stage("design", ["design.md"], "proposal")];

const CHANGE = "add-plan-export";

/** A blocked outcome's escalation; only that branch of the union has one. */
const escalationOf = (outcome: { status: string; escalation?: Escalation }) => outcome.escalation;

/** Writes `proposal.md` and approves the proposal stage, as `answerSpecLoop` records it. */
function approveProposal(changeDir: string, over: readonly SpecStage[] = stages) {
	writeFileSync(join(changeDir, "proposal.md"), "## Why\n\nCSV and JSON.\n");
	recordApproval(changeDir, over[0]!, { principal: "jesse", notes: "", at: "2026-10-01T00:00:00.000Z" }, over);
}

/** Every spec loop in `storage`: its ID and input. */
async function specLoops(storage: Storage) {
	return (await storage.scanTasks({ kind: SPEC_LOOP }, 100, undefined, context)).items.map((record) => ({
		id: record.id,
		input: record.input as unknown as SpecLoopInput,
	}));
}

/** A host with `draftLoopExtensions` installed over `over`; `before` prepares the change directory. */
async function host(
	body: (h: { harness: Harness; env: ReturnType<typeof setup>; options: task.DraftLoopOptions; storage: Storage }) => Promise<void>,
	{ before, over = stages, maxIterations }: { before?: (changeDir: string) => void; over?: readonly SpecStage[]; maxIterations?: number } = {},
) {
	const { workspace, changeDir } = specWorkspace(CHANGE);
	before?.(changeDir);
	const env = setup();
	for (const extension of task.draftLoopExtensions({ workspace, stages: over })) env.registry.install(extension);
	const storage = new MemoryStorage();
	const harness = await openHarness(storage, env);
	const options: task.DraftLoopOptions = {
		change: CHANGE,
		intent: "Export a plan as CSV or JSON",
		workspace,
		stages: over,
		model: env.model,
		...(maxIterations !== undefined ? { budget: { maxIterations } } : {}),
	};
	try {
		await body({ harness, env, options, storage });
	} finally {
		await harness.close(context);
	}
}

async function run(harness: Harness, options: task.DraftLoopOptions): Promise<LoopOutcome<task.DraftOutcome>> {
	const id = await task.startDraftLoop(harness, options, context);
	harness.resume();
	return task.waitForDraftLoop(harness, id, context);
}

/** The same Models, whose every streamed request calls `onRequest` and then never answers: the process died mid-request. */
function stalled(models: Models, onRequest: () => void): Models {
	return new Proxy(models, {
		get(target, prop, receiver) {
			if (prop === "streamSimple" || prop === "stream") {
				return () => {
					onRequest();
					const never = () => new Promise<never>(() => {});
					return { [Symbol.asyncIterator]: () => ({ next: never }), result: never };
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

describe("spec/draft: The draft loop is one durable task with three phases", () => {
	it("Scenario: Killed while a stage drafts", async () => {
		const { workspace, changeDir } = specWorkspace(CHANGE);
		const storage = new MemoryStorage();
		const options = (model: task.DraftLoopOptions["model"]): task.DraftLoopOptions => ({
			change: CHANGE,
			intent: "Export a plan as CSV or JSON",
			workspace,
			stages,
			model,
		});

		// The first process reaches the proposal's model request, and dies there: never closed, never answered.
		const first = setup();
		for (const extension of task.draftLoopExtensions({ workspace, stages })) first.registry.install(extension);
		let died = () => {};
		const requested = new Promise<void>((resolve) => (died = resolve));
		const dead = await Harness.open(storage, { models: stalled(first.models, () => died()), registry: first.registry }, context);
		const id = await task.startDraftLoop(dead, options(first.model), context);
		dead.resume();
		await requested;

		const stranded = await storage.task(id as unknown as TaskId, context);
		const checkpoint = (stranded?.state as { checkpoint?: { phase: string; stage?: string; child?: number } }).checkpoint;
		const before = await specLoops(storage);

		// A fresh process on the same storage resumes the draft.
		const env = setup();
		for (const extension of task.draftLoopExtensions({ workspace, stages })) env.registry.install(extension);
		const harness = await openHarness(storage, env);
		env.faux.setResponses([draft("=== proposal.md\n## Why\n\nCSV and JSON.\n")]);
		harness.resume();
		try {
			const outcome = await task.waitForDraftLoop(harness, id, context);
			const after = await specLoops(storage);

			expect(checkpoint).toMatchObject({ phase: "stage", stage: "proposal" });
			expect(before.map((loop) => loop.id)).toEqual([checkpoint?.child]);
			// The same spec loop finished the proposal; no second one started.
			expect(after.map((loop) => loop.id)).toEqual([checkpoint?.child]);
			expect(after.map((loop) => loop.input.stage.name)).toEqual(["proposal"]);
			expect(outcome).toMatchObject({
				status: "blocked",
				escalation: { reason: "review" },
				result: { change: CHANGE, stages: [{ stage: "proposal", approved: false, runs: 1 }] },
			});
			expect(escalationOf(outcome)?.question).toContain("proposal.md");
			expect(readFileSync(join(changeDir, "proposal.md"), "utf8")).toBe("## Why\n\nCSV and JSON.\n");
		} finally {
			await harness.close(context);
		}
	});
});

describe("spec/draft: A stage runs as a child spec loop, and its block blocks the draft", () => {
	it("Scenario: A review blocks the draft", async () => {
		await host(async ({ harness, env, options, storage }) => {
			env.faux.setResponses([draft("=== proposal.md\n## Why\n\nCSV and JSON.\n")]);
			const outcome = await run(harness, options);
			const loops = await specLoops(storage);
			const child = await task.waitForSpecLoop(harness, loops[0]!.id as never, context);

			expect(loops.map((loop) => loop.input.stage.name)).toEqual(["proposal"]);
			expect(child.status).toBe("blocked");
			expect(outcome.status).toBe("blocked");
			// The child's escalation, unchanged.
			expect(escalationOf(outcome)).toEqual(escalationOf(child));
			expect(escalationOf(outcome)).toMatchObject({ reason: "review", to: "principal" });
			expect(escalationOf(outcome)?.question).toContain("proposal.md");
		});
	});

	it("Scenario: An exhausted stage fails the draft", async () => {
		const over = [stage("proposal", ["proposal.md"]), stage("design", ["design.md"], "proposal", never)];
		await host(
			async ({ harness, env, options, storage }) => {
				env.faux.setResponses([draft("=== design.md\n## Context\n\nNot enough.\n")]);
				const outcome = await run(harness, options);
				const loops = await specLoops(storage);

				expect(loops.map((loop) => loop.input.stage.name)).toEqual(["design"]);
				expect((await task.waitForSpecLoop(harness, loops[0]!.id as never, context)).status).toBe("exhausted");
				expect(outcome.status).toBe("failed");
				expect(outcome.result).toEqual({
					change: CHANGE,
					stages: [
						{ stage: "proposal", approved: true, runs: 0 },
						{ stage: "design", approved: false, runs: 1 },
					],
				});
				const settled = await storage.task(loops[0]!.id, context);
				const owner = settled?.owner;
				const draftRecord = owner === undefined ? undefined : await storage.task(owner as unknown as TaskId, context);
				const notes = (draftRecord?.state as { outcome?: { result?: { notes?: string[] } } }).outcome?.result?.notes ?? [];
				expect(notes.join("\n")).toMatch(/the design stage ended exhausted/);
			},
			{ over, maxIterations: 1, before: (changeDir) => approveProposal(changeDir, over) },
		);
	});
});

describe("spec/draft: The outcome is a LoopOutcome of DraftOutcome", () => {
	it("Scenario: An already approved proposal is entered with runs 0", async () => {
		await host(
			async ({ harness, env, options, storage }) => {
				env.faux.setResponses([draft("=== design.md\n## Context\n\nCSV first.\n")]);
				const outcome = await run(harness, options);

				expect((await specLoops(storage)).map((loop) => loop.input.stage.name)).toEqual(["design"]);
				expect(outcome.status).toBe("blocked");
				expect(escalationOf(outcome)).toMatchObject({ reason: "review" });
				expect(escalationOf(outcome)?.question).toContain("design.md");
				expect(outcome.result).toEqual({
					change: CHANGE,
					stages: [
						{ stage: "proposal", approved: true, runs: 0 },
						{ stage: "design", approved: false, runs: 1 },
					],
				});
			},
			{ before: (changeDir) => approveProposal(changeDir) },
		);
	});
});
