/**
 * change/cli: `close` folds a finished change into `openspec/specs/`. `agentscript-change` in
 * process, in a temp git repository holding `add-plan-export` (a new `plan/export` and a
 * modified `plan/cli`), every stage approved. A change loop, when a test needs one, comes from
 * a real `build` on a faux model, with the test judges as scripts and `true` as both checks.
 * `close` runs the repo's pinned `openspec`, so it goes first on PATH.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordApproval } from "../../src/task/spec-approvals.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { commitAll, gitIn, write } from "../task/cli-helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, temp, verdict } from "../task/helpers.js";
import { CHANGE, change } from "./helpers.js";

/** The repo's pinned `openspec` (1.14.1): `close` validates and archives with it. */
const OPENSPEC_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "node_modules", ".bin");

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
const EXPORT_SPEC = [
	"## Purpose",
	"Plans leave the tool as files another program can read back.",
	"",
	"## ADDED Requirements",
	"", "### Requirement: Plans export", "A plan SHALL export as JSON.", "", scenario("A plan exports")].join("\n");
const CLI_MAIN = [
	"# plan/cli Specification",
	"",
	"## Purpose",
	"The plan command line: what it takes, what it prints and how it exits.",
	"",
	"## Requirements",
	"",
	"### Requirement: Plans list",
	"The CLI SHALL list every plan.",
	"",
	scenario("Plans are listed"),
].join("\n");
const MODIFIED = "The CLI SHALL list every plan, and each plan's export.";
/** Over openspec's 500-character limit: the change validates (MODIFIED text is not measured), the merged spec does not. */
const OVERLONG = `The CLI SHALL list every plan, and each plan's export, ${"with its name, its size and the time it was written, ".repeat(9)}in one table.`;
const cliDelta = (text: string) => ["## MODIFIED Requirements", "", "### Requirement: Plans list", text, "", scenario("Plans are listed")].join("\n");
const TASKS = [
	"## 1. Export",
	"",
	'- [ ] 1.1 `src/export.ts`: "A plan exports"',
	'- [ ] 1.2 `src/export.ts`: "A plan exports"',
	"",
	"## 2. CLI",
	"",
	'- [ ] 2.1 `src/cli.ts`: "Plans are listed"',
	'- [ ] 2.2 `src/cli.ts`: "Plans are listed"',
	'- [ ] 2.3 `src/cli.ts`: "Plans are listed"',
	"",
].join("\n");

/**
 * A git repository with one commit holding the config, `openspec/specs/plan/cli` and
 * `add-plan-export`, every stage approved; the judges and the database live outside it.
 */
function repo(cliText = MODIFIED) {
	const dir = temp("change-close-repo-");
	const changeDir = join(dir, "openspec", "changes", CHANGE);
	write(dir, {
		"agentscript.config.json": JSON.stringify({ task: { changesDir: "openspec/changes" } }),
		"README.md": "# plans\n",
		[join("openspec", "specs", "plan", "cli", "spec.md")]: CLI_MAIN,
		[join("openspec", "changes", CHANGE, "proposal.md")]: PROPOSAL,
		[join("openspec", "changes", CHANGE, "design.md")]: "## Context\nA design.\n",
		[join("openspec", "changes", CHANGE, "specs", "plan", "export", "spec.md")]: EXPORT_SPEC,
		[join("openspec", "changes", CHANGE, "specs", "plan", "cli", "spec.md")]: cliDelta(cliText),
		[join("openspec", "changes", CHANGE, "tasks.md")]: TASKS,
	});
	for (const stage of SPEC_STAGES) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
	gitIn(dir, "init", "-q", "-b", "main");
	commitAll(dir, "init");

	const outside = temp("change-close-");
	const script = join(outside, "judge.agent");
	const groupScript = join(outside, "group.agent");
	writeFileSync(script, JUDGE_ONLY);
	writeFileSync(groupScript, GROUP_JUDGE);
	const db = join(outside, "loops.sqlite");
	const buildArgs = ["--db", db, "--script", script, "--group-script", groupScript, "--check", "true", "--change-check", "true"];
	return { dir, changeDir, db, buildArgs };
}

/** Tick every task in tasks.md except `except`, as a principal who did them by hand. */
function tick(changeDir: string, except: readonly string[] = []) {
	const path = join(changeDir, "tasks.md");
	const ticked = readFileSync(path, "utf8").replace(/^- \[ \] (\d+\.\d+) /gm, (line, id: string) => (except.includes(id) ? line : `- [x] ${id} `));
	writeFileSync(path, ticked);
}

