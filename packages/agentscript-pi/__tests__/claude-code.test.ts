import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, type ReasoningRequest } from "@coopcli/agentscript/interpreter";
import {
	claudeCodeArgs,
	claudeCodeEnv,
	createClaudeCodeReasoningPort,
	toClaudeCodeOutcome,
	type ProcessResult,
	type Runner,
} from "../src/claude-code.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(PKG_DIR, "src", "claude-code.ts"), "utf8");
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
