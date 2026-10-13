import { describe, expect, it } from "vitest";
import { readSlices, sliceIssues } from "../../../src/task/stages/slices-md.js";

const SLICED = [
	"1. `add-plan-export`: Export a plan as JSON with `specplan export --json`.",
	"2. `add-plan-export-schema`: Publish the JSON Schema of the export. Follows add-plan-export.",
	"3. `add-plan-export-ci`: A GitHub Action that fails a PR whose plan export is invalid. Follows add-plan-export-schema.",
	"",
].join("\n");

const EXISTING = ["add-plan-export", "add-spec-loop"];

const issuesFor = (markdown: string, changeId = "add-plan-export") => sliceIssues(readSlices(markdown), changeId, EXISTING);

describe("task/stages/slices-md: scenarios", () => {
	it("Scenario: A sliced proposal passes", () => {
		const slices = readSlices(SLICED);
		expect(slices.malformed).toEqual([]);
		expect(slices.entries).toEqual([
			{ n: 1, id: "add-plan-export", intent: "Export a plan as JSON with `specplan export --json`.", line: 1 },
			{ n: 2, id: "add-plan-export-schema", intent: "Publish the JSON Schema of the export. Follows add-plan-export.", line: 2 },
			{ n: 3, id: "add-plan-export-ci", intent: "A GitHub Action that fails a PR whose plan export is invalid. Follows add-plan-export-schema.", line: 3 },
		]);
		expect(sliceIssues(slices, "add-plan-export", EXISTING)).toEqual([]);
	});

	it("Scenario: A slice whose id is taken", () => {
		const issues = issuesFor("1. `add-plan-export`: Export.\n2. `add-spec-loop`: Again.\n");
		expect(issues).toHaveLength(1);
		expect(issues[0]?.level).toBe("ERROR");
		expect(issues[0]?.path).toBe("slices.md");
		expect(issues[0]?.message).toContain("add-spec-loop");
	});

	it("Scenario: The first slice must be this change", () => {
		const issues = issuesFor("1. `add-plan-schema`: Schema.\n2. `add-plan-export`: Export.\n");
		const first = issues.filter((issue) => issue.message.includes("must start with"));
		expect(first).toHaveLength(1);
		expect(first[0]?.level).toBe("ERROR");
		expect(first[0]?.message).toContain("add-plan-export");
	});
});

describe("task/stages/slices-md: readSlices and sliceIssues", () => {
	it("names the line number of a malformed line, headings included", () => {
		const issues = issuesFor("# Slices\n1. `add-plan-export`: Export.\n2. add-plan-ci: CI.\n3. `add-plan-ci`: CI.\n");
		expect(readSlices("# Slices\n").malformed).toEqual([{ line: 1, text: "# Slices" }]);
		const malformed = issues.filter((issue) => issue.message.includes("does not match"));
		expect(malformed.map((issue) => issue.message)).toEqual([
			"slices.md line 1 does not match `<n>. \\`<change-id>\\`: <intent>`",
			"slices.md line 3 does not match `<n>. \\`<change-id>\\`: <intent>`",
		]);
		expect(malformed.every((issue) => issue.level === "ERROR")).toBe(true);
	});

	it("requires numbering to run 1, 2, 3", () => {
		const issues = issuesFor("1. `add-plan-export`: Export.\n3. `add-plan-ci`: CI.\n");
		expect(issues.map((issue) => issue.message)).toEqual(["slices.md line 2: expected 2, got 3"]);
	});

	it("requires at least two entries", () => {
		const issues = issuesFor("1. `add-plan-export`: Export.\n");
		expect(issues.map((issue) => issue.message)).toEqual(["slices.md must list at least two changes, this one first"]);
		expect(issuesFor("").map((issue) => issue.message)).toEqual(["slices.md must list at least two changes, this one first"]);
	});

	it("rejects an id that is not kebab-case", () => {
		for (const id of ["add--x", "-x", "x-"]) {
			const issues = issuesFor(`1. \`add-plan-export\`: Export.\n2. \`${id}\`: X.\n`);
			expect(issues).toHaveLength(1);
			expect(issues[0]?.message).toContain(`\`${id}\` is not a kebab-case change id`);
		}
	});

	it("rejects a repeated id", () => {
		const issues = issuesFor("1. `add-plan-export`: Export.\n2. `add-plan-ci`: CI.\n3. `add-plan-ci`: CI again.\n");
		expect(issues.map((issue) => issue.message)).toEqual(["slices.md line 3: `add-plan-ci` is listed more than once"]);
	});

	it("allows this change's own id only as the first entry", () => {
		const issues = issuesFor("1. `add-plan-export`: Export.\n2. `add-plan-export`: Again.\n");
		expect(issues.map((issue) => issue.message)).toEqual([
			"slices.md line 2: `add-plan-export` is listed more than once",
			"slices.md: `add-plan-export` is already used by a change or archived change",
		]);
	});

	it("reads CRLF line endings and skips blank lines", () => {
		const slices = readSlices("\r\n1. `add-plan-export`: Export.  \r\n\r\n   \r\n2. `add-plan-ci`: CI.\r\n");
		expect(slices.malformed).toEqual([]);
		expect(slices.entries).toEqual([
			{ n: 1, id: "add-plan-export", intent: "Export.", line: 2 },
			{ n: 2, id: "add-plan-ci", intent: "CI.", line: 5 },
		]);
		expect(sliceIssues(slices, "add-plan-export", EXISTING)).toEqual([]);
	});
});
