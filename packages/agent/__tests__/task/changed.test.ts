// The `changed` seed: what a task loop changed since it started, measured from the baseline its
// first iteration takes, kept across resume and answers, and per task loop in a group.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage, type Storage, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { RESULT_TOOL, memoryWorkspace } from "../../src/durable/index.js";
import type { LoopOutcome, TaskOutcome } from "../../src/openspec/index.js";
import {
	answerEscalation,
	groupLoopExtensions,
	startGroupLoop,
	startTaskLoop,
	waitForGroupLoop,
	waitForTaskLoop,
	waitForTaskLoopResult,
} from "../../src/task/index.js";
import { gitRepo, write } from "./cli-helpers.js";
import {
	GROUP_JUDGE,
	JUDGE_ONLY,
	SCRIPTS,
	cleanTemps,
	context,
	loopEnv,
	loopHarness,
	plan,
	runLoop,
	runTasks,
	temp,
	text,
	writer,
	verdict,
} from "./helpers.js";
import { openHarness, setup } from "../durable/helpers.js";

afterEach(cleanTemps);

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_HOOK = join(HERE, "..", "durable", "fixtures", "ts-resolve.mjs");


/** The `changed` each task script's `agentscript.run` was seeded with, oldest first; `undefined` where none was. */
async function seededChanged(storage: Storage): Promise<(string | undefined)[]> {
	return (await runTasks(storage))
		.map((t) => (t.input as { options: { variables: Record<string, unknown> } }).options.variables)
		.filter((variables) => "task_id" in variables)
		.map((variables) => variables["changed"] as string | undefined);
}

/** A check that counts its calls in the file it is given and fails on the third. */
const COUNTING_CHECK = `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
const calls = (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0) + 1;
writeFileSync(file, String(calls));
process.exit(calls === 3 ? 1 : 0);
`;

/** A git repository holding the tiny change under `openspec/changes/tiny`. */
const repoChange = (repo: string) => join(repo, "openspec", "changes", "tiny");

describe("task/agent: A script that declares changed is seeded what changed since the loop started", () => {
	it("Scenario: A script without changed keeps the contract", async () => {
		const r = await runLoop([verdict(false, "not yet"), verdict(true)], { workspace: gitRepo() });
		const runs = await runTasks(r.storage);
		await r.harness.close(context);
		expect(r.outcome.status).toBe("converged");
		expect(runs).toHaveLength(2);
		for (const run of runs) expect((run.input as { options: { variables: Record<string, unknown> } }).options.variables).not.toHaveProperty("changed");
	});

	it("Scenario: A mistyped changed is refused", async () => {
		const { env, workspace } = loopEnv();
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		const script = JUDGE_ONLY.replace('    carried: mutable string = ""\n', '    carried: mutable string = ""\n    changed: mutable number = 0\n');
		const started = startTaskLoop(harness, { change: { dir: repoChange(gitRepo()) }, task: "1.1", script: { text: script }, workspace, model: env.model }, context);
		await expect(started).rejects.toThrow(/changed is declared number; the contract needs string/);
		expect((await storage.scanTasks({ kind: "agentscript.task-loop" }, 10, undefined, context)).items).toHaveLength(0);
		expect(env.requests).toHaveLength(0);
		await harness.close(context);
	});

	it("Scenario: The second iteration sees the first iteration's files", async () => {
		const repo = gitRepo();
		const r = await runLoop([verdict(false, "not yet"), verdict(true)], {
			change: { dir: repoChange(repo) },
			script: { text: writer([["src/b.ts", "src/a.ts"]]) },
			workspace: repo,
		});
		const changed = await seededChanged(r.storage);
		await r.harness.close(context);
		expect(r.outcome.status).toBe("converged");
		expect(changed).toEqual(["", "src/a.ts\nsrc/b.ts"]);
	});

	it("Scenario: Edits made before the loop started are not listed", async () => {
		const repo = gitRepo({ "src/old.ts": "old\n" });
		write(repo, { "src/old.ts": "edited before the loop\n" });
		const r = await runLoop([verdict(false, "not yet"), verdict(true)], {
			change: { dir: repoChange(repo) },
			script: { text: writer([["src/a.ts"]]) },
			workspace: repo,
		});
		const changed = await seededChanged(r.storage);
		await r.harness.close(context);
		expect(changed).toEqual(["", "src/a.ts"]);
	});
});

