import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetOpenspecCache } from "../../src/task/openspec-bin.js";
import { openspecDeltas, openspecValidate } from "../../src/task/stages/openspec-cli.js";
import { cleanTemps, fakeOpenspecBin, type FakeOpenspecReply, openspecCalls, temp } from "./helpers.js";

beforeEach(resetOpenspecCache);

afterEach(() => {
	vi.unstubAllEnvs();
	cleanTemps();
});

const CHANGE = "add-plan-export";
const VALIDATE = `validate ${CHANGE} --strict --json`;
const SHOW = `show ${CHANGE} --json --deltas-only`;

/** A workspace whose project openspec (`node_modules/.bin/openspec`, 1.14.1 unless given) answers as given. */
function workspace(replies: { version?: string; validate?: FakeOpenspecReply; show?: FakeOpenspecReply } = {}) {
	const dir = temp("openspec-cli-ws-");
	return { dir, ...fakeOpenspecBin(join(dir, "node_modules", ".bin"), replies) };
}

const validateJson = (issues: unknown[]) =>
	JSON.stringify({ items: [{ id: CHANGE, type: "change", valid: issues.length === 0, issues, durationMs: 3 }], version: "1.0" }, null, 2);

describe.skipIf(process.platform === "win32")("openspecValidate", () => {
	it("Scenario: An OpenSpec error reaches the next draft", async () => {
		const issue = { level: "ERROR", path: "specs/plan/export/spec.md", message: "Requirement must have at least one scenario" };
		// No project copy: a 1.9.0 first on PATH, below the minimum, which the gate does not enforce.
		const ws = temp("openspec-cli-ws-");
		const onPath = temp("openspec-cli-path-");
		const fake = fakeOpenspecBin(onPath, { version: "1.9.0", validate: { stdout: validateJson([issue]), exit: 1 } });
		vi.stubEnv("PATH", `${onPath}:${process.env["PATH"] ?? ""}`);
		expect(await openspecValidate(ws, CHANGE)).toEqual([issue]);
		expect(openspecCalls(fake.log)).toEqual([`${fake.path} 0 --version`, `${fake.path} 0 ${VALIDATE}`]);
	});

	it("Scenario: openspec is missing", async () => {
		vi.stubEnv("PATH", temp("empty-path-"));
		expect(await openspecValidate(temp("openspec-cli-ws-"), CHANGE)).toEqual([
			{ level: "ERROR", path: ".", message: `\`openspec ${VALIDATE}\` could not run (openspec not found)` },
		]);
	});

	it("keeps each issue's own level", async () => {
		const issues = [
			{ level: "WARNING", path: "proposal.md", message: "Why section is short" },
			{ level: "INFO", path: "specs/plan/export/spec.md", message: "Consider more scenarios" },
		];
		expect(await openspecValidate(workspace({ validate: { stdout: validateJson(issues) } }).dir, CHANGE)).toEqual(issues);
	});

	it("a clean change has no issues, from the project copy with telemetry off", async () => {
		const ws = workspace({ validate: { stdout: validateJson([]) } });
		expect(await openspecValidate(ws.dir, CHANGE)).toEqual([]);
		expect(openspecCalls(ws.log)).toEqual([`${ws.path} 0 --version`, `${ws.path} 0 ${VALIDATE}`]);
	});

	it("non-JSON output is one ERROR naming the command and the openspec run", async () => {
		const ws = workspace({ validate: { stdout: "Error: change not found\n", exit: 1 } });
		expect(await openspecValidate(ws.dir, CHANGE)).toEqual([
			{ level: "ERROR", path: ".", message: `\`openspec ${VALIDATE}\` printed no parseable JSON (openspec 1.14.1 at ${ws.path})` },
		]);
	});

	it("empty output is the same ERROR", async () => {
		const ws = workspace({ validate: { stdout: "", exit: 1 } });
		expect(await openspecValidate(ws.dir, CHANGE)).toEqual([
			{ level: "ERROR", path: ".", message: `\`openspec ${VALIDATE}\` printed no parseable JSON (openspec 1.14.1 at ${ws.path})` },
		]);
	});

	it("JSON of the wrong shape is one ERROR saying what it lacks, and the openspec run", async () => {
		const ws = workspace({ validate: { stdout: '{"items": "none"}' } });
		expect(await openspecValidate(ws.dir, CHANGE)).toEqual([
			{ level: "ERROR", path: ".", message: `\`openspec ${VALIDATE}\` printed JSON without an items array (openspec 1.14.1 at ${ws.path})` },
		]);
		const noMessage = workspace({ validate: { stdout: validateJson([{ level: "ERROR", path: "proposal.md" }]) } });
		expect((await openspecValidate(noMessage.dir, CHANGE))[0]?.message).toMatch(/without a level, path and message in each issue \(openspec 1\.14\.1 at /);
	});

	it("runs a given bin without resolving one, and a given null as not found", async () => {
		const elsewhere = fakeOpenspecBin(temp("openspec-cli-bin-"), { validate: { stdout: validateJson([]) } });
		const ws = temp("openspec-cli-ws-");
		expect(await openspecValidate(ws, CHANGE, { path: elsewhere.path, version: "1.14.1", source: "path" })).toEqual([]);
		expect(openspecCalls(elsewhere.log)).toEqual([`${elsewhere.path} 0 ${VALIDATE}`]);

		const project = workspace({ validate: { stdout: validateJson([]) } });
		expect(await openspecValidate(project.dir, CHANGE, null)).toEqual([
			{ level: "ERROR", path: ".", message: `\`openspec ${VALIDATE}\` could not run (openspec not found)` },
		]);
		expect(openspecCalls(project.log)).toEqual([]);
	});

	it("a bin that cannot spawn is one ERROR saying why, and naming it", async () => {
		const path = join(temp("openspec-cli-bin-"), "openspec");
		const issues = await openspecValidate(temp("openspec-cli-ws-"), CHANGE, { path, version: "1.14.1", source: "project" });
		expect(issues).toEqual([{ level: "ERROR", path: ".", message: expect.stringMatching(new RegExp(`^\`openspec ${VALIDATE}\` could not run: .*ENOENT`)) }]);
		expect(issues[0]?.message.endsWith(` (openspec 1.14.1 at ${path})`)).toBe(true);
	});
});

/** As openspec 1.14.1 prints `show <id> --json --deltas-only`: `requirement` and `requirements` both, `rename` for RENAMED. */
const SHOWN = JSON.stringify(
	{
		id: CHANGE,
		title: CHANGE,
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

describe.skipIf(process.platform === "win32")("openspecDeltas", () => {
	it("parses openspec's deltas, one per requirement", async () => {
		const ws = workspace({ show: { stdout: SHOWN } });
		expect(await openspecDeltas(ws.dir, CHANGE)).toEqual({
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
		expect(openspecCalls(ws.log)).toEqual([`${ws.path} 0 --version`, `${ws.path} 0 ${SHOW}`]);
	});

	it("Scenario: Unreadable show output names the openspec run", async () => {
		const unreadable = workspace({ show: { stdout: "Error: change not found\n" } });
		expect(await openspecDeltas(unreadable.dir, CHANGE)).toEqual({
			deltas: [],
			issues: [{ level: "ERROR", path: ".", message: `\`openspec ${SHOW}\` printed no parseable JSON (openspec 1.14.1 at ${unreadable.path})` }],
		});

		// As openspec 1.9.0 printed it: a requirement with no name.
		const nameless = { deltas: [{ spec: "plan/export", operation: "ADDED", requirement: { text: "Plans SHALL export.", scenarios: [] } }] };
		const unnamed = workspace({ show: { stdout: JSON.stringify(nameless) } });
		const result = await openspecDeltas(unnamed.dir, CHANGE);
		expect(result.deltas).toEqual([]);
		expect(result.issues).toEqual([{ level: "ERROR", path: ".", message: expect.stringContaining("requirement names") }]);
		expect(result.issues[0]?.message.endsWith(` (openspec 1.14.1 at ${unnamed.path})`)).toBe(true);
	});

	it("a delta of an unknown operation is one ERROR naming openspec show and the openspec run", async () => {
		const ws = workspace({ show: { stdout: JSON.stringify({ deltas: [{ spec: "plan/export", operation: "CHANGED" }] }) } });
		const result = await openspecDeltas(ws.dir, CHANGE);
		expect(result).toEqual({
			deltas: [],
			issues: [
				{
					level: "ERROR",
					path: ".",
					message: `\`openspec ${SHOW}\` printed JSON without a known operation (ADDED, MODIFIED, REMOVED, RENAMED) in each delta (openspec 1.14.1 at ${ws.path})`,
				},
			],
		});
	});

	it("a missing openspec is one ERROR naming openspec show", async () => {
		vi.stubEnv("PATH", temp("empty-path-"));
		expect(await openspecDeltas(temp("openspec-cli-ws-"), CHANGE)).toEqual({
			deltas: [],
			issues: [{ level: "ERROR", path: ".", message: `\`openspec ${SHOW}\` could not run (openspec not found)` }],
		});
	});
});
