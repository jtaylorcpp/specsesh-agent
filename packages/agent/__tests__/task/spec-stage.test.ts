import { describe, expect, it } from "vitest";
import { owns, stageContractProblems } from "../../src/task/spec-stage.js";

const VARIABLES: Record<string, string> = {
	change_id: 'mutable string = ""',
	stage: 'mutable string = ""',
	intent: 'mutable string = ""',
	approved: 'mutable string = ""',
	current: 'mutable string = ""',
	base: 'mutable string = ""',
	carried: 'mutable string = ""',
	iteration: "mutable number = 1",
	files: 'mutable string = ""',
	summary: 'mutable string = ""',
	next_action: 'mutable string = "review"',
	question: 'mutable string = ""',
};

/** A stage script declaring the contract, with `changes` applied (`null` drops a variable). */
function stageScript(changes: Record<string, string | null> = {}): string {
	const declarations = Object.entries({ ...VARIABLES, ...changes })
		.filter((entry): entry is [string, string] => entry[1] !== null)
		.map(([name, declaration]) => `    ${name}: ${declaration}`)
		.join("\n");
	return `config:
    agent_name: "spec-stage"
    description: "A stage draft"

variables:
${declarations}

subagent draft:
    description: "Draft the stage's files"

    reasoning:
        instructions: ->
            | Draft {!@variables.stage} for {!@variables.change_id}: {!@variables.intent}
            set @variables.files = @outputs.files
            set @variables.summary = @outputs.summary
            set @variables.next_action = @outputs.next_action
            set @variables.question = @outputs.question
`;
}

describe("task/spec-stage: owns", () => {
	const stage = { owns: ["design.md", "design/"] };

	it("owns a listed file and every file under a listed directory, and nothing else", () => {
		expect(owns(stage, "design.md")).toBe(true);
		expect(owns(stage, "design/examples/a.ts")).toBe(true);
		expect(owns(stage, "tasks.md")).toBe(false);
	});

	it("does not own prefix look-alikes or the directory itself", () => {
		expect(owns(stage, "designs.md")).toBe(false);
		expect(owns(stage, "design.md.bak")).toBe(false);
		expect(owns(stage, "design")).toBe(false);
		expect(owns(stage, "design/")).toBe(false);
		expect(owns(stage, "designs/a.ts")).toBe(false);
	});

	it("never owns an absolute, empty or .. path", () => {
		expect(owns(stage, "/design.md")).toBe(false);
		expect(owns(stage, "C:/design.md")).toBe(false);
		expect(owns(stage, "")).toBe(false);
		expect(owns(stage, "design/../tasks.md")).toBe(false);
		expect(owns(stage, "design/../../secret")).toBe(false);
	});

	it("reads backslashes as separators", () => {
		expect(owns(stage, "design\\examples\\a.ts")).toBe(true);
		expect(owns(stage, "design\\..\\tasks.md")).toBe(false);
	});
});

describe("task/spec-stage: stageContractProblems", () => {
	it("passes a script that keeps the contract", () => {
		expect(stageContractProblems(stageScript())).toEqual([]);
	});

	it("names a missing variable and its type", () => {
		const problems = stageContractProblems(stageScript({ files: null }));
		expect(problems).toEqual(["files is not declared; declare it as string"]);
	});

	it("names a mistyped variable and the type the contract needs", () => {
		const problems = stageContractProblems(stageScript({ iteration: 'mutable string = "1"' }));
		expect(problems).toEqual(["iteration is declared string; the contract needs number"]);
	});

	it("names review and ask when next_action defaults outside them", () => {
		const problems = stageContractProblems(stageScript({ next_action: 'mutable string = "retry"' }));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('"retry"');
		expect(problems[0]).toContain('"review"');
		expect(problems[0]).toContain('"ask"');
	});

	it("lists every problem, not just the first", () => {
		const problems = stageContractProblems(stageScript({ files: null, base: null, next_action: 'mutable string = "retry"' }));
		expect(problems).toHaveLength(3);
		expect(problems).toContain("files is not declared; declare it as string");
		expect(problems).toContain("base is not declared; declare it as string");
	});
});
