// The claude-code provider's turn limit on a step that offers tools (#37): configurable as
// `maxTurns`, defaulting to DEFAULT_TOOL_STEP_TURNS rather than the one-shot port's 16, and named
// in the step's outcome when it ended the step.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxText, Type, type Context, type Message } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { main as durableMain } from "../../src/bin/agentscript-durable.js";
import type { CliModelOptions } from "../../src/bin/models.js";
import type { ProcessResult, Runner } from "../../src/claude-code/claude-code.js";
import { DEFAULT_TOOL_STEP_TURNS, claudeCodeModel, claudeCodeProvider } from "../../src/claude-code/claude-code-provider.js";
import type { ToolBridgeFactory } from "../../src/claude-code/tool-bridge.js";
import { createAgentHarness } from "../../src/durable/harness.js";
import { memoryWorkspace, runScript } from "../../src/durable/index.js";
import { DEFAULT_MAX_ROUNDS } from "../../src/pi/port.js";
import { PIPELINE, context, setup } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const bridge: ToolBridgeFactory = async (tools) => ({
	mcpConfig: "/tmp/fake-mcp-config.json",
	allowedTools: tools.map((t) => `mcp__agentscript__${t.name}`),
	close: async () => {},
});

const result = (fields: Record<string, unknown>): ProcessResult => ({
	code: 0,
	stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: "done", ...fields }),
	stderr: "",
});

/** A runner that records each argv and answers `answer`. */
function recording(answer: ProcessResult) {
	const argvs: (readonly string[])[] = [];
	const runnerFor = (): Runner => async (args) => {
		argvs.push(args);
		return answer;
	};
	return { argvs, runnerFor };
}

const lookup = { name: "lookup", description: "Finds an order.", parameters: Type.Object({ id: Type.String() }) };
const system = (toolsAdded: Context["tools"]): Message => ({ role: "system", content: "Be kind.", sections: {}, toolsAdded, timestamp: 0 }) as Message;
const user = (content: string): Message => ({ role: "user", content, timestamp: 0 });
const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];

async function toolStep(options: { maxTurns?: number }, answer: ProcessResult) {
	const runner = recording(answer);
	const models = createModels();
	models.setProvider(claudeCodeProvider({ runner: runner.runnerFor, bridge, ...options }));
	const message = await models.complete(models.getModel("claude-code", "claude-haiku-4-5")!, { messages: [system([lookup]), user("Find order 7")] });
	return { message, argvs: runner.argvs };
}

const AT_LIMIT = (turns: number): ProcessResult => ({
	code: 1,
	stdout: JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: turns, result: "" }),
	stderr: "",
});

describe("claude-code/provider: a held session's turn limit is maxTurns", () => {
	it("defaults to DEFAULT_TOOL_STEP_TURNS, room for a coding step, not the one-shot port's bound", async () => {
		expect(DEFAULT_TOOL_STEP_TURNS).toBe(100);
		expect(DEFAULT_TOOL_STEP_TURNS).toBeGreaterThan(DEFAULT_MAX_ROUNDS);
		const { argvs } = await toolStep({}, result({}));
		expect(flag(argvs[0]!, "--max-turns")).toBe("100");
	});

	it("passes maxTurns as --max-turns", async () => {
		const { argvs } = await toolStep({ maxTurns: 7 }, result({}));
		expect(flag(argvs[0]!, "--max-turns")).toBe("7");
	});

	it("refuses a maxTurns that is not a positive integer", () => {
		for (const maxTurns of [0, -1, 1.5, Number.NaN]) {
			expect(() => claudeCodeProvider({ maxTurns }), String(maxTurns)).toThrow(RangeError);
		}
	});

	it("names the limit, and how to raise it, when the step stops at it", async () => {
		const { message } = await toolStep({ maxTurns: 7 }, AT_LIMIT(7));
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toBe(
			"claude stopped at its turn limit after 7 turns (maxTurns 7); the step ended unfinished: raise maxTurns (the CLI's --max-turns, or task.maxTurns in agentscript.config.json) to give it more",
		);
	});
});

/** One model step offering read_file. */
const READER = `config:
    agent_name: "reader"

subagent act:
    description: "Read"

    actions:
        read_file:
            description: "Read a file"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"

    reasoning:
        instructions: ->
            | Read a.txt.
        actions:
            read: @actions.read_file
                with path = ...
`;

describe("durable/run-task: a step that hit the turn limit says so in its outcome", () => {
	it("fails the step once, naming the limit, with no retry", async () => {
		let spawned = 0;
		const provider = claudeCodeProvider({
			bridge,
			maxTurns: 12,
			runner: () => async () => {
				spawned += 1;
				return AT_LIMIT(12);
			},
		});
		const model = claudeCodeModel("claude-haiku-4-5");
		const agent = await createAgentHarness(
			{
				models: { default: () => ({ provider, model: { provider: "claude-code", modelId: model.id } }) },
				workspace: () => memoryWorkspace({ "a.txt": "hi" }),
			},
			{ storage: new MemoryStorage(), env: {}, context },
		);
		const run = await runScript(agent.harness, READER, { entry: ["act"], model: agent.models["default"]! }, context);
		await agent.harness.close(context);

		expect(spawned).toBe(1);
		expect(run.kind).toBe("failed");
		const outcome = run.steps.at(-1)?.outcome;
		expect(outcome?.kind).toBe("failed");
		expect(outcome?.kind === "failed" && outcome.message).toContain("claude stopped at its turn limit after 12 turns (maxTurns 12)");
		expect(outcome?.kind === "failed" && outcome.message).toContain("--max-turns");
	});
});

describe("durable/cli: --max-turns", () => {
	function workdir() {
		const dir = mkdtempSync(join(tmpdir(), "agentscript-turns-"));
		dirs.push(dir);
		const script = join(dir, "pipeline.agent");
		writeFileSync(script, PIPELINE);
		return { script, db: join(dir, "runs.sqlite") };
	}

	async function durable(argv: string[]) {
		const env = setup();
		env.faux.setResponses([fauxAssistantMessage([fauxText("one")]), fauxAssistantMessage([fauxText("two")])]);
		const seen: (CliModelOptions | undefined)[] = [];
		const err: string[] = [];
		const code = await durableMain([...argv, "--provider", env.model.provider, "--model", env.model.modelId], {
			models: (options) => {
				seen.push(options);
				return env.models;
			},
			out: () => {},
			err: (line) => err.push(line),
		});
		return { code, seen, err: err.join("\n") };
	}

	it("hands the limit to the model collection, and the resume hint repeats it", async () => {
		const { script, db } = workdir();
		const r = await durable(["run", script, "--db", db, "--max-turns", "40"]);
		expect(r.seen).toEqual([{ maxTurns: 40 }]);
		expect(r.err).toMatch(/resume with: agentscript-durable resume \d+ --db \S+ --max-turns 40/);
	});

	it("leaves the provider's default without the flag", async () => {
		const { script, db } = workdir();
		const r = await durable(["run", script, "--db", db]);
		expect(r.seen).toEqual([{}]);
		expect(r.err).not.toContain("--max-turns");
	});

	it("refuses a limit that is not a positive integer, opening nothing", async () => {
		const { script, db } = workdir();
		for (const bad of ["0", "ten", "1.5"]) {
			const r = await durable(["run", script, "--db", db, "--max-turns", bad]);
			expect(r.code, bad).toBe(2);
			expect(r.err, bad).toContain(`--max-turns must be a positive integer, got "${bad}"`);
			expect(r.seen, bad).toEqual([]);
		}
	});
});
