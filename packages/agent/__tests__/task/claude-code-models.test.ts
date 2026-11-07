// The task CLI runs a loop on any claude-code model id (#50), its own and the config's named
// models alike, where an id the provider doesn't list was refused as unknown.

import { cpSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import type { Runner } from "../../src/claude-code/claude-code.js";
import { claudeCodeProvider } from "../../src/claude-code/claude-code-provider.js";
import { cli, fauxModels } from "./cli-helpers.js";
import { cleanTemps, temp, tinyChange } from "./helpers.js";

afterEach(() => cleanTemps());

/** The cli() environment over a claude-code provider whose `claude` records its --model and fails. */
function claudeCodeEnv(modelId: string) {
	const seen: string[] = [];
	const runner = (): Runner => async (args) => {
		seen.push(args[args.indexOf("--model") + 1]!);
		return { code: 1, stdout: JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "stop here" }), stderr: "" };
	};
	const models = createModels();
	models.setProvider(claudeCodeProvider({ runner }));
	return { env: { ...fauxModels(), models, args: ["--provider", "claude-code", "--model", modelId] }, seen };
}

function configured(extra: Record<string, unknown> = {}) {
	const root = realpathSync(temp("task-cc-models-"));
	writeFileSync(join(root, "agentscript.config.json"), JSON.stringify({ task: { checks: ["node --version"], allow: ["node"] }, ...extra }));
	cpSync(tinyChange(), join(root, "openspec", "changes", "tiny"), { recursive: true });
	return root;
}

describe("task/cli: a claude-code model the provider doesn't list", () => {
	it("runs the loop on it instead of refusing it as unknown", async () => {
		const { env, seen } = claudeCodeEnv("claude-sonnet-4-5");
		const r = await cli(["run", "tiny", "1.1", "--db", "loops.sqlite", "--script", "task", ...env.args], env, { cwd: configured() });
		expect(r.err).not.toContain("no model");
		// The fake claude fails the first step, so the loop ends failed, not refused.
		expect(r.code, r.err).toBe(1);
		expect(seen[0]).toBe("claude-sonnet-4-5");
	});

	it("accepts one as a named model of the config", async () => {
		const { env } = claudeCodeEnv("claude-haiku-4-5");
		const root = configured({ models: { reviewer: { provider: "claude-code", model: "claude-opus-4-1" } } });
		const r = await cli(["run", "tiny", "1.1", "--db", "loops.sqlite", "--script", "task", ...env.args], env, { cwd: root });
		expect(r.err).not.toContain("claude-opus-4-1");
		expect(r.code, r.err).toBe(1);
	});
});
