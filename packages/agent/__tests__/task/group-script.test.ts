import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/index.js";
import { readDeclarations } from "../../src/interpreter/compose.js";
import { next, scanDocument, start, type ReasoningRequest, type VariableValue } from "../../src/interpreter/index.js";
import { GROUP_AMEND, GROUP_READ_BACK, GROUP_SEEDED, groupContractProblems } from "../../src/task/group-judge.js";
import { BUNDLED_SCRIPTS } from "../../src/task/index.js";
import { SCRIPTS } from "./helpers.js";

const source = readFileSync(join(SCRIPTS, "group.agent"), "utf8");
const analysis = analyze(source);

const SEED: Record<string, VariableValue> = {
	group_number: 2,
	group_title: "The group",
	tasks: "2.1 First — converged\n2.2 Second — converged",
	proposal: "A proposal.",
	deltas: "## task/group\nA delta.",
	check_output: "pnpm test exited 1",
	rework_count: 1,
};

/** The judge step's request: the script's one subagent, composed with `variables`. No port. */
function composeJudge(variables: Record<string, VariableValue>): ReasoningRequest {
	const step = next(source, start(source, { entry: ["judge"], variables }));
	if (step.type !== "request") throw new Error(`expected the judge's request, got ${step.type}`);
	return step.request;
}

describe("task/group: The bundled group.agent fits the contract and acts on nothing", () => {
	it("Scenario: The bundled judge script is clean", () => {
		expect(analysis.diagnostics).toEqual([]);
		expect(scanDocument(analysis.parsed)).toEqual([]);
		expect(source).not.toMatch(/^\s*actions:/m);
		expect(source).not.toContain("@actions");
		expect(source.match(/^subagent /gm)).toHaveLength(1);
		expect(groupContractProblems(source)).toEqual([]);

		const declarations = readDeclarations(analysis.parsed);
		for (const name of Object.keys(GROUP_SEEDED)) expect(declarations.has(name), name).toBe(true);
		expect(GROUP_AMEND).toEqual({ amend_path: "string", amend_text: "string" });
		const readBack = { ...GROUP_READ_BACK, ...GROUP_AMEND };
		expect(Object.keys(readBack).sort()).toEqual(["amend_path", "amend_text", "feedback", "next_action", "question", "rework_task"]);
		for (const [name, type] of Object.entries(readBack)) expect(declarations.get(name)?.type, name).toBe(type);

		// All six are set from the judge's one structured result.
		const schema = composeJudge(SEED).outputSchema as { properties?: Record<string, unknown> } | undefined;
		expect(Object.keys(schema?.properties ?? {})).toEqual(expect.arrayContaining(Object.keys(readBack)));
	});

	it("Scenario: The bundled judge reworks first", () => {
		const { prompt } = composeJudge({ ...SEED, rework_count: 1 });
		expect(prompt).toContain("rework the task most likely at fault");
		expect(prompt).not.toContain("Prefer asking");
	});

	it("Scenario: The bundled judge is told how to amend a delta", () => {
		const { prompt } = composeJudge(SEED);
		expect(prompt).toContain("when the spec delta itself is wrong");
		expect(prompt).toContain("amend-spec");
		expect(prompt).toContain("amend_path");
		expect(prompt).toContain("amend_text");
	});

	it("declares every seeded and read-back variable with its type", () => {
		expect(GROUP_SEEDED).toEqual({
			group_number: "number",
			group_title: "string",
			tasks: "string",
			proposal: "string",
			deltas: "string",
			check_output: "string",
			rework_count: "number",
		});
		expect(GROUP_READ_BACK).toEqual({ next_action: "string", rework_task: "string", feedback: "string", question: "string" });
		const declarations = readDeclarations(analysis.parsed);
		for (const [name, type] of Object.entries({ ...GROUP_SEEDED, ...GROUP_READ_BACK })) {
			expect(declarations.get(name)?.type, name).toBe(type);
		}
	});

	it("is the file the default group script resolves to", () => {
		expect(readFileSync(BUNDLED_SCRIPTS.group, "utf8")).toBe(source);
	});
});
