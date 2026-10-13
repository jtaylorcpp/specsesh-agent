import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { check } from "../../src/openspec/index.js";
import type { StageIssue } from "../../src/task/spec-stage.js";
import { cleanTemps, prompts } from "./helpers.js";
import { SpecLoopOutcome, draft, proposalStage, runSpecLoop } from "./spec-helpers.js";

afterEach(cleanTemps);

const PROPOSAL = "=== proposal.md\n## Why\n\nBecause.\n";
const ISSUE: StageIssue = { level: "ERROR", path: "proposal.md", message: "needs a ## What Changes section" };

describe("spec/loop: Gate issues carry into the next iteration within budget", () => {
	it("Scenario: An issue is fixed on the second iteration", async () => {
		let round = 0;
		const stage = proposalStage(() => (++round === 1 ? [ISSUE] : []));
		const r = await runSpecLoop(stage, [draft(PROPOSAL), draft(PROPOSAL)]);

		expect(r.runs).toHaveLength(2);
		expect((r.runs[1]?.input as { options: { variables: Record<string, unknown> } }).options.variables["carried"]).toBe(
			"ERROR proposal.md: needs a ## What Changes section",
		);
		expect(prompts(r.env.requests)[1]).toContain("Carried: ERROR proposal.md: needs a ## What Changes section");
		expect(r.outcome.status).toBe("blocked");
		expect(r.outcome.iterations).toHaveLength(2);
		expect(r.outcome.iterations[0]).toMatchObject({
			verdict: { met: false, unmet: [{ target: { check: "proposal gate" } }] },
			feedback: [{ action: "retry", from: { kind: "spec-defect", message: "ERROR proposal.md: needs a ## What Changes section" } }],
			evidence: [{ kind: "validation", report: { valid: false, issues: [ISSUE] } }],
		});
		expect(r.outcome.iterations[1]?.verdict.met).toBe(true);
		expect(check(SpecLoopOutcome, r.outcome)).toBe(true);
	});

	it("Scenario: Issues every time exhaust the budget", async () => {
		const r = await runSpecLoop(proposalStage(() => [ISSUE]), [draft(PROPOSAL), draft(PROPOSAL), draft(PROPOSAL)], {
			budget: { maxIterations: 2 },
		});

		expect(r.outcome.status).toBe("exhausted");
		expect(r.outcome.iterations).toHaveLength(2);
		expect(r.runs).toHaveLength(2);
		expect(check(SpecLoopOutcome, r.outcome)).toBe(true);
	});
});

describe("spec/loop: A clean gate blocks for the principal's review", () => {
	it("Scenario: A clean draft waits for review", async () => {
		const r = await runSpecLoop(proposalStage(), [draft(PROPOSAL)]);

		expect(readFileSync(join(r.changeDir, "proposal.md"), "utf8")).toBe("## Why\n\nBecause.\n");
		expect(r.outcome).toMatchObject({
			status: "blocked",
			escalation: {
				level: "change",
				to: "principal",
				reason: "review",
				question: "Review proposal.md for the proposal stage of add-thing. Answer approve, or say what to change.",
			},
			result: { change: "add-thing", stage: "proposal", files: ["proposal.md"], approved: false },
		});
		expect(check(SpecLoopOutcome, r.outcome)).toBe(true);
	});

	it("Scenario: The stage asks a question", async () => {
		const gate = vi.fn(() => []);
		const r = await runSpecLoop(proposalStage(gate), [draft("", "ask", "Should it export CSV too?")], { escalateTo: "agent" });

		expect(gate).not.toHaveBeenCalled();
		expect(r.outcome).toMatchObject({
			status: "blocked",
			iterations: [],
			escalation: { level: "change", to: "agent", reason: "question", question: "Should it export CSV too?" },
		});
		expect(existsSync(join(r.changeDir, "proposal.md"))).toBe(false);
		expect(check(SpecLoopOutcome, r.outcome)).toBe(true);
	});
});
