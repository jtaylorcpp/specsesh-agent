/**
 * A spec loop's review through `main()`: `status`, `answer` with the principal
 * taken from git, and the text output's closing commands, on a faux model in a
 * temp git repository.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { cli, fauxModels, gitIn, gitRepo } from "./cli-helpers.js";
import { cleanTemps } from "./helpers.js";
import { draft } from "./spec-helpers.js";

afterEach(() => cleanTemps());

/** All five sections, in order, naming one new capability. */
const PROPOSAL = ["Why", "What Changes", "Out of scope", "Capabilities", "Impact"]
	.map((heading) => `## ${heading}\n\n${heading === "Capabilities" ? "- **New:** `plan/export`." : `- ${heading} text.`}\n`)
	.join("\n");

/** Two sections, a self-contained mock and an example, each named in design.md. */
const DESIGN = [
	"=== design.md",
	"## Context\n\nThe mock is `design/mock.html`.\n",
	"## Decisions\n\nSee `design/examples/export.ts`.\n",
	"=== design/mock.html",
	"<!doctype html>\n<html><body>Export</body></html>\n",
	"=== design/examples/export.ts",
	"export const plan = {};\n",
].join("\n");

/** One delta for the proposal's one new capability, with its `## Purpose`. */
const SPECS = [
	"=== specs/plan/export/spec.md",
	"## Purpose\n\nExport a plan as JSON, so that CI and other tools can read it.\n",
	"## ADDED Requirements\n",
	"### Requirement: Export as JSON\n\nThe CLI SHALL print the plan as JSON.\n",
	"#### Scenario: JSON on stdout\n\n- **WHEN** the plan is exported\n- **THEN** stdout is the plan as JSON\n",
].join("\n");

/** One group with one task, naming one file and quoting the delta's one scenario. */
const TASKS = [
	"=== tasks.md",
	"## 1. Export\n",
	'- [ ] 1.1 `src/export.ts` (new): print the plan as JSON, "JSON on stdout"\n',
].join("\n");

/** A clean draft per stage in `SPEC_STAGES`; a stage added there needs one here. */
const DRAFTS: Record<string, string> = { proposal: `=== proposal.md\n${PROPOSAL}`, design: DESIGN, specs: SPECS, tasks: TASKS };

const INTENT = "Export a plan as JSON so CI can read it";

/** The existing capability's spec, valid enough that the specs gate's trial fold passes it. */
const CLI_SPEC = [
	"## Purpose\n\nThe task CLI runs one task of a change and reports how it ended.\n",
	"## Requirements\n",
	"### Requirement: It runs\n\nThe CLI SHALL run the task.\n",
	"#### Scenario: A task runs\n\n- **WHEN** the CLI is run\n- **THEN** the task runs\n",
].join("\n");

/**
 * A repository with one existing capability and `user.name` `jesse` in its local
 * git config only. `$USER` is `fallback`, so a `jesse` can only come from git.
 */
function reviewRepo(): string {
	const repo = gitRepo({ "openspec/specs/task/cli/spec.md": CLI_SPEC });
	gitIn(repo, "config", "user.name", "jesse");
	return repo;
}

const db = (repo: string) => join(repo, ".agentscript", "spec.sqlite");

/** `<args> --db <db>` in `repo`, on a faux model answering `responses`. */
async function task(repo: string, args: string[], responses: ReturnType<typeof draft>[] = []) {
	const env = fauxModels();
	env.faux.setResponses(responses);
	const model = env.faux.getModel();
	return cli([...args, "--db", db(repo)], env, {
		cwd: repo,
		env: { AGENTSCRIPT_PROVIDER: model.provider, AGENTSCRIPT_MODEL: model.id, USER: "fallback" },
	});
}

/** `spec add-plan-export` for `stage`, drafting it clean; the loop id from the output's first line. */
async function startReview(repo: string, stage = SPEC_STAGES[0]!.name, intent = true) {
	const files = DRAFTS[stage];
	expect(files, `no draft fixture for stage ${stage}`).toBeDefined();
	const r = await task(repo, ["spec", "add-plan-export", ...(intent ? ["--intent", INTENT] : [])], [draft(files!)]);
	const id = /^# spec loop (\d+) — blocked/.exec(r.out)?.[1];
	expect(id, `${r.out}\n${r.err}`).toBeDefined();
	return { ...r, id: id! };
}

const lastLines = (out: string, n: number) => out.split("\n").filter((line) => line.trim() !== "").slice(-n);

