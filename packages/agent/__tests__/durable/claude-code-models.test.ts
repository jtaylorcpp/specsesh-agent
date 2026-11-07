// The claude-code provider serves any model id a run names (#50), not only the four it lists, so
// `--provider claude-code --model claude-sonnet-4-5` runs; `claude --model` judges the id.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { main as durableMain } from "../../src/bin/agentscript-durable.js";
import { withClaudeCode } from "../../src/bin/models.js";
import type { ProcessResult, Runner } from "../../src/claude-code/claude-code.js";
import { CLAUDE_CODE_MODELS, claudeCodeProvider, serveClaudeCodeModels } from "../../src/claude-code/claude-code-provider.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const said = (text: string): ProcessResult => ({
	code: 0,
	stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: text }),
	stderr: "",
});

/** A runner that records each argv and says "hi". */
function recording() {
	const argvs: (readonly string[])[] = [];
	const runner = (): Runner => async (args) => {
		argvs.push(args);
		return said("hi");
	};
	return { argvs, runner };
}

const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];
const ids = (models: ReturnType<typeof createModels>) => models.getModels("claude-code").map((m) => m.id);

describe("claude-code/provider: model ids beyond the four it lists", () => {
	it("serves the ids in `models`, beside CLAUDE_CODE_MODELS, skipping repeats and empties", () => {
		const models = createModels();
		models.setProvider(claudeCodeProvider({ models: ["claude-sonnet-4-5", "haiku", "", "claude-sonnet-4-5"] }));
		expect(ids(models)).toEqual([...CLAUDE_CODE_MODELS.map((m) => m.id), "claude-sonnet-4-5"]);
		expect(models.getModel("claude-code", "claude-sonnet-4-5")).toMatchObject({ provider: "claude-code", api: "claude-code", name: "claude-sonnet-4-5 (via Claude Code)" });
	});

	it("serveClaudeCodeModels adds ids later, to this provider only", () => {
		const models = createModels();
		const provider = claudeCodeProvider();
		models.setProvider(provider);
		expect(models.getModel("claude-code", "claude-opus-4-1")).toBeUndefined();
		expect(serveClaudeCodeModels(provider, ["claude-opus-4-1"])).toBe(true);
		expect(models.getModel("claude-code", "claude-opus-4-1")?.id).toBe("claude-opus-4-1");
		expect(claudeCodeProvider().getModels().map((m) => m.id)).not.toContain("claude-opus-4-1");
		expect(serveClaudeCodeModels(fauxProvider().provider, ["x"])).toBe(false);
	});

	it("runs a step on a served id with claude --model <id>", async () => {
		const { argvs, runner } = recording();
		const models = createModels();
		models.setProvider(claudeCodeProvider({ runner, models: ["claude-sonnet-4-5"] }));
		const message = await models.complete(models.getModel("claude-code", "claude-sonnet-4-5")!, { messages: [{ role: "user", content: "Hi", timestamp: 0 }] });
		expect(message.content).toEqual([{ type: "text", text: "hi" }]);
		expect(flag(argvs[0]!, "--model")).toBe("claude-sonnet-4-5");
	});
});

describe("cli: withClaudeCode serves the claude-code ids a run names", () => {
	it("adds only refs on claude-code, and only to a claude-code provider of its own", async () => {
		const models = createModels();
		models.setProvider(claudeCodeProvider());
		await withClaudeCode(models, [
			{ provider: "claude-code", modelId: "claude-sonnet-4-5" },
			{ provider: "anthropic", modelId: "claude-opus-4-1" },
		]);
		expect(ids(models)).toContain("claude-sonnet-4-5");
		expect(ids(models)).not.toContain("claude-opus-4-1");

		const bare = createModels();
		await withClaudeCode(bare, [{ provider: "claude-code", modelId: "claude-sonnet-4-5" }]);
		expect(bare.getProvider("claude-code")).toBeUndefined();
	});
});

const SAY = `config:
    agent_name: "say"

subagent say:
    description: "Say hi"

    reasoning:
        instructions: ->
            | Say hi.
`;

describe("durable/cli: --provider claude-code --model <any id>", () => {
	it("runs on an id the provider doesn't list, where it was refused as unknown", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agentscript-cc-models-"));
		dirs.push(dir);
		const script = join(dir, "say.agent");
		writeFileSync(script, SAY);
		const { argvs, runner } = recording();
		const models = createModels();
		models.setProvider(claudeCodeProvider({ runner }));
		const err: string[] = [];
		const code = await durableMain(["run", script, "--db", join(dir, "runs.sqlite"), "--provider", "claude-code", "--model", "claude-sonnet-4-5"], {
			models: () => models,
			out: () => {},
			err: (line) => err.push(line),
		});
		expect(err.join("\n")).not.toContain("no model");
		expect(code, err.join("\n")).toBe(0);
		expect(argvs.map((args) => flag(args, "--model"))).toEqual(["claude-sonnet-4-5"]);
	});
});
