/**
 * change/cli: what `draft` prints and how it exits, by what the change waits for.
 * `agentscript-change` in process, on a faux model, over the `SPEC_STAGES` names, files
 * and order with a test script and an empty gate.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordApproval } from "../../src/task/spec-approvals.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { cleanTemps } from "../task/helpers.js";
import { STAGE_SCRIPT, draft } from "../task/spec-helpers.js";
import { CHANGE, change, draftLoopsIn, loopsIn, workspace } from "./helpers.js";

afterEach(cleanTemps);

const stages: readonly SpecStage[] = SPEC_STAGES.map((stage) => ({ ...stage, script: { text: STAGE_SCRIPT }, gate: () => [] }));

/** The stages up to (not including) `until` drafted and approved, as the draft loop records an approval. */
function approveUntil(changeDir: string, until: string) {
	mkdirSync(join(changeDir, "specs", "plan", "export"), { recursive: true });
	writeFileSync(join(changeDir, "intent.md"), "Export a plan");
	writeFileSync(join(changeDir, "proposal.md"), "## Why\n");
	writeFileSync(join(changeDir, "design.md"), "## Context\n");
	writeFileSync(join(changeDir, "specs", "plan", "export", "spec.md"), "## Purpose\n");
	for (const stage of stages) {
		if (stage.name === until) break;
		recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, stages);
	}
}

/** The output's last `n` lines, trimmed. */
const tail = (out: string, n: number) =>
	out
		.trimEnd()
		.split("\n")
		.slice(-n)
		.map((line) => line.trim());

describe("change/cli draft output", () => {
	it("Scenario: draft alone shows what is waiting", async () => {
		const { dir, changeDir, db } = workspace();
		approveUntil(changeDir, "design");
		expect((await change(["draft", CHANGE], dir, [draft("=== design.md\n## Context\n\nDrafted.\n")], stages)).code).toBe(0);
		const before = await loopsIn(db);
		const drafts = await draftLoopsIn(db);

		const run = await change(["draft", CHANGE], dir, [], stages);
		expect(run.code).toBe(0);
		expect(run.calls).toBe(0);
		expect(run.out).toContain("design.md");
		expect(await loopsIn(db)).toEqual(before);
		expect(await draftLoopsIn(db)).toEqual(drafts);
	});

	it("Scenario: A review ends with both commands", async () => {
		const { dir } = workspace();
		const run = await change(["draft", CHANGE, "--intent", "Export a plan"], dir, [draft("=== proposal.md\n## Why\n\nPlans export.\n")], stages);

		expect(run.code).toBe(0);
		expect(run.out.split("\n")[0]).toMatch(new RegExp(`^# ${CHANGE} — `));
		expect(run.out).toContain("proposal.md");
		const [revise, approve] = tail(run.out, 2);
		expect(revise).toContain(`pnpm change draft ${CHANGE} "<what to change>"`);
		expect(approve).toContain(`pnpm change approve ${CHANGE}`);
	});

	it("Scenario: A question exits 1", async () => {
		const { dir } = workspace();
		const run = await change(["draft", CHANGE, "--intent", "Export a plan"], dir, [draft("", "ask", "CSV too?")], stages);

		expect(run.code).toBe(1);
		const [question, answer] = tail(run.out, 2);
		expect(question).toContain("CSV too?");
		expect(answer).toContain(`pnpm change draft ${CHANGE} "<answer>"`);
	});

	it("Scenario: A drafted change points at the next step", async () => {
		const { dir, changeDir } = workspace();
		mkdirSync(changeDir, { recursive: true });
		writeFileSync(join(changeDir, "tasks.md"), "## 1. Code\n");
		approveUntil(changeDir, "");

		const run = await change(["draft", CHANGE], dir, [], stages);
		expect(run.code).toBe(0);
		expect(run.out.split("\n")[0]).toContain("drafted");
		expect(tail(run.out, 1)[0]).toContain(`pnpm task ${CHANGE} --next-group`);
	});
});
