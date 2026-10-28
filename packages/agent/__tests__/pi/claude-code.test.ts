import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, type ReasoningRequest } from "../../src/interpreter/index.js";
import { CLAUDE_CODE_API, CLAUDE_CODE_PROVIDER_ID } from "../../src/claude-code/claude-code-provider.js";
import {
	CLAUDE_CODE_PROVIDER,
	claudeArgs,
	claudeCodeArgs,
	claudeCodeEnv,
	createClaudeCodeReasoningPort,
	toClaudeCodeOutcome,
	type ProcessResult,
	type Runner,
} from "../../src/claude-code/claude-code.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(PKG_DIR, "src", "claude-code", "claude-code.ts"), "utf8");
const TRIAGE = readFileSync(join(PKG_DIR, "examples", "triage.agent"), "utf8");

const ok = (result: Record<string, unknown>): ProcessResult => ({
	code: 0,
	stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, ...result }),
	stderr: "",
});

/** A runner that answers from a queue and records every call. */
function fakeRunner(...answers: ProcessResult[]) {
	const calls: { args: readonly string[]; input: string; env: NodeJS.ProcessEnv }[] = [];
	const runner: Runner = async (args, input, env) => {
		calls.push({ args, input, env });
		return answers[Math.min(calls.length - 1, answers.length - 1)]!;
	};
	return { runner, calls };
}

const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];

/** The note `pi/claude-code` pins, as the literal string. */
const NOTE =
	"This step has no workspace. The environment details you may see (working directory, whether it is a git repository, platform) describe the process running this step, not the project the step is about; ignore them.";

/** A fake `claude` that answers with the directory it ran in. */
function cwdClaude(): string {
	const binary = join(mkdtempSync(join(tmpdir(), "agentscript-fake-claude-")), "claude");
	writeFileSync(binary, `#!${process.execPath}\nprocess.stdin.resume();\nprocess.stdin.on("end", () => process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: process.cwd() })));\n`);
	chmodSync(binary, 0o755);
	return binary;
}

describe("the claude-code port on the triage example", () => {
	it("sets variables from Claude Code's structured_output", async () => {
		const { runner, calls } = fakeRunner(
			ok({ result: '{"severity":"high","summary":"x"}', structured_output: { severity: "high", summary: "Crashes outside git." } }),
		);
		const result = await run(TRIAGE, { port: createClaudeCodeReasoningPort({ runner }) });
		expect(result.kind).toBe("completed");
		expect(result.variables).toMatchObject({ severity: "high", summary: "Crashes outside git." });

		const { args, input } = calls[0]!;
		expect(JSON.parse(flag(args, "--json-schema")!)).toMatchObject({ type: "object" });
		expect(flag(args, "--system-prompt")).toContain("You triage bug reports");
		expect(input).toContain("Triage this bug report:");
		expect(input).not.toContain("You triage bug reports");
	});

	it("fails the run when a structured step comes back without structured_output", async () => {
		const { runner } = fakeRunner(ok({ result: "severity: high" }));
		const result = await run(TRIAGE, { port: createClaudeCodeReasoningPort({ runner }) });
		expect(result.kind).toBe("failed");
		expect(result.variables.severity).toBe("");
	});
});

describe("claudeCodeArgs", () => {
	const request: ReasoningRequest = { systemInstructions: "sys", prompt: "p" };

	it("runs headless, in safe mode, with no tools and no saved session", () => {
		const args = claudeCodeArgs(request, {});
		expect(args).toContain("-p");
		expect(args).toContain("--safe-mode");
		expect(flag(args, "--tools")).toBe("");
		expect(args).toContain("--no-session-persistence");
		expect(flag(args, "--output-format")).toBe("json");
	});

	it("defaults to claude-haiku-4-5 and takes another model", () => {
		expect(flag(claudeCodeArgs(request, {}), "--model")).toBe("claude-haiku-4-5");
		expect(flag(claudeCodeArgs(request, { model: "sonnet" }), "--model")).toBe("sonnet");
	});

	it("passes no schema for a text step, and passes max turns only when asked", () => {
		const args = claudeCodeArgs(request, {});
		expect(args).not.toContain("--json-schema");
		expect(args).not.toContain("--max-turns");
		expect(flag(claudeCodeArgs(request, { maxTurns: 3 }), "--max-turns")).toBe("3");
	});

	it("never uses --bare, which would force API-key auth", () => {
		expect(claudeCodeArgs(request, { maxTurns: 1 })).not.toContain("--bare");
	});
});

