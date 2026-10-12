/**
 * Starts a run whose one `run` calls the durable `run_checks`, and dies inside
 * the child run's own `run_command`: after the parent committed the child's id,
 * before the child settled. Prints the parent's task ID first.
 *
 *   node --import ./ts-resolve.mjs crash-durable-act-child.ts <db-path> <workspace>
 */

import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { agentScriptExtensions, createActionRegistry, startScript } from "../../../src/durable/index.js";
import { context, openHarness, setup } from "../helpers.js";
import { deterministicScript, durableChecks, hostAction } from "../action-scripts.js";

const [dbPath, workspace] = process.argv.slice(2) as [string, string];
if (dbPath === undefined) throw new Error("usage: crash-durable-act-child.ts <db-path> [workspace]");

const dying = hostAction("run_command", async () => {
	process.stdout.write("CRASH\n");
	process.exit(137);
});
const env = setup();
const installed = agentScriptExtensions({
	actions: createActionRegistry([durableChecks().action, dying]),
	workspace: workspace ?? process.cwd(),
});
env.registry.install(installed.run);
env.registry.install(installed.step);

const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
const id = await startScript(harness, deterministicScript("run_checks"), { model: env.model }, context);
process.stdout.write(`TASK ${id}\n`);
harness.resume();
await new Promise(() => {});
