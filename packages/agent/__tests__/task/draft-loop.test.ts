import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage, type Harness } from "@earendil-works/pi-durable";
import type { LoopOutcome } from "../../src/openspec/index.js";
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

const stage = (name: string, owns: string[], after?: string): SpecStage => ({
	name,
	owns,
	script: { text: STAGE_SCRIPT },
	...(after !== undefined ? { after: [after] } : {}),
	gate: present,
});

/** The four stages of `SPEC_STAGES`, in its order and with its `after` links, each with a trivial gate. */
const stages = [
	stage("proposal", ["proposal.md"]),
	stage("design", ["design.md"], "proposal"),
	stage("specs", ["specs/"], "design"),
	stage("tasks", ["tasks.md"], "specs"),
];

const CHANGE = "add-plan-export";

/** Writes one file per stage and approves all four, in order, as `answerSpecLoop` records them. */
function approveAll(changeDir: string) {
	const files = ["proposal.md", "design.md", "specs/plan/export/spec.md", "tasks.md"];
	for (const file of files) {
		mkdirSync(dirname(join(changeDir, file)), { recursive: true });
		writeFileSync(join(changeDir, file), `# ${file}\n`);
	}
	for (const s of stages) recordApproval(changeDir, s, { principal: "jesse", notes: "", at: "2026-10-01T00:00:00.000Z" }, stages);
}

const questionOf = (outcome: { status: string; escalation?: { question: string } }) => outcome.escalation?.question ?? "";

/** A host with `draftLoopExtensions` installed over the four stages; `before` prepares the change directory. */
async function host(
	body: (h: {
		harness: Harness;
		env: ReturnType<typeof setup>;
		options: task.DraftLoopOptions;
		specLoops: () => Promise<SpecLoopInput[]>;
	}) => Promise<void>,
	before?: (changeDir: string) => void,
) {
	const { workspace, changeDir } = specWorkspace(CHANGE);
	before?.(changeDir);
	const env = setup();
	for (const extension of task.draftLoopExtensions({ workspace, stages })) env.registry.install(extension);
	const storage = new MemoryStorage();
	const harness = await openHarness(storage, env);
	const options: task.DraftLoopOptions = { change: CHANGE, intent: "Export a plan as CSV or JSON", workspace, changesDir: join(workspace, "openspec", "changes"), stages, model: env.model };
	const specLoops = async () =>
		(await storage.scanTasks({ kind: SPEC_LOOP }, 100, undefined, context)).items.map((record) => record.input as unknown as SpecLoopInput);
	try {
		await body({ harness, env, options, specLoops });
	} finally {
		await harness.close(context);
	}
}

async function run(harness: Harness, options: task.DraftLoopOptions): Promise<LoopOutcome<task.DraftOutcome>> {
	const id = await task.startDraftLoop(harness, options, context);
	harness.resume();
	return task.waitForDraftLoop(harness, id, context);
}

describe("task/draft-loop", () => {
	it("Scenario: A host starts and awaits a draft loop", async () => {
		await host(async ({ harness, env, options }) => {
			env.faux.setResponses([draft("=== proposal.md\n## Why\n\nCSV and JSON.\n")]);
			const outcome = await run(harness, options);

			expect(outcome).toMatchObject({
				status: "blocked",
				escalation: { reason: "review", to: "principal" },
				result: { change: CHANGE, stages: [{ stage: "proposal", approved: false, runs: 1 }] },
			});
			expect(questionOf(outcome)).toContain("proposal.md");
		});
	});

	it("Scenario: A fully approved change converges at once", async () => {
		await host(async ({ harness, env, options, specLoops }) => {
			const outcome = await run(harness, options);

			expect(outcome).toEqual({
				status: "converged",
				iterations: [],
				result: { change: CHANGE, stages: stages.map((s) => ({ stage: s.name, approved: true, runs: 0 })) },
			});
			expect(await specLoops()).toHaveLength(0);
			expect(env.requests).toHaveLength(0);
		}, approveAll);
	});

	it("Scenario: An edited approved file reopens its stage", async () => {
		await host(
			async ({ harness, env, options, specLoops }) => {
				env.faux.setResponses([draft("=== design.md\n## Context\n\nRedrafted.\n")]);
				const outcome = await run(harness, options);

				expect((await specLoops()).map((input) => input.stage.name)).toEqual(["design"]);
				expect(outcome).toMatchObject({
					status: "blocked",
					escalation: { reason: "review" },
					result: {
						stages: [
							{ stage: "proposal", approved: true, runs: 0 },
							{ stage: "design", approved: false, runs: 1 },
						],
					},
				});
				expect(questionOf(outcome)).toContain("design.md");
			},
			(changeDir) => {
				approveAll(changeDir);
				appendFileSync(join(changeDir, "design.md"), "Edited after approval.\n");
			},
		);
	});
});
