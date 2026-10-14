/**
 * change/cli: `build` answers a waiting build, shows its question, and ends with the next
 * command. `agentscript-change` in process, on a faux model, in a temp git repository holding
 * `add-plan-export` (groups 1, 2 and 3, every stage approved), with the test judges as
 * scripts and `true` as both checks. The guard validates the change with the repo's pinned
 * `openspec`, so it goes first on PATH.
 *
 * "A built change points at the next step" names a scenario of both the draft and the build
 * output requirements, so the tests are grouped by requirement.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { CHANGE_LOOP_TASK } from "../../src/task/change-input.js";
import { resetOpenspecCache } from "../../src/task/openspec-bin.js";
import { readChangeResult } from "../../src/task/change-api.js";
import { GROUP_LOOP_NAME } from "../../src/task/group.js";
import { TASK_LOOP } from "../../src/task/index.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { commitAll, gitIn, write } from "../task/cli-helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, temp, verdict } from "../task/helpers.js";
import { STAGE_SCRIPT, draft } from "../task/spec-helpers.js";
import { stagedCheck } from "../task/staged-check.js";
import { CHANGE, answersIn, change, csvImportGroup1, fakeOpenspec, noAmendment, planExportTask22, snapshotOpenspec } from "./helpers.js";

/** The repo's pinned `openspec` (1.14.1): the guard validates the change with it. */
const OPENSPEC_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "node_modules", ".bin");

let savedPath: string | undefined;
beforeEach(() => {
	savedPath = process.env.PATH;
	process.env.PATH = `${OPENSPEC_BIN}:${savedPath ?? ""}`;
	resetOpenspecCache();
});
afterEach(() => {
	process.env.PATH = savedPath;
	resetOpenspecCache();
	cleanTemps();
});

const PROPOSAL = "## Why\nPlans have to leave the tool, for a reason long enough to pass.\n\n## What Changes\n- Exports a plan.\n";
const scenario = (name: string) => `#### Scenario: ${name}\n- **WHEN** it runs\n- **THEN** it SHALL work\n`;
const REQUIREMENTS = [
	["Plans export", "A plan SHALL export as JSON.", "A plan exports"],
	["Exports are complete", "An export SHALL hold every step.", "An export holds every step"],
	["Exports are named", "An export SHALL be named after its plan.", "An export is named"],
	["Exports use the API", "An export SHALL go through the plan API.", "An export calls the API"],
	["Exports are listed", "Every export SHALL be listed.", "An export is listed"],
];
/** With `## Purpose`, so the change check's trial fold creates each capability clean. */
const delta = (requirements: string[][]) =>
	["## Purpose", "Plans leave the tool as files another program can read back.", "", "## ADDED Requirements", "", ...requirements.flatMap(([name, text, title]) => [`### Requirement: ${name}`, text!, "", scenario(title!)])].join("\n");
const SPEC = delta(REQUIREMENTS);
/** The same requirements over two deltas: `plan/export` and, holding the last one, `plan/schema`. */
const SPLIT_SPECS = { "plan/export": delta(REQUIREMENTS.slice(0, -1)), "plan/schema": delta(REQUIREMENTS.slice(-1)) };
const TASKS = [
	"## 1. Export",
	"",
	'- [ ] 1.1 `src/export.ts`: "A plan exports"',
	'- [ ] 1.2 `src/export.ts`: "An export holds every step"',
	"",
	"## 2. API",
	"",
	'- [ ] 2.1 `src/api.ts`: "An export calls the API"',
	'- [ ] 2.2 `src/name.ts`: "An export is named"',
	"",
	"## 3. Listing",
	"",
	'- [ ] 3.1 `src/list.ts`: "An export is listed"',
	"",
].join("\n");

/**
 * A git repository with one commit holding the config and `add-plan-export`, every stage
 * approved; the judges and the database live outside it, so they never dirty the tree.
 * `check` is the task and group check (default `true`).
 */
