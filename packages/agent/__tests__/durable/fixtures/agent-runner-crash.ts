/**
 * Runs CALLER with a `reviewer` agent grant on a SQLite file, and dies right
 * after the commit that creates the reviewer's child run and stores its id in
 * the parent's `act` checkpoint, before the child settles. The child's model
 * never answers. Prints the parent's task ID first.
 *
 *   node --import ./ts-resolve.mjs agent-runner-crash.ts <db-path> <workspace>
 */

import type { Storage, StorageWrite } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { READ_AGENT, startScript } from "../../../src/durable/index.js";
import { CALLER, agentHarness, fauxModels } from "../agent-runner-scripts.js";
import { context } from "../helpers.js";

const [dbPath, workspace] = process.argv.slice(2) as [string, string];
if (workspace === undefined) throw new Error("usage: agent-runner-crash.ts <db-path> <workspace>");

/** The commit that checkpoints a run at `act` with its child stored. */
function storesChild(writes: readonly StorageWrite[]): boolean {
	return writes.some((write) => {
		if (write.type !== "task" || write.value.kind !== "agentscript.run") return false;
		const checkpoint = write.value.state.checkpoint as { phase?: string; child?: unknown } | undefined;
		return checkpoint?.phase === "act" && checkpoint.child !== undefined;
	});
}

/** The same storage, except that the process ends once that commit has landed. */
function dyingAfter(storage: Storage): Storage {
	return new Proxy(storage, {
		get(target, prop) {
			const value = Reflect.get(target, prop, target);
			if (prop === "commit") {
				return async (writes: readonly StorageWrite[], ctx: never) => {
					const committed = await target.commit(writes, ctx);
					if (storesChild(writes)) {
						process.stdout.write("CRASH\n");
						process.exit(137);
					}
					return committed;
				};
			}
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

const faux = fauxModels();
faux.script("opus", [() => new Promise(() => {})]);
const { harness, models } = await agentHarness(dyingAfter(await openNodeSqliteStorage(dbPath)), workspace, faux.models, {
	reviewer: { runner: "agent", model: "opus", script: READ_AGENT },
});
const id = await startScript(harness, CALLER, { model: models.default, variables: { instructions: "Review src/a.ts" } }, context);
process.stdout.write(`TASK ${id}\n`);
harness.resume();
await new Promise(() => {});
