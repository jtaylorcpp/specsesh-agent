import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStorage, type Harness, type TaskId } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import type { LoopOutcome } from "../../src/openspec/index.js";
import { answerSpecLoop, specLoopExtensions, startSpecLoop, waitForSpecLoop, type StageOutcome } from "../../src/task/index.js";
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

interface ApprovalEntry {
	stage: string;
	approved: boolean;
	by: string;
	principal: string;
	notes: unknown;
	at: string;
	files: Record<string, string>;
}

const readApprovals = (dir: string): { approvals: ApprovalEntry[] } =>
	existsSync(join(dir, "approvals.json")) ? JSON.parse(readFileSync(join(dir, "approvals.json"), "utf8")) : { approvals: [] };

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const variablesOf = (run: { input: unknown }) => (run.input as { options: { variables: Record<string, unknown> } }).options.variables;

/**
 * A faux-model harness with the spec loop installed over a temporary workspace holding an
 * empty `openspec/changes/add-plan-export/`, handed to `body` and closed after it.
 */
async function withSpecHarness(
	body: (r: {
		harness: Harness;
		changeDir: string;
		env: ReturnType<typeof setup>;
		blockedOnReview: (stage: SpecStage, response: ReturnType<typeof draft>) => Promise<{ id: SpecId; outcome: LoopOutcome<StageOutcome> }>;
		blockedOnQuestion: (stage: SpecStage, response: ReturnType<typeof draft>) => Promise<{ id: SpecId; outcome: LoopOutcome<StageOutcome> }>;
		runs: () => Promise<readonly { input: unknown }[]>;
	}) => Promise<void>,
) {
	const { workspace, changeDir } = specWorkspace(CHANGE);
	const env = setup();
	for (const extension of specLoopExtensions({ workspace, stages: [proposalStage, designStage] })) env.registry.install(extension);
	const storage = new MemoryStorage();
	const harness = await openHarness(storage, env);
	harness.resume();

	const blockedOn = (reason: "review" | "question") => async (stage: SpecStage, response: ReturnType<typeof draft>) => {
		env.faux.setResponses([response]);
		const approved = stage.after?.includes("proposal") ? ["proposal.md"] : [];
		const id = await startSpecLoop(harness, { change: CHANGE, stage, intent: "Export the plan", workspace, approved, model: env.model }, context);
		const outcome = await waitForSpecLoop(harness, id, context);
		expect(outcome).toMatchObject({ status: "blocked", escalation: { reason } });
		return { id, outcome };
	};

	try {
		await body({
			harness,
			changeDir,
			env,
			blockedOnReview: blockedOn("review"),
			blockedOnQuestion: blockedOn("question"),
			runs: async () => (await storage.scanTasks({ kind: "agentscript.run" }, 100, undefined, context)).items,
		});
	} finally {
		await harness.close(context);
	}
}

