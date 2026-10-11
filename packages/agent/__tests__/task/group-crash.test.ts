import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonObject, TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { GroupOutcome, LoopOutcome, check } from "../../src/openspec/index.js";
import { TASK_LOOP, groupLoopExtensions, waitForGroupLoop } from "../../src/task/index.js";
import { GROUP_LOOP_NAME, decodeCheckpoint } from "../../src/task/group.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context, temp, tinyChange, verdict } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_HOOK = join(HERE, "..", "durable", "fixtures", "ts-resolve.mjs");
const RUNNER = join(HERE, "fixtures", "group-crash-runner.ts");

let runner: ChildProcess | undefined;
afterEach(() => {
	if (runner?.pid !== undefined) {
		try {
			process.kill(-runner.pid, "SIGKILL");
		} catch {
			// already gone
		}
	}
	runner = undefined;
	cleanTemps();
});

async function until(done: () => boolean, ms: number, what: string): Promise<void> {
	const deadline = Date.now() + ms;
	while (!done()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 50));
	}
}

describe("task/group: A group loop survives its process dying", () => {
	it("Scenario: Killed during a task", async () => {
		const workspace = temp("group-crash-ws-");
		const gate = temp("group-crash-gate-");
		const db = join(temp("group-crash-db-"), "loops.sqlite");
		const dir = join(workspace, "change");
		mkdirSync(dir);
		cpSync(tinyChange(), dir, { recursive: true });

		// Phase 1: a child process runs 1.1, then parks inside 1.2 until it is killed.
		let out = "";
		runner = spawn(process.execPath, ["--import", TS_HOOK, RUNNER, db, workspace, gate, dir], {
			detached: true,
			stdio: ["ignore", "pipe", "inherit"],
		});
		runner.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
		});
		const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
			runner!.once("exit", (code, signal) => resolve({ code, signal })),
		);
		const early = exited.then((e) => {
			throw new Error(`runner exited before task 1.2 started: ${JSON.stringify(e)}\n${out}`);
		});
		early.catch(() => undefined);
		await Promise.race([until(() => existsSync(join(gate, "in-1.2")), 60_000, "task 1.2 to start"), early]);
		expect(runner.exitCode === null && runner.signalCode === null).toBe(true);
		process.kill(-runner.pid!, "SIGKILL");
		expect(await exited).toEqual({ code: null, signal: "SIGKILL" });

		const id = Number(/LOOP (\d+)/.exec(out)?.[1]) as TaskId<never>;
		expect(Number.isInteger(id)).toBe(true);

		// The group was parked in its task phase on 1.2, child recorded before the kill.
		const storage = await openNodeSqliteStorage(db);
		const scan = async (kind: string) => (await storage.scanTasks({ kind }, 50, undefined, context)).items;
		const [group] = await scan(GROUP_LOOP_NAME);
		const parked = decodeCheckpoint((group?.state as unknown as { checkpoint: JsonObject }).checkpoint);
		expect(parked.phase).toBe("task");
		expect(parked.child?.task).toBe("1.2");
		const childId = parked.child?.id;
		expect(childId).toBeDefined();
		expect(await scan(GROUP_LOOP_NAME)).toHaveLength(1);
		const before = (await scan(TASK_LOOP)).map((t) => (t.input as unknown as { task: string }).task).sort();
		expect(before).toEqual(["1.1", "1.2"]);

		// Phase 2: a fresh harness on the same file; 1.2 now converges.
		const env = setup();
		for (const extension of groupLoopExtensions({ workspace, checks: ["node -e process.exit(0)"] })) env.registry.install(extension);
		env.faux.setResponses([verdict(true)]);
		const harness = await openHarness(storage, env);
		harness.resume();
		try {
			const outcome = await waitForGroupLoop(harness, id as never, context);

			expect(outcome.status).toBe("converged");
			expect(outcome.result?.tasks.map((t) => ({ task: t.task, runs: t.runs }))).toEqual([
				{ task: "1.1", runs: 1 },
				{ task: "1.2", runs: 1 },
			]);

			const children = (await scan(TASK_LOOP)).map((t) => ({ id: t.id, task: (t.input as unknown as { task: string }).task }));
			expect(children.filter((c) => c.task === "1.1")).toHaveLength(1);
			expect(children.filter((c) => c.task === "1.2")).toEqual([{ id: childId, task: "1.2" }]);

			expect(check(LoopOutcome(GroupOutcome), outcome)).toBe(true);
			const tasksMd = readFileSync(join(dir, "tasks.md"), "utf8");
			expect(tasksMd).toContain("- [x] 1.1 ");
			expect(tasksMd).toContain("- [x] 1.2 ");
		} finally {
			await harness.close(context).catch(() => undefined);
		}
	}, 120_000);
});