/** Every file under `openspec/`, by path relative to it, in path order. */
function snapshot(dir: string): Record<string, string> {
	const root = join(dir, "openspec");
	const files: Record<string, string> = {};
	for (const path of readdirSync(root, { recursive: true, encoding: "utf8" }).sort()) {
		const full = join(root, path);
		if (statSync(full).isFile()) files[relative(root, full)] = readFileSync(full, "utf8");
	}
	return files;
}

/** `openspec validate <change> --strict` in `dir`: the exit code. */
function validateChange(dir: string): number {
	try {
		execFileSync("openspec", ["validate", CHANGE, "--strict"], { cwd: dir, env: { ...process.env, OPENSPEC_TELEMETRY: "0" }, stdio: "pipe" });
		return 0;
	} catch (error) {
		return (error as { status?: number }).status ?? 1;
	}
}

/** Group 1 converges, then 2.1 asks the principal `Which format?`; the build ends blocked, exit 1. */
const blocking = () => [verdict(true), verdict(true), verdict(false, "two formats", "ask", "Which format?")];

describe.skipIf(process.platform === "win32")("change/cli close", () => {
	describe("close refuses an unfinished change", () => {
		it("Scenario: An unticked task refuses close", async () => {
			const { dir, changeDir, db } = repo();
			tick(changeDir, ["2.3"]);
			const before = snapshot(dir);

			const run = await change(["close", CHANGE, "--db", db], dir);
			expect(run.code).toBe(2);
			expect(`${run.out}\n${run.err}`).toContain("2.3");
			expect(snapshot(dir)).toEqual(before);
		}, 60_000);

		it("Scenario: A waiting build refuses close", async () => {
			const { dir, changeDir, db, buildArgs } = repo();
			expect((await change(["build", CHANGE, ...buildArgs], dir, blocking())).code).toBe(1);
			tick(changeDir);
			const before = snapshot(dir);

			const run = await change(["close", CHANGE, "--db", db], dir);
			expect(run.code).toBe(2);
			expect(`${run.out}\n${run.err}`).toMatch(/waiting for an answer/i);
			expect(snapshot(dir)).toEqual(before);
		}, 120_000);
	});

	describe("close folds the change through a trial first", () => {
		it("Scenario: A finished change is folded", async () => {
			const { dir, db, buildArgs } = repo();
			// The older change loop blocked; the newest, answering it, converged: the newest decides.
			expect((await change(["build", CHANGE, ...buildArgs], dir, blocking())).code).toBe(1);
			expect((await change(["build", CHANGE, "JSON only", ...buildArgs], dir, [verdict(true), verdict(true), verdict(true)])).code).toBe(0);
			const head = gitIn(dir, "rev-parse", "HEAD");

			const run = await change(["close", CHANGE, "--db", db], dir);
			expect(run.err).toBe("");
			expect(run.code).toBe(0);

			const specs = join(dir, "openspec", "specs");
			expect(readFileSync(join(specs, "plan", "export", "spec.md"), "utf8")).toContain("### Requirement: Plans export");
			expect(readFileSync(join(specs, "plan", "cli", "spec.md"), "utf8")).toContain(MODIFIED);
			expect(existsSync(join(dir, "openspec", "changes", CHANGE))).toBe(false);
			const archived = readdirSync(join(dir, "openspec", "changes", "archive")).filter((name) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${CHANGE}$`).test(name));
			expect(archived).toHaveLength(1);

			expect(run.out).toContain("plan/export");
			expect(run.out).toContain("plan/cli");
			expect(run.out).toContain(`openspec/changes/archive/${archived[0]}/`);
			expect(run.out.trim()).toMatch(/git add -A openspec && git commit$/);
			// It never commits.
			expect(gitIn(dir, "rev-parse", "HEAD")).toBe(head);
		}, 120_000);

		it("Scenario: A fold that breaks the specs is refused", async () => {
			expect(OVERLONG.length).toBeGreaterThan(500);
			const { dir, changeDir, db } = repo(OVERLONG);
			tick(changeDir);
			expect(validateChange(dir)).toBe(0);
			const before = snapshot(dir);

			const run = await change(["close", CHANGE, "--db", db], dir);
			expect(run.code).toBe(2);
			// Refused by the merged length limit, not by anything else in the fixture.
			expect(run.err).toContain("Requirement text is very long");
			expect(snapshot(dir)).toEqual(before);
			expect(existsSync(join(dir, "openspec", "changes", CHANGE))).toBe(true);
			expect(existsSync(join(dir, "openspec", "changes", "archive"))).toBe(false);
		}, 60_000);
	});
});
