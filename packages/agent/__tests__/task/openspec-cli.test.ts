import { describe, expect, it } from "vitest";
import type { CheckRun } from "../../src/task/checks.js";
import { openspecDeltas, openspecValidate } from "../../src/task/stages/openspec-cli.js";

/** A `StageContext.run` that records each argv and prints `output`, or throws `error`. */
function fakeRun(output: string, exitCode = 0, error?: Error) {
	const calls: string[][] = [];
	const run = async (argv: readonly string[]): Promise<CheckRun> => {
		calls.push([...argv]);
		if (error !== undefined) throw error;
		return { command: argv.join(" "), exitCode, output };
	};
	return { run, calls };
}

const validateJson = (issues: unknown[]) =>
	JSON.stringify({ items: [{ id: "add-plan-export", type: "change", valid: issues.length === 0, issues, durationMs: 3 }], version: "1.0" }, null, 2);

describe("openspecValidate", () => {
	it("Scenario: An OpenSpec error reaches the next draft", async () => {
		const { run } = fakeRun(
			validateJson([{ level: "ERROR", path: "specs/plan/export/spec.md", message: "Requirement must have at least one scenario" }]),
			1,
		);
		expect(await openspecValidate(run, "add-plan-export")).toEqual([
			{ level: "ERROR", path: "specs/plan/export/spec.md", message: "Requirement must have at least one scenario" },
		]);
	});

	it("Scenario: openspec is missing", async () => {
		const missing = Object.assign(new Error("spawn openspec ENOENT"), { code: "ENOENT" });
		const { run } = fakeRun("", 0, missing);
		const issues = await openspecValidate(run, "add-plan-export");
		expect(issues).toHaveLength(1);
		expect(issues[0]?.level).toBe("ERROR");
		expect(issues[0]?.message).toContain("openspec validate");
		expect(issues[0]?.message).toContain("ENOENT");
	});

	it("non-JSON output is one ERROR cut to 400 characters of output", async () => {
		const output = `env: 'openspec': No such file or directory ${"x".repeat(1000)}`;
		const { run } = fakeRun(output, 127);
		const issues = await openspecValidate(run, "add-plan-export");
		expect(issues).toEqual([{ level: "ERROR", path: ".", message: `\`openspec validate\` failed: ${output.slice(0, 400)}` }]);
	});

	it("empty output is one ERROR naming the command", async () => {
		const { run } = fakeRun("", 1);
		const issues = await openspecValidate(run, "add-plan-export");
		expect(issues).toHaveLength(1);
		expect(issues[0]?.message).toContain("openspec validate");
	});

	it("JSON of the wrong shape is one ERROR naming the command", async () => {
		const { run } = fakeRun('{"items": "none"}');
		const issues = await openspecValidate(run, "add-plan-export");
		expect(issues).toEqual([{ level: "ERROR", path: ".", message: '`openspec validate` failed: {"items": "none"}' }]);
	});

	it("keeps each issue's own level", async () => {
		const { run } = fakeRun(
			validateJson([
				{ level: "WARNING", path: "proposal.md", message: "Why section is short" },
				{ level: "INFO", path: "specs/plan/export/spec.md", message: "Consider more scenarios" },
			]),
		);
		expect(await openspecValidate(run, "add-plan-export")).toEqual([
			{ level: "WARNING", path: "proposal.md", message: "Why section is short" },
			{ level: "INFO", path: "specs/plan/export/spec.md", message: "Consider more scenarios" },
		]);
	});

	it("a clean change has no issues", async () => {
		const { run } = fakeRun(validateJson([]));
		expect(await openspecValidate(run, "add-plan-export")).toEqual([]);
	});

	it("runs openspec with telemetry off and the exact args", async () => {
		const { run, calls } = fakeRun(validateJson([]));
		await openspecValidate(run, "add-plan-export");
		expect(calls).toEqual([["env", "OPENSPEC_TELEMETRY=0", "openspec", "validate", "add-plan-export", "--strict", "--json"]]);
	});
});

/** As openspec 1.14.1 prints `show <id> --json --deltas-only`: `requirement` and `requirements` both, `rename` for RENAMED. */
const SHOW = JSON.stringify(
	{
		id: "add-plan-export",
		title: "add-plan-export",
		deltaCount: 3,
		deltas: [
			{
				spec: "plan/export",
				operation: "ADDED",
				description: "Add requirement: Plans SHALL export.",
				requirement: {
					name: "Plans export",
					text: "Plans SHALL export.",
					scenarios: [{ name: "An export", rawText: "- **WHEN** a plan is exported\n- **THEN** a file SHALL be written" }],
				},
				requirements: [{ name: "Plans export", text: "Plans SHALL export.", scenarios: [{ name: "An export", rawText: "" }] }],
			},
			{
				spec: "plan/import",
				operation: "REMOVED",
				description: "Remove requirement: ",
				requirement: { name: "Plans import", text: "", scenarios: [] },
				requirements: [{ name: "Plans import", text: "", scenarios: [] }],
			},
			{
				spec: "plan/export",
				operation: "RENAMED",
				description: 'Rename requirement from "Old" to "New"',
				rename: { from: "Old", to: "New" },
			},
		],
		root: { path: "/repo", source: "nearest" },
	},
	null,
	2,
);

describe("openspecDeltas", () => {
	it("parses openspec's deltas, one per requirement", async () => {
		const { run, calls } = fakeRun(SHOW);
		expect(await openspecDeltas(run, "add-plan-export")).toEqual({
			deltas: [
				{
					spec: "plan/export",
					operation: "ADDED",
					requirement: {
						name: "Plans export",
						text: "Plans SHALL export.",
						scenarios: [{ name: "An export", rawText: "- **WHEN** a plan is exported\n- **THEN** a file SHALL be written" }],
					},
				},
				{ spec: "plan/import", operation: "REMOVED", requirement: { name: "Plans import", text: "", scenarios: [] } },
				{ spec: "plan/export", operation: "RENAMED", requirement: { name: "New", text: "", scenarios: [] } },
			],
			issues: [],
		});
		expect(calls).toEqual([["env", "OPENSPEC_TELEMETRY=0", "openspec", "show", "add-plan-export", "--json", "--deltas-only"]]);
	});

	it("garbage output is one ERROR naming openspec show", async () => {
		const { run } = fakeRun("Error: change not found\n");
		const result = await openspecDeltas(run, "add-plan-export");
		expect(result.deltas).toEqual([]);
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]?.level).toBe("ERROR");
		expect(result.issues[0]?.message).toContain("openspec show");
	});

	it("a delta of the wrong shape is one ERROR naming openspec show", async () => {
		const { run } = fakeRun(JSON.stringify({ deltas: [{ spec: "plan/export", operation: "CHANGED" }] }));
		const result = await openspecDeltas(run, "add-plan-export");
		expect(result.deltas).toEqual([]);
		expect(result.issues.map((i) => i.message)).toEqual([expect.stringContaining("openspec show")]);
	});

	it("a spawn error is one ERROR naming openspec show", async () => {
		const { run } = fakeRun("", 0, new Error("spawn openspec ENOENT"));
		const result = await openspecDeltas(run, "add-plan-export");
		expect(result).toEqual({ deltas: [], issues: [{ level: "ERROR", path: ".", message: "`openspec show` failed: spawn openspec ENOENT" }] });
	});
});
