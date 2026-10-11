/**
 * Hello world on @specsesh/agent.
 *
 *   pnpm --filter hello-world-example start [name]
 *
 * Runs hello.agent as a durable pi-durable task stored in hello.sqlite, on Claude
 * Haiku through your own `claude` binary (your subscription). Set
 * AGENTSCRIPT_PROVIDER=anthropic with ANTHROPIC_API_KEY to use the API instead.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { AgentScript, AgentScriptStepExtension, runScript } from "@specsesh/agent/durable";

const here = dirname(fileURLToPath(import.meta.url));
const context = BACKGROUND_CONTEXT;
const name = process.argv[2] ?? "World";

const useApi = process.env.AGENTSCRIPT_PROVIDER === "anthropic";
const models = createModels();
models.setProvider(useApi ? anthropicProvider() : claudeCodeProvider());
const model = { provider: useApi ? "anthropic" : "claude-code", modelId: "claude-haiku-4-5" };

const registry = createRegistry();
registry.install(AgentScript);
registry.install(AgentScriptStepExtension);
const harness = await Harness.open(await openNodeSqliteStorage(join(here, "hello.sqlite")), { models, registry }, context);

const started = Date.now();
const result = await runScript(
	harness,
	readFileSync(join(here, "hello.agent"), "utf8"),
	{ model, entry: ["greet", "decide", "sign_off"], variables: { name } },
	context,
);
await harness.close(context);

console.log(`${model.provider}/${model.modelId} — ${result.kind} in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
console.log(result.variables.greeting);
const signOff = result.steps.at(-1)?.outcome;
if (signOff?.kind === "answered") console.log(signOff.text);
if (result.kind !== "completed") {
	for (const step of result.steps) if (step.outcome.kind === "failed") console.error(`${step.subagent}: ${step.outcome.message}`);
	process.exitCode = 1;
}
console.log(`\nvariables: ${JSON.stringify(result.variables)}`);
