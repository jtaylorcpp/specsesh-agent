import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fauxProvider } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { defaultCloudflareRunners } from "../../src/cloudflare/runners.js";
import { createAgentHarness, DelegateGrantError, memoryWorkspace, type AgentConfig } from "../../src/durable/index.js";
import { context } from "../durable/helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// `worker.ts` imports the public entries, so it checks against dist/ (built by the suite's global setup).
const HOST_FIXTURE = join(HERE, "fixtures", "agent-host", "tsconfig.json");
const TSC = createRequire(import.meta.url).resolve("typescript/bin/tsc");

describe("cloudflare/agent-host: defineAgentHost builds a Durable Object class from an AgentConfig", () => {
	it("Scenario: A host class is built from a config", () => {
		const tsc = spawnSync(process.execPath, [TSC, "--pretty", "false", "-p", HOST_FIXTURE], {
			cwd: dirname(HOST_FIXTURE),
			encoding: "utf8",
		});

		expect(tsc.stdout + tsc.stderr).toBe("");
		expect(tsc.status).toBe(0);
	}, 60_000);

	it("Scenario: A claude-code grant is refused on Cloudflare", async () => {
		expect(Object.keys(defaultCloudflareRunners())).toEqual(["agent"]);

		const faux = fauxProvider();
		const model = faux.getModel();
		const config: AgentConfig<{}> = {
			models: { default: () => ({ provider: faux.provider, model: { provider: model.provider, modelId: model.id } }) },
			workspace: () => memoryWorkspace(),
			delegates: { claude_code: { runner: "claude-code" } },
			runners: defaultCloudflareRunners(),
		};
		const built = createAgentHarness(config, { storage: new MemoryStorage(), env: {}, context });

		await expect(built).rejects.toBeInstanceOf(DelegateGrantError);
		await expect(built).rejects.toThrow(/claude-code.*agent/);
	});
});
