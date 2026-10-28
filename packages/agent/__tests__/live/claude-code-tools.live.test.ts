/**
 * `pnpm test:claude-code`: tool steps against the real `claude`, on your Claude
 * subscription, with Haiku. Never part of `pnpm test` (vitest.config.ts excludes
 * `__tests__/live/`); `pnpm test:live` picks it up too, by its glob.
 *
 * Tool steps replace `--safe-mode` with flags whose isolation was measured by hand
 * on Claude Code 2.1.310. These checks re-measure it: input tokens against
 * `--safe-mode`, and a project CLAUDE.md sentinel with a positive control. Then a
 * real tool call through `mcpBridge`, on a value the model can't guess, and one
 * durable run through the built bin. About six Haiku requests.
 *
 * It needs `claude` installed and logged in, and skips saying why otherwise.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { claudeArgs, claudeCodeEnv, spawnRunner, type ClaudeCodeResult } from "../../src/claude-code/claude-code.js";
import { createClaudeCodeReasoningPort } from "../../src/claude-code/index.js";
import type { ActionResult, ToolOffer } from "../../src/interpreter/index.js";
import { mcpBridge } from "../../src/node/index.js";
import type { PiToolCall, PiToolHost } from "../../src/pi/index.js";
import { claudeReady } from "./ready.js";
import { killRunning, startDetached } from "./spawn.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DURABLE_BIN = join(PKG_DIR, "dist", "bin", "agentscript-durable.js");
const MODEL = "haiku";
const CODEWORD = "PERIWINKLE-4417";
const CODEWORD_QUESTION = "What is the project codeword? Answer with it, or NONE.";
const STEP_MS = 180_000;

// Run from inside a Claude Code session, its children inherit CLAUDE_CODE_SAFE_MODE (which turns
// off --mcp-config servers) and CLAUDE_CODE_DISABLE_CLAUDE_MDS, so every check would measure the
// session, not the flags. Every `claude` here, and the bin's, starts without them.
for (const key of Object.keys(process.env)) if (key.startsWith("CLAUDE_CODE_")) delete process.env[key];

const ready = claudeReady();
if (!ready.ok) console.warn(`pnpm test:claude-code skipped: ${ready.reason}`);

let tmp = "";

beforeAll(() => {
	if (ready.ok) tmp = mkdtempSync(join(tmpdir(), "agentscript-live-cc-tools-"));
});

afterEach(killRunning);

afterAll(() => {
	killRunning();
	if (tmp !== "") rmSync(tmp, { recursive: true, force: true });
});

function recordingHost(outputs: Extract<ActionResult, { ok: true }>["outputs"]) {
	const calls: PiToolCall[] = [];
	const host: PiToolHost = async (call): Promise<ActionResult> => {
		calls.push(call);
		return { ok: true, outputs };
	};
	return { host, calls };
}

function offer(name: string, description: string): ToolOffer {
	return {
		name,
		description,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		action: name,
		bound: {},
	};
}

/** One `claude -p` with `args`, the prompt on stdin, in a fresh empty directory; its JSON result. */
async function claudeJson(args: readonly string[], prompt: string, cwd?: string): Promise<ClaudeCodeResult> {
	const r = await spawnRunner("claude", STEP_MS, undefined, cwd)(args, prompt, claudeCodeEnv(process.env));
	if (r.spawnError !== undefined) throw r.spawnError;
	try {
		return JSON.parse(r.stdout) as ClaudeCodeResult;
	} catch {
		throw new Error(`claude exited ${r.code ?? "by signal"} without a JSON result: ${(r.stderr || r.stdout).slice(0, 500)}`);
	}
}

