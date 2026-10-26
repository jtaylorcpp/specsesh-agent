/**
 * Starts a task loop on `ollama/qwen3:8b` against its own fake Ollama server and dies mid-iteration.
 *
 * The loop runs JUDGE_ONLY over the change directory given. When iteration 1's child run makes
 * its first model request, the process exits with code 137 on the spot (no close, no flush),
 * leaving the loop checkpointed at `await` on that child. Prints the loop's ID first.
 *
 *   node --import ../../durable/fixtures/ts-resolve.mjs crash-ollama-loop-child.ts <db-path> <change-dir> <workspace>
 */

import { createModels, type Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { registerOllama } from "../../../src/pi/ollama.js";
import { startTaskLoop, taskLoopExtensions } from "../../../src/task/index.js";
import { startFakeOllama } from "../../pi/fake-ollama.js";
import { JUDGE_ONLY, context } from "../helpers.js";

const [dbPath, dir, workspace] = process.argv.slice(2);
if (dbPath === undefined || dir === undefined || workspace === undefined) {
	throw new Error("usage: crash-ollama-loop-child.ts <db-path> <change-dir> <workspace>");
}

const fake = await startFakeOllama({ models: ["qwen3:8b"] });
const models = createModels();
const registered = await registerOllama(models, { baseUrl: fake.url });
if (!registered.ok) throw new Error(`fake ollama: ${registered.reason}`);

const crashing = new Proxy(models, {
	get(target, prop, receiver) {
		const value = Reflect.get(target, prop, receiver);
		if (prop === "stream" || prop === "streamSimple") {
			return () => {
				process.stdout.write("CRASH\n");
				process.exit(137);
			};
		}
		return typeof value === "function" ? value.bind(target) : value;
	},
}) as Models;

const registry = createRegistry();
for (const extension of taskLoopExtensions({ workspace })) registry.install(extension);
const harness = await Harness.open(await openNodeSqliteStorage(dbPath), { models: crashing, registry }, context);
const id = await startTaskLoop(
	harness,
	{ change: { dir }, task: "1.1", script: { text: JUDGE_ONLY }, workspace, model: { provider: "ollama", modelId: "qwen3:8b" } },
	context,
);
process.stdout.write(`LOOP ${id}\n`);
harness.resume();
// Never resolves normally: the first model request ends the process.
await new Promise(() => {});