describe("claudeCodeEnv", () => {
	it("drops the API key so the subscription login is used, and the nested-session marker", () => {
		const env = claudeCodeEnv({ ANTHROPIC_API_KEY: "sk-test", CLAUDECODE: "1", PATH: "/bin", HOME: "/home/x" });
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env.CLAUDECODE).toBeUndefined();
		expect(env).toMatchObject({ PATH: "/bin", HOME: "/home/x" });
	});

	it("is what the port actually spawns with", async () => {
		const { runner, calls } = fakeRunner(ok({ result: "hi" }));
		const saved = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = "sk-test";
		try {
			await createClaudeCodeReasoningPort({ runner }).reason({ systemInstructions: "s", prompt: "p" });
		} finally {
			if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
			else process.env.ANTHROPIC_API_KEY = saved;
		}
		expect(calls[0]!.env.ANTHROPIC_API_KEY).toBeUndefined();
	});
});

describe("the port never touches Claude Code's credentials", () => {
	it("reads no credentials file and names no OAuth token", () => {
		const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
		expect(code).not.toMatch(/\.credentials|claudeAiOauth|accessToken|ANTHROPIC_OAUTH_TOKEN|keychain/i);
		expect(code).not.toMatch(/readFile/);
	});
});

describe("toClaudeCodeOutcome", () => {
	it("answers with text for a text step", () => {
		expect(toClaudeCodeOutcome(ok({ result: "Ocean." }), false).step).toEqual({ kind: "answered", text: "Ocean." });
	});

	it("ignores structured_output when the step did not ask for it", () => {
		expect(toClaudeCodeOutcome(ok({ result: "x", structured_output: { a: 1 } }), false).step).toEqual({
			kind: "answered",
			text: "x",
		});
	});

	it("settles max turns as cut short, carrying Claude Code's turn count", () => {
		const step = toClaudeCodeOutcome(ok({ subtype: "error_max_turns", is_error: true, num_turns: 4, result: "half" }), true).step;
		expect(step).toEqual({ kind: "cut-short", text: "half", turns: 4 });
	});

	it("takes an API error's category from its status", () => {
		const step = toClaudeCodeOutcome(ok({ is_error: true, api_error_status: 429, result: "slow down" }), false).step;
		expect(step).toEqual({ kind: "failed", category: "rate_limit", message: "slow down" });
	});

	it("reports unknown when the error carries no status", () => {
		const step = toClaudeCodeOutcome(ok({ subtype: "error_during_execution", is_error: true }), false).step;
		expect(step).toEqual({ kind: "failed", category: "unknown", message: "claude reported error_during_execution" });
	});

	it("maps a max_tokens stop to max_output_tokens", () => {
		const step = toClaudeCodeOutcome(ok({ is_error: true, stop_reason: "max_tokens" }), false).step;
		expect(step).toMatchObject({ kind: "failed", category: "max_output_tokens" });
	});

	it("fails by name when claude is not installed", () => {
		const step = toClaudeCodeOutcome({ code: null, stdout: "", stderr: "", spawnError: new Error("spawn claude ENOENT") }, false).step;
		expect(step).toMatchObject({ kind: "failed", category: "unknown" });
		expect(step.kind === "failed" && step.message).toMatch(/ENOENT.*installed and on PATH/);
	});

	it("fails with stderr when the output is not JSON", () => {
		const step = toClaudeCodeOutcome({ code: 1, stdout: "", stderr: "Invalid API key · Please run /login" }, false).step;
		expect(step).toMatchObject({ kind: "failed", category: "unknown" });
		expect(step.kind === "failed" && step.message).toMatch(/exited 1.*Please run \/login/);
	});
});

describe("The claude-code surface is exported from the root entry", () => {
	it("Scenario: The provider id and API are claude-code", () => {
		expect(CLAUDE_CODE_PROVIDER).toBe("claude-code");
		expect(CLAUDE_CODE_PROVIDER_ID).toBe("claude-code");
		expect(CLAUDE_CODE_API).toBe("claude-code");
	});
});

describe("Each turn is one headless claude -p invocation with a fixed argv", () => {
	it("Scenario: Headless, safe mode, no tools, no saved session", () => {
		expect(claudeArgs({ system: "s", model: "m" })).toEqual([
			"-p",
			"--safe-mode",
			"--model",
			"m",
			"--tools",
			"",
			"--no-session-persistence",
			"--output-format",
			"json",
			"--system-prompt",
			`s\n\n${NOTE}`,
		]);
	});

	it("Scenario: A schema and a turn bound are appended in order", () => {
		const args = claudeArgs({ system: "s", model: "m", schema: { type: "object" }, maxTurns: 3 });
		expect(args.slice(-4)).toEqual(["--json-schema", '{"type":"object"}', "--max-turns", "3"]);
		expect(args.slice(0, -4)).toEqual(claudeArgs({ system: "s", model: "m" }));
	});
});

