/**
 * Starts a task loop on a SQLite file and dies at the gate.
 *
 * The judge answers met on iteration 1, so the loop checkpoints at `gate` and runs its one
 * check. On its first run the check kills this process with SIGKILL (no close, no flush); the
 * marker file it leaves in the workspace makes every later run of the check exit 0.
 * Prints the loop's ID first.
 *
 *   node --import ../../durable/fixtures/ts-resolve.mjs crash-gate-child.ts <db-path> <change-dir> <workspace>
 */

import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { startTaskLoop, taskLoopExtensions } from "../../../src/task/index.js";
import { context, openHarness, setup } from "../../durable/helpers.js";
import { JUDGE_ONLY, verdict } from "../helpers.js";

const [dbPath, dir, workspace] = process.argv.slice(2);
if (dbPath === undefined || dir === undefined || workspace === undefined) {
	throw new Error("usage: crash-gate-child.ts <db-path> <change-dir> <workspace>");
}

/** A command is split on whitespace with no shell, so this has none. */
const KILL_ONCE =
	"node -e require('fs').existsSync('marker')||(require('fs').writeFileSync('marker',''),process.kill(process.ppid,9))";

const env = setup();
for (const extension of taskLoopExtensions({ workspace })) env.registry.install(extension);
env.faux.setResponses([verdict(true)]);
const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
const id = await startTaskLoop(
	harness,
	{ change: { dir }, task: "1.1", script: { text: JUDGE_ONLY }, workspace, checks: [KILL_ONCE], model: env.model },
	context,
);
process.stdout.write(`LOOP ${id}\n`);
harness.resume();
// Never resolves normally: the gate's check ends the process.
await new Promise(() => {});