function repo(check = "true", specs: Record<string, string> = { "plan/export": SPEC }) {
	const dir = temp("change-answer-repo-");
	const changeDir = join(dir, "openspec", "changes", CHANGE);
	write(dir, {
		"agentscript.config.json": JSON.stringify({ task: { changesDir: "openspec/changes" } }),
		"README.md": "# plans\n",
		[join("openspec", "changes", CHANGE, "proposal.md")]: PROPOSAL,
		[join("openspec", "changes", CHANGE, "design.md")]: "## Context\nA design.\n",
		...Object.fromEntries(Object.entries(specs).map(([capability, text]) => [join("openspec", "changes", CHANGE, "specs", capability, "spec.md"), text])),
		[join("openspec", "changes", CHANGE, "tasks.md")]: TASKS,
	});
	mkdirSync(join(dir, "openspec", "specs"), { recursive: true });
	writeFileSync(join(dir, "openspec", "specs", ".gitkeep"), "");
	for (const stage of SPEC_STAGES) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
	gitIn(dir, "init", "-q", "-b", "main");
	commitAll(dir, "init");

	const outside = temp("change-answer-");
	const script = join(outside, "judge.agent");
	const groupScript = join(outside, "group.agent");
	writeFileSync(script, JUDGE_ONLY);
	writeFileSync(groupScript, GROUP_JUDGE);
	const db = join(outside, "loops.sqlite");
	const args = ["--db", db, "--script", script, "--group-script", groupScript, "--check", check, "--change-check", "true"];
	return { dir, changeDir, db, args };
}

/** Every loop in the database (change, group and task loops) and every `agentscript.run`. */
async function tasksIn(db: string) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const scan = async (kind: string) => (await storage.scanTasks({ kind }, 100, undefined, context)).items;
		return {
			changes: await scan(CHANGE_LOOP_TASK),
			groups: await scan(GROUP_LOOP_NAME),
			tasks: await scan(TASK_LOOP),
			runs: await scan("agentscript.run"),
		};
	} finally {
		await storage.close(context);
	}
}

const judgeRework = (task: string) =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { next_action: "rework", rework_task: task, feedback: "try again", question: "" })], {
		stopReason: "toolUse",
	});

/** Group 1's tasks converge, then 2.1 asks the principal `question`; `build` ends blocked, exit 1. */
async function blockInGroup2(question: string, specs?: Record<string, string>) {
	const fixture = repo("true", specs);
	const blocked = await change(["build", CHANGE, ...fixture.args], fixture.dir, [verdict(true), verdict(true), verdict(false, "two APIs", "ask", question)]);
	expect(blocked.code).toBe(1);
	return { ...fixture, blocked };
}

const lastLines = (out: string, n: number) => out.trim().split("\n").slice(-n);

/** The `SPEC_STAGES` names, files and order with the test stage script and an empty gate, so `draft` runs on the faux model. */
const draftStages: readonly SpecStage[] = SPEC_STAGES.map((stage) => ({ ...stage, script: { text: STAGE_SCRIPT }, gate: () => [] }));

/** The newest change loop's outcome status and, when blocked, its question. */
async function latestChangeLoop(db: string) {
	const { changes } = await tasksIn(db);
	const newest = changes.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
	const record = newest.state as unknown as { outcome: { result: unknown } };
	const { outcome } = readChangeResult(record.outcome.result as never, Number(newest.id) as never);
	return { status: outcome.status, question: (outcome as { escalation?: { question: string } }).escalation?.question };
}

/** The ids of every loop and run in `db`, by kind. */
async function idsIn(db: string) {
	const all = await tasksIn(db);
	return Object.fromEntries(Object.entries(all).map(([kind, tasks]) => [kind, tasks.map((task) => task.id)]));
}

const STALE_REFUSAL = `${CHANGE}: approved files changed since they were approved; build refused`;

/**
 * The build answered `blocked` once, with `decision`: one new change loop answering it, and
 * one group run, group 2's, answering the blocked one with the decision as given.
 */
