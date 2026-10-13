/**
 * `formatDraftOutput` and `formatBuildOutput`: the text and its next commands, on results built by hand.
 * The scenarios themselves are tested through the bin in `__tests__/change/cli-output.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { formatBuildOutput, formatDraftOutput, type BuildShown, type DraftShown } from "../../src/task/change-output.js";
import type { BuildGroup } from "../../src/task/cmd-build.js";

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

	it("ends a drafted change with the build command, and says every stage is approved", () => {
		const lines = formatDraftOutput({ kind: "drafted", change, ran: false, approved: ["proposal", "design", "specs", "tasks"], exitCode: 0 }, context);
		expect(lines[0]).toBe("# add-plan-export — drafted: every stage is approved");
		expect(lines.at(-1)).toBe("  next:     pnpm change build add-plan-export");
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

const shown = { change, loop: 7, ran: true, groups: [], unclaimed: [], changed: [], notes: [] };
const converged = (k: number, over: Partial<BuildGroup> = {}): BuildGroup => ({ group: k, status: "converged", tasks: 2, reworks: 0, ...over });

describe("formatBuildOutput", () => {
	it("lists every group, the change check, the changed files, and ends a built change with the close command", () => {
		const result: BuildShown = {
			...shown,
			kind: "built",
			groups: [converged(1, { tasks: 4 }), converged(2, { tasks: 3, reworks: 1 }), converged(3)],
			check: { passed: true },
			changed: ["packages/plan/src/export.ts", "packages/plan/src/cli.ts"],
			exitCode: 0,
		};
		expect(formatBuildOutput(result)).toEqual([
			"# add-plan-export — built",
			"## group 1: converged (4 tasks, 0 reworks)",
			"## group 2: converged (3 tasks, 1 rework)",
			"## group 3: converged (2 tasks, 0 reworks)",
			"## change check: passed",
			"",
			"Changed: packages/plan/src/export.ts, packages/plan/src/cli.ts",
			"pnpm change close add-plan-export",
		]);
		expect(result.exitCode).toBe(0);
	});

	it("says a build that ran nothing is built, with no changed files", () => {
		const lines = formatBuildOutput({ ...shown, ran: false, kind: "built", groups: [converged(1)], check: { passed: true }, exitCode: 0 });
		expect(lines[0]).toBe("# add-plan-export — built");
		expect(lines.join("\n")).not.toContain("Changed:");
		expect(lines.at(-1)).toBe("pnpm change close add-plan-export");
	});

	it("ends a built change with the close command after the change check and the unclaimed scenarios, never spec:archive", () => {
		const lines = formatBuildOutput({
			...shown,
			kind: "built",
			groups: [converged(1)],
			check: { passed: true },
			unclaimed: [{ capability: ["plan", "export"], requirement: "Export writes JSON", scenario: "An empty plan exports" }],
			exitCode: 0,
		});
		expect(lines).toContain("## change check: passed");
		expect(lines.indexOf("## unclaimed: 1")).toBeGreaterThan(lines.indexOf("## change check: passed"));
		expect(lines.at(-1)).toBe("pnpm change close add-plan-export");
		expect(lines.join("\n")).not.toContain("spec:archive");
	});

	it("ends a blocked build with the group's question, then the answer command", () => {
		const result: BuildShown = {
			...shown,
			kind: "waiting",
			groups: [converged(1, { tasks: 4 }), { group: 2, status: "blocked", tasks: 3, reworks: 0, blockedAt: "2.3" }],
			to: "principal",
			question: "Which API?",
			group: 2,
			task: "2.3",
			exitCode: 1,
		};
		const lines = formatBuildOutput(result);
		expect(lines.slice(0, 3)).toEqual(["# add-plan-export — waiting for an answer", "## group 1: converged (4 tasks, 0 reworks)", "## group 2: blocked at 2.3"]);
		expect(lines.slice(-2)).toEqual(["group 2 asks: Which API?", '  answer:  pnpm change build add-plan-export "<answer>"']);
		expect(result.exitCode).toBe(1);
	});

	it("asks without a group when the build doesn't know it", () => {
		const lines = formatBuildOutput({ ...shown, kind: "waiting", to: "principal", question: "Which API?", exitCode: 1 });
		expect(lines.slice(-2)).toEqual(["question: Which API?", '  answer:  pnpm change build add-plan-export "<answer>"']);
	});

	it("prints a failed change check's commands and output, and the unclaimed scenarios", () => {
		const lines = formatBuildOutput({
			...shown,
			kind: "failed",
			status: "exhausted",
			reason: "exhausted",
			groups: [converged(1)],
			check: { passed: false, reason: "change check failed:\n$ pnpm spec:check\nexit 1\n1 change invalid" },
			unclaimed: [{ capability: ["plan", "export"], requirement: "Export writes JSON", scenario: "An empty plan exports" }],
			exitCode: 1,
		});
		expect(lines).toEqual([
			"# add-plan-export — exhausted",
			"## group 1: converged (2 tasks, 0 reworks)",
			"## change check: failed",
			"   $ pnpm spec:check",
			"   exit 1",
			"   1 change invalid",
			"## unclaimed: 1",
			"   plan/export › Export writes JSON › An empty plan exports",
			"",
			"  retry:   pnpm change build add-plan-export",
		]);
	});

	it("ends a failed build with its reason and the retry command", () => {
		const lines = formatBuildOutput({ ...shown, kind: "failed", status: "failed", reason: "model unavailable", exitCode: 1 });
		expect(lines[0]).toBe("# add-plan-export — failed");
		expect(lines.slice(-2)).toEqual(["reason: model unavailable", "  retry:   pnpm change build add-plan-export"]);
	});
});
