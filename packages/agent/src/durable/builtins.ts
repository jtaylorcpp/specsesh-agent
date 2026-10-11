/**
 * The five built-in host actions, confined to one workspace directory.
 *
 *   read_file             { path } → { content }                read     safe
 *   edit_file             { path, content } → { ok }            edit     safe
 *   run_command           { command } → { exit_code, output }   command  unsafe
 *   run_checks            { task_id } → { passed, output }      command  unsafe
 *   delegate_claude_code  { instructions } → { ok, summary }    delegate unsafe
 *
 * Every execution that changes or runs something puts an ontology record in its
 * result: `{ action, evidence }`, an `Action` (`openspec/loops`) and its
 * `Evidence` (`openspec/evidence`), each checked against its schema as it is
 * built. A record the ontology refuses is a bug here, and throws.
 *
 * Commands never go through a shell. `run_command` splits on whitespace into an
 * argv, so `pnpm test; rm -rf src` hands `pnpm` four arguments and starts no `rm`.
 *
 * `delegate_claude_code` keeps this project's hard lines: `claude -p --safe-mode`,
 * never `--bare`, `ANTHROPIC_API_KEY` and `CLAUDECODE` stripped, and Claude
 * Code's OAuth token never read, copied or forwarded — the child logs in as you.
 * It runs headless without ever prompting: `--permission-mode dontAsk` with an
 * `--allowedTools` list built from the same allowlist `run_command` uses, so a
 * tool use outside it comes back to Claude Code as a denial instead of a wait.
 */

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ActionResult } from "../interpreter/index.js";
import { claudeCodeEnv } from "../claude-code/claude-code.js";
import { Action, Evidence, check, explain } from "../openspec/index.js";
import type { HostAction } from "./actions.js";

/** What a built-in puts in its result's `record`. */
export interface ActionRecord {
	readonly action: Action;
	readonly evidence: readonly Evidence[];
}

/** Build a record, checking each part against the ontology before it leaves. */
function actionRecord(action: Action, evidence: readonly Evidence[]): ActionRecord {
	const parts: [typeof Action | typeof Evidence, unknown][] = [[Action, action], ...evidence.map((e) => [Evidence, e] as [typeof Evidence, unknown])];
	for (const [schema, value] of parts) {
		if (!check(schema, value)) {
			throw new Error(`a built-in action built a record the ontology refuses: ${explain(schema, value).join("; ")}`);
		}
	}
	return { action, evidence };
}

export interface BuiltinActionOptions {
	/** The directory every built-in is confined to and runs in. */
	readonly workspace: string;
	/** First words `run_command` may run. Empty: it runs nothing. */
	readonly allow?: readonly string[];
	/** Commands `run_checks` runs, in order. Empty: it refuses rather than pass vacuously. */
	readonly checks?: readonly string[];
	/** Per command (and per delegate run) before it is killed. Defaults to 10 minutes. */
	readonly timeoutMs?: number;
	/** The Claude Code binary `delegate_claude_code` runs. Defaults to `claude` on PATH. */
	readonly claudeBinary?: string;
	/** `--model` for the delegate. Unset: Claude Code's own default. */
	readonly delegateModel?: string;
	/** Files appended to the delegate's system prompt, in order, resolved against the workspace. */
	readonly delegateContext?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 600_000;
/** Claude Code's file tools, always allowed; `Bash` is enabled but allowed only per allowlist entry. */
const DELEGATE_FILE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"];

export function builtinActions(options: BuiltinActionOptions): HostAction[] {
	const workspace = resolve(options.workspace);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const allow = options.allow ?? [];
	const checks = options.checks ?? [];

	const readFileAction: HostAction = {
		name: "read_file",
		kind: "read",
		inputs: { path: "string" },
		outputs: { content: "string" },
		replay: "safe",
		async execute(inputs) {
			const path = String(inputs["path"]);
			const target = confine(workspace, path);
			if (typeof target !== "string") return target;
			if (!existsSync(target)) return { ok: false, message: `${path} does not exist in the workspace` };
			return { ok: true, outputs: { content: await readFile(target, "utf8") } };
		},
	};

	const editFileAction: HostAction = {
		name: "edit_file",
		kind: "edit",
		inputs: { path: "string", content: "string" },
		outputs: { ok: "boolean" },
		replay: "safe",
		async execute(inputs) {
			const path = String(inputs["path"]);
			const target = confine(workspace, path);
			if (typeof target !== "string") return target;
			const change = existsSync(target) ? "modified" : "added";
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, String(inputs["content"]));
			const ref = relative(workspace, target).split(sep).join("/");
			return {
				ok: true,
				outputs: { ok: true },
				record: actionRecord(
					{ kind: "edit", summary: `${change === "added" ? "create" : "replace"} ${ref}`, refs: [ref] },
					[{ kind: "diff", files: [{ path: ref, change }] }],
				),
			};
		},
	};

