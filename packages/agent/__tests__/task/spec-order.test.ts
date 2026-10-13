import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStorage, type Harness, type TaskId } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import type { LoopOutcome } from "../../src/openspec/index.js";
import {
	EscalationAnswerError,
	SPEC_LOOP,
	TaskLoopStartError,
	answerSpecLoop,
	specLoopExtensions,
	startSpecLoop,
	waitForSpecLoop,
	type SpecLoopAnswer,
	type StageOutcome,
} from "../../src/task/index.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context } from "./helpers.js";
import { STAGE_SCRIPT, draft, specWorkspace } from "./spec-helpers.js";

afterEach(cleanTemps);

type SpecId = TaskId<LoopOutcome<StageOutcome>>;

const CHANGE = "add-plan-export";
const script = { text: STAGE_SCRIPT };
const proposalStage: SpecStage = { name: "proposal", owns: ["proposal.md"], script, gate: () => [] };
const designStage: SpecStage = { name: "design", after: ["proposal"], owns: ["design.md", "design/"], script, gate: () => [] };

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** `approvals.json`'s raw text, or null when it does not exist. */
const readApprovals = (changeDir: string) => {
	const path = join(changeDir, "approvals.json");
	return existsSync(path) ? readFileSync(path, "utf8") : null;
};

const writeApprovals = (changeDir: string, approvals: unknown[]) =>
	writeFileSync(join(changeDir, "approvals.json"), `${JSON.stringify({ approvals }, null, 2)}\n`);

const proposalEntry = (changeDir: string, overrides: Record<string, unknown> = {}) => ({
	stage: "proposal",
	approved: true,
	by: "principal",
	principal: "jesse",
	notes: "",
	at: "2026-10-01T00:00:00.000Z",
	files: { "proposal.md": sha256(join(changeDir, "proposal.md")) },
	...overrides,
});

const refusal = (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e);

/**
 * A faux-model harness with the spec loop installed over a temporary workspace holding an
 * empty `openspec/changes/add-plan-export/`, handed to `body` and closed after it.
 */
async function withSpecHarness(
	body: (r: {
		harness: Harness;
		changeDir: string;
		start: (stage: SpecStage) => Promise<SpecId>;
		blockedOnReview: () => Promise<SpecId>;
		loops: () => Promise<readonly { input: unknown }[]>;
		runs: () => Promise<readonly unknown[]>;
	}) => Promise<void>,
) {
	const { workspace, changeDir } = specWorkspace(CHANGE);
	const env = setup();
	for (const extension of specLoopExtensions({ workspace, stages: [proposalStage, designStage] })) env.registry.install(extension);
	const storage = new MemoryStorage();
	const harness = await openHarness(storage, env);
	harness.resume();

	const start = (stage: SpecStage) =>
		startSpecLoop(harness, { change: CHANGE, stage, intent: "Export the plan", workspace, approved: [], model: env.model }, context);

	const blockedOnReview = async () => {
		env.faux.setResponses([draft("=== proposal.md\n## Why\n\nExport the plan as JSON.\n")]);
		const id = await start(proposalStage);
		expect(await waitForSpecLoop(harness, id, context)).toMatchObject({ status: "blocked", escalation: { reason: "review" } });
		return id;
	};

	try {
		await body({
			harness,
			changeDir,
			start,
			blockedOnReview,
			loops: async () => (await storage.scanTasks({ kind: SPEC_LOOP }, 100, undefined, context)).items,
			runs: async () => (await storage.scanTasks({ kind: "agentscript.run" }, 100, undefined, context)).items,
		});
	} finally {
		await harness.close(context);
	}
}

const stageOf = (loop: { input: unknown }) => (loop.input as { stage: { name: string } }).stage.name;

