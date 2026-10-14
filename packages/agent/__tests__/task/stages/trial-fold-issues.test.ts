import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTrialFold, type TrialFoldIssue, type TrialFoldResult, trialFold } from "../../../src/task/cmd-close.js";
import { trialFoldIssues } from "../../../src/task/stages/trial-fold-issues.js";
import { cleanTemps, temp } from "../helpers.js";

vi.mock("../../../src/task/cmd-close.js", () => ({ formatTrialFold: vi.fn(), trialFold: vi.fn() }));

// The real cmd-close imports trial-fold-issues through its graph, so loading it in the factory would bind
// the module under test to the real `trialFold`. Loaded here, after the static imports, it cannot.
const actual = await vi.importActual<typeof import("../../../src/task/cmd-close.js")>("../../../src/task/cmd-close.js");
vi.mocked(formatTrialFold).mockImplementation(actual.formatTrialFold);

afterEach(() => {
	cleanTemps();
	vi.mocked(trialFold).mockReset();
});

const CHANGE = "add-judge";
const COMMAND = "openspec validate --specs --strict --json" as const;

/** A workspace whose change has a delta for `spec/judge`, or no `specs/` at all. */
function workspace(withDeltas = true): string {
	const dir = temp("trial-fold-issues-");
	const change = join(dir, "openspec", "changes", CHANGE);
	mkdirSync(change, { recursive: true });
	if (withDeltas) {
		mkdirSync(join(change, "specs", "spec", "judge"), { recursive: true });
		writeFileSync(join(change, "specs", "spec", "judge", "spec.md"), "## MODIFIED Requirements\n");
	}
	return dir;
}

const folded = (issues: readonly TrialFoldIssue[]): TrialFoldResult => ({ ok: issues.length === 0, command: COMMAND, exit: issues.length === 0 ? 0 : 1, issues });
const failed = (failure: string): TrialFoldResult => ({ ok: false, command: COMMAND, exit: null, issues: [], failure });

describe("trialFoldIssues", () => {
	it("Scenario: A folded MODIFIED requirement over 500 characters is sent back", async () => {
		const dir = workspace();
		const message = 'Requirement "The judge scores each draft" text exceeds 500 characters (612)';
		vi.mocked(trialFold).mockResolvedValue(folded([{ level: "ERROR", spec: "spec/judge", message }]));

		expect(await trialFoldIssues(dir, CHANGE)).toEqual([
			{ level: "ERROR", path: "specs/spec/judge/spec.md", message: `trial fold: spec/judge: ${message}` },
		]);
		expect(trialFold).toHaveBeenCalledTimes(1);
		expect(trialFold).toHaveBeenCalledWith(dir, CHANGE);
	});

	it("Scenario: A fold warning on a spec without a delta", async () => {
		const dir = workspace();
		vi.mocked(trialFold).mockResolvedValue(folded([{ level: "WARNING", spec: "core/subset", message: "Purpose section is too brief" }]));

		expect(await trialFoldIssues(dir, CHANGE)).toEqual([
			{ level: "WARNING", path: "openspec/specs/core/subset/spec.md", message: "trial fold: core/subset: Purpose section is too brief" },
		]);
		expect(trialFold).toHaveBeenCalledExactlyOnceWith(dir, CHANGE);
	});

	it("Scenario: A fold reporting only INFO adds no issue", async () => {
		const dir = workspace();
		vi.mocked(trialFold).mockResolvedValueOnce(folded([]));
		expect(await trialFoldIssues(dir, CHANGE)).toEqual([]);

		const info = { level: "INFO", spec: "spec/judge", message: "Consider adding more scenarios" } as unknown as TrialFoldIssue;
		vi.mocked(trialFold).mockResolvedValueOnce(folded([info]));
		expect(await trialFoldIssues(dir, CHANGE)).toEqual([]);
	});

	it("Scenario: The fold prints no parseable JSON", async () => {
		const dir = workspace();
		vi.mocked(trialFold).mockResolvedValue({ ...failed("no parseable JSON on stdout"), exit: 0 });

		const issues = await trialFoldIssues(dir, CHANGE);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toEqual({ level: "ERROR", message: "openspec validate --specs --strict could not run: no parseable JSON on stdout" });
		expect(issues[0]?.path).toBeUndefined();
	});

	it("Scenario: openspec is missing at the fold", async () => {
		const dir = workspace();
		vi.mocked(trialFold).mockResolvedValue(failed("spawn openspec ENOENT"));

		const issues = await trialFoldIssues(dir, CHANGE);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toEqual({ level: "ERROR", message: "openspec validate --specs --strict could not run: spawn openspec ENOENT" });
		expect(issues[0]?.path).toBeUndefined();
		expect(issues[0]?.message).toContain("openspec validate --specs --strict");
		// An ERROR is what sends the spec loop round again.
		expect(issues.some((i) => i.level === "ERROR")).toBe(true);
	});

	it("places every issue in openspec/specs/ when the change has no specs/", async () => {
		const dir = workspace(false);
		vi.mocked(trialFold).mockResolvedValue(
			folded([
				{ level: "ERROR", spec: "spec/judge", message: "too long" },
				{ level: "WARNING", spec: "core/subset", message: "too brief" },
			]),
		);

		expect((await trialFoldIssues(dir, CHANGE)).map((issue) => issue.path)).toEqual([
			"openspec/specs/spec/judge/spec.md",
			"openspec/specs/core/subset/spec.md",
		]);
	});
});
