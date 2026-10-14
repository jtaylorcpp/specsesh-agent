/**
 * change/cli: what `draft` prints and how it exits, by what the change waits for.
 * `agentscript-change` in process, on a faux model, over the `SPEC_STAGES` names, files
 * and order with a test script and an empty gate.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordApproval } from "../../src/task/spec-approvals.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { cleanTemps, verdict } from "../task/helpers.js";
import { STAGE_SCRIPT, draft } from "../task/spec-helpers.js";
import { AMEND_SPEC, type AmendAsker, CHANGE, OPENSPEC_BIN, change, draftLoopsIn, loopsIn, seedBlockedOnAmendment, workspace } from "./helpers.js";

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
		const [revise, approve] = tail(run.out, 2);
		expect(revise).toContain(`pnpm change draft ${CHANGE} "<what to change>"`);
		expect(approve).toContain(`pnpm change approve ${CHANGE}`);
		expect(run.out.indexOf("proposal.md")).toBeGreaterThan(-1);
		expect(run.out.indexOf("proposal.md")).toBeLessThan(run.out.indexOf(`pnpm change draft ${CHANGE} "<what to change>"`));
		expect(run.out).not.toContain("pnpm task answer");
		expect(run.out).not.toContain("--decision approve");
	});

	it("Scenario: Approving a sliced proposal lists draft commands", async () => {
		const { dir } = workspace();
		const slices = [
			`1. \`${CHANGE}\`: Export a plan as JSON.`,
			"2. `add-plan-export-schema`: Publish the JSON Schema of the export. Follows add-plan-export.",
			"3. `add-plan-export-ci`: Fail a PR whose plan export is invalid. Follows add-plan-export-schema.",
		].join("\n");
		const drafted = await change(
			["draft", CHANGE, "--intent", "Export a plan"],
			dir,
			[draft(`=== proposal.md\n## Why\n\nPlans export.\n=== slices.md\n${slices}\n`)],
			stages,
		);
		expect(drafted.code).toBe(0);

		const run = await change(["approve", CHANGE, "--principal", "jesse"], dir, [draft("=== design.md\n## Context\n\nDrafted.\n")], stages);
		expect(run.code).not.toBe(2);
		expect([0, 1]).toContain(run.code);
		expect(run.out).toContain("Sliced into 3 changes.");
		const schema = run.out.indexOf('pnpm change draft add-plan-export-schema --intent "Publish the JSON Schema of the export. Follows add-plan-export."');
		const ci = run.out.indexOf('pnpm change draft add-plan-export-ci --intent "Fail a PR whose plan export is invalid. Follows add-plan-export-schema."');
		expect(schema).toBeGreaterThan(-1);
		expect(ci).toBeGreaterThan(schema);
		expect(run.out).not.toContain(`pnpm change draft ${CHANGE} --intent`);
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
		expect(tail(run.out, 1)[0]).toContain(`pnpm change build ${CHANGE}`);
		expect(run.out).not.toContain("--next-group");
	});
});

/** `add-plan-export` blocked on `asker`, asking `question`, with or without an amendment to its spec. */
const blockedPlanExport = (asker: AmendAsker, question: string, amended: boolean) =>
	seedBlockedOnAmendment({
		change: CHANGE,
		capability: "plan/export",
		asker,
		question,
		...(amended ? { amendment: { delta: "specs/plan/export/spec.md", text: AMEND_SPEC.replace("An export SHALL hold every step.", "An export SHALL hold every step, in order.") } } : {}),
	});

const endsWith = (text: string) => new RegExp(`${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

// The seeded builds run the start guard, which validates the change with the pinned `openspec`.
describe.skipIf(process.platform === "win32")("change/cli build output", () => {
	let savedPath: string | undefined;
	beforeEach(() => {
		savedPath = process.env.PATH;
		process.env.PATH = `${OPENSPEC_BIN}:${savedPath ?? ""}`;
	});
	afterEach(() => {
		process.env.PATH = savedPath;
	});

	describe("Build output ends with the next command", () => {
		it("Scenario: A blocked build ends with the answer command", async () => {
			const { blocked } = await blockedPlanExport({ kind: "task", task: "2.2" }, "Which API?", false);

			expect(blocked.code).toBe(1);
			const [question, answer] = tail(blocked.out, 2);
			expect(question).toMatch(endsWith("Which API?"));
			expect(answer).toMatch(endsWith(`pnpm change build ${CHANGE} "<answer>"`));
			expect(blocked.out).not.toContain("--amend");
		}, 120_000);

		// The `--amend` line follows the amendment, whoever asked: a task loop or a group's judge.
		for (const asker of [{ kind: "task", task: "2.2" }, { kind: "group", group: 1 }] as const) {
			it(`Scenario: A blocked build with an amendment ends with both commands (${asker.kind === "task" ? `task ${asker.task}` : `group ${asker.group} judge`})`, async () => {
				const { blocked } = await blockedPlanExport(asker, "Amend the spec?", true);

				expect(blocked.code).toBe(1);
				const [question, amend, answer] = tail(blocked.out, 3);
				expect(question).toMatch(endsWith("Amend the spec?"));
				expect(amend).toMatch(endsWith(`pnpm change build ${CHANGE} --amend`));
				expect(answer).toMatch(endsWith(`pnpm change build ${CHANGE} "<answer>"`));
			}, 120_000);
		}

		it("Scenario: A built change points at the next step", async () => {
			const fixture = await blockedPlanExport({ kind: "task", task: "2.2" }, "Which API?", false);

			// 2.2 again with the answer, then 3.1; the group and change checks are `true`.
			const run = await fixture.build(["Use the v2 API"], [verdict(true), verdict(true)]);
			expect(run.code).toBe(0);
			expect(run.out.split("\n")[0]).toBe(`# ${CHANGE} — built`);
			expect(run.out).toContain("## change check: passed");
			expect(tail(run.out, 1)[0]).toBe(`pnpm change close ${CHANGE}`);
		}, 120_000);
	});
});
