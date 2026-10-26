/**
 * Starts HELLO on `ollama/qwen3:8b` against its own fake Ollama server and dies mid-run.
 *
 * Step 1 (greet) is answered. When step 2 (farewell) makes its model request, the process
 * exits with code 137 on the spot — no close, no flush. Prints the run's task ID first.
 *
 *   node --import ./ts-resolve.mjs crash-ollama-child.ts <db-path>
 */

import { createModels, type Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { AgentScript, AgentScriptStepExtension, startScript } from "../../../src/durable/index.js";
import { registerOllama } from "../../../src/pi/ollama.js";
import { startFakeOllama } from "../../pi/fake-ollama.js";
import { context, HELLO, HELLO_ENTRIES } from "../helpers.js";

const dbPath = process.argv[2];
if (dbPath === undefined) throw new Error("usage: crash-ollama-child.ts <db-path>");

const fake = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "Hello, Ada." } });
const models = createModels();
const registered = await registerOllama(models, { baseUrl: fake.url });
if (!registered.ok) throw new Error(`fake ollama: ${registered.reason}`);

let count = 0;
const crashing = new Proxy(models, {
	get(target, prop, receiver) {
		const value = Reflect.get(target, prop, receiver);
		if ((prop === "stream" || prop === "streamSimple") && typeof value === "function") {
			return (...args: unknown[]) => {
				count += 1;
				if (count === 2) {
					process.stdout.write("CRASH\n");
					process.exit(137);
				}
				return (value as (...a: unknown[]) => unknown).apply(target, args);
			};
		}
		return typeof value === "function" ? value.bind(target) : value;
	},
}) as Models;

const registry = createRegistry();
registry.install(AgentScript);
registry.install(AgentScriptStepExtension);
const harness = await Harness.open(await openNodeSqliteStorage(dbPath), { models: crashing, registry }, context);
const id = await startScript(harness, HELLO, { entry: HELLO_ENTRIES, model: { provider: "ollama", modelId: "qwen3:8b" } }, context);
process.stdout.write(`TASK ${id}\n`);
harness.resume();
// Never resolves normally: the second model request ends the process.
await new Promise(() => {});
