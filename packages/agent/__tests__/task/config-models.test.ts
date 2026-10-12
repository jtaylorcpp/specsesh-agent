// The config's named models and an agent grant's bundled script, through the CLI's own
// config loading and `buildHarness`. In process, on a faux provider registered as `anthropic`.

import { cpSync, existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { buildHarness } from "../../src/bin/agentscript-task.js";
import { READ_AGENT } from "../../src/durable/delegate-scripts.js";
import { loadConfig, resolveNamedModels } from "../../src/task/config.js";
import { cli, fauxModels, write } from "./cli-helpers.js";
import { cleanTemps, context, temp, tinyChange } from "./helpers.js";

afterEach(() => cleanTemps());

const REVIEWER = { provider: "anthropic", model: "claude-haiku-4-5" };

/** A root holding `agentscript.config.json` as given, `openspec/changes/fixture-live-task` and `packages/agent`. */
function configured(config: unknown) {
	const root = realpathSync(temp("task-models-"));
	writeFileSync(join(root, "agentscript.config.json"), JSON.stringify(config));
	cpSync(tinyChange(), join(root, "openspec", "changes", "fixture-live-task"), { recursive: true });
	write(root, { "packages/agent/.keep": "" });
	return { root, sub: join(root, "packages", "agent") };
}

/** The harness `run` builds from the config at `root`, on a faux `anthropic/claude-haiku-4-5`. */
async function harnessFor(root: string) {
	const env = fauxModels(REVIEWER.provider, REVIEWER.model);
	const model = env.faux.getModel();
	const config = loadConfig(root);
	const built = await buildHarness(
		new MemoryStorage(),
		{ provider: env.faux.provider, model: { provider: model.provider, modelId: model.id } },
		{ workspace: root, checks: [], allow: [], delegates: config.delegates },
		resolveNamedModels(config.models, env.models),
	);
	await built.harness.close(context);
	return { built, config, env };
}

describe("task/headless: The repo config may name more models", () => {
	it("Scenario: A named model reaches the harness", async () => {
		const { root } = configured({ models: { reviewer: REVIEWER } });
		const { built } = await harnessFor(root);
		expect(Object.keys(built.models)).toEqual(["default", "reviewer"]);
		expect(built.models["reviewer"]).toEqual({ provider: REVIEWER.provider, modelId: REVIEWER.model });
	});

	it("Scenario: Redefining default is refused", async () => {
		const { sub, root } = configured({ task: { db: "loops.sqlite" }, models: { default: { provider: "anthropic", model: "x" } } });
		const env = fauxModels(REVIEWER.provider, REVIEWER.model);
		const r = await cli(["run", "fixture-live-task", "1.1", ...env.args], env, { cwd: sub });
		expect(r.code).toBe(2);
		expect(r.err).toContain("default");
		expect(existsSync(join(root, "loops.sqlite"))).toBe(false);
		expect(env.faux.state.callCount).toBe(0);
	});
});

describe("task/headless: An agent grant's script is a bundled name or a path", () => {
	it("Scenario: A bundled delegate script by name", async () => {
		const { root } = configured({
			models: { reviewer: REVIEWER },
			delegates: { reader: { runner: "agent", model: "reviewer", script: "read" } },
		});
		const { built, config } = await harnessFor(root);
		expect(config.delegates["reader"]?.["script"]).toBe(READ_AGENT);
		expect([...built.actions.keys()]).toContain("delegate/reader");
	});
});
