/**
 * change/cli: how `draft` continues a change that exists, and how its feedback answers
 * what waits. `agentscript-change` in process, on a faux model, over the `SPEC_STAGES`
 * names, files and order with a test script and an empty gate, so a stage's request is
 * `Stage <name> of <change>` and its carried lines are in it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FauxResponseStep } from "@earendil-works/pi-ai";
import { recordApproval } from "../../src/task/spec-approvals.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { cleanTemps } from "../task/helpers.js";
import { STAGE_SCRIPT, draft } from "../task/spec-helpers.js";
import { CHANGE, change, draftLoopsIn, loopsIn, workspace } from "./helpers.js";

afterEach(cleanTemps);

const stages: readonly SpecStage[] = SPEC_STAGES.map((stage) => ({ ...stage, script: { text: STAGE_SCRIPT }, gate: () => [] }));

/** Every stage drafted and approved, as the draft loop records an approval. */
function approveAll(changeDir: string) {
	mkdirSync(join(changeDir, "specs", "plan", "export"), { recursive: true });
	writeFileSync(join(changeDir, "intent.md"), "Export a plan");
	writeFileSync(join(changeDir, "proposal.md"), "## Why\n");
	writeFileSync(join(changeDir, "design.md"), "## Context\n");
	writeFileSync(join(changeDir, "specs", "plan", "export", "spec.md"), "## Purpose\n");
	writeFileSync(join(changeDir, "tasks.md"), "## 1. Code\n");
	for (const stage of stages) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, stages);
}

/** A response that records the request's messages in `prompts`, then answers `message`. */
const capture = (prompts: string[], message: ReturnType<typeof draft>): FauxResponseStep => (context) => {
	prompts.push(JSON.stringify(context.messages));
	return message;
};

/** A new change whose proposal waits for a review (a clean `proposal.md`) or a question (`CSV too?`). */
async function blockAt(dir: string, reason: "review" | "question") {
	const first = reason === "review" ? draft("=== proposal.md\n## Why\n\nPlans export.\n") : draft("", "ask", "CSV too?");
	return change(["draft", CHANGE, "--intent", "Export a plan"], dir, [first], stages);
}

describe("change/cli draft", () => {
	it("Scenario: An edited design redrafts from the design", async () => {
		const { dir, changeDir, db } = workspace();
		approveAll(changeDir);
		writeFileSync(join(changeDir, "design.md"), "## Context\n\nEdited by hand.\n");

		const prompts: string[] = [];
		const run = await change(["draft", CHANGE], dir, [capture(prompts, draft("=== design.md\n## Context\n\nRedrafted.\n"))], stages);
		expect([0, 1]).toContain(run.code);
		expect(await draftLoopsIn(db)).toHaveLength(1);
		expect(prompts[0]).toContain(`Stage design of ${CHANGE}`);
		const specLoops = (await loopsIn(db)).filter((loop) => loop.change === CHANGE).sort((a, b) => a.id - b.id);
		expect(specLoops[0]?.task).toBe("spec design");
	});

	it("Scenario: A fully approved change starts nothing", async () => {
		const { dir, changeDir, db } = workspace();
		approveAll(changeDir);
		const before = await loopsIn(db);

		const run = await change(["draft", CHANGE], dir, [], stages);
		expect(run.code).toBe(0);
		expect(run.calls).toBe(0);
		expect(await loopsIn(db)).toEqual(before);
		expect(await draftLoopsIn(db)).toHaveLength(0);
		const header = run.out.split("\n").find((line) => line.startsWith(`# ${CHANGE} — `));
		expect(header).toContain("approved");
	});

	it("Scenario: Feedback redrafts the stage under review", async () => {
		const { dir, db } = workspace();
		expect((await blockAt(dir, "review")).code).toBe(0);
		const [blocked] = await draftLoopsIn(db);

		const prompts: string[] = [];
		const run = await change(["draft", CHANGE, "JSON only"], dir, [capture(prompts, draft("=== proposal.md\n## Why\n\nJSON plans.\n"))], stages);
		expect(run.code).toBe(0);
		// The answer is a run of the blocked loop, not a new draft.
		const runs = await draftLoopsIn(db);
		expect(runs).toHaveLength(2);
		expect(runs[1]!.input.resume?.answers).toBe(blocked!.id);
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain(`Stage proposal of ${CHANGE}`);
		expect(prompts[0]).toContain("The principal asked for: JSON only");
		expect(run.out).toContain("### proposal draft 2");
		const [revise, approve] = run.out
			.trimEnd()
			.split("\n")
			.slice(-2)
			.map((line) => line.trim());
		expect(revise).toContain(`specsesh change draft ${CHANGE} "<what to change>"`);
		expect(approve).toContain(`specsesh change approve ${CHANGE}`);
	});

	it("Scenario: Feedback answers a stage's question", async () => {
		const { dir, db } = workspace();
		expect((await blockAt(dir, "question")).code).toBe(1);
		const [blocked] = await draftLoopsIn(db);

		const prompts: string[] = [];
		await change(["draft", CHANGE, "No"], dir, [capture(prompts, draft("=== proposal.md\n## Why\n\nPlans export.\n"))], stages);
		const runs = await draftLoopsIn(db);
		expect(runs).toHaveLength(2);
		expect(runs[1]!.input.resume?.answers).toBe(blocked!.id);
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain(`Stage proposal of ${CHANGE}`);
		expect(prompts[0]).toContain("The principal asked for: No");
	});
});
