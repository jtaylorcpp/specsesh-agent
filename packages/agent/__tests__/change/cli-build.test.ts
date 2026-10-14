/**
 * change/cli: `build` starts a change's build. `agentscript-change` in process, on a faux
 * model, in a temp git repository holding `add-plan-export` (groups 1 and 2, every stage
 * approved), with the test judges as scripts and `true` as both checks. The guard validates
 * the change with the repo's pinned `openspec`, so it goes first on PATH.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANGE_LOOP_TASK } from "../../src/task/change-input.js";
import { GROUP_LOOP_NAME } from "../../src/task/group.js";
import { TASK_LOOP } from "../../src/task/index.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { commitAll, gitIn, write } from "../task/cli-helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, temp, verdict } from "../task/helpers.js";
import { CHANGE, change, seedBlockedOnAmendment } from "./helpers.js";

/** The repo's pinned `openspec` (1.14.1): the guard validates the change with it. */
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
const SPEC = [
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
function repo(spec = SPEC) {
	const dir = temp("change-build-repo-");
	const changeDir = join(dir, "openspec", "changes", CHANGE);
	write(dir, {
		"agentscript.config.json": JSON.stringify({ task: { changesDir: "openspec/changes" } }),
		"README.md": "# plans\n",
		[join("openspec", "changes", CHANGE, "proposal.md")]: PROPOSAL,
		[join("openspec", "changes", CHANGE, "design.md")]: "## Context\nA design.\n",
		[join("openspec", "changes", CHANGE, "specs", "plan", "export", "spec.md")]: spec,
		[join("openspec", "changes", CHANGE, "tasks.md")]: TASKS,
	});
	mkdirSync(join(dir, "openspec", "specs"), { recursive: true });
	writeFileSync(join(dir, "openspec", "specs", ".gitkeep"), "");
	for (const stage of SPEC_STAGES) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
	gitIn(dir, "init", "-q", "-b", "main");
	commitAll(dir, "init");

	const outside = temp("change-build-");
	const script = join(outside, "judge.agent");
	const groupScript = join(outside, "group.agent");
	writeFileSync(script, JUDGE_ONLY);
	writeFileSync(groupScript, GROUP_JUDGE);
	const db = join(outside, "loops.sqlite");
	const args = ["--db", db, "--script", script, "--group-script", groupScript, "--check", "true", "--change-check", "true"];
	return { dir, changeDir, db, args };
}

/** Every loop in the database: change, group and task loops. */
async function loopsIn(db: string) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const scan = async (kind: string) => (await storage.scanTasks({ kind }, 100, undefined, context)).items.map((task) => ({ kind, id: task.id }));
		return [...(await scan(CHANGE_LOOP_TASK)), ...(await scan(GROUP_LOOP_NAME)), ...(await scan(TASK_LOOP))];
	} finally {
		await storage.close(context);
	}
}

/** Each task converges on its first pass; a passing group check asks no judge. */
const converging = () => [verdict(true), verdict(true), verdict(true)];

const STALE_SPEC = [
	`${CHANGE}: approved files changed since they were approved; build refused`,
	"  specs: specs/plan/export/spec.md (changed)",
	`review it with: pnpm change draft ${CHANGE}`,
	`then approve it again: pnpm change approve ${CHANGE}`,
].join("\n");

/** `repo()` with `specs/plan/export/spec.md` edited by hand after its approval. */
function handEdited() {
	const built = repo();
	writeFileSync(join(built.changeDir, "specs", "plan", "export", "spec.md"), `${SPEC}\nEdited by hand.\n`);
	return built;
}

