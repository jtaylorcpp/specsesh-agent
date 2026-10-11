/**
 * Starts a group loop on a SQLite file and blocks forever inside task 1.2.
 *
 * Task 1.1 converges on its first iteration. Task 1.2's first model request writes
 * `<gate>/in-1.2` and never answers, so the parent test can SIGKILL this process with the
 * group parked in its `task` phase. Prints `LOOP <id>` once the group loop exists.
 *
 *   node --import ../../durable/fixtures/ts-resolve.mjs group-crash-runner.ts <db-path> <workspace> <gate-dir> <change-dir>
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { groupLoopExtensions, startGroupLoop, waitForGroupLoop } from "../../../src/task/index.js";
import { context, openHarness, setup } from "../../durable/helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, verdict } from "../helpers.js";

const [dbPath, workspace, gate, dir] = process.argv.slice(2);
if (dbPath === undefined || workspace === undefined || gate === undefined || dir === undefined) {
	throw new Error("usage: group-crash-runner.ts <db-path> <workspace> <gate-dir> <change-dir>");
}

const checks = ["node -e process.exit(0)"];
const env = setup();
for (const extension of groupLoopExtensions({ workspace, checks })) env.registry.install(extension);
const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);

const block = (): Promise<never> => {
	writeFileSync(join(gate, "in-1.2"), "");
	// Poll for a file that is never created: the live interval keeps the event loop busy.
	return new Promise<never>(() => {
		setInterval(() => {
			if (existsSync(join(gate, "never"))) process.exit(0);
		}, 50);
	});
};
env.faux.setResponses([verdict(true), block]);

const id = await startGroupLoop(
	harness,
	{ change: { dir }, group: 1, script: { text: JUDGE_ONLY }, groupScript: { text: GROUP_JUDGE }, workspace, checks, model: env.model },
	context,
);
process.stdout.write(`LOOP ${id}\n`);
harness.resume();
await waitForGroupLoop(harness, id, context);
