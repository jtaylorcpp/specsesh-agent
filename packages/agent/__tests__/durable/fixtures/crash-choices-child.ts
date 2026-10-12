/**
 * Starts JUDGE with `choices` on a SQLite file and dies on the judge step's model request.
 *
 *   node --import ./ts-resolve.mjs crash-choices-child.ts <db-path>
 *
 * Prints the run's task ID first, then CRASH, and exits 137 with nothing answered.
 */

import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { startScript } from "../../../src/durable/index.js";
import { context, JUDGE, JUDGE_CHOICES, openHarness, setup } from "../helpers.js";

const dbPath = process.argv[2];
if (dbPath === undefined) throw new Error("usage: crash-choices-child.ts <db-path>");

const env = setup();
const harness = await openHarness(await openNodeSqliteStorage(dbPath), env, {
	onRequest: () => {
		process.stdout.write("CRASH\n");
		process.exit(137);
	},
});
const id = await startScript(harness, JUDGE, { entry: ["judge"], choices: JUDGE_CHOICES, model: env.model }, context);
process.stdout.write(`TASK ${id}\n`);
harness.resume();
await new Promise(() => {});