describe("task/spec-order: who approves, and what a stage follows", () => {
	it("Scenario: An agent cannot approve a stage", async () => {
		await withSpecHarness(async ({ harness, changeDir, blockedOnReview, loops, runs }) => {
			const id = await blockedOnReview();
			const before = readApprovals(changeDir);
			const loopCount = (await loops()).length;
			const runCount = (await runs()).length;

			const answers: SpecLoopAnswer[] = [
				{ by: "agent", principal: "bot", decision: "approve" },
				{ by: "principal", decision: "approve" },
				{ by: "principal", principal: "  ", decision: "approve" },
			];
			for (const answer of answers) {
				const error = await refusal(answerSpecLoop(harness, id, answer, context));
				expect(error).toBeInstanceOf(EscalationAnswerError);
				expect((error as Error).message).toMatch(/only the principal/);
			}

			expect(readApprovals(changeDir)).toBe(before);
			expect(await loops()).toHaveLength(loopCount);
			expect(await runs()).toHaveLength(runCount);
			expect(await waitForSpecLoop(harness, id, context)).toMatchObject({ status: "blocked", escalation: { reason: "review" } });
		});
	});

	it("Scenario: Designing before the proposal is approved is refused", async () => {
		await withSpecHarness(async ({ changeDir, start, loops, runs }) => {
			writeFileSync(join(changeDir, "proposal.md"), "## Why\n\nExport the plan.\n");

			const error = await refusal(start(designStage));

			expect(error).toBeInstanceOf(TaskLoopStartError);
			expect((error as Error).message).toContain("the proposal stage of add-plan-export is not approved");
			expect(await loops()).toHaveLength(0);
			expect(await runs()).toHaveLength(0);
			expect(existsSync(join(changeDir, "design.md"))).toBe(false);
			expect(readApprovals(changeDir)).toBeNull();
		});
	});

	it("Scenario: An edited approved file is refused", async () => {
		await withSpecHarness(async ({ changeDir, start, loops, runs }) => {
			const proposal = join(changeDir, "proposal.md");
			writeFileSync(proposal, "## Why\n\nExport the plan.\n");
			writeApprovals(changeDir, [proposalEntry(changeDir)]);
			appendFileSync(proposal, "\nAnd as CSV.\n");

			const error = await refusal(start(designStage));

			expect(error).toBeInstanceOf(TaskLoopStartError);
			expect((error as Error).message).toContain("proposal.md changed since the proposal stage was approved; review it again");
			expect(await loops()).toHaveLength(0);
			expect(await runs()).toHaveLength(0);
			expect(existsSync(join(changeDir, "design.md"))).toBe(false);
		});
	});

	it("starts the design over the same approval when proposal.md is unedited", async () => {
		await withSpecHarness(async ({ changeDir, start, loops }) => {
			writeFileSync(join(changeDir, "proposal.md"), "## Why\n\nExport the plan.\n");
			writeApprovals(changeDir, [proposalEntry(changeDir)]);

			const id = await start(designStage);

			expect((await loops()).map(stageOf)).toEqual(["design"]);
			expect(id).toBeDefined();
		});
	});

	it("refuses an edit after an approval recorded through answerSpecLoop", async () => {
		await withSpecHarness(async ({ harness, changeDir, start, blockedOnReview, loops }) => {
			const next = await answerSpecLoop(harness, await blockedOnReview(), { by: "principal", principal: "jesse", decision: "approve" }, context);
			expect((await waitForSpecLoop(harness, next, context)).status).toBe("converged");
			appendFileSync(join(changeDir, "proposal.md"), "\nAnd as CSV.\n");
			const loopCount = (await loops()).length;

			const error = await refusal(start(designStage));

			expect(error).toBeInstanceOf(TaskLoopStartError);
			expect((error as Error).message).toContain("proposal.md changed since the proposal stage was approved; review it again");
			expect(await loops()).toHaveLength(loopCount);
		});
	});

	it("Scenario: A malformed approvals file refuses the start", async () => {
		await withSpecHarness(async ({ changeDir, start, loops, runs }) => {
			writeFileSync(join(changeDir, "proposal.md"), "## Why\n\nExport the plan.\n");
			writeApprovals(changeDir, [proposalEntry(changeDir, { by: "agent" })]);

			const error = await refusal(start(designStage));

			expect(error).toBeInstanceOf(TaskLoopStartError);
			expect((error as Error).message).toContain("approvals.json");
			expect(await loops()).toHaveLength(0);
			expect(await runs()).toHaveLength(0);
			expect(existsSync(join(changeDir, "design.md"))).toBe(false);
		});
	});

	it("refuses an approvals.json that is not JSON, naming it", async () => {
		await withSpecHarness(async ({ changeDir, start, loops }) => {
			writeFileSync(join(changeDir, "proposal.md"), "## Why\n\nExport the plan.\n");
			writeFileSync(join(changeDir, "approvals.json"), "{ not json");

			const error = await refusal(start(designStage));

			expect(error).toBeInstanceOf(TaskLoopStartError);
			expect((error as Error).message).toContain("approvals.json is not valid JSON");
			expect(await loops()).toHaveLength(0);
		});
	});
});
