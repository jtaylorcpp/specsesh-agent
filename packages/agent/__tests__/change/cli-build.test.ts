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
import { TASK_LOOP, changeLoopExtensions, startChangeLoop } from "../../src/task/index.js";
import { setup } from "../durable/helpers.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { commitAll, gitIn, write } from "../task/cli-helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, loopHarness, temp, verdict } from "../task/helpers.js";
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
/** With `## Purpose`, so the change check's trial fold creates the capability clean. */
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
	`review it with: specsesh change draft ${CHANGE}`,
	`then approve it again: specsesh change approve ${CHANGE}`,
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

/** The change loops in the database, oldest first: id, how the task stands, and the loop it restarts. */
async function changeLoopsOf(db: string) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const page = await storage.scanTasks({ kind: CHANGE_LOOP_TASK }, 100, undefined, context);
		return page.items
			.map((task) => ({
				id: Number(task.id),
				state: task.state.status === "terminal" ? task.state.outcome.status : task.state.status,
				restarts: (task.input as { restarts?: number }).restarts,
			}))
			.sort((a, b) => a.id - b.id);
	} finally {
		await storage.close(context);
	}
}

/** Every task in the database that hasn't ended. */
async function unsettledIn(db: string) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const live: string[] = [];
		for (const kind of [CHANGE_LOOP_TASK, GROUP_LOOP_NAME, TASK_LOOP, "agentscript.run"]) {
			for (const task of (await storage.scanTasks({ kind }, 100, undefined, context)).items) if (task.state.status !== "terminal") live.push(`${kind} ${task.id}`);
		}
		return live;
	} finally {
		await storage.close(context);
	}
}

/** A change loop of `repo()`'s change created on `db` but never run, as a process that died before its first step leaves it. */
async function interruptedLoop(built: ReturnType<typeof repo>) {
	const env = setup();
	for (const extension of changeLoopExtensions({ workspace: built.dir, checks: ["true"] })) env.registry.install(extension);
	const harness = await loopHarness(env, await openNodeSqliteStorage(built.db));
	const id = await startChangeLoop(
		harness,
		{ change: { dir: built.changeDir }, script: { text: JUDGE_ONLY }, groupScript: { text: GROUP_JUDGE }, workspace: built.dir, checks: ["true"], changeChecks: ["true"], model: env.model },
		context,
	);
	await harness.close(context);
	return Number(id);
}

describe.skipIf(process.platform === "win32")("change/cli build --restart (#52)", () => {
	it("leaves a blocked loop as it ended and builds from a new one, which records it", async () => {
		const { dir, db, args } = repo();
		const blocked = await change(["build", CHANGE, ...args], dir, [verdict(false, "which?", "ask", "Which format?")]);
		expect(blocked.code, blocked.err).toBe(1);
		const [first] = await changeLoopsOf(db);

		const run = await change(["build", CHANGE, "--restart", ...args], dir, converging());
		expect(run.code, run.err).toBe(0);
		expect(run.out.split("\n")[0]).toMatch(new RegExp(`^# ${CHANGE} — built`));
		expect(run.err).toContain(`change loop ${first!.id} of ${CHANGE} left blocked; starting a new one`);
		const loops = await changeLoopsOf(db);
		expect(loops).toEqual([
			{ id: first!.id, state: "completed", restarts: undefined },
			{ id: expect.any(Number), state: "completed", restarts: first!.id },
		]);
		// The new loop's hint doesn't repeat --restart: building again resumes, it doesn't restart.
		expect(run.err).toMatch(new RegExp(`change loop ${loops[1]!.id} — resume with: specsesh change build ${CHANGE} --db \\S+$`, "m"));
	}, 60_000);

	it("aborts a loop a process died in, then builds from a new one", async () => {
		const built = repo();
		const stuck = await interruptedLoop(built);
		expect(await unsettledIn(built.db)).toEqual([`${CHANGE_LOOP_TASK} ${stuck}`]);

		const run = await change(["build", CHANGE, "--restart", ...built.args], built.dir, converging());
		expect(run.code, run.err).toBe(0);
		expect(run.err).toContain(`change loop ${stuck} of ${CHANGE} aborted; starting a new one`);
		const loops = await changeLoopsOf(built.db);
		expect(loops[0]).toEqual({ id: stuck, state: "aborted", restarts: undefined });
		expect(loops[1]).toMatchObject({ state: "completed", restarts: stuck });
		expect(await unsettledIn(built.db)).toEqual([]);
	}, 60_000);

	it("aborts the group and task loops under it too", async () => {
		const built = repo();
		const env = setup();
		// A check still running when the harness closes, so the loops under the change loop are left unsettled.
		const slow = "node -e setTimeout(()=>{},2000)";
		for (const extension of changeLoopExtensions({ workspace: built.dir, checks: [slow] })) env.registry.install(extension);
		const harness = await loopHarness(env, await openNodeSqliteStorage(built.db));
		env.faux.setResponses([verdict(true)]);
		const stuck = await startChangeLoop(
			harness,
			{ change: { dir: built.changeDir }, script: { text: JUDGE_ONLY }, groupScript: { text: GROUP_JUDGE }, workspace: built.dir, checks: [slow], changeChecks: [slow], model: env.model },
			context,
		);
		harness.resume();
		while (env.faux.state.callCount < 1) await new Promise((resolve) => setTimeout(resolve, 20));
		await new Promise((resolve) => setTimeout(resolve, 300));
		await harness.close(context);
		const live = await unsettledIn(built.db);
		expect(live.some((t) => t.startsWith(GROUP_LOOP_NAME)), live.join(", ")).toBe(true);
		expect(live.some((t) => t.startsWith(TASK_LOOP)), live.join(", ")).toBe(true);

		// The dead run ticked a task, as a crash mid-build leaves the tree.
		const run = await change(["build", CHANGE, "--restart", "--allow-dirty", ...built.args], built.dir, converging());
		expect(run.code, run.err).toBe(0);
		expect(run.err).toContain(`change loop ${stuck} of ${CHANGE} aborted; starting a new one`);
		expect(await unsettledIn(built.db)).toEqual([]);
	}, 90_000);

	it("refuses a built change, and --restart with an answer or --amend, changing nothing", async () => {
		const { dir, db, args } = repo();
		expect((await change(["build", CHANGE, ...args], dir, converging())).code).toBe(0);
		const before = await changeLoopsOf(db);
		const builtAgain = await change(["build", CHANGE, "--restart", ...args], dir, converging());
		expect(builtAgain.code).toBe(2);
		expect(builtAgain.err).toContain(`${CHANGE} is built (change loop ${before[0]!.id}); there is nothing to restart`);
		for (const extra of [["an answer"], ["--amend"]]) {
			const r = await change(["build", CHANGE, ...extra, "--restart", ...args], dir);
			expect(r.code, extra.join(" ")).toBe(2);
			expect(r.err).toContain("--restart takes no answer and no --amend");
		}
		expect(await changeLoopsOf(db)).toEqual(before);
	}, 60_000);
});
