import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localWorkspace } from "../../../src/node/index.js";
import type { StageContext } from "../../../src/task/spec-stage.js";
import type { Delta } from "../../../src/task/stages/openspec-cli.js";
import { specsGate } from "../../../src/task/stages/specs.js";
import { asChange, coverageIssues, deltaCapabilities, notTasks, specsSizeIssues } from "../../../src/task/stages/specs-gate.js";
import { cleanTemps, temp } from "../helpers.js";

afterEach(cleanTemps);

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

const CHANGE = "add-thing";

const proposal = (capabilities: string) =>
	["Why", "What Changes", "Out of scope", "Capabilities", "Impact"]
		.map((heading) => `## ${heading}\n\n${heading === "Capabilities" ? capabilities : `- ${heading} text.\n`}`)
		.join("\n");

/** A workspace holding `CHANGE` with `proposal.md` approved as given. */
function changeWorkspace(proposalMd: string): { workspace: string; changeDir: string } {
	const workspace = temp("specs-gate-");
	const changeDir = join(workspace, "openspec", "changes", CHANGE);
	mkdirSync(changeDir, { recursive: true });
	writeFileSync(join(changeDir, "proposal.md"), proposalMd);
	return { workspace, changeDir };
}

/**
 * A directory holding an `openspec` script that logs `$OPENSPEC_TELEMETRY $*` to `calls.log`
 * and prints the given JSON for `validate` (exiting 1 when it reports an issue, as OpenSpec
 * does) or `show`.
 */
function fakeOpenspec(validate: unknown, show: unknown): string {
	const dir = temp("fake-openspec-");
	writeFileSync(join(dir, "validate.json"), JSON.stringify(validate));
	writeFileSync(join(dir, "show.json"), JSON.stringify(show));
	const invalid = JSON.stringify(validate).includes('"valid":false') ? 1 : 0;
	const script = [
		"#!/bin/sh",
		`printf '%s %s\\n' "$OPENSPEC_TELEMETRY" "$*" >> '${dir}/calls.log'`,
		'case "$1" in',
		`  validate) cat '${dir}/validate.json'; exit ${invalid} ;;`,
		`  show) cat '${dir}/show.json' ;;`,
		"esac",
		"",
	].join("\n");
	writeFileSync(join(dir, "openspec"), script, { mode: 0o755 });
	return dir;
}

/** A `StageContext` whose `run` is the spec loop's: `localWorkspace` exec, here with `path` as `PATH`. */
function gateContext(proposalMd: string, files: Record<string, string>, path: string): StageContext {
	const { workspace, changeDir } = changeWorkspace(proposalMd);
	const exec = localWorkspace(workspace).exec;
	return {
		changeId: CHANGE,
		workspace,
		changeDir,
		files,
		run: async (argv) => {
			const command = argv.join(" ");
			const ran = await exec!(argv, { timeoutMs: 30_000, env: { ...(process.env as Record<string, string>), PATH: path } });
			if (ran.kind === "exited") return { command, exitCode: ran.code, output: ran.stdout + ran.stderr };
			if (ran.kind === "timed-out") return { command, exitCode: -1, output: `${ran.stdout}${ran.stderr}\n(timed out)` };
			return { command, exitCode: 127, output: `(could not start: ${ran.message})` };
		},
	};
}

const onPath = (dir: string) => `${dir}:${process.env["PATH"] ?? ""}`;
const validated = (issues: unknown[] = []) => ({ items: [{ id: CHANGE, valid: issues.length === 0, issues }] });
const shown = (...specs: string[]) => ({
	deltas: specs.map((spec) => ({ spec, operation: "MODIFIED", requirement: { name: spec, text: "It SHALL.", scenarios: [{ rawText: "S" }] } })),
});
const MODIFIED_DELTA = "## MODIFIED Requirements\n\n### Requirement: It runs\nIt SHALL run.\n\n#### Scenario: S\n- **WHEN** x\n- **THEN** y\n";

describe.skipIf(process.platform === "win32")("specsGate, with a fake openspec on PATH", () => {
	it("Scenario: An OpenSpec error reaches the next draft", async () => {
		const issue = { level: "ERROR", path: "specs/plan/export/spec.md", message: "Requirement must have at least one scenario" };
		const fake = fakeOpenspec(validated([issue]), shown("plan/export"));
		const files = { "specs/plan/export/spec.md": MODIFIED_DELTA };
		const issues = await specsGate(gateContext(proposal("- **Modified:** `plan/export`\n"), files, onPath(fake)));
		expect(issues).toEqual([issue]);
		expect(readFileSync(join(fake, "calls.log"), "utf8")).toBe(`0 validate ${CHANGE} --strict --json\n0 show ${CHANGE} --json --deltas-only\n`);
	});

	it("Scenario: openspec is missing", async () => {
		const bin = temp("no-openspec-");
		symlinkSync("/usr/bin/env", join(bin, "env"));
		const files = { "specs/task/cli/spec.md": MODIFIED_DELTA };
		const issues = await specsGate(gateContext(proposal("- **Modified:** `task/cli`\n"), files, bin));
		expect(issues).toEqual([{ level: "ERROR", path: ".", message: expect.stringContaining("`openspec validate`") }]);
	});

	it("reports the same one ERROR when even env cannot be spawned", async () => {
		const files = { "specs/task/cli/spec.md": MODIFIED_DELTA };
		const issues = await specsGate(gateContext(proposal("- **Modified:** `task/cli`\n"), files, temp("empty-path-")));
		expect(issues).toEqual([{ level: "ERROR", path: ".", message: expect.stringContaining("`openspec validate`") }]);
	});

	it("Scenario: A delta for an unnamed capability", async () => {
		const fake = fakeOpenspec(validated(), shown("task/cli", "task/group"));
		const files = { "specs/task/cli/spec.md": MODIFIED_DELTA, "specs/task/group/spec.md": MODIFIED_DELTA };
		const issues = await specsGate(gateContext(proposal("- **Modified:** `task/cli`\n"), files, onPath(fake)));
		expect(issues).toEqual([{ level: "ERROR", path: "specs/task/group/spec.md", message: expect.stringContaining("`task/group`") }]);
	});

	it("Scenario: A new capability without a Purpose", async () => {
		const fake = fakeOpenspec(validated(), {
			deltas: [{ spec: "spec/export", operation: "ADDED", requirement: { name: "Export", text: "It SHALL export.", scenarios: [{ rawText: "S" }] } }],
		});
		const delta = "## ADDED Requirements\n\n### Requirement: Export\nIt SHALL export.\n\n#### Scenario: S\n- **WHEN** x\n- **THEN** y\n";
		const issues = await specsGate(gateContext(proposal("- **New:** `spec/export`\n"), { "specs/spec/export/spec.md": delta }, onPath(fake)));
		expect(issues).toEqual([{ level: "ERROR", path: "specs/spec/export/spec.md", message: expect.stringContaining("`spec/export`") }]);
		expect(issues[0]?.message).toContain("## Purpose");
	});
});
