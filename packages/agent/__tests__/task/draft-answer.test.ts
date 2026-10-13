import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage, type Harness, type TaskId } from "@earendil-works/pi-durable";
import type { LoopOutcome } from "../../src/openspec/index.js";
import * as task from "../../src/task/index.js";
import { DRAFT_LOOP_TASK } from "../../src/task/draft-input.js";
import { SPEC_LOOP, type SpecLoopInput } from "../../src/task/spec-loop.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context } from "./helpers.js";
import { STAGE_SCRIPT, draft, specWorkspace } from "./spec-helpers.js";

afterEach(cleanTemps);

const CHANGE = "add-plan-export";

const proposal: SpecStage = { name: "proposal", owns: ["proposal.md"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const design: SpecStage = { name: "design", owns: ["design.md"], after: ["proposal"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const stages = [proposal, design];

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const principal = (decision: string): task.SpecLoopAnswer => ({ by: "principal", principal: "jesse", decision });

const refusal = (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e);

const questionOf = (outcome: { status: string; escalation?: { question: string } }) => outcome.escalation?.question ?? "";

type DraftId = TaskId<LoopOutcome<task.DraftOutcome>>;

/**
 * A host with `draftLoopExtensions` installed over the two stages, and a draft already blocked
 * for review of the proposal; `before` prepares the change directory.
 */
async function blockedOnProposal(
	body: (h: {
		harness: Harness;
		env: ReturnType<typeof setup>;
		changeDir: string;
		first: DraftId;
		blocked: LoopOutcome<task.DraftOutcome>;
		specLoops: () => Promise<string[]>;
		count: (kind: string) => Promise<number>;
	}) => Promise<void>,
	before?: (changeDir: string) => void,
) {
	const { workspace, changeDir } = specWorkspace(CHANGE);
	before?.(changeDir);
	const env = setup();
	for (const extension of task.draftLoopExtensions({ workspace, stages })) env.registry.install(extension);
	const storage = new MemoryStorage();
	const harness = await openHarness(storage, env);
	const scan = async (kind: string) => (await storage.scanTasks({ kind }, 100, undefined, context)).items;
	const specLoops = async () => (await scan(SPEC_LOOP)).map((record) => (record.input as unknown as SpecLoopInput).stage.name);
	const count = async (kind: string) => (await scan(kind)).length;
	try {
		env.faux.setResponses([draft("=== proposal.md\n## Why\n\nCSV and JSON.\n")]);
		const options: task.DraftLoopOptions = { change: CHANGE, intent: "Export a plan as CSV or JSON", workspace, changesDir: join(workspace, "openspec", "changes"), stages, model: env.model };
		const first = await task.startDraftLoop(harness, options, context);
		harness.resume();
		const blocked = await task.waitForDraftLoop(harness, first, context);
		expect(blocked).toMatchObject({ status: "blocked", escalation: { reason: "review" } });
		expect(questionOf(blocked)).toContain("proposal.md");
		await body({ harness, env, changeDir, first, blocked, specLoops, count });
	} finally {
		await harness.close(context);
	}
}

describe("task/draft-answer", () => {
	it("Scenario: Approving the proposal drafts the design", async () => {
		await blockedOnProposal(async ({ harness, env, changeDir, first, specLoops }) => {
			env.faux.setResponses([draft("=== design.md\n## Context\n\nDrafted.\n")]);
			const next = await task.answerDraftLoop(harness, first, principal("approve"), context);
			const outcome = await task.waitForDraftLoop(harness, next, context);

			const approvals = JSON.parse(readFileSync(join(changeDir, "approvals.json"), "utf8"));
			expect(approvals.approvals.map((a: { stage: string }) => a.stage)).toEqual(["proposal"]);
			expect(approvals.approvals[0].files).toEqual({ "proposal.md": sha256(join(changeDir, "proposal.md")) });
			// The proposal's first draft, the run recording its approval, then the design.
			expect((await specLoops()).sort()).toEqual(["design", "proposal", "proposal"]);
			expect(outcome).toMatchObject({
				status: "blocked",
				escalation: { reason: "review" },
				result: {
					change: CHANGE,
					stages: [
						{ stage: "proposal", approved: true, runs: 2 },
						{ stage: "design", approved: false, runs: 1 },
					],
				},
			});
			expect(questionOf(outcome)).toContain("design.md");
		});
	});

	it("Scenario: A revision redrafts the same stage", async () => {
		await blockedOnProposal(async ({ harness, env, changeDir, first }) => {
			const before = env.requests.length;
			env.faux.setResponses([draft("=== proposal.md\n## Why\n\nJSON.\n")]);
			const next = await task.answerDraftLoop(harness, first, principal("JSON only"), context);
			const outcome = await task.waitForDraftLoop(harness, next, context);

			const prompts = env.requests.slice(before).map((request) => JSON.stringify(request.messages));
			expect(prompts).toHaveLength(1);
			expect(prompts[0]).toContain(`Stage proposal of ${CHANGE}`);
			expect(prompts[0]).toContain("The principal asked for: JSON only");
			expect(existsSync(join(changeDir, "approvals.json"))).toBe(false);
			expect(outcome).toMatchObject({
				status: "blocked",
				escalation: { reason: "review" },
				result: { stages: [{ stage: "proposal", approved: false, runs: 2 }] },
			});
			expect(questionOf(outcome)).toContain("proposal.md");
		});
	});

	it("Scenario: An agent cannot approve through the draft", async () => {
		// An unrelated entry, so "unchanged" is checked byte for byte rather than as "still absent".
		const file = `${JSON.stringify({
			approvals: [{ stage: "other", approved: true, by: "principal", principal: "jesse", notes: "", at: "2026-10-01T00:00:00.000Z", files: {} }],
		})}\n`;
		await blockedOnProposal(
			async ({ harness, env, changeDir, first, blocked, count }) => {
				const drafts = await count(DRAFT_LOOP_TASK);
				const loops = await count(SPEC_LOOP);
				const requests = env.requests.length;

				const error = await refusal(task.answerDraftLoop(harness, first, { by: "agent", principal: "bot", decision: "approve" }, context));

				expect(error).toBeInstanceOf(task.EscalationAnswerError);
				expect((error as Error).message).toContain("only the principal answers the review of the proposal stage");
				expect(await count(DRAFT_LOOP_TASK)).toBe(drafts);
				expect(await count(SPEC_LOOP)).toBe(loops);
				expect(env.requests).toHaveLength(requests);
				expect(readFileSync(join(changeDir, "approvals.json"), "utf8")).toBe(file);
				expect(await task.waitForDraftLoop(harness, first, context)).toEqual(blocked);
			},
			(changeDir) => writeFileSync(join(changeDir, "approvals.json"), file),
		);
	});
});
