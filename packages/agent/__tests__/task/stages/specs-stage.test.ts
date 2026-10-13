import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StageContext } from "../../../src/task/spec-stage.js";
import { specsStage } from "../../../src/task/stages/specs.js";
import { cleanTemps, temp } from "../helpers.js";

afterEach(cleanTemps);

const CLI_SPEC = "## Purpose\nThe task CLI.\n\n## Requirements\n\n### Requirement: It runs\nIt SHALL run.\n";

const PROPOSAL = ["Why", "What Changes", "Out of scope", "Capabilities", "Impact"]
	.map((heading) =>
		`## ${heading}\n\n${heading === "Capabilities" ? "- **Modified:** `task/cli`\n- **New:** `spec/export`\n" : `- ${heading} text.\n`}`,
	)
	.join("\n");

const DELTAS = {
	"specs/task/cli/spec.md": "## MODIFIED Requirements\n\n### Requirement: It runs\n",
	"specs/spec/export/spec.md": "## Purpose\n\nExport.\n\n## ADDED Requirements\n\n### Requirement: Export\n",
};

/** A workspace with `task/cli`'s spec and the approved proposal in `add-thing`. */
function specsWorkspace(): { workspace: string; changeDir: string } {
	const workspace = temp("specs-stage-");
	const spec = join(workspace, "openspec", "specs", "task", "cli", "spec.md");
	mkdirSync(dirname(spec), { recursive: true });
	writeFileSync(spec, CLI_SPEC);
	const changeDir = join(workspace, "openspec", "changes", "add-thing");
	mkdirSync(changeDir, { recursive: true });
	writeFileSync(join(changeDir, "proposal.md"), PROPOSAL);
	return { workspace, changeDir };
}

type Reply = { output: string; exitCode?: number } | Error;

/** A `run` answering `openspec validate` and `openspec show` with canned replies, recording each argv. */
function fakeRun(validate: Reply, show: Reply): { run: StageContext["run"]; calls: string[][] } {
	const calls: string[][] = [];
	const run: StageContext["run"] = async (argv) => {
		calls.push([...argv]);
		const reply = argv.includes("validate") ? validate : show;
		if (reply instanceof Error) throw reply;
		return { command: argv.join(" "), exitCode: reply.exitCode ?? 0, output: reply.output };
	};
	return { run, calls };
}

const validJson = (issues: unknown[] = []) => ({ output: JSON.stringify({ items: [{ id: "add-thing", valid: issues.length === 0, issues }] }) });
const showJson = (deltas: unknown[]) => ({ output: JSON.stringify({ deltas }) });
const scenarios = (n: number) => Array.from({ length: n }, (_, i) => ({ rawText: `S${i}` }));
const delta = (spec: string, operation: string, n: number) => ({ spec, operation, requirement: { name: `${spec} ${n}`, text: "It SHALL.", scenarios: scenarios(n) } });
const COVERED = [delta("task/cli", "MODIFIED", 1), delta("spec/export", "ADDED", 1)];

function context(run: StageContext["run"], files: Record<string, string> = DELTAS): StageContext {
	const { workspace, changeDir } = specsWorkspace();
	return { changeId: "add-thing", workspace, changeDir, files, run };
}

describe("specsStage", () => {
	it("owns specs/ after design, with the bundled specify script", () => {
		expect(specsStage.name).toBe("specs");
		expect(specsStage.owns).toEqual(["specs/"]);
		expect(specsStage.after).toEqual(["design"]);
		expect("path" in specsStage.script && specsStage.script.path).toMatch(/spec-specify\.agent$/);
	});

	it("seeds base with the full spec of each modified capability only", async () => {
		const ctx = context(fakeRun(validJson(), showJson([])).run, {});
		expect((await specsStage.seed?.(ctx))?.base).toBe(`=== openspec/specs/task/cli/spec.md\n${CLI_SPEC}`);
	});

	it("passes a clean draft, running validate then show with telemetry off", async () => {
		const { run, calls } = fakeRun(validJson(), showJson(COVERED));
		expect(await specsStage.gate(context(run))).toEqual([]);
		expect(calls).toEqual([
			["env", "OPENSPEC_TELEMETRY=0", "openspec", "validate", "add-thing", "--strict", "--json"],
			["env", "OPENSPEC_TELEMETRY=0", "openspec", "show", "add-thing", "--json", "--deltas-only"],
		]);
	});

	it("reports validate's issues at their own level and path, ahead of coverage", async () => {
		const issue = { level: "ERROR", path: "specs/spec/export/spec.md", message: "Requirement must have at least one scenario" };
		const files = { ...DELTAS, "specs/task/group/spec.md": "## ADDED Requirements\n" };
		const issues = await specsStage.gate(context(fakeRun({ ...validJson([issue]), exitCode: 1 }, showJson(COVERED)).run, files));
		expect(issues).toEqual([issue, { level: "ERROR", path: "specs/task/group/spec.md", message: expect.stringContaining("`task/group`") }]);
	});

	it("reports one ERROR naming openspec validate when it cannot spawn, and never runs show", async () => {
		const { run, calls } = fakeRun(new Error("spawn openspec ENOENT"), showJson(COVERED));
		const issues = await specsStage.gate(context(run));
		expect(issues).toEqual([{ level: "ERROR", path: ".", message: expect.stringContaining("`openspec validate`") }]);
		expect(issues[0]?.message).toContain("ENOENT");
		expect(calls).toHaveLength(1);
	});

	it("still checks coverage when validate cannot run", async () => {
		const issues = await specsStage.gate(context(fakeRun({ output: "env: 'openspec': No such file", exitCode: 127 }, showJson([])).run, {}));
		expect(issues.map((issue) => issue.path)).toEqual([".", "specs/spec/export/spec.md", "specs/task/cli/spec.md"]);
	});

	it("passes show's ERROR through and skips the size check when show fails", async () => {
		const issues = await specsStage.gate(context(fakeRun(validJson(), { output: "not json" }).run));
		expect(issues).toEqual([{ level: "ERROR", path: ".", message: expect.stringContaining("`openspec show`") }]);
	});

	it("warns on 17 scenarios against 16, with no tasks or groups issue", async () => {
		const deltas = [delta("task/cli", "MODIFIED", 9), delta("spec/export", "ADDED", 8)];
		const issues = await specsStage.gate(context(fakeRun(validJson(), showJson(deltas)).run));
		expect(issues).toEqual([{ level: "WARNING", path: "specs", message: expect.stringMatching(/^17 scenarios, over the budget of 16/) }]);
	});
});
