/**
 * Starts a task loop on a SQLite file and dies between iterations.
 *
 * The loop runs the script file given over the change directory, its first judge answering
 * unmet. When the loop's iterate phase is about to start iteration 2 (iteration 1's judge
 * committed, no second run created), the process exits on the spot, leaving the loop
 * checkpointed at `iterate`. Prints the loop's ID first.
 *
 *   node --import ../../durable/fixtures/ts-resolve.mjs crash-changed-child.ts <db-path> <change-dir> <workspace> <script>
 */

import { defineExtension, defineTask } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { TASK_LOOP, TaskLoopTask, startTaskLoop, taskLoopExtensions, type LoopCheckpoint, type TaskLoopInput, type TaskLoopResult } from "../../../src/task/index.js";
import { context, openHarness, setup } from "../../durable/helpers.js";
import { verdict } from "../helpers.js";

const [dbPath, dir, workspace, script] = process.argv.slice(2);
if (dbPath === undefined || dir === undefined || workspace === undefined || script === undefined) {
	throw new Error("usage: crash-changed-child.ts <db-path> <change-dir> <workspace> <script>");
}

const definition = TaskLoopTask.definition;
const crashing = defineTask<TaskLoopInput, LoopCheckpoint, TaskLoopResult>({
	...definition,
	phases: {
		...definition.phases,
		iterate: async (task, runtime, ctx) => {
			if (task.state.checkpoint.iterations.length >= 1) {
				process.stdout.write("CRASH\n");
				process.exit(137);
			}
			return definition.phases.iterate(task, runtime, ctx);
		},
	},
});

const env = setup();
const [, run, step] = taskLoopExtensions({ workspace });
for (const extension of [defineExtension({ name: TASK_LOOP, tasks: [crashing] }), run, step]) env.registry.install(extension);
env.faux.setResponses([verdict(false, "not yet")]);
const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
const id = await startTaskLoop(harness, { change: { dir }, task: "1.1", script: { path: script }, workspace, model: env.model }, context);
process.stdout.write(`LOOP ${id}\n`);
harness.resume();
// Never resolves normally: iteration 2's iterate phase ends the process.
await new Promise(() => {});
