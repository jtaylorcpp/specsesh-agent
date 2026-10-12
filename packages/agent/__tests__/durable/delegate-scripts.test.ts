/**
 * The bundled delegate scripts: clean, keeping the delegate contract, and
 * offering exactly their tools. No provider: analysis and the contract only.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/index.js";
import { readReasoningActions } from "../../src/interpreter/actions.js";
import { readSubagents } from "../../src/interpreter/compose.js";
import { declaredActions, scanDocument, start } from "../../src/interpreter/index.js";
import { EDIT_AGENT, READ_AGENT, delegateContractProblems } from "../../src/durable/index.js";

const READ_TOOLS = ["read_file", "list_files", "search_files"];
const EDIT_TOOLS = [...READ_TOOLS, "edit_file", "run_command"];

function offered(source: string): string[] {
	const work = readSubagents(analyze(source).parsed).get("work");
	return readReasoningActions(work).map((entry) => entry.tool);
}

/** `READ_AGENT` with its `variables` block replaced. */
function withVariables(variables: string): string {
	return READ_AGENT.replace(/^variables:\n[\s\S]*?\n\n/m, `variables:\n${variables}\n\n`);
}

describe("actions/agent-runner: The bundled delegate scripts fit the contract", () => {
	it("Scenario: The bundled delegate scripts are clean", () => {
		for (const source of [READ_AGENT, EDIT_AGENT]) {
			const analysis = analyze(source);
			expect(analysis.diagnostics).toEqual([]);
			expect(scanDocument(analysis.parsed)).toEqual([]);
			expect(delegateContractProblems(source)).toEqual([]);
			expect(() => start(source, { entry: ["work"] })).not.toThrow();
		}
	});

	it("offers exactly their tools under work's reasoning.actions, and defines no others", () => {
		expect(offered(READ_AGENT)).toEqual(READ_TOOLS);
		expect(offered(EDIT_AGENT)).toEqual(EDIT_TOOLS);
		expect(declaredActions(READ_AGENT).map((action) => action.tool)).toEqual(READ_TOOLS);
		expect(declaredActions(EDIT_AGENT).map((action) => action.tool)).toEqual(EDIT_TOOLS);
	});

	it("the checker names summary and string when summary is not declared", () => {
		const source = withVariables(`    instructions: mutable string = ""\n    ok: mutable boolean = False`);
		expect(delegateContractProblems(source)).toEqual(["summary is not declared; declare it as string"]);
	});

	it("the checker names ok and boolean when ok is declared string", () => {
		const source = withVariables(`    instructions: mutable string = ""\n    ok: mutable string = ""\n    summary: mutable string = ""`);
		expect(delegateContractProblems(source)).toEqual(["ok is declared string; the contract needs boolean"]);
	});

	it("imports no node: module", () => {
		const module = readFileSync(new URL("../../src/durable/delegate-scripts.ts", import.meta.url), "utf8");
		expect(module).not.toMatch(/from\s+["']node:|import\(\s*["']node:|require\(\s*["']node:/);
	});
});
