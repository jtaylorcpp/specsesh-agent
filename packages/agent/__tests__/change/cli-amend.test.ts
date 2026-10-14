/**
 * change/cli: `build <change> --amend` applies the amendment a blocked change loop's escalation
 * carries. `agentscript-change` in process, on a faux model, in a temp git repository seeded by a
 * real `build` that ends blocked (see `seedBlockedOnAmendment`). The seeding guard validates the
 * change with the repo's pinned `openspec`, so it goes first on PATH; each test then puts the fake
 * `openspec` in front of it, which logs every call and passes it through to the real one.
 */

import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GROUP_LOOP_NAME } from "../../src/task/group.js";
import { cleanTemps, context, verdict } from "../task/helpers.js";
import { AMEND_SPEC, OPENSPEC_BIN, badPath, csvImportGroup1, errorTooLong, fakeOpenspec, noAmendment, planExportTask22, snapshotOpenspec, warningOnly } from "./helpers.js";

/** "Export writes JSON" as a MODIFIED requirement whose text is 534 characters long. */
const LONG_REQUIREMENT = "`plan export` SHALL write the plan as JSON, with keys sorted".padEnd(533, ", with keys sorted") + ".";
const MODIFIED_TOO_LONG = [
	"## MODIFIED Requirements",
	"",
	"### Requirement: Export writes JSON",
	LONG_REQUIREMENT,
	"",
	"#### Scenario: Export writes JSON",
	"- **WHEN** `plan export p1` runs",
	"- **THEN** stdout SHALL be the plan as JSON, with keys sorted",
	"",
].join("\n");

let savedPath: string | undefined;
beforeEach(() => {
	savedPath = process.env.PATH;
	process.env.PATH = `${OPENSPEC_BIN}:${savedPath ?? ""}`;
});
afterEach(() => {
	process.env.PATH = savedPath;
	cleanTemps();
});

/** Every decision a group judge was answered with (`answerGroupEscalation`): a group run's resume checkpoint with `decision`, not `carried`. */
async function judgeDecisions(db: string): Promise<string[]> {
	const storage = await openNodeSqliteStorage(db);
	try {
		const page = await storage.scanTasks({ kind: GROUP_LOOP_NAME }, 100, undefined, context);
		return page.items.flatMap((record) => {
			const decision = (record.input as unknown as { resume?: { checkpoint: { decision?: string } } }).resume?.checkpoint.decision;
			return decision !== undefined ? [decision] : [];
		});
	} finally {
		await storage.close(context);
	}
}

type Seeded =Awaited<ReturnType<typeof planExportTask22>>;

/** Everything a refused `--amend` must leave as it was: `openspec/`, the change loops and the decisions taken. */
async function untouched(seeded: Seeded) {
	return { files: snapshotOpenspec(seeded.dir), loops: await seeded.changeLoops(), answers: await seeded.answers() };
}

/** A refused `--amend`: `message` on stderr or stdout, exit 2, no model, no openspec, and nothing changed. */
async function expectRefused(seeded: Seeded, run: Awaited<ReturnType<Seeded["build"]>>, message: string, before: Awaited<ReturnType<typeof untouched>>, openspec: ReturnType<typeof fakeOpenspec>) {
	expect(`${run.out}\n${run.err}`).toContain(message);
	expect(run.code).toBe(2);
	expect(run.calls).toBe(0);
	expect(openspec.calls()).toEqual([]);
	expect(await untouched(seeded)).toEqual(before);
	expect((await seeded.changeLoops()).at(-1)!.status).toBe("blocked");
	expect(run.out).not.toMatch(/^amended /m);
	expect(run.out).not.toContain("## validation:");
}