const TOOLS = { mcpConfig: "/x/mcp.json", allowedTools: ["mcp__agentscript__a", "mcp__agentscript__b"] };

describe("--bare is never passed and --safe-mode always is", () => {
	it("Scenario: Never bare", () => {
		for (const args of [
			claudeArgs({ system: "s", model: "m" }),
			claudeArgs({ system: "s", model: "m", schema: { type: "object" }, maxTurns: 1 }),
		]) {
			expect(args).not.toContain("--bare");
			expect(args).toContain("--safe-mode");
		}
	});

	it("Scenario: A tool step is isolated without safe mode", () => {
		const args = claudeArgs({ system: "s", model: "m", schema: { type: "object" }, tools: TOOLS });
		expect(args).not.toContain("--bare");
		expect(args).not.toContain("--safe-mode");
		expect(flag(args, "--setting-sources")).toBe("");
		expect(args).toContain("--disable-slash-commands");
		expect(args).toContain("--strict-mcp-config");
	});
});

describe("A tool step names one MCP server and allows only its tools", () => {
	it("Scenario: The tool flags replace safe mode in place", () => {
		const noTools = claudeArgs({ system: "s", model: "m" });
		expect(claudeArgs({ system: "s", model: "m", tools: TOOLS })).toEqual([
			"-p",
			"--setting-sources",
			"",
			"--disable-slash-commands",
			"--strict-mcp-config",
			"--mcp-config",
			"/x/mcp.json",
			"--allowedTools",
			"mcp__agentscript__a,mcp__agentscript__b",
			"--permission-mode",
			"dontAsk",
			...noTools.slice(2),
		]);
	});
});

describe("The bridge types are exported from the claude-code entry", () => {
	it("Scenario: The bridge server name is agentscript", async () => {
		const entry = await import("../../src/claude-code/index.js");
		expect(entry.BRIDGE_SERVER).toBe("agentscript");
	});
});

describe("The system prompt ends with the no-workspace note", () => {
	it("Scenario: The note follows the system text", () => {
		expect(flag(claudeArgs({ system: "s", model: "m" }), "--system-prompt")).toBe(`s\n\n${NOTE}`);
	});

	it("Scenario: An empty system text is the note alone", () => {
		expect(flag(claudeArgs({ system: "", model: "m" }), "--system-prompt")).toBe(NOTE);
	});

	it("Scenario: The port passes the note", async () => {
		const { runner, calls } = fakeRunner(ok({ result: "{}", structured_output: { severity: "high", summary: "x" } }));
		await run(TRIAGE, { port: createClaudeCodeReasoningPort({ runner }) });
		expect(calls.length).toBeGreaterThan(0);
		for (const { args } of calls) {
			const system = flag(args, "--system-prompt")!;
			expect(system).toContain("You triage bug reports");
			expect(system.endsWith(NOTE)).toBe(true);
		}
	});
});

describe("The port is one claude process per step and stateless", () => {
	it("Scenario: The port runs claude in its cwd option", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "agentscript-port-cwd-"));
		const port = createClaudeCodeReasoningPort({ binary: cwdClaude(), cwd, timeoutMs: 10_000 });
		const outcome = await port.reason({ systemInstructions: "s", prompt: "p" });
		expect(outcome.kind).toBe("answered");
		expect(realpathSync(outcome.kind === "answered" ? outcome.text : "")).toBe(realpathSync(cwd));
	});

	it("Scenario: onResult sees each parsed result", async () => {
		const first = { type: "result", subtype: "success", is_error: false, num_turns: 1, result: "one" };
		const second = { ...first, result: "two", total_cost_usd: 0.5 };
		const { runner } = fakeRunner(
			{ code: 0, stdout: JSON.stringify(first), stderr: "" },
			{ code: 0, stdout: JSON.stringify(second), stderr: "" },
		);
		const seen: unknown[] = [];
		const port = createClaudeCodeReasoningPort({ runner, onResult: (r) => seen.push(r) });
		await port.reason({ systemInstructions: "s", prompt: "p" });
		await port.reason({ systemInstructions: "s", prompt: "p" });
		expect(seen).toEqual([first, second]);
	});
});

describe("The claude-code surface is exported from the root entry", () => {
	it("Scenario: Argv building and spawning stay module-level", async () => {
		const root = await import("../../src/claude-code/index.js");
		expect(root.createClaudeCodeReasoningPort).toBeTypeOf("function");
		expect(root).not.toHaveProperty("claudeArgs");
		expect(root).not.toHaveProperty("spawnRunner");
		const module = await import("../../src/claude-code/claude-code.js");
		expect(module.claudeArgs).toBeTypeOf("function");
		expect(module.spawnRunner).toBeTypeOf("function");
	});
});
