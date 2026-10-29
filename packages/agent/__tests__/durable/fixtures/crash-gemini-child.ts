/**
 * Starts HELLO on `google/gemini-3.5-flash` against its own fake Gemini server and dies mid-run.
 *
 * Step 1 (greet) is answered. When step 2 (farewell) makes its model request, the process
 * exits with code 137 on the spot — no close, no flush. Prints the run's task ID first.
 *
 *   node --import ./ts-resolve.mjs crash-gemini-child.ts <db-path>
 */

import { type Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { AgentScript, AgentScriptStepExtension, startScript } from "../../../src/durable/index.js";
import { registerGemini } from "../../../src/pi/gemini.js";
import { startFakeGemini, textReply } from "../../pi/fake-gemini.js";
import { context, HELLO, HELLO_ENTRIES } from "../helpers.js";

const dbPath = process.argv[2];
if (dbPath === undefined) throw new Error("usage: crash-gemini-child.ts <db-path>");

// pi's google provider reads the key from the process at request time.
process.env.GEMINI_API_KEY = "test";
const fake = await startFakeGemini();
fake.reply(textReply("Hello, Ada."));
const models = builtinModels();
const registered = await registerGemini(models, { baseUrl: fake.url });
if (!registered.ok) throw new Error(`fake gemini: ${registered.reason}`);

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
const id = await startScript(harness, HELLO, { entry: HELLO_ENTRIES, model: { provider: "google", modelId: "gemini-3.5-flash" } }, context);
process.stdout.write(`TASK ${id}\n`);
harness.resume();
// Never resolves normally: the second model request ends the process.
await new Promise(() => {});