describe("task/cli: status and answer cover spec loops", () => {
	it("Scenario: status shows the stage", async () => {
		const repo = reviewRepo();
		const { id } = await startReview(repo);

		const r = await task(repo, ["status"]);
		expect(r.code, r.err).toBe(0);
		const line = r.out.split("\n").find((l) => l.startsWith(`loop ${id} `));
		expect(line, r.out).toBeDefined();
		expect(line).toContain("spec proposal");
	});

	it("Scenario: answer approves with the git name", async () => {
		const repo = reviewRepo();
		const { id } = await startReview(repo);

		const r = await task(repo, ["answer", id, "--by", "principal", "--decision", "approve"]);
		expect(r.code, r.err).toBe(0);
		const file = JSON.parse(readFileSync(join(repo, "openspec", "changes", "add-plan-export", "approvals.json"), "utf8")) as {
			approvals: { stage: string; principal: string }[];
		};
		const entry = file.approvals.find((approval) => approval.stage === "proposal");
		expect(entry?.principal).toBe("jesse");
		const [hint, ...lines] = r.err.trimEnd().split("\n");
		expect(hint).toMatch(/^loop \d+ — resume with: specsesh task resume \d+ --db /);
		expect(lines.map((line) => JSON.parse(line) as unknown)).toMatchObject([
			{ event: "stage-started", stage: "proposal", script: "spec-proposal" },
			{ event: "stage-ended", status: "converged", drafts: 0, approved: true },
		]);
	});
});

describe("task/cli: text output for a spec loop ends with the next step", () => {
	it("Scenario: A review prints both commands", async () => {
		const repo = reviewRepo();
		const r = await startReview(repo);
		expect(r.code, r.err).toBe(0);
		expect(r.out).toContain("## proposal draft 1: clean");
		expect(r.out).toContain("openspec/changes/add-plan-export/proposal.md");
		const [approve, revise] = lastLines(r.out, 2);
		expect(approve).toMatch(new RegExp(`specsesh task answer ${r.id} --by principal --decision approve$`));
		expect(revise!.endsWith(`specsesh task answer ${r.id} --by principal --decision "<what to change>"`)).toBe(true);
		expect(r.out).not.toContain("agentscript-task");
		expect(r.out).not.toContain("pnpm task");
	});

	it("Scenario: The last approval points at execution", async () => {
		const repo = reviewRepo();
		let last;
		for (const [n, stage] of SPEC_STAGES.entries()) {
			const { id } = await startReview(repo, stage.name, n === 0);
			last = await task(repo, ["answer", id, "--by", "principal", "--decision", "approve"]);
			expect(last.code, last.err).toBe(0);
		}
		expect(last!.out).toMatch(/^# spec loop \d+ — converged/);
		expect(lastLines(last!.out, 1)[0]).toMatch(/specsesh task add-plan-export --next-group$/);
		expect(last!.out).not.toContain("pnpm task");
	});

	it("Scenario: Approving a sliced proposal lists the other slices", async () => {
		const repo = reviewRepo();
		const slices = [
			"1. `add-plan-export`: Export a plan as JSON with `specplan export --json`.",
			"2. `add-plan-export-schema`: Publish the JSON Schema of the export. Follows add-plan-export.",
			"3. `add-plan-export-ci`: A GitHub Action that fails a PR whose plan export is invalid. Follows add-plan-export-schema.",
		].join("\n");
		const first = await task(
			repo,
			["spec", "add-plan-export", "--intent", INTENT],
			[draft(`${DRAFTS.proposal}\n=== slices.md\n${slices}\n`)],
		);
		const id = /^# spec loop (\d+) — blocked/.exec(first.out)?.[1];
		expect(id, `${first.out}\n${first.err}`).toBeDefined();

		const r = await task(repo, ["answer", id!, "--by", "principal", "--decision", "approve"]);
		expect(r.code, r.err).toBe(0);
		const next =
			SPEC_STAGES.length > 1 ? "Next: specsesh task spec add-plan-export" : "specsesh task add-plan-export --next-group";
		const schema =
			'specsesh task spec add-plan-export-schema --intent "Publish the JSON Schema of the export. Follows add-plan-export."';
		const ci =
			'specsesh task spec add-plan-export-ci --intent "A GitHub Action that fails a PR whose plan export is invalid. Follows add-plan-export-schema."';
		expect(r.out).toContain(schema);
		expect(r.out).toContain(ci);
		expect(r.out.indexOf(schema)).toBeLessThan(r.out.indexOf(ci));
		expect(r.out).not.toContain("spec add-plan-export --intent");
		expect(r.out.indexOf(next), r.out).toBeGreaterThanOrEqual(0);
		expect(r.out.indexOf(next)).toBeLessThan(r.out.indexOf(schema));
		expect(r.out).not.toContain("agentscript-task");
		expect(r.out).not.toContain("pnpm task");
	});
});
