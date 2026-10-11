import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/index.js";
import { readDeclarations } from "../../src/interpreter/compose.js";
import { scanDocument } from "../../src/interpreter/index.js";
import { GROUP_READ_BACK, GROUP_SEEDED, groupContractProblems } from "../../src/task/group-judge.js";
import { BUNDLED_SCRIPTS } from "../../src/task/index.js";
import { SCRIPTS } from "./helpers.js";

const source = readFileSync(join(SCRIPTS, "group.agent"), "utf8");
const analysis = analyze(source);

describe("task/group: The bundled group.agent fits the contract and acts on nothing", () => {
	it("Scenario: The bundled judge script is clean", () => {
		expect(analysis.diagnostics).toEqual([]);
		expect(scanDocument(analysis.parsed)).toEqual([]);
		expect(source).not.toMatch(/^\s*actions:/m);
		expect(source).not.toContain("@actions");
		expect(source.match(/^subagent /gm)).toHaveLength(1);
		expect(groupContractProblems(source)).toEqual([]);
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
