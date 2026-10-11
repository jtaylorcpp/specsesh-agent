/**
 * Starts a task loop on a SQLite file and dies mid-iteration.
 *
 * The loop runs JUDGE_ONLY over the change directory given. When iteration 1's
 * child run makes its first model request, the process exits on the spot (no
 * close, no flush), leaving the loop checkpointed at `await` on that child.
 * Prints the loop's ID first.
 *
 *   node --import ../../durable/fixtures/ts-resolve.mjs crash-loop-child.ts <db-path> <change-dir> <workspace>
 */

import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { startTaskLoop, taskLoopExtensions } from "../../../src/task/index.js";
import { context, openHarness, setup } from "../../durable/helpers.js";
import { JUDGE_ONLY } from "../helpers.js";

const [dbPath, dir, workspace] = process.argv.slice(2);
if (dbPath === undefined || dir === undefined || workspace === undefined) {
	throw new Error("usage: crash-loop-child.ts <db-path> <change-dir> <workspace>");
}

const env = setup();
for (const extension of taskLoopExtensions({ workspace })) env.registry.install(extension);
const harness = await openHarness(await openNodeSqliteStorage(dbPath), env, {
	onRequest: () => {
		process.stdout.write("CRASH\n");
		process.exit(137);
	},
});
const id = await startTaskLoop(
	harness,
	{ change: { dir }, task: "1.1", script: { text: JUDGE_ONLY }, workspace, model: env.model },
	context,
);
process.stdout.write(`LOOP ${id}\n`);
harness.resume();
// Never resolves normally: the first model request ends the process.
await new Promise(() => {});
