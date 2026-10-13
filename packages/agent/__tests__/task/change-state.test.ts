import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage, type Harness } from "@earendil-works/pi-durable";
import * as task from "../../src/task/index.js";
import { changeState } from "../../src/task/change-state.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context, temp } from "./helpers.js";
import { STAGE_SCRIPT, draft, specWorkspace } from "./spec-helpers.js";

afterEach(cleanTemps);

const CHANGE = "add-plan-export";

const proposal: SpecStage = { name: "proposal", owns: ["proposal.md"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const design: SpecStage = { name: "design", owns: ["design.md"], after: ["proposal"], script: { text: STAGE_SCRIPT }, gate: () => [] };

const AT = "2026-10-13T00:00:00.000Z";

/** A faux-model harness with the draft loop over `stages`, and a workspace holding the change. */
async function withHarness(stages: readonly SpecStage[], body: (h: { harness: Harness; env: ReturnType<typeof setup>; workspace: string; changeDir: string }) => Promise<void>) {
	const { workspace, changeDir } = specWorkspace(CHANGE);
	const env = setup();
	for (const extension of task.draftLoopExtensions({ workspace, stages })) env.registry.install(extension);
	const harness = await openHarness(new MemoryStorage(), env);
	try {
		await body({ harness, env, workspace, changeDir });
	} finally {
		await harness.close(context);
	}
}

/** Every stage of `SPEC_STAGES` drafted and approved, in order. */
function approveAll(changeDir: string) {
	mkdirSync(join(changeDir, "specs", "plan", "export"), { recursive: true });
	for (const [file, text] of [
		["proposal.md", "## Why\n"],
		["design.md", "## Context\n"],
		["specs/plan/export/spec.md", "## Purpose\n"],
		["tasks.md", "## 1. Code\n"],
	]) {
		writeFileSync(join(changeDir, file!), text!);
	}
	for (const stage of SPEC_STAGES) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: AT }, SPEC_STAGES);
}

async function startBlocked(harness: Harness, env: ReturnType<typeof setup>, workspace: string, stages: readonly SpecStage[], change = CHANGE) {
	const id = await task.startDraftLoop(harness, { change, intent: "Export a plan", workspace, changesDir: join(workspace, "openspec", "changes"), stages, model: env.model }, context);
	harness.resume();
	await task.waitForDraftLoop(harness, id, context);
	return Number(id);
}

describe("task/change-state", () => {
	it("a change with no directory is missing", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			const changesDir = join(workspace, "openspec", "changes");
			expect(await changeState(harness, { change: "add-nothing", changesDir }, context)).toEqual({ kind: "missing", change: "add-nothing" });
		});
	});

	it("a change with no draft loop is ready at the proposal", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			const changesDir = join(workspace, "openspec", "changes");
			expect(await changeState(harness, { change: CHANGE, changesDir }, context)).toEqual({
				kind: "ready",
				change: CHANGE,
				firstStage: "proposal",
				approved: [],
			});
		});
	});

	it("an approved change with design.md edited is ready at the design", async () => {
		await withHarness([proposal], async ({ harness, workspace, changeDir }) => {
			approveAll(changeDir);
			writeFileSync(join(changeDir, "design.md"), "## Context\n\nEdited.\n");
			expect(await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes") }, context)).toEqual({
				kind: "ready",
				change: CHANGE,
				firstStage: "design",
				approved: ["proposal"],
			});
		});
	});

	it("an approved, unchanged change is drafted", async () => {
		await withHarness([proposal], async ({ harness, workspace, changeDir }) => {
			approveAll(changeDir);
			expect(await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes") }, context)).toEqual({
				kind: "drafted",
				change: CHANGE,
				approved: ["proposal", "design", "specs", "tasks"],
			});
		});
	});

	it("a draft blocked for review of design.md is a review", async () => {
		const stages = [proposal, design];
		await withHarness(stages, async ({ harness, env, workspace }) => {
			env.faux.setResponses([draft("=== proposal.md\n## Why\n")]);
			const first = await startBlocked(harness, env, workspace, stages);
			env.faux.setResponses([draft("=== design.md\n## Context\n")]);
			const next = await task.answerDraftLoop(harness, first as never, { by: "principal", principal: "jesse", decision: "approve" }, context);
			await task.waitForDraftLoop(harness, next, context);

			const state = await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes"), stages }, context);
			expect(state).toEqual({
				kind: "review",
				change: CHANGE,
				loop: Number(next),
				stage: "design",
				files: ["design.md"],
				approved: ["proposal"],
				drafts: [{ n: 1, issues: [] }],
			});
		});
	});

	it("a draft blocked on a question is a question", async () => {
		await withHarness([proposal], async ({ harness, env, workspace }) => {
			env.faux.setResponses([draft("", "ask", "CSV too?")]);
			const loop = await startBlocked(harness, env, workspace, [proposal]);

			const state = await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes"), stages: [proposal] }, context);
			expect(state).toEqual({ kind: "question", change: CHANGE, loop, stage: "proposal", question: "CSV too?", approved: [], drafts: [] });
		});
	});

	it("only the newest draft loop counts", async () => {
		await withHarness([proposal], async ({ harness, env, workspace }) => {
			env.faux.setResponses([draft("=== proposal.md\n## Why\n")]);
			const first = await startBlocked(harness, env, workspace, [proposal]);
			const next = await task.answerDraftLoop(harness, first as never, { by: "principal", principal: "jesse", decision: "approve" }, context);
			expect(await task.waitForDraftLoop(harness, next, context)).toMatchObject({ status: "converged" });

			const state = await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes"), stages: [proposal] }, context);
			expect(state).toEqual({ kind: "drafted", change: CHANGE, loop: Number(next), approved: ["proposal"] });
		});
	});

	it("a draft loop of another change is ignored", async () => {
		await withHarness([proposal], async ({ harness, env, workspace }) => {
			mkdirSync(join(workspace, "openspec", "changes", "add-other"), { recursive: true });
			env.faux.setResponses([draft("=== proposal.md\n## Why\n")]);
			await startBlocked(harness, env, workspace, [proposal], "add-other");

			const state = await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes"), stages: [proposal] }, context);
			expect(state).toEqual({ kind: "ready", change: CHANGE, firstStage: "proposal", approved: [] });
		});
	});

	it("a changesDir elsewhere is read as given", async () => {
		await withHarness([proposal], async ({ harness }) => {
			const changesDir = temp("changes-");
			mkdirSync(join(changesDir, CHANGE));
			expect(await changeState(harness, { change: CHANGE, changesDir, stages: [proposal] }, context)).toMatchObject({ kind: "ready", firstStage: "proposal" });
		});
	});
});
