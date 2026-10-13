import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage, defineExtension, type Harness, type TaskId } from "@earendil-works/pi-durable";
import { DraftLoop, DraftLoopTask, type DraftLoopInput, type DraftLoopResult } from "../../src/task/draft-loop.js";
import { SPEC_LOOP, specLoopTask } from "../../src/task/spec-loop.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context } from "./helpers.js";
import { STAGE_SCRIPT, draft, specWorkspace } from "./spec-helpers.js";

afterEach(cleanTemps);

const proposal: SpecStage = { name: "proposal", owns: ["proposal.md"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const design: SpecStage = { name: "design", owns: ["design.md"], after: ["proposal"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const stages = [proposal, design];

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function draftHarness() {
	const env = setup();
	const storage = new MemoryStorage();
	env.registry.install(defineExtension({ name: SPEC_LOOP, tasks: [specLoopTask((name) => stages.find((s) => s.name === name))] }));
	env.registry.install(DraftLoop);
	const harness = await openHarness(storage, env);
	return { env, storage, harness };
}

async function startDraft(harness: Harness, input: Partial<DraftLoopInput> & Pick<DraftLoopInput, "workspace">) {
	const full: DraftLoopInput = {
		change: "add-thing",
		stages: stages.map(({ name, owns, after }) => ({ name, owns, ...(after !== undefined ? { after } : {}), script: STAGE_SCRIPT })),
		intent: "Make the thing",
		budget: { maxIterations: 8 },
		escalateTo: "principal",
		...input,
	};
	const owner = await harness.root(context);
	return owner.commit((tx) => tx.createTask(DraftLoopTask, full, { ownership: { kind: "conversation" } }), context);
}

async function outcomeOf(harness: Harness, id: TaskId<DraftLoopResult>) {
	const settled = await harness.waitForTask(id, context);
	if (settled.state.status !== "terminal" || settled.state.outcome.status !== "completed") {
		throw new Error(`draft loop ${id} did not complete: ${JSON.stringify(settled.state)}`);
	}
	return settled.state.outcome.result;
}

describe("task/draft-loop: phases", () => {
	it("blocks on the proposal's review, then an approval drafts the design and blocks on its review", async () => {
		const { workspace, changeDir } = specWorkspace();
		const { env, storage, harness } = await draftHarness();
		try {
			env.faux.setResponses([draft("=== proposal.md\n## Why\n\nDrafted.\n")]);
			const first = await startDraft(harness, { workspace, model: env.model });
			harness.resume();
			const blocked = await outcomeOf(harness, first);
			expect(blocked.outcome).toMatchObject({
				status: "blocked",
				escalation: { reason: "review", to: "principal" },
				result: { change: "add-thing", stages: [{ stage: "proposal", approved: false, runs: 1 }] },
			});
			expect((blocked.outcome as { escalation: { question: string } }).escalation.question).toContain("proposal.md");

			const [child] = (await storage.scanTasks({ kind: SPEC_LOOP }, 100, undefined, context)).items;
			env.faux.setResponses([draft("=== design.md\n## Context\n\nDrafted.\n")]);
			const second = await startDraft(harness, {
				workspace,
				model: env.model,
				resume: {
					stage: "proposal",
					child: child!.id as unknown as number,
					entries: blocked.outcome.result!.stages,
					answer: { by: "principal", principal: "jesse", decision: "approve" },
					answers: first as unknown as number,
				},
			});
			const next = await outcomeOf(harness, second);
			expect(next.outcome).toMatchObject({
				status: "blocked",
				escalation: { reason: "review" },
				result: {
					stages: [
						{ stage: "proposal", approved: true, runs: 2 },
						{ stage: "design", approved: false, runs: 1 },
					],
				},
			});
			expect((next.outcome as { escalation: { question: string } }).escalation.question).toContain("design.md");
			const approvals = JSON.parse(readFileSync(join(changeDir, "approvals.json"), "utf8"));
			expect(approvals.approvals.map((a: { stage: string }) => a.stage)).toEqual(["proposal"]);
			expect((await storage.scanTasks({ kind: SPEC_LOOP }, 100, undefined, context)).items).toHaveLength(3);
		} finally {
			await harness.close(context);
		}
	});

	it("converges at once, with runs 0, when every stage is approved and unchanged", async () => {
		const { workspace, changeDir } = specWorkspace();
		for (const file of ["proposal.md", "design.md"]) writeFileSync(join(changeDir, file), `# ${file}\n`);
		const entry = (stage: string, file: string) => ({
			stage,
			approved: true,
			by: "principal",
			principal: "jesse",
			notes: "",
			at: "2026-10-01T00:00:00.000Z",
			files: { [file]: sha256(join(changeDir, file)) },
		});
		writeFileSync(join(changeDir, "approvals.json"), JSON.stringify({ approvals: [entry("proposal", "proposal.md"), entry("design", "design.md")] }));
		const { env, storage, harness } = await draftHarness();
		try {
			const id = await startDraft(harness, { workspace, model: env.model });
			harness.resume();
			const done = await outcomeOf(harness, id);
			expect(done.outcome).toEqual({
				status: "converged",
				iterations: [],
				result: {
					change: "add-thing",
					stages: [
						{ stage: "proposal", approved: true, runs: 0 },
						{ stage: "design", approved: true, runs: 0 },
					],
				},
			});
			expect((await storage.scanTasks({ kind: SPEC_LOOP }, 100, undefined, context)).items).toHaveLength(0);
		} finally {
			await harness.close(context);
		}
	});
});
