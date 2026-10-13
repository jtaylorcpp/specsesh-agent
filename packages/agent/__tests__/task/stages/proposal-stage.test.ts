import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../../src/authoring/index.js";
import { readDeclarations } from "../../../src/interpreter/compose.js";
import { BUNDLED_SCRIPTS, proposalStage } from "../../../src/task/index.js";
import { stageContractProblems, type StageContext } from "../../../src/task/spec-stage.js";
import { cleanTemps, temp } from "../helpers.js";
import { draft, runSpecLoop } from "../spec-helpers.js";

afterEach(cleanTemps);

/** A workspace whose `openspec/specs/` holds one spec per entry, written in the order given. */
function workspaceWith(specs: Readonly<Record<string, string>>): string {
	const workspace = temp("proposal-stage-");
	for (const [path, purpose] of Object.entries(specs)) {
		const file = join(workspace, "openspec", "specs", path, "spec.md");
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `## Purpose\n${purpose}\n\n## Requirements\n`);
	}
	mkdirSync(join(workspace, "openspec", "changes", "add-thing"), { recursive: true });
	return workspace;
}

function stageContext(workspace: string, files: Record<string, string> = {}, changeId = "add-thing"): StageContext {
	mkdirSync(join(workspace, "openspec", "changes", changeId), { recursive: true });
	return {
		changeId,
		workspace,
		changeDir: join(workspace, "openspec", "changes", changeId),
		files,
		run: async (argv) => ({ command: argv.join(" "), exitCode: 0, output: "" }),
	};
}

/** All five sections, in order, with this Capabilities body. */
const proposal = (capabilities: string): string =>
	["Why", "What Changes", "Out of scope", "Capabilities", "Impact"]
		.map((heading) => `## ${heading}\n\n${heading === "Capabilities" ? capabilities : `- ${heading} text.`}\n`)
		.join("\n");

const THREE = proposal("- **New:** `spec/stages`.\n- **Modified:**\n  - `task/cli`;\n  - `task/headless`.\n");
const TWO = proposal("- **New:** `spec/stages`.\n- **Modified:**\n  - `task/cli`.\n");

/** A `slices.md` listing these ids in order. */
const slices = (...ids: string[]): string => ids.map((id, i) => `${i + 1}. \`${id}\`: The ${id} intent.`).join("\n") + "\n";

describe("proposalStage", () => {
	it("Scenario: The proposal stage is seeded with every capability", async () => {
		// Written in reverse, so the order comes from the seed.
		const workspace = workspaceWith({ "task/cli": "CLI purpose.", "core/subset": "Subset purpose." });
		expect(await proposalStage.seed?.(stageContext(workspace))).toEqual({ base: "core/subset: Subset purpose.\ntask/cli: CLI purpose." });

		expect(proposalStage.name).toBe("proposal");
		expect(proposalStage.owns).toEqual(["proposal.md", "slices.md"]);
		expect(proposalStage.after ?? []).toEqual([]);
		expect("path" in proposalStage.script && proposalStage.script.path).toBe(fileURLToPath(BUNDLED_SCRIPTS.specProposal));
		expect("path" in proposalStage.script && proposalStage.script.path).toMatch(/spec-proposal\.agent$/);
	});

	it("Scenario: A proposal touching three capabilities is sent back", async () => {
		const workspace = workspaceWith({ "task/cli": "CLI purpose.", "task/headless": "Headless purpose." });
		const issues = await proposalStage.gate(stageContext(workspace, { "proposal.md": THREE }, "add-plan-export"));
		// No slices.md, so no slice validation ERROR.
		expect(issues.filter((issue) => issue.level === "ERROR")).toEqual([]);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ level: "WARNING", path: "proposal.md" });
		for (const path of ["spec/stages", "task/cli", "task/headless"]) expect(issues[0]?.message).toContain(path);
		expect(issues[0]?.message).toMatch(/slices\.md/);
		expect(issues[0]?.message).toMatch(/one line per small change/);
		expect(issues[0]?.message).toMatch(/this one first/);

		// The loop iterates on the warning; the two-capability redraft gates clean and goes to review.
		const r = await runSpecLoop(proposalStage, [draft(`=== proposal.md\n${THREE}`), draft(`=== proposal.md\n${TWO}`)], { workspace });
		expect(r.runs).toHaveLength(2);
		expect(r.outcome.iterations).toHaveLength(2);
		expect(r.outcome.iterations[0]).toMatchObject({ verdict: { met: false }, evidence: [{ kind: "validation", report: { valid: false, issues } }] });
		expect(r.outcome.iterations[1]?.verdict.met).toBe(true);
		expect(r.outcome).toMatchObject({ status: "blocked", escalation: { reason: "review" } });
		expect(readFileSync(join(workspace, "openspec", "changes", "add-thing", "proposal.md"), "utf8")).toBe(TWO);
	});

	it("keeps the size warning, without the slicing hint, when slices.md is present", async () => {
		const workspace = workspaceWith({ "task/cli": "CLI purpose.", "task/headless": "Headless purpose." });
		const files = { "proposal.md": THREE, "slices.md": slices("add-thing", "add-thing-next") };
		const issues = await proposalStage.gate(stageContext(workspace, files));
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ level: "WARNING", path: "proposal.md" });
		expect(issues[0]?.message).not.toContain("slices.md");
	});

	it("Scenario: The bundled proposal script fits the contract", () => {
		expect("path" in proposalStage.script).toBe(true);
		const source = readFileSync((proposalStage.script as { path: string }).path, "utf8");
		const analysis = analyze(source);
		// No error (LSP severity 1); the contract's unused `stage` and `approved` are informational.
		expect(analysis.diagnostics.filter((diagnostic) => diagnostic.severity === 1)).toEqual([]);
		expect(stageContractProblems(source)).toEqual([]);
		expect(readDeclarations(analysis.parsed).get("next_action")?.initial).toBe("review");

		expect(source.match(/^subagent /gm)).toHaveLength(1);
		for (const name of ["files", "summary", "next_action", "question"]) {
			expect(source).toContain(`set @variables.${name} = @outputs.${name}`);
		}
	});
});