describe("task/agent: changed is measured from a baseline the loop keeps", () => {
	it("Scenario: The tick and excluded paths are not listed", async () => {
		const repo = gitRepo();
		const tasks = "openspec/changes/tiny/tasks.md";
		const r = await runLoop([verdict(false, "not yet"), verdict(false, "still not")], {
			change: { dir: repoChange(repo) },
			script: { text: writer([["src/a.ts", tasks, "runs.sqlite", "runs.sqlite-wal"]]) },
			workspace: repo,
			excludeChanged: ["runs.sqlite", "runs.sqlite-wal"],
			budget: { maxIterations: 2 },
		});
		const changed = await seededChanged(r.storage);
		await r.harness.close(context);
		expect(r.outcome.status).toBe("exhausted");
		expect(changed).toEqual(["", "src/a.ts"]);
	});

	it("Scenario: A workspace without snapshots seeds unknown", async () => {
		const workspace = memoryWorkspace();
		const r = await runLoop([verdict(true)], { script: { text: writer([]) }, workspace: workspace.root }, { workspace });
		const changed = await seededChanged(r.storage);
		await r.harness.close(context);
		expect(r.outcome.status).toBe("converged");
		expect(changed).toEqual(["(unknown)"]);
	});

	it("Scenario: A resumed loop measures from the loop's start", async () => {
		const repo = gitRepo();
		const db = join(temp("task-crash-"), "loops.sqlite");
		const script = join(temp("task-script-"), "writer.agent");
		write(dirname(script), { "writer.agent": writer([["src/a.ts"]]) });
		let out = "";
		let status: number | null = 0;
		try {
			out = execFileSync(
				process.execPath,
				["--import", TS_HOOK, join(HERE, "fixtures", "crash-changed-child.ts"), db, repoChange(repo), repo, script],
				{ encoding: "utf8", timeout: 60_000 },
			);
		} catch (error) {
			const e = error as { stdout?: string; status?: number | null };
			out = e.stdout ?? "";
			status = e.status ?? null;
		}
		expect(out).toContain("CRASH");
		expect(status).toBe(137);
		const id = Number(/LOOP (\d+)/.exec(out)?.[1]) as unknown as TaskId<LoopOutcome<TaskOutcome>>;

		const storage = await openNodeSqliteStorage(db);
		const stranded = await storage.scanTasks({ kind: "agentscript.task-loop" }, 10, undefined, context);
		// Killed after iteration 1's judge commit: parked at iterate, the baseline already stored.
		const checkpoint = (stranded.items[0]?.state as { checkpoint?: { phase: string; since?: unknown } }).checkpoint;
		expect(checkpoint?.phase).toBe("iterate");
		expect(checkpoint?.since).toEqual({});

		const { env } = loopEnv({ workspace: repo });
		env.faux.setResponses([verdict(true)]);
		const harness = await loopHarness(env, storage);
		harness.resume();
		const outcome = await waitForTaskLoop(harness, id, context);
		const changed = await seededChanged(storage);
		await harness.close(context);
		expect(outcome.status).toBe("converged");
		expect(changed).toEqual(["", "src/a.ts"]);
	}, 90_000);

	it("Scenario: An answered run measures from the blocked loop's start", async () => {
		const repo = gitRepo();
		const r = await runLoop([verdict(false, "two ways", "ask", "Which way?")], {
			change: { dir: repoChange(repo) },
			script: { text: writer([["src/a.ts"]]) },
			workspace: repo,
		});
		expect(r.outcome.status).toBe("blocked");
		if (r.outcome.status !== "blocked") throw new Error("not blocked");
		r.env.faux.setResponses([verdict(true)]);
		const next = await answerEscalation(r.harness, r.id, { escalation: r.outcome.escalation, by: "principal", decision: "the first way", feedback: [] }, context);
		const result = await waitForTaskLoopResult(r.harness, next, context);
		const changed = await seededChanged(r.storage);
		await r.harness.close(context);
		expect(result.outcome.status).toBe("converged");
		expect(changed).toEqual(["", "src/a.ts"]);
		expect(result.since).toEqual({});
	});
});