describe("task/spec-review: answering a spec loop's review", () => {
	it("Scenario: Approving the proposal", async () => {
		await withSpecHarness(async ({ harness, changeDir, env, blockedOnReview }) => {
			const { id } = await blockedOnReview(proposalStage, draft("=== proposal.md\n## Why\n\nExport the plan as JSON.\n"));
			const proposal = join(changeDir, "proposal.md");
			const drafted = readFileSync(proposal);
			const calls = env.requests.length;

			const next = await answerSpecLoop(harness, id, { by: "principal", principal: "jesse", decision: " Approve " }, context);
			const outcome = await waitForSpecLoop(harness, next, context);

			expect(next).not.toBe(id);
			expect(outcome.status).toBe("converged");
			expect(outcome.result).toMatchObject({ stage: "proposal", files: ["proposal.md"], approved: true });
			expect(env.requests.length).toBe(calls);
			expect(readFileSync(proposal).equals(drafted)).toBe(true);

			const { approvals } = readApprovals(changeDir);
			expect(approvals).toHaveLength(1);
			const entry = approvals[0]!;
			expect(entry).toMatchObject({ stage: "proposal", approved: true, by: "principal", principal: "jesse" });
			expect(typeof entry.notes).toBe("string");
			expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
			expect(new Date(entry.at).toISOString()).toBe(entry.at);
			expect(entry.files["proposal.md"]).toBe(sha256(proposal));
		});
	});

	it("Scenario: Re-approving the proposal drops the design's approval", async () => {
		await withSpecHarness(async ({ harness, changeDir, blockedOnReview }) => {
			const approve = async (id: SpecId) => {
				const next = await answerSpecLoop(harness, id, { by: "principal", principal: "jesse", decision: "approve" }, context);
				expect((await waitForSpecLoop(harness, next, context)).status).toBe("converged");
			};
			const proposal = join(changeDir, "proposal.md");

			await approve((await blockedOnReview(proposalStage, draft("=== proposal.md\n## Why\n\nCSV and JSON.\n"))).id);
			const oldHash = sha256(proposal);
			await approve((await blockedOnReview(designStage, draft("=== design.md\n## Context\n\nTwo exporters.\n"))).id);
			expect(readApprovals(changeDir).approvals.map((entry) => entry.stage)).toEqual(["proposal", "design"]);

			writeFileSync(proposal, "## Why\n\nJSON only.\n");
			await approve((await blockedOnReview(proposalStage, draft("=== proposal.md\n## Why\n\nJSON only, revised.\n"))).id);

			const { approvals } = readApprovals(changeDir);
			expect(approvals).toHaveLength(1);
			expect(approvals[0]!.stage).toBe("proposal");
			expect(approvals[0]!.files["proposal.md"]).toBe(sha256(proposal));
			expect(approvals[0]!.files["proposal.md"]).not.toBe(oldHash);
			expect(approvals.some((entry) => entry.stage === "design")).toBe(false);
		});
	});

	it("Scenario: A revision reaches the next draft", async () => {
		await withSpecHarness(async ({ harness, changeDir, env, blockedOnReview, runs }) => {
			const { id, outcome: blocked } = await blockedOnReview(proposalStage, draft("=== proposal.md\n## Why\n\nCSV and JSON.\n"));
			const last = blocked.iterations.at(-1)!.n;
			const before = (await runs()).length;

			env.faux.setResponses([draft("=== proposal.md\n## Why\n\nJSON.\n")]);
			const onDisk = readFileSync(join(changeDir, "proposal.md"), "utf8");
			const next = await answerSpecLoop(harness, id, { by: "principal", principal: "jesse", decision: "JSON only" }, context);
			const outcome = await waitForSpecLoop(harness, next, context);

			const all = await runs();
			expect(all).toHaveLength(before + 1);
			const first = variablesOf(all.at(-1)!);
			expect(first["carried"]).toContain("The principal asked for: JSON only");
			expect(first["iteration"]).toBe(last + 1);
			expect(first["current"]).toBe(`=== proposal.md\n${onDisk}`);
			expect(outcome.iterations.at(-1)!.n).toBe(last + 1);
			expect(existsSync(join(changeDir, "approvals.json"))).toBe(false);
		});
	});

	it('Scenario: An answered question is carried, even "approve"', async () => {
		await withSpecHarness(async ({ harness, changeDir, env, blockedOnQuestion, runs }) => {
			const { id } = await blockedOnQuestion(proposalStage, draft("", "ask", "CSV or JSON?"));
			const before = (await runs()).length;
			const calls = env.requests.length;

			env.faux.setResponses([draft("=== proposal.md\n## Why\n\nJSON.\n")]);
			const next = await answerSpecLoop(harness, id, { by: "principal", decision: "approve" }, context);
			const outcome = await waitForSpecLoop(harness, next, context);

			expect(env.requests.length).toBeGreaterThan(calls);
			const all = await runs();
			expect(all).toHaveLength(before + 1);
			expect(variablesOf(all.at(-1)!)["carried"]).toContain("The principal asked for: approve");
			expect(outcome.iterations.length).toBeGreaterThan(0);
			expect(outcome.status === "converged" && outcome.result?.approved === true).toBe(false);
			expect(readApprovals(changeDir).approvals).toEqual([]);
		});
	});
});
