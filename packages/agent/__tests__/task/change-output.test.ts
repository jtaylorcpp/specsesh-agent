/**
 * `formatDraftOutput`: the draft's text and its next commands, on results built by hand.
 * The scenarios themselves are tested through the bin in `__tests__/change/cli-output.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { formatDraftOutput, type DraftShown } from "../../src/task/change-output.js";

const change = "add-plan-export";
const context = { changePath: `openspec/changes/${change}` };

const review = (over: Partial<Extract<DraftShown, { kind: "review" }>> = {}): DraftShown => ({
	kind: "review",
	change,
	loop: 12,
	ran: true,
	approved: [],
	stage: "proposal",
	files: ["proposal.md"],
	drafts: [{ n: 1, issues: [] }],
	exitCode: 0,
	...over,
});

describe("formatDraftOutput", () => {
	it("ends a review with its files, then the revise and approve commands", () => {
		const lines = formatDraftOutput(review(), context);
		expect(lines.slice(-3)).toEqual([
			"Review openspec/changes/add-plan-export/proposal.md, then:",
			'  revise:   pnpm change draft add-plan-export "<what to change>"',
			"  approve:  pnpm change approve add-plan-export",
		]);
		expect(lines.join("\n")).not.toContain("pnpm task answer");
	});

	const slices = [
		{ id: change, intent: "Export a plan." },
		{ id: "add-plan-export-schema", intent: "A schema for the export." },
		{ id: "add-plan-export-ci", intent: 'Check "$PLAN" in `ci` \\ too.' },
	];

	it("lists a draft command per later slice, in order, before the ending", () => {
		const lines = formatDraftOutput(review({ approved: ["proposal"], stage: "design", files: ["design.md"] }), { ...context, slices });
		const at = lines.indexOf("Sliced into 3 changes. Draft the others when you're ready:");
		expect(lines[at - 1]).toBe("");
		expect(lines.slice(at + 1, at + 3)).toEqual([
			'  pnpm change draft add-plan-export-schema --intent "A schema for the export."',
			'  pnpm change draft add-plan-export-ci --intent "Check \\"\\$PLAN\\" in \\`ci\\` \\\\ too."',
		]);
		expect(lines.at(-1)).toBe("  approve:  pnpm change approve add-plan-export");
	});

	it("lists no slices without them, or with this change alone", () => {
		for (const given of [context, { ...context, slices: [] }, { ...context, slices: slices.slice(0, 1) }]) {
			expect(formatDraftOutput(review({ approved: ["proposal"] }), given).join("\n")).not.toContain("Sliced into");
		}
	});

	it("ends a question with it, then the answer command", () => {
		const shown: DraftShown = { kind: "question", change, loop: 3, ran: true, approved: [], stage: "proposal", question: "CSV too?", drafts: [{ n: 1, issues: [] }], exitCode: 1 };
		expect(formatDraftOutput(shown, context).slice(-2)).toEqual(["question: CSV too?", '  answer:   pnpm change draft add-plan-export "<answer>"']);
		expect(shown.exitCode).toBe(1);
	});

	it("ends a drafted change with the next group, and says every stage is approved", () => {
		const lines = formatDraftOutput({ kind: "drafted", change, ran: false, approved: ["proposal", "design", "specs", "tasks"], exitCode: 0 }, context);
		expect(lines[0]).toBe("# add-plan-export — drafted: every stage is approved");
		expect(lines.at(-1)).toBe("  next:     pnpm task add-plan-export --next-group");
	});

	it("puts the header, then the approved stages, then the current stage's drafts with their issues", () => {
		const lines = formatDraftOutput(
			review({
				approved: ["proposal"],
				stage: "design",
				files: ["design.md"],
				drafts: [
					{ n: 1, issues: [{ level: "ERROR", path: "design.md", message: "no ## Context" }, { level: "WARNING", path: "design.md", message: "long" }] },
					{ n: 2, issues: [] },
				],
			}),
			context,
		);
		expect(lines.slice(0, 6)).toEqual([
			"# add-plan-export — waiting for review of the design",
			"## proposal: approved",
			"### design draft 1: 2 issues",
			"   ERROR design.md: no ## Context",
			"   WARNING design.md: long",
			"### design draft 2: clean",
		]);
		expect(lines.join("\n")).toContain("openspec/changes/add-plan-export/design.md");
	});

	it("counts one issue in the singular", () => {
		const lines = formatDraftOutput(review({ drafts: [{ n: 1, issues: [{ level: "WARNING", path: "proposal.md", message: "3 capabilities" }] }] }), context);
		expect(lines).toContain("### proposal draft 1: 1 issue");
	});

	it("ends a failed or exhausted draft with its reason and the retry command", () => {
		const failed = formatDraftOutput({ kind: "failed", change, loop: 4, ran: true, approved: [], status: "failed", reason: "model unavailable", stage: "specs", drafts: [], exitCode: 1 }, context);
		expect(failed[0]).toBe("# add-plan-export — draft failed at the specs");
		expect(failed.slice(-2)).toEqual(["reason: model unavailable", "  retry:    pnpm change draft add-plan-export"]);

		const exhausted = formatDraftOutput({ kind: "failed", change, loop: 5, ran: true, approved: [], status: "exhausted", reason: "exhausted", drafts: [], exitCode: 1 }, context);
		expect(exhausted[0]).toBe("# add-plan-export — draft exhausted");
		expect(exhausted.slice(-2)).toEqual(["", "  retry:    pnpm change draft add-plan-export"]);
	});
});