describe("task/agent: Each task loop of a group measures changed from its own start", () => {
	/** A group loop over the repo's tiny change, its task loops running `script`, its check `check`. */
	async function runGroup(repo: string, script: string, responses: Parameters<ReturnType<typeof setup>["faux"]["setResponses"]>[0], check: string) {
		const env = setup();
		for (const extension of groupLoopExtensions({ workspace: repo, checks: [check] })) env.registry.install(extension);
		const storage = new MemoryStorage();
		const harness = await openHarness(storage, env);
		env.faux.setResponses(responses);
		const id = await startGroupLoop(
			harness,
			{
				change: { dir: repoChange(repo) },
				group: 1,
				script: { text: script },
				groupScript: { text: GROUP_JUDGE },
				workspace: repo,
				checks: [check],
				model: env.model,
				excludeChanged: ["runs.sqlite"],
			},
			context,
		);
		harness.resume();
		const outcome = await waitForGroupLoop(harness, id, context);
		const loops = (await storage.scanTasks({ kind: "agentscript.task-loop" }, 10, undefined, context)).items;
		const changed = await seededChanged(storage);
		await harness.close(context);
		return { outcome, loops, changed };
	}

	it("Scenario: A later task does not see an earlier task's files", async () => {
		const repo = gitRepo();
		// Task 1.1's only iteration writes src/a.ts; 1.2's run is the next `agentscript.run`.
		const r = await runGroup(repo, writer([["src/a.ts"]]), [verdict(true), verdict(true)], "node --version");
		expect(r.outcome.status).toBe("converged");
		expect(r.loops.map((l) => (l.input as { task: string }).task)).toEqual(["1.1", "1.2"]);
		for (const loop of r.loops) expect((loop.input as { excludeChanged?: string[] }).excludeChanged).toEqual(["runs.sqlite"]);
		expect(r.changed).toEqual(["", ""]);
	});

	it("Scenario: A reworked task measures from its rerun", async () => {
		const repo = gitRepo();
		// Each task loop's gate runs the check once, then the group: it fails only on its third call,
		// the group's first check, so the judge reworks 1.1 once.
		const aux = temp("group-count-");
		write(aux, { "check.mjs": COUNTING_CHECK });
		const check = `${process.execPath} ${join(aux, "check.mjs")} ${join(aux, "calls")}`;
		const rework = fauxAssistantMessage(
			[fauxToolCall(RESULT_TOOL, { next_action: "rework", rework_task: "1.1", feedback: "again", question: "" })],
			{ stopReason: "toolUse" },
		);
		const r = await runGroup(repo, writer([["src/a.ts"]]), [verdict(true), verdict(true), rework, verdict(true)], check);
		expect(r.outcome.status).toBe("converged");
		expect(r.loops.map((l) => (l.input as { task: string }).task)).toEqual(["1.1", "1.2", "1.1"]);
		// The rework's first iteration rewrites src/a.ts, but measures from its own start.
		expect(r.changed).toEqual(["", "", ""]);
	});
});

describe("task/agent: A script can make passing checks sufficient", () => {
	it("Scenario: Passing checks converge a loop whose judge said unmet", async () => {
		const accept = `
subagent accept:
    description: "Passing checks are enough, without the model"

    reasoning:
        instructions: ->
            if @variables.checks_passed:
                set @variables.met = True
`;
		const script = readFileSync(join(SCRIPTS, "task.agent"), "utf8").trimEnd() + "\n" + accept;
		const repo = gitRepo();
		const r = await runLoop([plan("nothing to do"), text("nothing changed"), verdict(false, "the delegate changed nothing")], {
			change: { dir: repoChange(repo) },
			script: { text: script },
			workspace: repo,
			checks: ["node --version"],
			allow: ["node"],
			budget: { maxIterations: 1 },
		});
		await r.harness.close(context);
		expect(r.outcome.status).toBe("converged");
		if (r.outcome.status === "converged") expect(r.outcome.result.ticked).toBe(true);
		expect(readFileSync(join(repoChange(repo), "tasks.md"), "utf8")).toContain("- [x] 1.1 ");
	});
});