describe.skipIf(process.platform === "win32")("change/cli build", () => {
	it("Scenario: A build runs every group in order", async () => {
		const { dir, args } = repo();

		const run = await change(["build", CHANGE, ...args], dir, converging());
		expect(run.code).toBe(0);
		expect(run.out.split("\n")[0]).toMatch(new RegExp(`^# ${CHANGE} — built`));
		const one = run.out.search(/## group 1: converged \(2 tasks, 0 reworks\)/);
		const two = run.out.search(/## group 2: converged \(1 tasks?, 0 reworks\)/);
		expect(one).toBeGreaterThan(-1);
		expect(two).toBeGreaterThan(one);
	}, 60_000);

	it("Scenario: A dirty tree refuses build", async () => {
		const { dir, db, args } = repo();
		writeFileSync(join(dir, "README.md"), "# plans, edited\n");

		const run = await change(["build", CHANGE, ...args], dir, converging());
		expect(run.code).toBe(2);
		expect(run.err).toContain("--allow-dirty");
		expect(run.calls).toBe(0);
		expect(await loopsIn(db)).toEqual([]);
	}, 60_000);

	it("Scenario: A refused guard exits 2", async () => {
		const { dir, db, args } = repo(`${SPEC}\n### Requirement: Export is idempotent\nExporting twice SHALL give the same file.\n`);

		const run = await change(["build", CHANGE, ...args], dir, converging());
		expect(run.code).toBe(2);
		expect(run.err).toContain("Export is idempotent");
		expect(run.calls).toBe(0);
		expect(await loopsIn(db)).toEqual([]);
	}, 60_000);

	it("Scenario: A built change starts nothing", async () => {
		const { dir, db, args } = repo();
		expect((await change(["build", CHANGE, ...args], dir, converging())).code).toBe(0);
		const before = await loopsIn(db);

		const run = await change(["build", CHANGE, ...args], dir);
		expect(run.code).toBe(0);
		expect(run.calls).toBe(0);
		expect(run.out).toContain("built");
		expect(await loopsIn(db)).toEqual(before);
	}, 60_000);

	it("Scenario: A hand-edited delta refuses a new build", async () => {
		const { dir, db, args } = handEdited();
		commitAll(dir, "edit the delta by hand");

		const run = await change(["build", CHANGE, ...args], dir, converging());
		expect(run.code).toBe(2);
		expect(run.err.replace(/\n$/, "")).toBe(STALE_SPEC);
		expect(run.calls).toBe(0);
		expect(await loopsIn(db)).toEqual([]);
	}, 60_000);

	it("Scenario: --allow-dirty does not get around the refusal", async () => {
		const { dir, db, args } = handEdited();

		for (const extra of [[], ["--allow-dirty"]]) {
			const run = await change(["build", CHANGE, ...extra, ...args], dir, converging());
			expect(run.code).toBe(2);
			expect(run.err).toContain(`${CHANGE}: approved files changed since they were approved; build refused`);
			expect(run.err).toContain("  specs: specs/plan/export/spec.md (changed)");
			expect(run.out).not.toContain("--allow-dirty");
			expect(run.err).not.toContain("--allow-dirty");
			expect(run.calls).toBe(0);
			expect(await loopsIn(db)).toEqual([]);
		}
	}, 60_000);

	it("Scenario: Showing the question does not check", async () => {
		const fixture = await seedBlockedOnAmendment({ change: CHANGE, capability: "plan/export", asker: { kind: "task", task: "2.2" }, question: "Which API?" });
		writeFileSync(fixture.deltaPath, `${readFileSync(fixture.deltaPath, "utf8")}\nEdited by hand.\n`);
		commitAll(fixture.dir, "edit the delta by hand");
		const before = await loopsIn(fixture.db);

		const run = await fixture.build();
		expect(run.code).toBe(1);
		expect(run.out).toContain("Which API?");
		expect(`${run.out}\n${run.err}`).not.toContain("approved files changed since they were approved");
		expect(run.calls).toBe(0);
		expect(await loopsIn(fixture.db)).toEqual(before);
	}, 120_000);

	it("Scenario: A built change does not check", async () => {
		const { dir, changeDir, db, args } = repo();
		expect((await change(["build", CHANGE, ...args], dir, converging())).code).toBe(0);
		writeFileSync(join(changeDir, "design.md"), "## Context\nA design, edited by hand.\n");
		commitAll(dir, "edit the design by hand");
		const before = await loopsIn(db);

		const run = await change(["build", CHANGE, ...args], dir);
		expect(run.out).toContain("built");
		expect(`${run.out}\n${run.err}`).not.toContain("approved files changed since they were approved");
		expect(run.calls).toBe(0);
		expect(await loopsIn(db)).toEqual(before);
	}, 60_000);
});