	const runCommandAction: HostAction = {
		name: "run_command",
		kind: "command",
		inputs: { command: "string" },
		outputs: { exit_code: "number", output: "string" },
		replay: "unsafe",
		async execute(inputs, context) {
			const command = String(inputs["command"]).trim();
			const argv = splitCommand(command);
			const first = argv[0];
			if (first === undefined) return { ok: false, message: "the command is empty" };
			if (!allow.includes(first)) {
				return {
					ok: false,
					message: `${first} is not on the allowlist (allowed: ${allow.join(", ") || "nothing"}); nothing was run`,
				};
			}
			const ran = await runArgv(argv, { cwd: workspace, timeoutMs, signal: context.signal });
			if (ran.kind === "timed-out") return { ok: false, message: `${command} timed out after ${timeoutMs}ms` };
			if (ran.kind === "spawn-error") return { ok: false, message: `${command} could not start: ${ran.message}` };
			return {
				ok: true,
				outputs: { exit_code: ran.code, output: ran.output },
				record: actionRecord({ kind: "command", summary: command, refs: [command] }, [
					{ kind: "check", command, exitCode: ran.code, output: ran.output },
				]),
			};
		},
	};

	const runChecksAction: HostAction = {
		name: "run_checks",
		kind: "command",
		inputs: { task_id: "string" },
		outputs: { passed: "boolean", output: "string" },
		replay: "unsafe",
		async execute(inputs, context) {
			if (checks.length === 0) {
				return { ok: false, message: "no checks configured, and an empty set of checks is not a pass" };
			}
			let passed = true;
			const sections: string[] = [];
			const evidence: Evidence[] = [];
			for (const command of checks) {
				const ran = await runArgv(splitCommand(command), { cwd: workspace, timeoutMs, signal: context.signal });
				const exitCode = ran.kind === "exited" ? ran.code : -1;
				const output =
					ran.kind === "exited"
						? ran.output
						: ran.kind === "timed-out"
							? `${ran.output}\n(timed out after ${timeoutMs}ms)`
							: `(could not start: ${ran.message})`;
				if (exitCode !== 0) passed = false;
				sections.push(`$ ${command}\n${output}\n(exit ${exitCode})`);
				evidence.push({ kind: "check", command, exitCode, output });
			}
			return {
				ok: true,
				outputs: { passed, output: sections.join("\n\n") },
				record: actionRecord(
					{ kind: "command", summary: `run the checks for task ${String(inputs["task_id"])}`, refs: [...checks] },
					evidence,
				),
			};
		},
	};

	const delegateAction: HostAction = {
		name: "delegate_claude_code",
		kind: "delegate",
		inputs: { instructions: "string" },
		outputs: { ok: "boolean", summary: "string" },
		replay: "unsafe",
		async execute(inputs, context) {
			const instructions = String(inputs["instructions"]);
			const binary = options.claudeBinary ?? "claude";
			const contextFiles = (options.delegateContext ?? []).map((file) => resolve(workspace, file));
			const missing = contextFiles.find((file) => !existsSync(file));
			if (missing !== undefined) {
				return { ok: false, message: `delegate context file ${missing} does not exist; Claude Code was not started` };
			}
			const args = delegateArgs({
				allow,
				...(options.delegateModel !== undefined ? { model: options.delegateModel } : {}),
				context: contextFiles,
			});
			const ran = await runArgv([binary, ...args], {
				cwd: workspace,
				timeoutMs,
				signal: context.signal,
				env: claudeCodeEnv(process.env),
				stdin: instructions,
				separate: true,
			});
			if (ran.kind === "timed-out") return { ok: false, message: `Claude Code timed out after ${timeoutMs}ms` };
			if (ran.kind === "spawn-error") return { ok: false, message: `Claude Code could not start: ${ran.message}` };
			const { ok, summary } = readDelegateResult(ran.code, ran.output, ran.stderr);
			const command = `${binary} ${args.slice(0, 2).join(" ")}`;
			return {
				ok: true,
				outputs: { ok, summary },
				record: actionRecord({ kind: "delegate", summary: firstLine(instructions), refs: [] }, [
					{ kind: "check", command, exitCode: ran.code, output: summary },
				]),
			};
		},
	};

