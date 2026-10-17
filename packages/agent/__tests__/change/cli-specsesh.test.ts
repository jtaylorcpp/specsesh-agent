/**
 * change/cli: every command line the change CLI prints for a person to run names
 * `specsesh change`. `agentscript-change` in process, on a faux model: usage and `draft` in a
 * bare workspace; `build` and `close` in a temp git repository holding `add-plan-export`
 * (groups 1 and 2, every stage approved), with the test judges as scripts and `true` as both
 * checks. The guard and `close` run the repo's pinned `openspec`, so it goes first on PATH.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordApproval } from "../../src/task/spec-approvals.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { commitAll, gitIn, write } from "../task/cli-helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, temp, verdict } from "../task/helpers.js";
import { draft } from "../task/spec-helpers.js";
import { CHANGE, OPENSPEC_BIN, change, workspace } from "./helpers.js";

let savedPath: string | undefined;
beforeEach(() => {
	savedPath = process.env.PATH;
	process.env.PATH = `${OPENSPEC_BIN}:${savedPath ?? ""}`;
});
afterEach(() => {
	process.env.PATH = savedPath;
	cleanTemps();
});

const PROPOSAL = "## Why\nPlans have to leave the tool, for a reason long enough to pass.\n\n## What Changes\n- Exports a plan.\n";
const scenario = (name: string) => `#### Scenario: ${name}\n- **WHEN** it runs\n- **THEN** it SHALL work\n`;
/** With `## Purpose`, so `close`'s trial fold creates the capability clean. */
const SPEC = [
	"## Purpose",
	"Plans leave the tool as files another program can read back.",
	"",
	"## ADDED Requirements",
	"",
	"### Requirement: Plans export",
	"A plan SHALL export as JSON.",
	"",
	scenario("A plan exports"),
	"### Requirement: Exports are complete",
	"An export SHALL hold every step.",
	"",
	scenario("An export holds every step"),
	"### Requirement: Exports are named",
	"An export SHALL be named after its plan.",
	"",
	scenario("An export is named"),
].join("\n");
const TASKS = [
	"## 1. Export",
	"",
	'- [ ] 1.1 `src/export.ts`: "A plan exports"',
	'- [ ] 1.2 `src/export.ts`: "An export holds every step"',
	"",
	"## 2. Naming",
	"",
	'- [ ] 2.1 `src/name.ts`: "An export is named"',
	"",
].join("\n");

/**
 * A git repository with one commit holding the config and `add-plan-export`, every stage
 * approved; the judges and the database live outside it, so they never dirty the tree.
 */
function repo() {
	const dir = temp("change-specsesh-repo-");
	const changeDir = join(dir, "openspec", "changes", CHANGE);
	write(dir, {
		"agentscript.config.json": JSON.stringify({ task: { changesDir: "openspec/changes" } }),
		"README.md": "# plans\n",
		[join("openspec", "changes", CHANGE, "proposal.md")]: PROPOSAL,
		[join("openspec", "changes", CHANGE, "design.md")]: "## Context\nA design.\n",
		[join("openspec", "changes", CHANGE, "specs", "plan", "export", "spec.md")]: SPEC,
		[join("openspec", "changes", CHANGE, "tasks.md")]: TASKS,
	});
	mkdirSync(join(dir, "openspec", "specs"), { recursive: true });
	writeFileSync(join(dir, "openspec", "specs", ".gitkeep"), "");
	for (const stage of SPEC_STAGES) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
	gitIn(dir, "init", "-q", "-b", "main");
	commitAll(dir, "init");

	const outside = temp("change-specsesh-");
	const script = join(outside, "judge.agent");
	const groupScript = join(outside, "group.agent");
	writeFileSync(script, JUDGE_ONLY);
	writeFileSync(groupScript, GROUP_JUDGE);
	const db = join(outside, "loops.sqlite");
	const args = ["--db", db, "--script", script, "--group-script", groupScript, "--check", "true", "--change-check", "true"];
	return { dir, changeDir, db, args };
}

/** Tick every task in tasks.md, as a principal who did them by hand. */
function tickAll(changeDir: string) {
	const path = join(changeDir, "tasks.md");
	writeFileSync(path, readFileSync(path, "utf8").replace(/^- \[ \] /gm, "- [x] "));
}

describe.skipIf(process.platform === "win32")("change/cli names specsesh change", () => {
	it("Scenario: The draft resume hint names specsesh change", async () => {
		const { dir } = workspace();
		// The stage asks at once, so the loop blocks after the hint is written.
		const run = await change(["draft", CHANGE, "--intent", "Export a plan"], dir, [draft("", "ask", "CSV too?")]);
		const hint = run.err.split("\n").find((line) => line.startsWith("draft loop "));
		expect(hint).toMatch(new RegExp(`^draft loop \\d+ — resume with: specsesh change draft ${CHANGE} --db `));
		expect(run.err).not.toContain("agentscript-change");
		expect(run.err).not.toContain("pnpm change");
	});

	it("Scenario: The build resume hint names specsesh change", async () => {
		const { dir, args } = repo();

		// Each task converges on its first pass; a passing group check asks no judge.
		const run = await change(["build", CHANGE, ...args], dir, [verdict(true), verdict(true), verdict(true)]);
		expect(run.code).toBe(0);
		const hint = run.err.split("\n").find((line) => line.startsWith("change loop "));
		expect(hint).toMatch(new RegExp(`^change loop \\d+ — resume with: specsesh change build ${CHANGE} --db `));
		expect(run.err).not.toContain("agentscript-change");
		expect(run.err).not.toContain("pnpm change");
	}, 60_000);

	it("Scenario: close names the build to run again", async () => {
		const { dir, changeDir, db, args } = repo();
		// 1.1 is unmet with one iteration: the task is exhausted, so the group and the change fail.
		expect((await change(["build", CHANGE, ...args, "--max-iterations", "1"], dir, [verdict(false, "not yet")])).code).toBe(1);
		tickAll(changeDir);

		const run = await change(["close", CHANGE, "--db", db], dir);
		expect(run.code).toBe(2);
		expect(run.err).toContain(`build it again with specsesh change build ${CHANGE}`);
		expect(run.err).not.toContain("agentscript-change");
		expect(run.err).not.toContain("pnpm change");
	}, 120_000);

	it("Scenario: The usage names no old command", async () => {
		const { dir } = workspace();
		const run = await change([], dir);
		expect(run.code).toBe(2);
		expect(run.err.startsWith("usage:")).toBe(true);
		expect(run.err).not.toContain("agentscript-change");
		expect(run.err).not.toContain("pnpm change");
	});
});
