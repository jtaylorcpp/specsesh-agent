import { describe, expect, it } from "vitest";
import type { Delta } from "../../../src/task/stages/openspec-cli.js";
import { asChange, coverageIssues, deltaCapabilities, notTasks, specsSizeIssues } from "../../../src/task/stages/specs-gate.js";

const SCENARIO = { name: "S", clauses: [] };
const delta = (spec: string, operation: Delta["operation"], scenarios = 1): Delta => ({
	spec,
	operation,
	requirement: { name: `${spec} ${operation}`, text: "It SHALL.", scenarios: Array.from({ length: scenarios }, () => SCENARIO) },
});

const ADDED_ONLY = "## ADDED Requirements\n\n### Requirement: Export\n";
const WITH_PURPOSE = `## Purpose\n\nExport plans.\n\n${ADDED_ONLY}`;

describe("coverageIssues", () => {
	it("passes a delta per named capability, Purpose on the new one", () => {
		const files = { "specs/task/cli/spec.md": ADDED_ONLY, "specs/spec/export/spec.md": WITH_PURPOSE };
		expect(coverageIssues({ new: ["spec/export"], modified: ["task/cli"] }, [], files)).toEqual([]);
	});

	it("names a delta file for a capability the proposal does not name", () => {
		const files = { "specs/task/cli/spec.md": ADDED_ONLY, "specs/task/group/spec.md": ADDED_ONLY };
		const issues = coverageIssues({ new: [], modified: ["task/cli"] }, [], files);
		expect(issues).toEqual([{ level: "ERROR", path: "specs/task/group/spec.md", message: expect.stringContaining("`task/group`") }]);
	});

	it("names a capability the proposal names with no delta", () => {
		expect(coverageIssues({ new: [], modified: ["task/cli"] }, [], {})).toEqual([
			{ level: "ERROR", path: "specs/task/cli/spec.md", message: expect.stringContaining("`task/cli`") },
		]);
	});

	it("counts a delta openspec parsed as covering its capability, and flags it when unnamed", () => {
		expect(coverageIssues({ new: [], modified: ["task/cli"] }, [delta("task/cli", "MODIFIED")], {})).toEqual([]);
		expect(coverageIssues({ new: [], modified: [] }, [delta("task/cli", "MODIFIED")], {})).toEqual([
			{ level: "ERROR", path: "specs/task/cli/spec.md", message: expect.stringContaining("does not name it") },
		]);
	});

	it("needs a ## Purpose line on a new capability, and not on a modified one", () => {
		const issues = coverageIssues({ new: ["spec/export"], modified: [] }, [], { "specs/spec/export/spec.md": ADDED_ONLY });
		expect(issues).toEqual([{ level: "ERROR", path: "specs/spec/export/spec.md", message: expect.stringContaining("`spec/export`") }]);
		expect(issues[0]?.message).toContain("## Purpose");
		expect(coverageIssues({ new: [], modified: ["spec/export"] }, [], { "specs/spec/export/spec.md": ADDED_ONLY })).toEqual([]);
		expect(coverageIssues({ new: ["spec/export"], modified: [] }, [], { "specs/spec/export/spec.md": "Text ## Purpose\n" })).toHaveLength(1);
	});
});

describe("deltaCapabilities", () => {
	it("reads specs/<area>/<name>/spec.md files, then delta specs, distinct", () => {
		const files = { "specs/a/b/spec.md": "", "specs/a/b/notes.md": "", "specs/a/spec.md": "", "proposal.md": "" };
		expect(deltaCapabilities([delta("c/d", "ADDED"), delta("a/b", "ADDED")], files)).toEqual(["a/b", "c/d"]);
	});
});

describe("specsSizeIssues", () => {
	it("warns at 17 scenarios against the budget of 16", () => {
		const deltas = [delta("task/cli", "MODIFIED", 9), delta("task/cli", "ADDED", 8)];
		expect(specsSizeIssues({ new: [], modified: ["task/cli"] }, deltas)).toEqual([
			{ level: "WARNING", path: "specs", message: expect.stringMatching(/^17 scenarios, over the budget of 16/) },
		]);
	});

	it("counts scenarios only from ADDED and MODIFIED, a requirement per delta", () => {
		const change = asChange({ new: ["a/b"], modified: [] }, [delta("a/b", "ADDED", 2), delta("a/b", "REMOVED", 5), delta("a/b", "RENAMED")]);
		expect(change.deltas.map((d) => d.op)).toEqual(["ADDED", "REMOVED", "RENAMED"]);
		expect(change.proposal.capabilities.new).toEqual([["a", "b"]]);
		expect(change.tasks).toBeUndefined();
	});

	it("warns on capabilities and requirements, never on tasks or groups", () => {
		const deltas = ["a/b", "c/d", "e/f"].flatMap((spec) => [delta(spec, "ADDED"), delta(spec, "ADDED"), delta(spec, "ADDED")]);
		const messages = specsSizeIssues({ new: ["a/b", "c/d", "e/f"], modified: [] }, deltas).map((issue) => issue.message);
		expect(messages).toEqual([expect.stringMatching(/^3 capabilities/), expect.stringMatching(/^9 requirements/)]);
		expect(notTasks({ level: "WARNING", path: "tasks.md", message: "13 tasks" })).toBe(false);
		expect(notTasks({ level: "WARNING", path: "specs", message: "17 scenarios" })).toBe(true);
	});
});
