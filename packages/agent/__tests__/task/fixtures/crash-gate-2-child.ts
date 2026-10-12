/**
 * Starts a task loop on a SQLite file and dies at the gate of iteration 2.
 *
 * The judge answers retry, then met, so the loop checkpoints at `gate` for iteration 2. The
 * commit that writes that checkpoint is followed by SIGKILL (no close, no flush), before the
 * gate runs its one check. That check appends a line to `count.txt` in the workspace, so the
 * file counts the rounds of checks that ran. Prints the loop's ID first.
 *
 *   node --import ../../durable/fixtures/ts-resolve.mjs crash-gate-2-child.ts <db-path> <change-dir> <workspace>
 */

import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { startTaskLoop, taskLoopExtensions } from "../../../src/task/index.js";
import { context, openHarness, setup } from "../../durable/helpers.js";
import { COUNT_CHECK, JUDGE_ONLY, verdict } from "../helpers.js";

const [dbPath, dir, workspace] = process.argv.slice(2);
if (dbPath === undefined || dir === undefined || workspace === undefined) {
	throw new Error("usage: crash-gate-2-child.ts <db-path> <change-dir> <workspace>");
}

const env = setup();
for (const extension of taskLoopExtensions({ workspace })) env.registry.install(extension);
env.faux.setResponses([verdict(false, "not yet", "retry"), verdict(true)]);

const storage = await openNodeSqliteStorage(dbPath);
const commit = storage.commit.bind(storage);
storage.commit = async (writes, ctx) => {
	const result = await commit(writes, ctx);
	const atGate = writes.some((w) => {
		if (w.type !== "task" || w.value.kind !== "agentscript.task-loop") return false;
		const checkpoint = (w.value.state as { checkpoint?: { phase: string; iterations: unknown[] } }).checkpoint;
		return checkpoint?.phase === "gate" && checkpoint.iterations.length === 1;
	});
	if (atGate) process.kill(process.pid, 9);
	return result;
};

const harness = await openHarness(storage, env);
const id = await startTaskLoop(
	harness,
	{ change: { dir }, task: "1.1", script: { text: JUDGE_ONLY }, workspace, checks: [COUNT_CHECK], model: env.model },
	context,
);
process.stdout.write(`LOOP ${id}\n`);
harness.resume();
// Never resolves normally: the commit of the gate checkpoint ends the process.
await new Promise(() => {});
