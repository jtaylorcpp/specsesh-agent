/**
 * Starts THINK_THEN_CHECK with `delegatePreamble` "P" and dies on its first model
 * request, before the durable `run_checks` is called. Prints the run's task ID first.
 *
 *   node --import ./ts-resolve.mjs crash-preamble-child.ts <db-path> <workspace>
 */

import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { AgentScriptRun, agentScriptExtensions, createActionRegistry } from "../../../src/durable/index.js";
import { context, openHarness, setup } from "../helpers.js";
import { durableChecks, hostAction, THINK_THEN_CHECK } from "../action-scripts.js";

const [dbPath, workspace] = process.argv.slice(2) as [string, string];
if (dbPath === undefined || workspace === undefined) throw new Error("usage: crash-preamble-child.ts <db-path> <workspace>");

const shell = hostAction("run_command", async () => ({ ok: true, outputs: { exit_code: 0, output: "" } }));
const env = setup();
const installed = agentScriptExtensions({ actions: createActionRegistry([durableChecks().action, shell]), workspace });
env.registry.install(installed.run);
env.registry.install(installed.step);

const harness = await openHarness(await openNodeSqliteStorage(dbPath), env, {
	onRequest: () => {
		process.stdout.write("CRASH\n");
		process.exit(137);
	},
});
const task = installed.run.tasks?.find((t) => t.definition.name === AgentScriptRun.definition.name) as typeof AgentScriptRun;
const root = await harness.root(context);
const id = await root.commit(
	(tx) =>
		tx.createTask(
			task,
			{ source: THINK_THEN_CHECK, options: { entry: ["think", "act"] }, model: env.model, delegatePreamble: "P" },
			{ ownership: { kind: "conversation" } },
		),
	context,
);
process.stdout.write(`TASK ${id}\n`);
harness.resume();
await new Promise(() => {});
