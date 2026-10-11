/**
 * Starts PIPELINE on a SQLite file and dies inside one named commit.
 *
 * The process exits (no close, no flush) just before the storage applies the commit, so
 * that commit is lost exactly as it would be if the process were killed while writing it.
 * Prints the run's task ID first.
 *
 *   tsx crash-on-commit-child.ts <db-path> <dispatch|answered>
 *
 *   dispatch   the commit that creates step 0's conversation and checkpoints `await`
 *   answered   the commit that folds step 0's answer in and checkpoints `next`; the
 *              model has already answered by then
 */

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { Storage, StorageWrite } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { RESULT_TOOL, startScript } from "../../src/index.js";
import { context, ENTRIES, openHarness, PIPELINE, setup } from "../helpers.js";

const dbPath = process.argv[2];
const mode = process.argv[3];
if (dbPath === undefined || (mode !== "dispatch" && mode !== "answered")) {
	throw new Error("usage: crash-on-commit-child.ts <db-path> <dispatch|answered>");
}

function isTheCommit(writes: readonly StorageWrite[]): boolean {
	return writes.some((write) => {
		if (mode === "dispatch") return write.type === "conversation" && write.value.owner?.taskId !== undefined;
		if (write.type !== "task" || write.value.kind !== "agentscript.run") return false;
		const checkpoint = write.value.state.checkpoint as { phase?: string; state?: { steps?: unknown[] } } | undefined;
		return checkpoint?.phase === "next" && checkpoint.state?.steps?.length === 1;
	});
}

/** The same storage, except that the chosen commit ends the process instead of landing. */
function dyingOn(storage: Storage): Storage {
	return new Proxy(storage, {
		get(target, prop) {
			const value = Reflect.get(target, prop, target);
			if (prop === "commit") {
				return (writes: readonly StorageWrite[], ctx: never) => {
					if (isTheCommit(writes)) {
						process.stdout.write("CRASH\n");
						process.exit(137);
					}
					return target.commit(writes, ctx);
				};
			}
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

const env = setup();
env.faux.setResponses([fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "high" })], { stopReason: "toolUse" })]);

const harness = await openHarness(dyingOn(await openNodeSqliteStorage(dbPath)), env);
const id = await startScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
process.stdout.write(`TASK ${id}\n`);
harness.resume();
await new Promise(() => {});
