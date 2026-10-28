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
 *                             ~9.3k tokens of LifeOS context vs ~500 with it). On every
 *                             step that offers no tools; a tool step replaces it (below).
 *   --tools ""                no built-in tools
 *   --system-prompt           the document's system block, as its own channel, then
 *                             the no-workspace note (below)
 *   --json-schema             when the step writes variables
 *   --no-session-persistence  the port is stateless
 *
 * --safe-mode also turns off the servers --mcp-config names (measured on Claude Code
 * 2.1.310), so a step that offers tools passes, in its place, the flags measured to
 * give the same context: --setting-sources "" --disable-slash-commands
 * --strict-mcp-config, then --mcp-config <the bridge's file>, --allowedTools with the
 * bridge's tools comma-joined (the flag is variadic and would swallow the next one),
 * and --permission-mode dontAsk. The bridge's token stays in its 0600 config file and
 * never appears in argv. --bare is never passed: it forces API-key auth.
 *
 * ANTHROPIC_API_KEY is removed from the child's environment, so Claude Code uses
 * the subscription login rather than silently billing an API key; CLAUDECODE is
 * removed so a run started from inside a Claude Code session is not refused.
 *
 * Claude Code adds its own environment block (working directory, git status,
 * platform, date) to the system prompt even with --system-prompt, and no flag
 * removes it. So each process runs in a fresh empty directory, and the system
 * prompt ends with a note saying those details describe the process, not the
 * project the step is about.
 *
 * Claude Code owns its own turn loop and bound, so unlike the pi port this one
 * CAN report `cut-short` — when Claude Code says it stopped at max turns.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ActionResult,
	ReasoningPort,
	ReasoningRequest,
	StepOutcome,
	StreamSink,
	ToolCallRecord,
	ToolOffer,
} from "../interpreter/index.js";
import { TOOLS_NEED_DURABLE_HOST, toFailureCategory } from "../interpreter/index.js";
import { categoryFromStatus } from "../pi/categories.js";
import { DEFAULT_MAX_ROUNDS, checkToolArguments, type PiToolHost } from "../pi/port.js";
import type { BridgeHandler, ToolBridge, ToolBridgeFactory } from "./tool-bridge.js";

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
	/** Where `claude` runs. Defaults to a fresh empty directory per step, removed after. Ignored with `runner`. */
	readonly cwd?: string;
	/** Replaces process spawning, for tests. */
	readonly runner?: Runner;
	/** Called with every parsed result, for logging cost and turns. */
	readonly onResult?: (result: ClaudeCodeResult) => void;
	/**
	 * Runs the tools a step offers. Without it a request offering tools is
	 * refused; with it (and `bridge`) Claude Code calls them through the bridge.
	 */
	readonly tools?: PiToolHost;
	/** Serves a step's offers to `claude` as one MCP server. Required with `tools`. */
	readonly bridge?: ToolBridgeFactory;
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

export function claudeCodeArgs(
	request: ReasoningRequest,
	options: ClaudeCodeReasoningPortOptions,
	tools?: ClaudeInvocation["tools"],
): string[] {
	return claudeArgs({
		system: request.systemInstructions,
		model: options.model ?? "claude-haiku-4-5",
		...(request.outputSchema !== undefined ? { schema: request.outputSchema } : {}),
		...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
		...(tools !== undefined ? { tools } : {}),
	});
}

/** One headless `claude -p` invocation, minus the prompt (which goes on stdin). */
export interface ClaudeInvocation {
	readonly system: string;
	readonly model: string;
	readonly schema?: Record<string, unknown>;
	readonly maxTurns?: number;
	/** A tool step: the bridge's config file and the tools it allows. */
	readonly tools?: { readonly mcpConfig: string; readonly allowedTools: readonly string[] };
}

/** Appended to every system prompt: Claude Code's environment block can't be turned off. */
const NO_WORKSPACE_NOTE =
	"This step has no workspace. The environment details you may see (working directory, whether it is a git repository, platform) describe the process running this step, not the project the step is about; ignore them.";