describe.skipIf(process.platform === "win32")("change/cli build --amend", () => {
	describe("--amend refuses what it cannot apply", () => {
		it("Scenario: --amend with an answer is refused", async () => {
			const seeded = await planExportTask22();
			const bytes = seeded.readDelta();
			const before = await untouched(seeded);
			const openspec = fakeOpenspec();
			try {
				const run = await seeded.build(["--amend", "Use v2"]);
				await expectRefused(seeded, run, '--amend takes no answer: use either --amend or "<answer>"', before, openspec);
				expect(seeded.readDelta()).toEqual(bytes);
			} finally {
				openspec.restore();
			}
		}, 120_000);

		it("Scenario: --amend with no amendment waiting is refused", async () => {
			const seeded = await noAmendment();
			const before = await untouched(seeded);
			const openspec = fakeOpenspec();
			try {
				const run = await seeded.build(["--amend"]);
				await expectRefused(seeded, run, "add-other-thing is not waiting on an amendment", before, openspec);
			} finally {
				openspec.restore();
			}
		}, 120_000);

		it("Scenario: A delta outside specs/ is refused", async () => {
			const seeded = await badPath();
			const tasks = join(seeded.changeDir, "tasks.md");
			expect(seeded.deltaPath).toBe(tasks);
			const bytes = seeded.readDelta();
			expect(bytes).not.toBeNull();
			const before = await untouched(seeded);
			const openspec = fakeOpenspec();
			try {
				const run = await seeded.build(["--amend"]);
				await expectRefused(seeded, run, 'amendment delta "tasks.md" is not specs/**/spec.md', before, openspec);
				expect(seeded.readDelta()).toEqual(bytes);
			} finally {
				openspec.restore();
			}
		}, 120_000);

		it.each(["../x/specs/a/spec.md", "/abs/specs/a/spec.md", "specs/a/notes.md"])("refuses the delta %s and creates nothing", async (delta) => {
			const seeded = await badPath({ amendment: { delta, text: "## ADDED Requirements\n" } });
			const before = await untouched(seeded);
			const outside = readdirSync(seeded.dir, { recursive: true, encoding: "utf8" }).sort();
			const openspec = fakeOpenspec();
			try {
				const run = await seeded.build(["--amend"]);
				await expectRefused(seeded, run, `amendment delta "${delta}" is not specs/**/spec.md`, before, openspec);
				expect(readdirSync(seeded.dir, { recursive: true, encoding: "utf8" }).sort()).toEqual(outside);
				expect(existsSync(join(seeded.changeDir, delta))).toBe(false);
				expect(existsSync(delta)).toBe(false);
			} finally {
				openspec.restore();
			}
		}, 120_000);
	});

	describe("--amend writes, validates, then resumes", () => {
		it("Scenario: A passing amendment resumes the task loop", async () => {
			const text = AMEND_SPEC.replace("stdout SHALL be the plan as JSON", "stdout SHALL be the plan as JSON, with keys sorted");
			const seeded = await planExportTask22({ amendment: { delta: "specs/plan/export/spec.md", text } });
			expect(seeded.readDelta()?.toString("utf8")).not.toBe(text);
			const answersBefore = await seeded.answers();
			const openspec = fakeOpenspec();
			try {
				// 2.2 again with the decision, then 3.1; passing group checks ask no judge.
				const run = await seeded.build(["--amend"], [verdict(true), verdict(true)]);

				expect(seeded.readDelta()?.toString("utf8")).toBe(text);

				// validate --all in the repo, then the trial fold in one temp copy of openspec/, all without telemetry.
				const calls = openspec.calls().filter((call) => !(call.args[0] === "validate" && call.args[1] === "add-plan-export"));
				expect(calls.map((call) => call.args.join(" "))).toEqual(["validate --all --strict", "archive add-plan-export --yes", "validate --specs --strict"]);
				for (const call of openspec.calls()) expect(call.telemetry).toBe("0");
				const repo = realpathSync(seeded.dir);
				expect(realpathSync(calls[0]!.cwd)).toBe(repo);
				expect(calls[1]!.cwd).toBe(calls[2]!.cwd);
				expect(calls[1]!.cwd.startsWith(repo)).toBe(false);
				expect(repo.startsWith(calls[1]!.cwd)).toBe(false);

				// The repository's change is not archived.
				expect(existsSync(seeded.changeDir)).toBe(true);
				expect(existsSync(join(seeded.dir, "openspec", "changes", "archive"))).toBe(false);

				const out = run.out;
				const amended = out.indexOf("amended openspec/changes/add-plan-export/specs/plan/export/spec.md");
				const validation = out.indexOf("## validation: passed", amended);
				const resumed = out.indexOf("resumed task 2.2 with decision: amendment-applied", validation);
				const converged = out.indexOf("# add-plan-export — built", resumed);
				expect(amended).toBeGreaterThan(-1);
				expect(validation).toBeGreaterThan(amended);
				expect(resumed).toBeGreaterThan(validation);
				expect(converged).toBeGreaterThan(resumed);

				// Task 2.2 was answered amendment-applied: group 2 reran it carrying the decision, and no judge took one.
				const answers = (await seeded.answers()).filter((answer) => !answersBefore.some((old) => old.loop === answer.loop));
				expect(answers.map(({ kind, group, task, decision }) => ({ kind, group, task, decision }))).toEqual([
					{ kind: "group", group: 2, task: undefined, decision: "amendment-applied" },
					{ kind: "task", group: undefined, task: "2.2", decision: "amendment-applied" },
				]);
				expect(await judgeDecisions(seeded.db)).toEqual([]);
				expect(run.code).toBe(0);
			} finally {
				openspec.restore();
			}
		}, 120_000);

		it("Scenario: A passing amendment resumes the group judge", async () => {
			const seeded = await csvImportGroup1();
			const text = AMEND_SPEC.replace("An export SHALL hold every step.", "An export SHALL hold every step, in order.");
			expect(seeded.readDelta()?.toString("utf8")).not.toBe(text);
			const answersBefore = await seeded.answers();
			const openspec = fakeOpenspec();
			try {
				// Groups 2 and 3 after the judge resumes: 2.1, 2.2, then 3.1.
				const run = await seeded.build(["--amend"], [verdict(true), verdict(true), verdict(true)]);

				expect(seeded.readDelta()?.toString("utf8")).toBe(text);
				const validateAll = openspec.calls().find((call) => call.args.join(" ") === "validate --all --strict");
				expect(validateAll?.telemetry).toBe("0");

				const out = run.out;
				const amended = out.indexOf("amended openspec/changes/add-csv-import/specs/plan/import/spec.md");
				const validation = out.indexOf("## validation: passed", amended);
				const resumed = out.indexOf("resumed group 1 judge with decision: amendment-applied", validation);
				expect(amended).toBeGreaterThan(-1);
				expect(validation).toBeGreaterThan(amended);
				expect(resumed).toBeGreaterThan(validation);

				// Group 1's judge took the decision (answerGroupEscalation); no task reran carrying it (answerEscalation).
				const answers = (await seeded.answers()).filter((answer) => !answersBefore.some((old) => old.loop === answer.loop));
				expect(answers.map(({ kind, group, decision }) => ({ kind, group, decision }))).toEqual([{ kind: "group", group: 1, decision: "amendment-applied" }]);
				expect(await judgeDecisions(seeded.db)).toEqual(["amendment-applied"]);
			} finally {
				openspec.restore();
			}
		}, 120_000);
	});

	describe("a failed --amend restores the delta", () => {
		it("Scenario: An error restores the uncommitted delta", async () => {
			const seeded = await planExportTask22({ onDisk: `${AMEND_SPEC}\n<!-- an uncommitted edit -->\n` });
			const bytes = seeded.readDelta()!;
			expect(bytes.toString("utf8")).toContain("<!-- an uncommitted edit -->");
			const loopsBefore = await seeded.changeLoops();
			const answersBefore = await seeded.answers();
			const openspec = fakeOpenspec({ replies: { validateAll: errorTooLong("add-plan-export") } });
			try {
				const run = await seeded.build(["--amend"]);

				const out = run.out;
				expect(out).toContain("## validation: failed");
				expect(out).toContain('[ERROR] requirement "Export writes JSON" is 534 characters (max 500)');
				expect(out).toContain("restored openspec/changes/add-plan-export/specs/plan/export/spec.md");
				expect(out).toContain("nothing resumed");

				// validate --all only: the trial fold never ran.
				const calls = openspec.calls().filter((call) => !(call.args[0] === "validate" && call.args[1] === "add-plan-export"));
				expect(calls.map((call) => call.args.join(" "))).toEqual(["validate --all --strict"]);

				expect(seeded.readDelta()!.equals(bytes)).toBe(true);

				expect(await seeded.answers()).toEqual(answersBefore);
				expect(await seeded.changeLoops()).toEqual(loopsBefore);
				expect(loopsBefore.at(-1)!.status).toBe("blocked");
				expect(run.calls).toBe(0);
				expect(run.code).toBe(2);
			} finally {
				openspec.restore();
			}
		}, 120_000);

		it("Scenario: A warning alone fails the validation", async () => {
			expect(LONG_REQUIREMENT).toHaveLength(534);
			const seeded = await planExportTask22({ amendment: { delta: "specs/plan/export/spec.md", text: MODIFIED_TOO_LONG } });
			const bytes = seeded.readDelta()!;
			const before = snapshotOpenspec(seeded.dir);
			const loopsBefore = await seeded.changeLoops();
			const answersBefore = await seeded.answers();
			// validate --all passes; the trial fold's archive passes and its validate --specs exits 0 with a warning.
			const openspec = fakeOpenspec({ replies: { validateAll: { exit: 0, stdout: "✓ change/add-plan-export\n" }, archive: { exit: 0 }, validateSpecs: warningOnly } });
			try {
				const run = await seeded.build(["--amend"]);

				const out = run.out;
				const validation = out.indexOf("## validation: failed");
				const warning = out.indexOf('[WARNING] requirement "Export writes JSON" is 534 characters; keep it under 500', validation);
				const restored = out.indexOf("restored openspec/changes/add-plan-export/specs/plan/export/spec.md", warning);
				const nothing = out.indexOf("nothing resumed", restored);
				expect(validation).toBeGreaterThan(-1);
				expect(warning).toBeGreaterThan(validation);
				expect(restored).toBeGreaterThan(warning);
				expect(nothing).toBeGreaterThan(restored);

				// The trial fold ran, without telemetry, in a copy outside the repository.
				const calls = openspec.calls().filter((call) => !(call.args[0] === "validate" && call.args[1] === "add-plan-export"));
				expect(calls.map((call) => call.args.join(" "))).toEqual(["validate --all --strict", "archive add-plan-export --yes", "validate --specs --strict"]);
				for (const call of openspec.calls()) expect(call.telemetry).toBe("0");
				const repo = realpathSync(seeded.dir);
				expect(calls[1]!.cwd).toBe(calls[2]!.cwd);
				expect(calls[1]!.cwd.startsWith(repo)).toBe(false);

				expect(seeded.readDelta()!.equals(bytes)).toBe(true);
				expect(snapshotOpenspec(seeded.dir)).toEqual(before);
				expect(existsSync(seeded.changeDir)).toBe(true);
				expect(existsSync(join(seeded.dir, "openspec", "changes", "archive"))).toBe(false);

				expect(await seeded.answers()).toEqual(answersBefore);
				expect(await seeded.changeLoops()).toEqual(loopsBefore);
				expect(run.calls).toBe(0);
				expect(run.code).toBe(2);
			} finally {
				openspec.restore();
			}
		}, 120_000);

		it("Scenario: A failed amendment that created a file deletes it", async () => {
			const seeded = await planExportTask22({ amendment: { delta: "specs/plan/new/spec.md", text: AMEND_SPEC } });
			expect(seeded.readDelta()).toBeNull();
			const created = join(seeded.changeDir, "specs", "plan", "new");
			expect(existsSync(created)).toBe(false);
			const before = snapshotOpenspec(seeded.dir);
			const tree = readdirSync(join(seeded.dir, "openspec"), { recursive: true, encoding: "utf8" }).sort();
			const loopsBefore = await seeded.changeLoops();
			const answersBefore = await seeded.answers();
			const openspec = fakeOpenspec({ replies: { validateAll: errorTooLong("add-plan-export") } });
			try {
				const run = await seeded.build(["--amend"]);

				expect(run.out).toContain("## validation: failed");
				expect(run.out).toContain("nothing resumed");

				// validate --all only: the trial fold never ran.
				const calls = openspec.calls().filter((call) => !(call.args[0] === "validate" && call.args[1] === "add-plan-export"));
				expect(calls.map((call) => call.args.join(" "))).toEqual(["validate --all --strict"]);

				// The file and the directory its write created are gone.
				expect(seeded.readDelta()).toBeNull();
				expect(existsSync(created)).toBe(false);
				expect(snapshotOpenspec(seeded.dir)).toEqual(before);
				expect(readdirSync(join(seeded.dir, "openspec"), { recursive: true, encoding: "utf8" }).sort()).toEqual(tree);

				expect(await seeded.answers()).toEqual(answersBefore);
				expect(await seeded.changeLoops()).toEqual(loopsBefore);
				expect(loopsBefore.at(-1)!.status).toBe("blocked");
				expect(run.calls).toBe(0);
				expect(run.code).toBe(2);
			} finally {
				openspec.restore();
			}
		}, 120_000);
	});
});
