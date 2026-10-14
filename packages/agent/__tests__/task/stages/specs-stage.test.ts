import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../../../src/authoring/index.js";
import { readDeclarations } from "../../../src/interpreter/compose.js";
import { SPEC_STAGES, designStage, proposalStage } from "../../../src/task/index.js";
import { stageContractProblems, type StageContext } from "../../../src/task/spec-stage.js";
import { specsStage } from "../../../src/task/stages/specs.js";
import { cleanTemps, prompts, temp } from "../helpers.js";
import { draft, runSpecLoop } from "../spec-helpers.js";

// The trial fold has its own tests in specs-gate.test.ts; here it folds clean.
vi.mock("../../../src/task/stages/trial-fold-issues.js", () => ({ trialFoldIssues: vi.fn(async () => []) }));

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

const STAGES_SPEC = "## Purpose\nThe spec stages.\n\n## Requirements\n\n### Requirement: Stages run in order\nThey SHALL run in order.\n";

const STAGES_PROPOSAL = PROPOSAL.replace("- **Modified:** `task/cli`\n- **New:** `spec/export`\n", "- **Modified:** `spec/stages`\n");

const DESIGN = "## Context\n\nWhy.\n\n## Decisions\n\n- See `design/mock.html` and `design/examples/a.ts`.\n";
const MOCK = "<!doctype html>\n<html><body>mock</body></html>\n";
const EXAMPLE = "a();\n";

/** A workspace with `spec/stages`'s spec, and `add-thing`'s approved proposal (modifying it) and design. */
function stagesWorkspace(): { workspace: string; changeDir: string } {
	const workspace = temp("specs-stage-");
	const spec = join(workspace, "openspec", "specs", "spec", "stages", "spec.md");
	mkdirSync(dirname(spec), { recursive: true });
	writeFileSync(spec, STAGES_SPEC);
	const changeDir = join(workspace, "openspec", "changes", "add-thing");
	mkdirSync(join(changeDir, "design", "examples"), { recursive: true });
	writeFileSync(join(changeDir, "proposal.md"), STAGES_PROPOSAL);
	writeFileSync(join(changeDir, "design.md"), DESIGN);
	writeFileSync(join(changeDir, "design", "mock.html"), MOCK);
	writeFileSync(join(changeDir, "design", "examples", "a.ts"), EXAMPLE);
	return { workspace, changeDir };
}

const specifySource = (): string => readFileSync((specsStage.script as { path: string }).path, "utf8");

describe("specsStage scenarios", () => {
	it("Scenario: The specs stage sees the mock and examples", async () => {
		const { workspace, changeDir } = stagesWorkspace();
		const base = `=== openspec/specs/spec/stages/spec.md\n${STAGES_SPEC}`;
		expect((await specsStage.seed?.({ changeId: "add-thing", workspace, changeDir, files: {}, run: fakeRun(validJson(), showJson([])).run }))?.base).toBe(base);

		// `approved` is seeded by the loop from the approved stages' owned paths; `ask` ends the run before the gate.
		const approved = [...proposalStage.owns, ...designStage.owns];
		const bundle = "=== specs/spec/stages/spec.md\n## MODIFIED Requirements\n";
		const r = await runSpecLoop(specsStage, [draft(bundle, "ask", "Which?")], { workspace, script: specifySource(), approved });
		const prompt = prompts(r.env.requests)[0] ?? "";
		expect(prompt).toContain(`=== proposal.md\n${STAGES_PROPOSAL}`);
		expect(prompt).toContain(`=== design.md\n${DESIGN}`);
		expect(prompt).toContain(`=== design/mock.html\n${MOCK}`);
		expect(prompt).toContain(`=== design/examples/a.ts\n${EXAMPLE}`);
		expect(prompt).toContain(base);
		expect(r.outcome).toMatchObject({ status: "blocked", escalation: { reason: "question" } });
	});

	it("Scenario: Seventeen scenarios are sent back", async () => {
		const { workspace, changeDir } = stagesWorkspace();
		const requirement = (name: string, n: number) => ({ spec: "spec/stages", operation: "MODIFIED", requirement: { name, text: "It SHALL.", scenarios: scenarios(n) } });
		const deltas = [requirement("One", 6), requirement("Two", 6), requirement("Three", 5)];
		const { run, calls } = fakeRun(validJson(), showJson(deltas));
		const files = { "specs/spec/stages/spec.md": "## MODIFIED Requirements\n\n### Requirement: One\n" };
		const issues = await specsStage.gate({ changeId: "add-thing", workspace, changeDir, files, run });

		const warnings = issues.filter((issue) => issue.level === "WARNING" && issue.message.includes("scenarios"));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.message).toContain("17");
		expect(warnings[0]?.message).toContain("16");
		expect(issues.filter((issue) => issue.path === "tasks.md" || /\b(groups?|tasks?)\b/.test(issue.message))).toEqual([]);
		expect(calls.map((argv) => argv.slice(0, 3))).toEqual([
			["env", "OPENSPEC_TELEMETRY=0", "openspec"],
			["env", "OPENSPEC_TELEMETRY=0", "openspec"],
		]);
	});

	it("Scenario: The design follows the proposal", () => {
		expect(SPEC_STAGES.map((stage) => stage.name)).toEqual(["proposal", "design", "specs", "tasks"]);
		expect(specsStage.after).toEqual(["design"]);
		expect(specsStage.owns).toEqual(["specs/"]);
		expect("path" in specsStage.script && specsStage.script.path).toMatch(/spec-specify\.agent$/);
	});

	it("Scenario: The bundled specify script fits the contract", () => {
		const source = specifySource();
		const analysis = analyze(source);
		// No error (LSP severity 1).
		expect(analysis.diagnostics.filter((diagnostic) => diagnostic.severity === 1)).toEqual([]);
		expect(stageContractProblems(source)).toEqual([]);
		expect(readDeclarations(analysis.parsed).get("next_action")?.initial).toBe("review");

		expect(source.match(/^subagent /gm)).toHaveLength(1);
		for (const name of ["files", "summary", "next_action", "question"]) {
			expect(source).toContain(`set @variables.${name} = @outputs.${name}`);
		}
	});
});
