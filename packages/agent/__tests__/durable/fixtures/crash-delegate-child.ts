/**
 * Runs `delegateTwice({ pause: true })` with a `claude_code` grant of one call on a
 * SQLite file, and dies inside the safe `read_file` between the two delegate calls,
 * the way a killed process would. Prints the run's task ID first.
 *
 *   node --import ./ts-resolve.mjs crash-delegate-child.ts <db-path> <workspace> <fake-claude>
 */

import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { agentScriptExtensions, createActionRegistry, delegationActions, startScript } from "../../../src/durable/index.js";
import { localWorkspace } from "../../../src/node/index.js";
import { context, openHarness, setup } from "../helpers.js";
import { hostAction } from "../action-scripts.js";
import { delegateTwice, fakeClaudeRunner } from "../delegation-scripts.js";

const [dbPath, workspace, binary] = process.argv.slice(2) as [string, string, string];
if (binary === undefined) throw new Error("usage: crash-delegate-child.ts <db-path> <workspace> <fake-claude>");

const dying = hostAction("read_file", async () => {
	process.stdout.write("CRASH\n");
	process.exit(137);
});
const delegates = delegationActions(
	{ claude_code: { runner: "fake", maxCalls: 1 } },
	{ workspace: localWorkspace(workspace), runners: { fake: fakeClaudeRunner(binary) } },
);
const env = setup();
const installed = agentScriptExtensions({ actions: createActionRegistry([dying, ...delegates]), workspace });
env.registry.install(installed.run);
env.registry.install(installed.step);

const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
const id = await startScript(harness, delegateTwice({ pause: true }), { model: env.model }, context);
process.stdout.write(`TASK ${id}\n`);
harness.resume();
await new Promise(() => {});
