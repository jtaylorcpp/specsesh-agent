import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../../src/authoring/index.js";
import { readDeclarations } from "../../../src/interpreter/compose.js";
import { SPEC_STAGES, designStage } from "../../../src/task/index.js";
import { stageContractProblems, type StageContext } from "../../../src/task/spec-stage.js";
import { cleanTemps, prompts, temp } from "../helpers.js";
import { draft, runSpecLoop } from "../spec-helpers.js";

afterEach(cleanTemps);

const CLI_SPEC = "## Purpose\nThe task CLI.\n\n## Requirements\n\n### Requirement: It runs\nIt SHALL run.\n";

const PROPOSAL = ["Why", "What Changes", "Out of scope", "Capabilities", "Impact"]
	.map((heading) =>
		`## ${heading}\n\n${heading === "Capabilities" ? "- **Modified:** `task/cli`\n- **New:** `spec/stages`\n" : `- ${heading} text.\n`}`,
	)
	.join("\n");

const MOCK = "<!doctype html>\n<html><head><style>body{}</style></head><body>mock</body></html>\n";

/** A workspace with `task/cli`'s spec, no `spec/stages` spec, and the approved proposal in `add-thing`. */
function designWorkspace(): { workspace: string; changeDir: string } {
	const workspace = temp("design-stage-");
	const spec = join(workspace, "openspec", "specs", "task", "cli", "spec.md");
	mkdirSync(dirname(spec), { recursive: true });
	writeFileSync(spec, CLI_SPEC);
	const changeDir = join(workspace, "openspec", "changes", "add-thing");
	mkdirSync(changeDir, { recursive: true });
	writeFileSync(join(changeDir, "proposal.md"), PROPOSAL);
	return { workspace, changeDir };
}

function stageContext(workspace: string, changeDir: string, files: Record<string, string> = {}): StageContext {
	return {
		changeId: "add-thing",
		workspace,
		changeDir,
		files,
		run: async (argv) => ({ command: argv.join(" "), exitCode: 0, output: "" }),
	};
}

const designSource = (): string => readFileSync((designStage.script as { path: string }).path, "utf8");

describe("designStage", () => {
	it("Scenario: The design stage is seeded with the modified specs", async () => {
		const { workspace, changeDir } = designWorkspace();
		const base = (await designStage.seed?.(stageContext(workspace, changeDir)))?.base ?? "";
		const sections = base.split(/^(?==== )/m).filter((section) => section !== "");
		expect(sections).toEqual([`=== openspec/specs/task/cli/spec.md\n${CLI_SPEC}`]);

		// `approved` is seeded by the loop from the approved stages' files; the design script shows it to the model.
		const passing = `=== design.md\n## Context\n\nWhy.\n\n## Decisions\n\n- See \`design/mock.html\`.\n=== design/mock.html\n${MOCK}=== design/examples/a.ts\na();\n`;
		const r = await runSpecLoop(designStage, [draft(passing)], { workspace, script: designSource(), approved: ["proposal.md"] });
		const prompt = prompts(r.env.requests)[0] ?? "";
		expect(prompt).toContain(`=== proposal.md\n${PROPOSAL}`);
		expect(prompt).toContain(`=== openspec/specs/task/cli/spec.md\n${CLI_SPEC}`);
		expect(r.outcome).toMatchObject({ status: "blocked", escalation: { reason: "review" } });
	});

	it("Scenario: design.md names a missing example", async () => {
		const files = {
			"design.md": "## Context\n\nSee [x](design/examples/missing.ts).\n\n## Decisions\n\n- The mock is `design/mock.html`.\n",
			"design/mock.html": MOCK,
			"design/examples/a.ts": "a();\n",
		};
		const { workspace, changeDir } = designWorkspace();
		const errors = (await designStage.gate(stageContext(workspace, changeDir, files))).filter((issue) => issue.level === "ERROR");
		expect(errors).toHaveLength(1);
		expect(errors[0]?.message).toContain("design/examples/missing.ts");
		expect(errors.filter((issue) => issue.message.includes("design/mock.html"))).toEqual([]);
	});

	it("Scenario: The design follows the proposal", () => {
		expect(SPEC_STAGES.map((stage) => stage.name)).toEqual(["proposal", "design", "specs", "tasks"]);
		expect(designStage.after).toEqual(["proposal"]);
		expect(designStage.owns).toEqual(expect.arrayContaining(["design.md", "design/"]));
		expect("path" in designStage.script && designStage.script.path).toMatch(/spec-design\.agent$/);
	});

	it("Scenario: The bundled design script fits the contract", () => {
		const source = designSource();
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
