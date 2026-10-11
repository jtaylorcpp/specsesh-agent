/**
 * Starts a one-action deterministic script on a SQLite file and dies inside the
 * action's executor, after the act phase recorded its intent — the way a killed
 * process would. Prints the run's task ID first.
 *
 *   node --import ./ts-resolve.mjs crash-act-child.ts <db-path> <run_checks|run_command|edit_file>
 */

import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { agentScriptExtensions, createActionRegistry, startScript } from "../../../src/durable/index.js";
import { context, openHarness, setup } from "../helpers.js";
import { deterministicScript, hostAction, type ActionName } from "../action-scripts.js";

const [dbPath, name, workspace] = process.argv.slice(2) as [string, "run_checks" | "run_command" | "edit_file", string];
if (dbPath === undefined || name === undefined) throw new Error("usage: crash-act-child.ts <db-path> <action> [workspace]");

const dying = hostAction(name as ActionName, async () => {
	process.stdout.write("CRASH\n");
	process.exit(137);
});
const env = setup();
const installed = agentScriptExtensions({ actions: createActionRegistry([dying]), workspace: workspace ?? process.cwd() });
env.registry.install(installed.run);
env.registry.install(installed.step);

const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
const id = await startScript(harness, deterministicScript(name), { model: env.model }, context);
process.stdout.write(`TASK ${id}\n`);
harness.resume();
await new Promise(() => {});
