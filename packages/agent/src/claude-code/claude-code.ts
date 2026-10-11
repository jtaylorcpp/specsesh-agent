/**
 * A `ReasoningPort` that runs your own `claude` binary headless, so a script can
 * run on your Claude subscription.
 *
 * This is the subscription path that stays within Anthropic's terms: the turn is
 * made BY Claude Code, logged in as you. This port never reads, copies or forwards
 * Claude Code's OAuth token — handing that token to another client (pi included)
 * is exactly what the terms rule out.
 *
 * Each step is one `claude -p` process:
 *
 *   --safe-mode               no CLAUDE.md, skills, plugins, hooks or MCP. Without it
 *                             your global CLAUDE.md leaks into every step (measured:
 *                             ~9.3k tokens of LifeOS context vs ~500 with it).
 *   --tools ""                no tools; the step is reasoning only
 *   --system-prompt           the document's system block, as its own channel
 *   --json-schema             when the step writes variables
 *   --no-session-persistence  the port is stateless
 *
 * ANTHROPIC_API_KEY is removed from the child's environment, so Claude Code uses
 * the subscription login rather than silently billing an API key; CLAUDECODE is
 * removed so a run started from inside a Claude Code session is not refused.
 *
 * Claude Code owns its own turn loop and bound, so unlike the pi port this one
 * CAN report `cut-short` — when Claude Code says it stopped at max turns.
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { ReasoningPort, ReasoningRequest, StepOutcome } from "../interpreter/index.js";
import { TOOLS_NEED_DURABLE_HOST, toFailureCategory } from "../interpreter/index.js";
import { categoryFromStatus } from "../pi/categories.js";

export const CLAUDE_CODE_PROVIDER = "claude-code";

/** What one `claude -p` process produced. */
export interface ProcessResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
	/** Set when the process could not be started at all (e.g. ENOENT). */
	readonly spawnError?: Error;
}

export type Runner = (args: readonly string[], input: string, env: NodeJS.ProcessEnv) => Promise<ProcessResult>;

export interface ClaudeCodeReasoningPortOptions {
	/** Model id or alias passed to `--model`. Defaults to claude-haiku-4-5. */
	readonly model?: string;
	/** The binary to run. Defaults to `claude` on PATH. */
	readonly binary?: string;
	/** Optional `--max-turns`. Claude Code's own bound; reaching it settles the step as cut short. */
	readonly maxTurns?: number;
	/** Kill the process after this long. Defaults to 5 minutes. */
	readonly timeoutMs?: number;
	/** Replaces process spawning, for tests. */
	readonly runner?: Runner;
	/** Called with every parsed result, for logging cost and turns. */
	readonly onResult?: (result: ClaudeCodeResult) => void;
}

/** The fields of `claude -p --output-format json` this port reads. */
export interface ClaudeCodeResult {
	readonly type?: string;
	readonly subtype?: string;
	readonly is_error?: boolean;
	readonly result?: string;
	readonly structured_output?: unknown;
	readonly num_turns?: number;
	readonly stop_reason?: string | null;
	readonly api_error_status?: number | null;
	readonly total_cost_usd?: number;
	readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

export function claudeCodeArgs(request: ReasoningRequest, options: ClaudeCodeReasoningPortOptions): string[] {
	return claudeArgs({
		system: request.systemInstructions,
		model: options.model ?? "claude-haiku-4-5",
		...(request.outputSchema !== undefined ? { schema: request.outputSchema } : {}),
		...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
	});
}

/** One headless `claude -p` invocation, minus the prompt (which goes on stdin). */
export interface ClaudeInvocation {
	readonly system: string;
	readonly model: string;
	readonly schema?: Record<string, unknown>;
	readonly maxTurns?: number;
}

export function claudeArgs(invocation: ClaudeInvocation): string[] {
	const args = [
		"-p",
		"--safe-mode",
		"--model",
		invocation.model,
		"--tools",
		"",
		"--no-session-persistence",
		"--output-format",
		"json",
		"--system-prompt",
		invocation.system,
	];
	if (invocation.schema !== undefined) args.push("--json-schema", JSON.stringify(invocation.schema));
	if (invocation.maxTurns !== undefined) args.push("--max-turns", String(invocation.maxTurns));
	return args;
}

/** The child's environment: the caller's, minus the API key and the nested-session marker. */
export function claudeCodeEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env = { ...parent };
	delete env.ANTHROPIC_API_KEY;
	delete env.CLAUDECODE;
	return env;
}

export function createClaudeCodeReasoningPort(options: ClaudeCodeReasoningPortOptions = {}): ReasoningPort {
	const runner = options.runner ?? spawnRunner(options.binary ?? "claude", options.timeoutMs ?? 300_000);
	return {
		async reason(request: ReasoningRequest): Promise<StepOutcome> {
			// One `claude -p` per step, tools off: nothing here can run a tool loop.
			if (request.tools !== undefined) {
				return { kind: "failed", category: "invalid_request", message: TOOLS_NEED_DURABLE_HOST };
			}
			const processResult = await runner(claudeCodeArgs(request, options), request.prompt, claudeCodeEnv(process.env));
			const outcome = toClaudeCodeOutcome(processResult, request.outputSchema !== undefined);
			if (outcome.parsed !== undefined) options.onResult?.(outcome.parsed);
			return outcome.step;
		},
	};
}

export function toClaudeCodeOutcome(
	processResult: ProcessResult,
	wantsStructured: boolean,
): { step: StepOutcome; parsed?: ClaudeCodeResult } {
	if (processResult.spawnError !== undefined) {
		return {
			step: {
				kind: "failed",
				category: "unknown",
				message: `could not start claude: ${processResult.spawnError.message}. Is Claude Code installed and on PATH?`,
			},
		};
	}

	let parsed: ClaudeCodeResult;
	try {
		parsed = JSON.parse(processResult.stdout) as ClaudeCodeResult;
	} catch {
		const detail = (processResult.stderr || processResult.stdout).trim().slice(0, 500);
		return {
			step: {
				kind: "failed",
				category: "unknown",
				message: `claude exited ${processResult.code ?? "by signal"} without a JSON result${detail ? `: ${detail}` : ""}`,
			},
		};
	}

	const text = parsed.result ?? "";
	if (parsed.subtype === "error_max_turns") {
		return { parsed, step: { kind: "cut-short", text, turns: parsed.num_turns ?? 0 } };
	}
	if (parsed.is_error === true || (parsed.subtype !== undefined && parsed.subtype !== "success")) {
		const category =
			parsed.stop_reason === "max_tokens"
				? "max_output_tokens"
				: toFailureCategory(categoryFromStatus(parsed.api_error_status ?? undefined));
		return {
			parsed,
			step: { kind: "failed", category, message: text || `claude reported ${parsed.subtype ?? "an error"}` },
		};
	}
	if (wantsStructured && parsed.structured_output !== undefined) {
		return { parsed, step: { kind: "answered", text, structured: parsed.structured_output } };
	}
	return { parsed, step: { kind: "answered", text } };
}

export function spawnRunner(binary: string, timeoutMs: number, signal?: AbortSignal): Runner {
	return (args, input, env) =>
		new Promise((resolve) => {
			// Run outside any project so no project-level settings are picked up either.
			const child = spawn(binary, args, { env, cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
			let stdout = "";
			let stderr = "";
			const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
			signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
			child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
			child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
			child.on("error", (spawnError) => {
				clearTimeout(timer);
				resolve({ code: null, stdout, stderr, spawnError });
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				resolve({ code, stdout, stderr });
			});
			child.stdin.end(input);
		});
}
