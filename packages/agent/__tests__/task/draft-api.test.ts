import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage, type Harness } from "@earendil-works/pi-durable";
import * as task from "../../src/task/index.js";
import { DRAFT_LOOP_TASK } from "../../src/task/draft-input.js";
import { SPEC_LOOP } from "../../src/task/spec-loop.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context } from "./helpers.js";
import { STAGE_SCRIPT, draft, specWorkspace } from "./spec-helpers.js";

afterEach(cleanTemps);

const proposal: SpecStage = { name: "proposal", owns: ["proposal.md"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const design: SpecStage = { name: "design", owns: ["design.md"], after: ["proposal"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const stages = [proposal, design];

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const approval = (stage: string, files: Record<string, string>) => ({
	stage,
	approved: true,
	by: "principal",
	principal: "jesse",
	notes: "",
	at: "2026-10-01T00:00:00.000Z",
	files,
});

const principal = (decision: string): task.SpecLoopAnswer => ({ by: "principal", principal: "jesse", decision });

const refusal = (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e);

const questionOf = (outcome: { status: string; escalation?: { question: string } }) => outcome.escalation?.question ?? "";

/** A host with `draftLoopExtensions` installed over the two stages; `before` prepares the change directory. */
async function host(body: (h: {
	harness: Harness;
	env: ReturnType<typeof setup>;
	changeDir: string;
	options: task.DraftLoopOptions;
	count: (kind: string) => Promise<number>;
}) => Promise<void>, before?: (changeDir: string) => void) {
	const { workspace, changeDir } = specWorkspace();
	before?.(changeDir);
	const env = setup();
	for (const extension of task.draftLoopExtensions({ workspace, stages })) env.registry.install(extension);
	const storage = new MemoryStorage();
	const harness = await openHarness(storage, env);
	const options: task.DraftLoopOptions = { change: "add-thing", intent: "Make the thing", workspace, stages, model: env.model };
	const count = async (kind: string) => (await storage.scanTasks({ kind }, 100, undefined, context)).items.length;
	try {
		await body({ harness, env, changeDir, options, count });
	} finally {
		await harness.close(context);
	}
}

describe("task/draft-api", () => {
	it("Scenario: answerDraftLoop on a converged or failed draft is refused", async () => {
		// Converged: every stage approved and unchanged.
		await host(
			async ({ harness, options, count }) => {
				const id = await task.startDraftLoop(harness, options, context);
				harness.resume();
				expect((await task.waitForDraftLoop(harness, id, context)).status).toBe("converged");

				const error = await refusal(task.answerDraftLoop(harness, id, principal("approve"), context));
				expect(error).toBeInstanceOf(task.EscalationAnswerError);
				expect((error as Error).message).toContain("ended converged, not blocked");
				expect(await count(DRAFT_LOOP_TASK)).toBe(1);
			},
			(changeDir) => {
				for (const name of ["proposal.md", "design.md"]) writeFileSync(join(changeDir, name), `# ${name}\n`);
				writeFileSync(
					join(changeDir, "approvals.json"),
					JSON.stringify({
						approvals: [
							approval("proposal", { "proposal.md": sha256(join(changeDir, "proposal.md")) }),
							approval("design", { "design.md": sha256(join(changeDir, "design.md")) }),
						],
					}),
				);
			},
		);
		// Failed: the proposal's spec loop exhausts its one iteration on an unowned path.
		await host(async ({ harness, env, options, count }) => {
			env.faux.setResponses([draft("=== other.md\nNot mine.\n")]);
			const id = await task.startDraftLoop(harness, { ...options, budget: { maxIterations: 1 } }, context);
			harness.resume();
			expect((await task.waitForDraftLoop(harness, id, context)).status).toBe("failed");

			const error = await refusal(task.answerDraftLoop(harness, id, principal("approve"), context));
			expect(error).toBeInstanceOf(task.EscalationAnswerError);
			expect((error as Error).message).toContain("ended failed, not blocked");
			expect(await count(DRAFT_LOOP_TASK)).toBe(1);
			expect(await count(SPEC_LOOP)).toBe(1);
		});
	});

	it("Scenario: An already approved proposal is entered with runs 0", async () => {
		await host(
			async ({ harness, env, options }) => {
				env.faux.setResponses([draft("=== design.md\n## Context\n\nDrafted.\n")]);
				const id = await task.startDraftLoop(harness, options, context);
				harness.resume();
				const outcome = await task.waitForDraftLoop(harness, id, context);

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
				writeFileSync(join(changeDir, "proposal.md"), "## Why\n\nApproved.\n");
				writeFileSync(
					join(changeDir, "approvals.json"),
					JSON.stringify({ approvals: [approval("proposal", { "proposal.md": sha256(join(changeDir, "proposal.md")) })] }),
				);
			},
		);
	});
});
