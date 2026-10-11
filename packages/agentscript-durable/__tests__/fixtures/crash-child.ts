/**
 * Starts PIPELINE on a SQLite file and dies mid-run.
 *
 * Step 1 (classify) is answered. When step 2 (respond) makes its model request,
 * the process exits on the spot — no close, no flush — the way an evicted Durable
 * Object or a killed Node process would. Prints the run's task ID first.
 *
 *   tsx crash-child.ts <db-path> [crash-at-request=2]
 *
 * With crash-at-request=1 it dies on step 1's request, before anything is answered.
 */

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { RESULT_TOOL, startScript } from "../../src/index.js";
import { context, ENTRIES, openHarness, PIPELINE, setup } from "../helpers.js";

const dbPath = process.argv[2];
if (dbPath === undefined) throw new Error("usage: crash-child.ts <db-path> [crash-at-request]");
const crashAt = Number(process.argv[3] ?? "2");

const env = setup();
env.faux.setResponses([fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "high" })], { stopReason: "toolUse" })]);

const harness = await openHarness(await openNodeSqliteStorage(dbPath), env, {
	onRequest: (count) => {
		if (count === crashAt) {
			process.stdout.write("CRASH\n");
			process.exit(137);
		}
	},
});
const id = await startScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
process.stdout.write(`TASK ${id}\n`);
harness.resume();
// Never resolves normally: the second model request ends the process.
await new Promise(() => {});
