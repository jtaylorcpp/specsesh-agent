import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { proposalStage } from "../../../src/task/index.js";
import type { StageContext, StageIssue } from "../../../src/task/spec-stage.js";
import { cleanTemps, temp } from "../helpers.js";

afterEach(cleanTemps);

const CHANGE = "add-plan-export";

/** A workspace with two specs, an open change `add-spec-loop` and an archived `add-spec-cli-events`. */
function workspace(): string {
	const dir = temp("slices-");
	for (const path of ["core/subset", "task/cli"]) {
		const file = join(dir, "openspec", "specs", path, "spec.md");
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `## Purpose\nThe ${path} purpose.\n\n## Requirements\n`);
	}
	const open = join(dir, "openspec", "changes", "add-spec-loop");
	mkdirSync(open, { recursive: true });
	writeFileSync(join(open, "proposal.md"), "## Why\n\nLoop.\n");
	mkdirSync(join(dir, "openspec", "changes", "archive", "2026-01-01-add-spec-cli-events"), { recursive: true });
	mkdirSync(join(dir, "openspec", "changes", CHANGE), { recursive: true });
	return dir;
}

/** All five sections, in order, naming one modified capability: within budget. */
const PROPOSAL = ["Why", "What Changes", "Out of scope", "Capabilities", "Impact"]
	.map((heading) => `## ${heading}\n\n${heading === "Capabilities" ? "- **Modified:** `task/cli`." : `- ${heading} text.`}\n`)
	.join("\n");

/** A `slices.md` listing these ids in order, numbered from 1. */
const slicesMd = (...ids: string[]): string => ids.map((id, i) => `${i + 1}. \`${id}\`: Intent for ${id}.`).join("\n") + "\n";

async function runGate(slices: string): Promise<StageIssue[]> {
	const dir = workspace();
	const context: StageContext = {
		changeId: CHANGE,
		workspace: dir,
		changeDir: join(dir, "openspec", "changes", CHANGE),
		files: { "proposal.md": PROPOSAL, "slices.md": slices },
		run: async (argv) => ({ command: argv.join(" "), exitCode: 0, output: "" }),
	};
	return proposalStage.gate(context);
}

const errors = (issues: StageIssue[]) => issues.filter((issue) => issue.level === "ERROR");

describe("proposalStage gate on slices.md", () => {
	it("Scenario: A sliced proposal passes", async () => {
		const issues = await runGate(slicesMd(CHANGE, "add-plan-export-schema", "add-plan-export-ci"));
		expect(issues.filter((issue) => issue.level === "ERROR" || issue.level === "WARNING")).toEqual([]);
	});

	it("Scenario: A slice whose id is taken", async () => {
		const found = errors(await runGate(slicesMd(CHANGE, "add-spec-loop", "add-plan-export-ci")));
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ path: "slices.md" });
		expect(found[0]?.message).toContain("add-spec-loop");
	});

	it("Scenario: The first slice must be this change", async () => {
		const found = errors(await runGate(slicesMd("add-plan-schema", "add-plan-export-schema")));
		expect(found.some((issue) => issue.path === "slices.md" && issue.message.includes(`\`${CHANGE}\``))).toBe(true);
	});
});