async function expectAnsweredOnce(db: string, blocked: { id: unknown }, decision: string) {
	const { changes } = await tasksIn(db);
	expect(changes).toHaveLength(2);
	const next = changes.find((task) => task.id !== blocked.id)!;
	expect((next.input as unknown as { resume?: { answers: number } }).resume?.answers).toBe(Number(blocked.id));
	const groups = (await answersIn(db)).filter((answer) => answer.kind === "group");
	expect(groups).toHaveLength(1);
	expect(groups[0]).toMatchObject({ group: 2, decision });
}

describe.skipIf(process.platform === "win32")("change/cli build answers", () => {
	describe("build with an answer continues a waiting build", () => {
		it("Scenario: Answering a waiting build continues it", async () => {
			const { dir, db, args } = await blockInGroup2("Which API?");
			const before = await tasksIn(db);
			expect(before.changes).toHaveLength(1);
			const [first] = before.changes;
			const record = first!.state as unknown as { status: string; outcome: { result: unknown } };
			const { outcome } = readChangeResult(record.outcome.result as never, Number(first!.id) as never);
			expect(outcome.status).toBe("blocked");
			expect((outcome as { escalation: { to: string; question: string } }).escalation).toMatchObject({ to: "principal", question: "Which API?" });

			// 2.1 again with the decision, then 2.2 and 3.1; passing group checks ask no judge.
			const run = await change(["build", CHANGE, "Use the v2 API", ...args], dir, [verdict(true), verdict(true), verdict(true)]);
			expect(run.code).toBe(0);
			const one = run.out.indexOf("## group 1: converged");
			const two = run.out.indexOf("## group 2: converged");
			const three = run.out.indexOf("## group 3: converged");
			expect(one).toBeGreaterThan(-1);
			expect(two).toBeGreaterThan(one);
			expect(three).toBeGreaterThan(two);

			// A new run of the same change loop, answering the blocked one; the decision reached group 2's rerun.
			const after = await tasksIn(db);
			expect(after.changes).toHaveLength(2);
			const next = after.changes.find((task) => task.id !== first!.id)!;
			expect((next.input as unknown as { change: unknown; resume?: { answers: number } }).resume?.answers).toBe(Number(first!.id));
			expect((next.input as unknown as { change: unknown }).change).toEqual((first!.input as unknown as { change: unknown }).change);
			const groupTwos = after.groups.filter((task) => (task.input as unknown as { group: number }).group === 2);
			expect(groupTwos).toHaveLength(2);
			expect(groupTwos.some((task) => JSON.stringify(task.input).includes("Use the v2 API"))).toBe(true);
		}, 120_000);

		it("Scenario: build alone shows the question", async () => {
			const { dir, db, args } = await blockInGroup2("Which API?");
			const before = await tasksIn(db);

			const run = await change(["build", CHANGE, ...args], dir, [verdict(true), verdict(true), verdict(true)]);
			expect(run.out).toContain("Which API?");
			expect(run.code).toBe(1);
			expect(run.calls).toBe(0);
			const after = await tasksIn(db);
			for (const kind of ["changes", "groups", "tasks", "runs"] as const) {
				expect(after[kind].map((task) => task.id)).toEqual(before[kind].map((task) => task.id));
			}
		}, 120_000);
	});

	describe("build refuses stale approvals before starting or continuing", () => {
		it("Scenario: An answer to a waiting build is refused and the loop stays blocked", async () => {
			const { dir, changeDir, db, args } = await blockInGroup2("Which API?");
			writeFileSync(join(changeDir, "design.md"), "## Context\nA design, edited by hand.\n");
			commitAll(dir, "edit the design by hand");
			const before = await idsIn(db);

			const run = await change(["build", CHANGE, "Use the v2 API", ...args], dir, [verdict(true), verdict(true), verdict(true)]);
			expect(run.code).toBe(2);
			expect(run.err).toContain(STALE_REFUSAL);
			expect(run.err).toContain("  design: design.md (changed)");
			expect(run.calls).toBe(0);

			// Nothing answered: no new loop or run, no decision anywhere, the newest change loop still asks.
			expect(await idsIn(db)).toEqual(before);
			expect(JSON.stringify(await tasksIn(db))).not.toContain("Use the v2 API");
			expect(await latestChangeLoop(db)).toEqual({ status: "blocked", question: "Which API?" });
		}, 120_000);

		it("Scenario: Ticked tasks are not a change", async () => {
			const { dir, changeDir, db, args } = await blockInGroup2("Which API?");
			// The build ticked 1.1 and 1.2 and touched no other approved file.
			const ticked = TASKS.replace("- [ ] 1.1", "- [x] 1.1").replace("- [ ] 1.2", "- [x] 1.2");
			expect(readFileSync(join(changeDir, "tasks.md"), "utf8")).toBe(ticked);
			expect(readFileSync(join(changeDir, "proposal.md"), "utf8")).toBe(PROPOSAL);
			expect(readFileSync(join(changeDir, "design.md"), "utf8")).toBe("## Context\nA design.\n");
			expect(readFileSync(join(changeDir, "specs", "plan", "export", "spec.md"), "utf8")).toBe(SPEC);
			commitAll(dir, "the build's ticks");
			const [blocked] = (await tasksIn(db)).changes;

			const run = await change(["build", CHANGE, "Use the v2 API", ...args], dir, [verdict(true), verdict(true), verdict(true)]);
			expect(`${run.out}\n${run.err}`).not.toContain("approved files changed since they were approved");
			expect(run.code).toBe(0);
			await expectAnsweredOnce(db, blocked!, "Use the v2 API");
		}, 120_000);

		it("Scenario: Redrafting and approving again lets the build continue", async () => {
			const { dir, changeDir, db, args } = await blockInGroup2("Which API?");
			const specPath = join(changeDir, "specs", "plan", "export", "spec.md");
			const edited = SPEC.replace("Every export SHALL be listed.", "Every export SHALL be listed by name.");
			writeFileSync(specPath, edited);
			writeFileSync(join(changeDir, "intent.md"), "Export a plan.\n");
			commitAll(dir, "edit the delta by hand");
			const [blocked] = (await tasksIn(db)).changes;
			const before = await idsIn(db);

			// Before the redraft, the answer is refused and the loop stays blocked on its question.
			const refused = await change(["build", CHANGE, "Use the v2 API", ...args], dir, [verdict(true), verdict(true), verdict(true)]);
			expect(refused.code).toBe(2);
			expect(refused.err).toContain(STALE_REFUSAL);
			expect(refused.err).toContain("  specs: specs/plan/export/spec.md (changed)");
			expect(refused.calls).toBe(0);
			expect(await idsIn(db)).toEqual(before);
			expect(await answersIn(db)).toEqual([]);

			// The specs stage is drafted again and approved; approving it drops tasks, which is drafted and approved in turn.
			const drafted = await change(["draft", CHANGE, "--db", db], dir, [draft(`=== specs/plan/export/spec.md\n${edited}`)], draftStages);
			expect(drafted.code).toBe(0);
			const tasks = readFileSync(join(changeDir, "tasks.md"), "utf8");
			const specs = await change(["approve", CHANGE, "--principal", "jesse", "--db", db], dir, [draft(`=== tasks.md\n${tasks}`)], draftStages);
			expect(specs.code).toBe(0);
			const all = await change(["approve", CHANGE, "--principal", "jesse", "--db", db], dir, [], draftStages);
			expect(all.code).toBe(0);
			expect(readFileSync(specPath, "utf8")).toBe(edited);
			commitAll(dir, "approve the redraft");
			// Still the same loop, asking the same question: redrafting started no build.
			expect(await latestChangeLoop(db)).toEqual({ status: "blocked", question: "Which API?" });
			expect((await tasksIn(db)).changes.map((task) => task.id)).toEqual([blocked!.id]);

			const run = await change(["build", CHANGE, "Use the v2 API", ...args], dir, [verdict(true), verdict(true), verdict(true)]);
			expect(`${run.out}\n${run.err}`).not.toContain("approved files changed since they were approved");
			expect(run.code).toBe(0);
			await expectAnsweredOnce(db, blocked!, "Use the v2 API");
		}, 120_000);
	});

	describe("The stale-approval refusal names each file and the next step", () => {
		it("Scenario: Several stages and a deleted file are listed in order", async () => {
			const { dir, changeDir, db, args } = await blockInGroup2("Which API?", SPLIT_SPECS);
			writeFileSync(join(changeDir, "design.md"), "## Context\nA design, edited by hand.\n");
			writeFileSync(join(changeDir, "specs", "plan", "export", "spec.md"), `${SPLIT_SPECS["plan/export"]}\nEdited by hand.\n`);
			rmSync(join(changeDir, "specs", "plan", "schema"), { recursive: true });
			commitAll(dir, "edit and delete approved files by hand");
			const before = await idsIn(db);

			const run = await change(["build", CHANGE, "Use the v2 API", ...args], dir, [verdict(true), verdict(true), verdict(true)]);
			expect(run.err.replace(/\n$/, "").split("\n")).toEqual([
				STALE_REFUSAL,
				"  design: design.md (changed)",
				"  specs: specs/plan/export/spec.md (changed)",
				"  specs: specs/plan/schema/spec.md (missing)",
				`review it with: pnpm change draft ${CHANGE}`,
				`then approve it again: pnpm change approve ${CHANGE}`,
			]);
			expect(run.code).toBe(2);
			expect(await idsIn(db)).toEqual(before);
			expect(await latestChangeLoop(db)).toEqual({ status: "blocked", question: "Which API?" });
		}, 120_000);
	});

	describe("Build output ends with the next command", () => {
		it("Scenario: A blocked build ends with the answer command", async () => {
			const { blocked } = await blockInGroup2("Which API?");
			expect(blocked.out.split("\n")[0]).toBe(`# ${CHANGE} — waiting for an answer`);
			const one = blocked.out.search(/## group 1: converged \(2 tasks, 0 reworks\)/);
			const two = blocked.out.indexOf("## group 2: blocked");
			expect(one).toBeGreaterThan(-1);
			expect(two).toBeGreaterThan(one);
			const [question, command] = lastLines(blocked.out, 2);
			expect(question).toMatch(/Which API\?$/);
			expect(command).toContain(`pnpm change build ${CHANGE} "<answer>"`);
		}, 120_000);

		it("Scenario: A built change points at the next step", async () => {
			// Gates of 1.1 and 1.2 pass, group 1's check fails once, the judge reopens 1.1, and everything after passes.
			const staged = stagedCheck([true, true, false, true]);
			const { dir, args } = repo(staged.command);

			const run = await change(["build", CHANGE, ...args], dir, [verdict(true), verdict(true), judgeRework("1.1"), verdict(true), verdict(true), verdict(true), verdict(true)]);
			expect(run.out.split("\n")[0]).toBe(`# ${CHANGE} — built`);
			expect(run.out).toMatch(/## group 1: converged \(\d+ tasks?, 1 rework\)/);
			expect(run.out).toContain("## change check: passed");
			expect(run.out.trim()).toMatch(new RegExp(`pnpm change close ${CHANGE}$`));
			expect(run.out).not.toContain("spec:archive");
			expect(run.code).toBe(0);
		}, 120_000);
	});

	describe("amendments", () => {
		it("Scenario: A task loop's amendment is shown as a diff", async () => {
			const seeded = await planExportTask22({ question: "Amend the spec?" });
			const bytes = seeded.readDelta();
			const files = snapshotOpenspec(seeded.dir);
			const loops = await seeded.changeLoops();
			const openspec = fakeOpenspec();
			try {
				const run = await seeded.build();
				const out = run.out;
				const header = out.indexOf("## proposed amendment (from task 2.2): specs/plan/export/spec.md");
				const minus = out.indexOf("--- openspec/changes/add-plan-export/specs/plan/export/spec.md (on disk)");
				const plus = out.indexOf("+++ openspec/changes/add-plan-export/specs/plan/export/spec.md (amended)");
				const hunk = out.indexOf("@@", plus);
				const removed = out.indexOf("\n-- **THEN** stdout SHALL be the plan as JSON\n", hunk);
				const added = out.indexOf("\n+- **THEN** stdout SHALL be the plan as JSON, with keys sorted\n", removed);
				expect(header).toBeGreaterThan(-1);
				expect(minus).toBeGreaterThan(header);
				expect(plus).toBeGreaterThan(minus);
				expect(hunk).toBeGreaterThan(plus);
				expect(removed).toBeGreaterThan(hunk);
				expect(added).toBeGreaterThan(removed);

				// The groups come first; the question, the amend and the answer commands close the output.
				const groups = out.indexOf("## group ");
				expect(groups).toBeGreaterThan(-1);
				expect(groups).toBeLessThan(header);
				const question = out.indexOf("Amend the spec?", added);
				const amend = out.indexOf("pnpm change build add-plan-export --amend", question);
				const answer = out.indexOf('pnpm change build add-plan-export "<answer>"', amend);
				expect(question).toBeGreaterThan(added);
				expect(amend).toBeGreaterThan(question);
				expect(answer).toBeGreaterThan(amend);
				expect(lastLines(out, 1)[0]).toContain('pnpm change build add-plan-export "<answer>"');

				// Showing it changes nothing: no write, no model, no new run, no decision, no openspec.
				expect(seeded.readDelta()).toEqual(bytes);
				expect(snapshotOpenspec(seeded.dir)).toEqual(files);
				expect(run.calls).toBe(0);
				expect(await seeded.changeLoops()).toEqual(loops);
				expect(await seeded.answers()).toEqual([]);
				expect(openspec.calls()).toEqual([]);
				expect(run.code).toBe(1);
			} finally {
				openspec.restore();
			}
		}, 120_000);

		it("Scenario: A group judge's amendment names the judge", async () => {
			const seeded = await csvImportGroup1();
			expect(seeded.readDelta()).not.toBeNull();

			const run = await seeded.build();
			expect(run.out).toContain("## proposed amendment (from group 1 judge): specs/plan/import/spec.md");
			expect(run.out).toContain("--- openspec/changes/add-csv-import/specs/plan/import/spec.md (on disk)");
			expect(run.out).toContain("+++ openspec/changes/add-csv-import/specs/plan/import/spec.md (amended)");
			expect(run.out).toContain("pnpm change build add-csv-import --amend");
			expect(run.code).toBe(1);
		}, 120_000);

		it("a text answer to a group judge writes and validates nothing", async () => {
			const seeded = await csvImportGroup1();
			const bytes = seeded.readDelta();
			const openspec = fakeOpenspec();
			try {
				const run = await seeded.build(["Keep the order loose"], Array.from({ length: 8 }, () => verdict(true)));
				expect(seeded.readDelta()).toEqual(bytes);
				// The answer validates and folds nothing; the change check's trial fold is the only fold.
				const commands = openspec.commands();
				expect(commands.filter((command) => command.startsWith("validate --all"))).toEqual([]);
				expect(commands.filter((command) => command.startsWith("archive") || command.startsWith("validate --specs"))).toEqual([
					"archive add-csv-import --yes",
					"validate --specs --strict --json",
				]);

				const judged = (await seeded.answers()).filter((answer) => answer.kind === "group" && answer.group === 1);
				expect(judged).toHaveLength(1);
				expect(judged[0]!.decision).toBe("Keep the order loose");

				expect(run.out).not.toMatch(/^amended /m);
				expect(run.out).not.toContain("## validation:");
			} finally {
				openspec.restore();
			}
		}, 120_000);

		it("prints a blocked build without an amendment as before", async () => {
			const seeded = await noAmendment();
			const run = await seeded.build();
			expect(run.out).not.toContain("## proposed amendment");
			expect(run.out).not.toContain("--amend");
			const [question, command] = lastLines(run.out, 2);
			expect(question).toMatch(/Which API\?$/);
			expect(command).toContain('pnpm change build add-other-thing "<answer>"');
			expect(run.code).toBe(1);
		}, 120_000);
	});
});
