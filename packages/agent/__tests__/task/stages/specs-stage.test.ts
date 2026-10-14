import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../../../src/authoring/index.js";
import { readDeclarations } from "../../../src/interpreter/compose.js";
import { SPEC_STAGES, designStage, proposalStage } from "../../../src/task/index.js";
import { resetOpenspecCache } from "../../../src/task/openspec-bin.js";
import { stageContractProblems, type StageContext } from "../../../src/task/spec-stage.js";
import { specsStage } from "../../../src/task/stages/specs.js";
import { cleanTemps, fakeOpenspecBin, type FakeOpenspecReply, openspecCalls, prompts, temp } from "../helpers.js";
import { draft, runSpecLoop } from "../spec-helpers.js";

// The trial fold has its own tests in specs-gate.test.ts; here it folds clean.
vi.mock("../../../src/task/stages/trial-fold-issues.js", () => ({ trialFoldIssues: vi.fn(async () => []) }));

beforeEach(resetOpenspecCache);

afterEach(() => {
	vi.unstubAllEnvs();
	cleanTemps();
});

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

/** The gates run openspec themselves; a stage's `run` is not used for it. */
const unusedRun: StageContext["run"] = async (argv) => ({ command: argv.join(" "), exitCode: 127, output: "unexpected command" });

/**
 * A project openspec in `workspace` answering `validate` and `show` as given; `calls()` is each
 * call as `<OPENSPEC_TELEMETRY> <args>`, `--version` included.
 */
function fakeOpenspec(workspace: string, validate: FakeOpenspecReply, show: FakeOpenspecReply): { calls: () => string[] } {
	const fake = fakeOpenspecBin(join(workspace, "node_modules", ".bin"), { validate, show });
	return { calls: () => openspecCalls(fake.log).map((line) => line.slice(fake.path.length + 1)) };
}

const validJson = (issues: unknown[] = []) => ({ stdout: JSON.stringify({ items: [{ id: "add-thing", valid: issues.length === 0, issues }] }) });
const showJson = (deltas: unknown[]) => ({ stdout: JSON.stringify({ deltas }) });
const scenarios = (n: number) => Array.from({ length: n }, (_, i) => ({ rawText: `S${i}` }));
const delta = (spec: string, operation: string, n: number) => ({ spec, operation, requirement: { name: `${spec} ${n}`, text: "It SHALL.", scenarios: scenarios(n) } });
const COVERED = [delta("task/cli", "MODIFIED", 1), delta("spec/export", "ADDED", 1)];

/** A specs workspace whose openspec answers as given. */
function context(validate: FakeOpenspecReply, show: FakeOpenspecReply, files: Record<string, string> = DELTAS): StageContext & { calls: () => string[] } {
	const { workspace, changeDir } = specsWorkspace();
	return { changeId: "add-thing", workspace, changeDir, files, run: unusedRun, ...fakeOpenspec(workspace, validate, show) };
}

describe("specsStage", () => {
	it("owns specs/ after design, with the bundled specify script", () => {
		expect(specsStage.name).toBe("specs");
		expect(specsStage.owns).toEqual(["specs/"]);
		expect(specsStage.after).toEqual(["design"]);
		expect("path" in specsStage.script && specsStage.script.path).toMatch(/spec-specify\.agent$/);
	});

	it("seeds base with the full spec of each modified capability only", async () => {
		const ctx = context(validJson(), showJson([]), {});
		expect((await specsStage.seed?.(ctx))?.base).toBe(`=== openspec/specs/task/cli/spec.md\n${CLI_SPEC}`);
	});

	it("passes a clean draft, running validate then show with telemetry off", async () => {
		const ctx = context(validJson(), showJson(COVERED));
		expect(await specsStage.gate(ctx)).toEqual([]);
		expect(ctx.calls()).toEqual(["0 --version", "0 validate add-thing --strict --json", "0 show add-thing --json --deltas-only"]);
	});

	it("reports validate's issues at their own level and path, ahead of coverage", async () => {
		const issue = { level: "ERROR", path: "specs/spec/export/spec.md", message: "Requirement must have at least one scenario" };
		const files = { ...DELTAS, "specs/task/group/spec.md": "## ADDED Requirements\n" };
		const issues = await specsStage.gate(context({ ...validJson([issue]), exit: 1 }, showJson(COVERED), files));
		expect(issues).toEqual([issue, { level: "ERROR", path: "specs/task/group/spec.md", message: expect.stringContaining("`task/group`") }]);
	});

	it("reports one ERROR naming openspec validate when its output cannot be read, and never runs show", async () => {
		const ctx = context({ stdout: "Error: change not found\n", exit: 1 }, showJson(COVERED));
		const issues = await specsStage.gate(ctx);
		expect(issues).toEqual([{ level: "ERROR", path: ".", message: expect.stringContaining("`openspec validate add-thing --strict --json` printed no parseable JSON") }]);
		expect(ctx.calls()).toEqual(["0 --version", "0 validate add-thing --strict --json"]);
	});

	it("still checks coverage when validate cannot run", async () => {
		const { workspace, changeDir } = specsWorkspace();
		vi.stubEnv("PATH", temp("empty-path-"));
		const issues = await specsStage.gate({ changeId: "add-thing", workspace, changeDir, files: {}, run: unusedRun });
		expect(issues.map((issue) => issue.path)).toEqual([".", "specs/spec/export/spec.md", "specs/task/cli/spec.md"]);
		expect(issues[0]?.message).toBe("`openspec validate add-thing --strict --json` could not run (openspec not found)");
	});

	it("passes show's ERROR through and skips the size check when show fails", async () => {
		const issues = await specsStage.gate(context(validJson(), { stdout: "not json" }));
		expect(issues).toEqual([{ level: "ERROR", path: ".", message: expect.stringContaining("`openspec show add-thing --json --deltas-only`") }]);
	});

	it("warns on 17 scenarios against 16, with no tasks or groups issue", async () => {
		const deltas = [delta("task/cli", "MODIFIED", 9), delta("spec/export", "ADDED", 8)];
		const issues = await specsStage.gate(context(validJson(), showJson(deltas)));
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
		expect((await specsStage.seed?.({ changeId: "add-thing", workspace, changeDir, files: {}, run: unusedRun }))?.base).toBe(base);

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
		const { calls } = fakeOpenspec(workspace, validJson(), showJson(deltas));
		const files = { "specs/spec/stages/spec.md": "## MODIFIED Requirements\n\n### Requirement: One\n" };
		const issues = await specsStage.gate({ changeId: "add-thing", workspace, changeDir, files, run: unusedRun });

		const warnings = issues.filter((issue) => issue.level === "WARNING" && issue.message.includes("scenarios"));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.message).toContain("17");
		expect(warnings[0]?.message).toContain("16");
		expect(issues.filter((issue) => issue.path === "tasks.md" || /\b(groups?|tasks?)\b/.test(issue.message))).toEqual([]);
		expect(calls().map((call) => call.split(" ").slice(0, 2).join(" "))).toEqual(["0 --version", "0 validate", "0 show"]);
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