export function claudeArgs(invocation: ClaudeInvocation): string[] {
	const { tools } = invocation;
	const isolation =
		tools === undefined
			? ["--safe-mode"]
			: [
					"--setting-sources",
					"",
					"--disable-slash-commands",
					"--strict-mcp-config",
					"--mcp-config",
					tools.mcpConfig,
					"--allowedTools",
					tools.allowedTools.join(","),
					"--permission-mode",
					"dontAsk",
				];
	const args = [
		"-p",
		...isolation,
		"--model",
		invocation.model,
		"--tools",
		"",
		"--no-session-persistence",
		"--output-format",
		"json",
		"--system-prompt",
		invocation.system === "" ? NO_WORKSPACE_NOTE : `${invocation.system}\n\n${NO_WORKSPACE_NOTE}`,
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
	if (options.tools !== undefined && options.bridge === undefined) {
		throw new TypeError("tools need a bridge: pass bridge: mcpBridge() from @specsesh/agent/node");
	}
	const runner = options.runner ?? spawnRunner(options.binary ?? "claude", options.timeoutMs ?? 300_000, undefined, options.cwd);
	return {
		// `claude -p --output-format json` reports no text until the step ends; the stream
		// only hears of tool calls, which the bridge sees as they happen.
		async reason(request: ReasoningRequest, stream?: StreamSink): Promise<StepOutcome> {
			if (request.tools !== undefined) {
				if (options.tools === undefined || options.bridge === undefined) {
					return { kind: "failed", category: "invalid_request", message: TOOLS_NEED_DURABLE_HOST };
				}
				return runToolStep(request, request.tools, options.tools, options.bridge, runner, options, stream);
			}
			const processResult = await runner(claudeCodeArgs(request, options), request.prompt, claudeCodeEnv(process.env));
			const outcome = toClaudeCodeOutcome(processResult, request.outputSchema !== undefined);
			if (outcome.parsed !== undefined) options.onResult?.(outcome.parsed);
			return outcome.step;
		},
	};
}

/** Offer names that keep `mcp__agentscript__<name>` within Claude Code's 64 characters. */
const SERVABLE_NAME = /^[A-Za-z0-9_-]{1,48}$/;

/**
 * One tool step: the offers are served through a bridge, and one `claude -p`
 * calls them in its own loop. Each call is checked and run on the host as in the
 * pi loop, but Claude Code may make calls concurrently, so records are kept in
 * arrival order.
 */
async function runToolStep(
	request: ReasoningRequest,
	offers: readonly ToolOffer[],
	host: PiToolHost,
	bridge: ToolBridgeFactory,
	runner: Runner,
	options: ClaudeCodeReasoningPortOptions,
	stream: StreamSink | undefined,
): Promise<StepOutcome> {
	const unservable = offers.find((offer) => !SERVABLE_NAME.test(offer.name));
	if (unservable !== undefined) {
		return {
			kind: "failed",
			category: "invalid_request",
			message: `offered tool name ${unservable.name} can't be served to claude`,
		};
	}

	const byName = new Map(offers.map((offer) => [offer.name, offer]));
	const toolCalls: ToolCallRecord[] = [];
	const handler: BridgeHandler = async (name, args) => {
		const offer = byName.get(name);
		if (offer === undefined) {
			// Not recorded, as in the pi loop: the model can recover.
			return { ok: false, text: `no tool named "${name}" is offered on this step` };
		}
		const problems = checkToolArguments(offer.inputSchema, args);
		if (problems.length > 0) {
			const message = problems.join("; ");
			toolCalls.push({ name: offer.name, inputs: args, ok: false, outputs: {} });
			stream?.onDelta({ type: "tool_result", name: offer.name, ok: false, outputs: {}, message });
			return { ok: false, text: message };
		}
		// Bound inputs win over the model's, as under the durable host.
		const inputs = { ...args, ...offer.bound };
		stream?.onDelta({ type: "tool_call", name: offer.name, inputs });
		let result: ActionResult;
		try {
			result = await host({ name: offer.name, tool: offer.action, inputs });
		} catch (error) {
			result = { ok: false, message: error instanceof Error ? error.message : String(error) };
		}
		stream?.onDelta(
			result.ok
				? { type: "tool_result", name: offer.name, ok: true, outputs: result.outputs }
				: { type: "tool_result", name: offer.name, ok: false, outputs: {}, message: result.message },
		);
		toolCalls.push({
			name: offer.name,
			inputs,
			ok: result.ok,
			outputs: result.ok ? result.outputs : {},
			...(result.record !== undefined ? { record: result.record } : {}),
		});
		return result.ok ? { ok: true, text: JSON.stringify(result.outputs) } : { ok: false, text: result.message };
	};

	let running: ToolBridge;
	try {
		running = await bridge(
			offers.map((offer) => ({ name: offer.name, description: offer.description, inputSchema: offer.inputSchema })),
			handler,
		);
	} catch (error) {
		return {
			kind: "failed",
			category: "unknown",
			message: `could not start the tool bridge: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	try {
		const args = claudeCodeArgs(request, { ...options, maxTurns: options.maxTurns ?? DEFAULT_MAX_ROUNDS }, {
			mcpConfig: running.mcpConfig,
			allowedTools: running.allowedTools,
		});
		const processResult = await runner(args, request.prompt, claudeCodeEnv(process.env));
		const outcome = toClaudeCodeOutcome(processResult, request.outputSchema !== undefined);
		if (outcome.parsed !== undefined) options.onResult?.(outcome.parsed);
		return outcome.step.kind === "answered" ? { ...outcome.step, toolCalls: [...toolCalls] } : outcome.step;
	} finally {
		await running.close();
	}
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

export function spawnRunner(binary: string, timeoutMs: number, signal?: AbortSignal, cwd?: string): Runner {
	return async (args, input, env) => {
		// Run outside any project so no project-level settings are picked up either, and
		// in a directory of our own, so Claude Code finds nothing another process left there.
		let dir: string;
		try {
			dir = cwd ?? (await mkdtemp(join(tmpdir(), "agentscript-claude-")));
		} catch (error) {
			return { code: null, stdout: "", stderr: "", spawnError: error instanceof Error ? error : new Error(String(error)) };
		}
		try {
			return await spawnIn(dir, binary, args, input, env, timeoutMs, signal);
		} finally {
			if (cwd === undefined) await rm(dir, { recursive: true, force: true });
		}
	};
}

function spawnIn(
	cwd: string,
	binary: string,
	args: readonly string[],
	input: string,
	env: NodeJS.ProcessEnv,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<ProcessResult> {
	return new Promise((resolve) => {
		const child = spawn(binary, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
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
