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
import { AMEND_SPEC, OPENSPEC_BIN, badPath, fakeOpenspec, noAmendment, planExportTask22, snapshotOpenspec } from "./helpers.js";

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
				// The scenario says `— converged`; a converged change loop's state is printed `built` (see cli-answer.test.ts).
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
	});
});