/** Every input token the request cost, cached or not. */
function inputTokens(result: ClaudeCodeResult): number {
	const usage = (result.usage ?? {}) as Record<string, number | undefined>;
	return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

describe.skipIf(!ready.ok)("pi/claude-code: pnpm test:claude-code re-checks tool steps against the real claude", () => {
	it(
		"Scenario: Tool-step isolation costs what safe mode costs",
		async () => {
			const system = "You answer questions.";
			const question = "What is the capital of France? Answer in one word.";

			const safe = await claudeJson(claudeArgs({ system, model: MODEL }), question);
			const bridge = await mcpBridge()([], async () => ({ ok: false, text: "no tools are served" }));
			let tool: ClaudeCodeResult;
			try {
				const args = claudeArgs({
					system,
					model: MODEL,
					tools: { mcpConfig: bridge.mcpConfig, allowedTools: bridge.allowedTools },
				});
				expect(args[args.indexOf("--allowedTools") + 1]).toBe("");
				tool = await claudeJson(args, question);
			} finally {
				await bridge.close();
			}

			expect(safe.is_error, safe.result).not.toBe(true);
			expect(tool.is_error, tool.result).not.toBe(true);
			const a = inputTokens(safe);
			const b = inputTokens(tool);
			console.log(`input tokens: --safe-mode ${a}, tool-step flags ${b}`);
			expect(a).toBeGreaterThan(0);
			expect(Math.abs(a - b), `--safe-mode ${a}, tool-step flags ${b}`).toBeLessThanOrEqual(0.1 * Math.max(a, b) + 100);
		},
		STEP_MS * 2,
	);

	it(
		"Scenario: A project CLAUDE.md does not reach a tool step",
		async () => {
			const project = mkdtempSync(join(tmp, "project-"));
			writeFileSync(join(project, "CLAUDE.md"), `The project codeword is ${CODEWORD}.\n`);

			// Positive control: plain `claude -p` in that directory, no isolation flags, must see it.
			const control = await claudeJson(["-p", "--model", MODEL, "--output-format", "json"], CODEWORD_QUESTION, project);
			expect(control.result ?? "", "control did not see CLAUDE.md; cannot detect a leak").toContain(CODEWORD);

			const { host } = recordingHost({ done: true });
			const port = createClaudeCodeReasoningPort({ model: MODEL, cwd: project, tools: host, bridge: mcpBridge() });
			const outcome = await port.reason({
				systemInstructions: "You answer questions.",
				prompt: CODEWORD_QUESTION,
				tools: [offer("noop", "Does nothing. You do not need it.")],
			});

			expect(outcome.kind, JSON.stringify(outcome)).toBe("answered");
			const text = outcome.kind === "answered" ? outcome.text : "";
			console.log(`tool step answered: ${text}`);
			expect(text).not.toContain(CODEWORD);
		},
		STEP_MS * 2,
	);

	it(
		"Scenario: A real claude calls a bridged tool",
		async () => {
			const { host, calls } = recordingHost({ value: 4817 });
			const port = createClaudeCodeReasoningPort({ model: MODEL, tools: host, bridge: mcpBridge() });
			const outcome = await port.reason({
				systemInstructions: "You answer with what your tools return. Be brief.",
				prompt: "Call the secret_number tool once, then reply with the number it returned.",
				tools: [offer("secret_number", "Returns the secret number.")],
			});

			expect(outcome.kind, JSON.stringify(outcome)).toBe("answered");
			if (outcome.kind !== "answered") return;
			expect(calls).toHaveLength(1);
			expect(calls[0]).toMatchObject({ name: "secret_number" });
			expect(outcome.toolCalls?.map((call) => call.name)).toEqual(["secret_number"]);
			expect(outcome.text).toContain("4817");
		},
		STEP_MS,
	);

	it(
		"Scenario: A real durable run records its call",
		async () => {
			const env = { ...process.env };
			for (const key of Object.keys(env)) if (key.startsWith("AGENTSCRIPT_")) delete env[key];
			const run = await startDetached(
				process.execPath,
				[
					DURABLE_BIN,
					"run",
					join(PKG_DIR, "examples", "tools", "tools.agent"),
					"--entry",
					"echo_it",
					"--entry",
					"count_it",
					"--tools",
					join(PKG_DIR, "examples", "tools", "tools.mjs"),
					"--provider",
					"claude-code",
					"--model",
					MODEL,
					"--db",
					join(tmp, "durable.sqlite"),
					"--json",
				],
				{ cwd: tmp, env, limitMs: STEP_MS * 2 },
			).done;

			expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
			const result = JSON.parse(run.stdout) as {
				kind: string;
				variables: Record<string, unknown>;
				steps: { outcome: { toolCalls?: { name: string }[] } }[];
			};
			expect(result.kind).toBe("completed");
			const calls = result.steps.flatMap((step) => step.outcome.toolCalls ?? []).filter((call) => call.name === "word_count");
			expect(calls).toHaveLength(1);
			expect(result.variables.count).toBe(6);
		},
		STEP_MS * 3,
	);
});
