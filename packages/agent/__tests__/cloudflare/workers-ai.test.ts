import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModels } from "@earendil-works/pi-ai";
import { createAI } from "agents/models/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { workersAI } from "../../src/cloudflare/workers-ai.js";
import type { AgentConfig, ModelFactory, Workspace } from "../../src/durable/index.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cloudflare");

// Checked by tsc (`pnpm check`): the entry's exports, without loading cloudflare:workers.
type Entry = typeof import("../../src/cloudflare/index.js");
const entryExportsWorkersAI: Entry["workersAI"] = workersAI;
type HostStillExported = Entry["AgentScriptHost"];
interface Env {
	AI: Ai;
}
declare const workspace: Workspace;
const factory: ModelFactory<Env> = (env) => workersAI(env.AI, "@cf/meta/llama-4-scout");
const config: AgentConfig<Env> = {
	models: { default: factory, reviewer: (env) => workersAI(env.AI, "@cf/qwen/qwen3-coder") },
	workspace: () => workspace,
};
void entryExportsWorkersAI;
void config;
void (null as unknown as HostStillExported);

function fakeBinding() {
	const run = vi.fn(async (..._args: unknown[]) => ({ response: "", usage: { prompt_tokens: 0, completion_tokens: 0 } }));
	return { binding: { run } as unknown as Ai, run };
}

describe("cloudflare/agent-host: The cloudflare entry exports defineAgentHost and workersAI", () => {
	it("workersAI is a ModelFactory result for the model ID, built without calling the binding", () => {
		const { binding, run } = fakeBinding();
		const choice = factory({ AI: binding });

		expect(choice.model).toEqual({ provider: "cloudflare", modelId: "@cf/meta/llama-4-scout" });
		expect(choice.provider.id).toBe("cloudflare");
		expect(run).not.toHaveBeenCalled();
	});

	it("each call builds a fresh provider", () => {
		const { binding } = fakeBinding();
		expect(workersAI(binding, "@cf/a").provider).not.toBe(workersAI(binding, "@cf/a").provider);
	});

	it("a generation goes to the binding's run with the model ID", async () => {
		const { binding, run } = fakeBinding();
		const choice = workersAI(binding, "@cf/meta/llama-4-scout");
		const models = createModels();
		models.setProvider(choice.provider);
		// The model object comes from another binding, so only workersAI's provider can reach `run`.
		const other = fakeBinding();
		const model = createAI({ binding: other.binding })(choice.model.modelId);
		await models.complete(model, { messages: [{ role: "user", content: "hi", timestamp: 0 }] });

		expect(other.run).not.toHaveBeenCalled();
		expect(run).toHaveBeenCalledOnce();
		expect(run.mock.calls[0]?.[0]).toBe("@cf/meta/llama-4-scout");
	});

	it("loads workers-ai.ts in plain Node, without importing cloudflare:workers", async () => {
		const loaded = await import("../../src/cloudflare/workers-ai.js");
		expect(typeof loaded.workersAI).toBe("function");
		const imports = [...readFileSync(join(SRC, "workers-ai.ts"), "utf8").matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
		expect(imports).toContain("agents/models/pi-ai");
		expect(imports).not.toContain("cloudflare:workers");
	});
});
