/**
 * Starts a change loop on a SQLite file and blocks forever, to be killed by the parent test.
 *
 * `group` (the default): group 1's task converges on its first iteration. Task 2.1's first model
 * request writes `<gate>/in-2.1` and never answers, so the parent test can SIGKILL this process
 * with the change parked in its `group` phase on group 2.
 *
 * `fold`: both tasks converge, and the process blocks wherever the `openspec` first on PATH does
 * during the change check's trial fold (the parent puts a fake there). `checks` replaces the default
 * check command. Either way, prints `LOOP <id>` once the change loop exists.
 *
 *   node --import ../../durable/fixtures/ts-resolve.mjs change-crash-runner.ts <db-path> <workspace> <gate-dir> <change-dir> [group|fold] [checks]
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { changeLoopExtensions, startChangeLoop, waitForChangeLoop } from "../../../src/task/index.js";
import { context, openHarness, setup } from "../../durable/helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, verdict } from "../helpers.js";

const [dbPath, workspace, gate, dir, mode = "group", check = "node -e process.exit(0)"] = process.argv.slice(2);
if (dbPath === undefined || workspace === undefined || gate === undefined || dir === undefined) {
	throw new Error("usage: change-crash-runner.ts <db-path> <workspace> <gate-dir> <change-dir> [group|fold] [checks]");
}

const checks = [check];
const env = setup();
for (const extension of changeLoopExtensions({ workspace, checks })) env.registry.install(extension);
const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);

const block = (): Promise<never> => {
	writeFileSync(join(gate, "in-2.1"), "");
	// Poll for a file that is never created: the live interval keeps the event loop busy.
	return new Promise<never>(() => {
		setInterval(() => {
			if (existsSync(join(gate, "never"))) process.exit(0);
		}, 50);
	});
};
env.faux.setResponses(mode === "fold" ? [verdict(true), verdict(true)] : [verdict(true), block]);

const id = await startChangeLoop(
	harness,
	{ change: { dir }, script: { text: JUDGE_ONLY }, groupScript: { text: GROUP_JUDGE }, workspace, checks, model: env.model },
	context,
);
process.stdout.write(`LOOP ${id}\n`);
harness.resume();
await waitForChangeLoop(harness, id, context);
