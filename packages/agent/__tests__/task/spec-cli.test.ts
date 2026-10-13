/**
 * `runSpec`: stage choice, `intent.md`, the refusals and the text output, in
 * process on a faux model over a stage defined in the tests.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LoopOutcome } from "../../src/openspec/index.js";
import type { LoadedConfig } from "../../src/task/config.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import { after, formatSpecOutcome, runSpec, specExitCode } from "../../src/task/spec-cli.js";
import type { StageOutcome } from "../../src/task/spec-loop.js";
import { fauxModels, gitIn, gitRepo } from "./cli-helpers.js";
import { temp } from "./helpers.js";
import { draft, proposalStage } from "./spec-helpers.js";

const stage = proposalStage();

async function spec(args: string[], options: { dir?: string; responses?: ReturnType<typeof draft>[] } = {}) {
	const dir = options.dir ?? temp("spec-cli-");
	const env = fauxModels();
	env.faux.setResponses(options.responses ?? []);
	const model = env.faux.getModel();
	const config: LoadedConfig = { dir, task: {}, delegates: {}, models: {} };
	const out: string[] = [];
	const err: string[] = [];
	const code = await runSpec([...args, "--db", join(dir, ".agentscript", "spec.sqlite")], config, {
		out: (line) => out.push(line),
		err: (line) => err.push(line),
		cwd: dir,
		env: { AGENTSCRIPT_PROVIDER: model.provider, AGENTSCRIPT_MODEL: model.id },
		models: () => env.models,
		stages: [stage],
	});
	return { code, out: out.join("\n"), err: err.join("\n"), dir };
}

const PROPOSAL_BUNDLE = "=== proposal.md\n# A proposal\n";

describe("spec", () => {
	it("Scenario: A new change starts at the proposal", async () => {
		const run = await spec(["add-plan-export", "--intent", "Export a plan"], { responses: [draft(PROPOSAL_BUNDLE)] });
		expect(run.err.split("\n")[0]).toMatch(/^loop \d+ — resume with: agentscript-task resume \d+ --db /);
		expect(run.code).toBe(0);
		const changeDir = join(run.dir, "openspec", "changes", "add-plan-export");
		expect(readFileSync(join(changeDir, "intent.md"), "utf8")).toBe("Export a plan");
		expect(readFileSync(join(changeDir, "proposal.md"), "utf8")).toBe("# A proposal\n");
		expect(run.out).toMatch(/^# spec loop \d+ — blocked \(review\)\n## proposal draft 1: clean\n/);
	});

	it("Scenario: A new change without an intent is refused", async () => {
		const run = await spec(["add-plan-export"]);
		expect(run.code).toBe(2);
		expect(run.err).toContain("--intent");
		expect(existsSync(join(run.dir, "openspec"))).toBe(false);
		expect(existsSync(join(run.dir, ".agentscript"))).toBe(false);
	});

	it("Scenario: A dirty tree does not refuse spec", async () => {
		const repo = gitRepo();
		writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
		expect(gitIn(repo, "status", "--porcelain")).toContain("src/a.ts");
		const run = await spec(["add-plan-export", "--intent", "Export a plan"], { dir: repo, responses: [draft(PROPOSAL_BUNDLE)] });
		expect(run.code).toBe(0);
		expect(existsSync(join(repo, "openspec", "changes", "add-plan-export", "proposal.md"))).toBe(true);
	});

	it("Scenario: A review prints both commands", async () => {
		const run = await spec(["add-plan-export", "--intent", "Export a plan"], { responses: [draft(PROPOSAL_BUNDLE)] });
		const id = /^# spec loop (\d+)/.exec(run.out)?.[1];
		expect(run.out.split("\n").slice(-3)).toEqual([
			"Review openspec/changes/add-plan-export/proposal.md, then:",
			`  approve:  pnpm task answer ${id} --by principal --decision approve`,
			`  revise:   pnpm task answer ${id} --by principal --decision "<what to change>"`,
		]);
	});

	it("Scenario: The last approval points at execution", async () => {
		const dir = temp("spec-cli-");
		const changeDir = join(dir, "openspec", "changes", "add-plan-export");
		await spec(["add-plan-export", "--intent", "Export a plan"], { dir, responses: [draft(PROPOSAL_BUNDLE)] });
		recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: new Date().toISOString() }, [stage]);
		const run = await spec(["add-plan-export"], { dir });
		expect(run.code).toBe(0);
		expect(run.out).toBe("Every stage of add-plan-export is approved. Execute it: pnpm task add-plan-export --next-group");
	});

	it("reruns an approved stage whose file changed", async () => {
		const dir = temp("spec-cli-");
		const changeDir = join(dir, "openspec", "changes", "add-plan-export");
		await spec(["add-plan-export", "--intent", "Export a plan"], { dir, responses: [draft(PROPOSAL_BUNDLE)] });
		recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: new Date().toISOString() }, [stage]);
		writeFileSync(join(changeDir, "proposal.md"), "# edited\n");
		const run = await spec(["add-plan-export"], { dir, responses: [draft(PROPOSAL_BUNDLE)] });
		expect(run.code).toBe(0);
		expect(run.out).toContain("## proposal draft 1: clean");
	});

	it("refuses --worktree, an unknown stage, both intents, and an intent over intent.md", async () => {
		const worktree = await spec(["add-plan-export", "--intent", "x", "--worktree"]);
		expect([worktree.code, worktree.err]).toEqual([2, "spec runs in place; --worktree is not supported"]);
		const unknown = await spec(["add-plan-export", "design", "--intent", "x"]);
		expect([unknown.code, unknown.err]).toEqual([2, "unknown stage design; stages: proposal"]);
		const both = await spec(["add-plan-export", "--intent", "x", "--intent-file", "f.md"]);
		expect(both.code).toBe(2);

		const dir = temp("spec-cli-");
		await spec(["add-plan-export", "--intent", "Export a plan"], { dir, responses: [draft(PROPOSAL_BUNDLE)] });
		const again = await spec(["add-plan-export", "--intent", "Something else"], { dir });
		expect(again.code).toBe(2);
		expect(again.err).toContain("intent.md exists; edit it instead");
		expect(readFileSync(join(dir, "openspec", "changes", "add-plan-export", "intent.md"), "utf8")).toBe("Export a plan");
	});

	it("streams the spec events as JSON Lines after the resume hint", async () => {
		const run = await spec(["add-plan-export", "--intent", "Export a plan"], { responses: [draft(PROPOSAL_BUNDLE)] });
		const [hint, ...lines] = run.err.split("\n");
		const id = Number(/^loop (\d+) — resume with/.exec(hint ?? "")?.[1]);
		const events = lines.map((line) => JSON.parse(line) as { event: string; loop: number });
		expect(events.map((event) => event.event)).toEqual(["stage-started", "stage-draft", "stage-review", "stage-ended"]);
		expect(events.every((event) => event.loop === id)).toBe(true);
		expect(events[0]).toMatchObject({ change: "add-plan-export", stage: "proposal", script: "custom" });
		expect(events[1]).toMatchObject({ draft: 1, written: ["proposal.md"], issues: [] });
		expect(events[3]).toMatchObject({ status: "blocked", drafts: 1, approved: false });
	});

	it("writes --intent-file's words verbatim", async () => {
		const dir = temp("spec-cli-");
		writeFileSync(join(dir, "why.md"), "Export a plan\n\nso CI can read it.\n");
		const run = await spec(["add-plan-export", "--intent-file", "why.md"], { dir, responses: [draft(PROPOSAL_BUNDLE)] });
		expect(run.code).toBe(0);
		expect(readFileSync(join(dir, "openspec", "changes", "add-plan-export", "intent.md"), "utf8")).toBe("Export a plan\n\nso CI can read it.\n");
	});
});

describe("formatSpecOutcome and specExitCode", () => {
	const review: LoopOutcome<StageOutcome> = {
		status: "blocked",
		iterations: [],
		escalation: { level: "change", to: "principal", reason: "review", question: "Review proposal.md" },
		result: { change: "add-plan-export", stage: "proposal", files: ["proposal.md"], approved: false },
	};
	const approved: LoopOutcome<StageOutcome> = {
		status: "converged",
		iterations: [],
		result: { change: "add-plan-export", stage: "proposal", files: ["proposal.md"], approved: true },
	};
	const context = { loop: 12, change: "add-plan-export", changePath: "openspec/changes/add-plan-export" };

	it("ends a review with both commands for its loop", () => {
		expect(formatSpecOutcome(review, context).slice(-2)).toEqual([
			"  approve:  pnpm task answer 12 --by principal --decision approve",
			'  revise:   pnpm task answer 12 --by principal --decision "<what to change>"',
		]);
	});

	it("ends an approval with the next stage's command, or with execution when none remains", () => {
		expect(formatSpecOutcome(approved, { ...context, loop: 13, principal: "jesse", nextStage: "design" })).toEqual([
			"# spec loop 13 — converged (approved)",
			"proposal approved by jesse.",
			"Next: pnpm task spec add-plan-export",
		]);
		expect(formatSpecOutcome(approved, { ...context, principal: "jesse" }).at(-1)).toBe(
			"Every stage of add-plan-export is approved. Execute it: pnpm task add-plan-export --next-group",
		);
	});

	const SLICES_MD = [
		"1. `add-plan-export`: Export a plan as JSON with `specplan export --json`.",
		"2. `add-plan-export-schema`: Publish the JSON Schema of the export. Follows add-plan-export.",
		"3. `add-plan-export-ci`: A GitHub Action that fails a PR whose plan export is invalid. Follows add-plan-export-schema.",
		"",
	].join("\n");

	/** A change directory whose proposal is approved by jesse, with `slices.md` when given. */
	function approvedChange(slices?: string) {
		const changeDir = join(temp("spec-cli-"), "openspec", "changes", "add-plan-export");
		mkdirSync(changeDir, { recursive: true });
		writeFileSync(join(changeDir, "proposal.md"), "# A proposal\n");
		if (slices !== undefined) writeFileSync(join(changeDir, "slices.md"), slices);
		recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: new Date().toISOString() }, [stage]);
		return changeDir;
	}

	it("lists the other slices after approving a sliced proposal", () => {
		const changeDir = approvedChange(SLICES_MD);
		const lines = formatSpecOutcome(approved, { ...context, loop: 14, ...after(approved, [stage, { ...stage, name: "design" }], changeDir) });
		expect(lines).toEqual([
			"# spec loop 14 — converged (approved)",
			"proposal approved by jesse.",
			"Next: pnpm task spec add-plan-export",
			"",
			"Sliced into 3 changes. Start the others when you're ready:",
			'  pnpm task spec add-plan-export-schema --intent "Publish the JSON Schema of the export. Follows add-plan-export."',
			'  pnpm task spec add-plan-export-ci --intent "A GitHub Action that fails a PR whose plan export is invalid. Follows add-plan-export-schema."',
		]);
		expect(lines.some((line) => line.startsWith("  pnpm task spec add-plan-export --intent"))).toBe(false);
	});

	it("escapes quotes, backslashes, dollars and backticks in a slice's intent", () => {
		const slices = [
			{ id: "add-plan-export", intent: "First." },
			{ id: "add-plan-export-schema", intent: 'Say "hi" to $HOME, `pwd` and \\n.' },
		];
		expect(formatSpecOutcome(approved, { ...context, nextStage: "design", slices }).at(-1)).toBe(
			'  pnpm task spec add-plan-export-schema --intent "Say \\"hi\\" to \\$HOME, \\`pwd\\` and \\\\n."',
		);
	});

	it("prints nothing extra without slices.md, or with a malformed one", () => {
		const expected = ["# spec loop 12 — converged (approved)", "proposal approved by jesse.", "Next: pnpm task spec add-plan-export"];
		const stages = [stage, { ...stage, name: "design" }];
		const plain = approvedChange();
		expect(formatSpecOutcome(approved, { ...context, ...after(approved, stages, plain) })).toEqual(expected);
		const malformed = approvedChange(`# Slices\n${SLICES_MD}`);
		expect(formatSpecOutcome(approved, { ...context, ...after(approved, stages, malformed) })).toEqual(expected);
	});

	it("lists no slices after approving a stage other than the proposal", () => {
		const slices = [
			{ id: "add-plan-export", intent: "First." },
			{ id: "add-plan-export-schema", intent: "Second." },
		];
		const design = { ...approved, result: { ...approved.result, stage: "design" } };
		expect(formatSpecOutcome(design, { ...context, nextStage: "specs", slices }).at(-1)).toBe("Next: pnpm task spec add-plan-export");
	});

	it("Scenario: A spec loop waiting for review exits 0", () => {
		expect(specExitCode(review)).toBe(0);
		expect(specExitCode(approved)).toBe(0);
		expect(specExitCode({ ...review, escalation: { ...review.escalation, reason: "question" } })).toBe(1);
		expect(specExitCode({ status: "exhausted" })).toBe(1);
		expect(specExitCode({ status: "failed" })).toBe(1);
	});
});