	return [readFileAction, editFileAction, runCommandAction, runChecksAction, delegateAction];
}

export interface DelegateArgsOptions {
	/** First words the delegate's Bash may run: one `Bash(<word>:*)` each. */
	readonly allow: readonly string[];
	readonly model?: string;
	/** Absolute paths, each passed as `--append-system-prompt-file`. */
	readonly context?: readonly string[];
}

/**
 * The delegate's argv after the binary. `-p --safe-mode` first, then its tools,
 * `dontAsk` and the allowed list; never `--bare` (it forces API-key auth) and
 * never `--tools ""`. The instructions go on stdin.
 */
export function delegateArgs(options: DelegateArgsOptions): string[] {
	const args = ["-p", "--safe-mode"];
	if (options.model !== undefined) args.push("--model", options.model);
	args.push(
		"--output-format",
		"json",
		"--no-session-persistence",
		"--tools",
		[...DELEGATE_FILE_TOOLS, "Bash"].join(","),
		"--permission-mode",
		"dontAsk",
	);
	for (const file of options.context ?? []) args.push("--append-system-prompt-file", file);
	args.push("--allowedTools", ...DELEGATE_FILE_TOOLS, ...options.allow.map((word) => `Bash(${word}:*)`));
	return args;
}

function readDelegateResult(code: number, stdout: string, stderr: string): { ok: boolean; summary: string } {
	try {
		const parsed = JSON.parse(stdout) as { result?: unknown; is_error?: unknown };
		const summary = typeof parsed.result === "string" ? parsed.result : stdout;
		return { ok: code === 0 && parsed.is_error !== true, summary };
	} catch {
		return { ok: false, summary: (stdout + stderr).trim() || `Claude Code exited ${code} with no output` };
	}
}

function firstLine(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

/** Split a command line on whitespace. No quoting, no shell: what you see is the argv. */
export function splitCommand(command: string): string[] {
	return command.trim().split(/\s+/).filter((word) => word !== "");
}

/**
 * Resolve `path` inside the workspace, or the refusal. Refused: an absolute path,
 * a `..` escape, and a path whose real location (through any symlink on the way,
 * up to the deepest part that exists) leaves the workspace.
 */
export function confine(workspace: string, path: string): string | ActionResult {
	const refuse = (): ActionResult => ({ ok: false, message: `${path} is outside the workspace; nothing was read or written` });
	if (path === "" || isAbsolute(path)) return refuse();
	const root = realpathSync(workspace);
	const target = resolve(workspace, path);
	if (!inside(resolve(workspace), target)) return refuse();
	let existing = target;
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) return refuse();
		existing = parent;
	}
	if (!inside(root, realpathSync(existing))) return refuse();
	return target;
}

function inside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

type Ran =
	| { kind: "exited"; code: number; output: string; stderr: string }
	| { kind: "timed-out"; output: string }
	| { kind: "spawn-error"; message: string };

interface RunOptions {
	readonly cwd: string;
	readonly timeoutMs: number;
	readonly signal?: AbortSignal | undefined;
	readonly env?: NodeJS.ProcessEnv;
	readonly stdin?: string;
	/** Keep stderr apart from stdout in `output`, instead of interleaving them. */
	readonly separate?: boolean;
}

/** Spawn an argv with no shell, collecting its output, killing it past the timeout. */
function runArgv(argv: readonly string[], options: RunOptions): Promise<Ran> {
	const [binary, ...args] = argv;
	if (binary === undefined) return Promise.resolve({ kind: "spawn-error", message: "the command is empty" });
	return new Promise((resolvePromise) => {
		const child = spawn(binary, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let output = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, options.timeoutMs);
		const abort = () => child.kill("SIGKILL");
		options.signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => {
			if (options.separate === true) stderr += chunk.toString();
			else output += chunk.toString();
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
			resolvePromise({ kind: "spawn-error", message: error.message });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
			if (timedOut) resolvePromise({ kind: "timed-out", output });
			else resolvePromise({ kind: "exited", code: code ?? -1, output, stderr });
		});
		child.stdin.on("error", () => {});
		child.stdin.end(options.stdin ?? "");
	});
}

