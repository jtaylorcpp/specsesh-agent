/**
 * The `claude-code` process runner: one `claude -p --safe-mode` per delegate
 * call, in the workspace, on the grant's terms. argv comes from the terms
 * alone; the run's delegate preamble (inside a task loop) and the instructions
 * reach the process only on stdin, followed by the terms block. Never `--bare` (it
 * forces API-key auth) and never `--tools ""`. The environment drops
 * `ANTHROPIC_API_KEY` and `CLAUDECODE`; Claude Code's OAuth token is never read.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { claudeCodeEnv } from "../claude-code/claude-code.js";
import type { GrantKey, ProcessRunner } from "../durable/delegation.js";

export interface ClaudeCodeRunnerOptions {
	/** The `claude` binary. Defaults to `claude` on `PATH`. */
	readonly binary?: string;
}

const DEFAULT_TOOLS: readonly string[] = Object.freeze(["Read", "Edit", "Write", "Glob", "Grep", "Bash"]);
const NONE: readonly string[] = Object.freeze([]);

function stringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const GRANT_KEYS: Readonly<Record<string, GrantKey>> = {
	model: { check: (value) => (typeof value === "string" ? undefined : `must be a string, not ${JSON.stringify(value)}`) },
	tools: {
		check: (value) =>
			stringArray(value) && value.length > 0 ? undefined : `must be a non-empty array of strings, not ${JSON.stringify(value)}`,
		default: DEFAULT_TOOLS,
	},
	allow: {
		check: (value) => (stringArray(value) ? undefined : `must be an array of strings, not ${JSON.stringify(value)}`),
		default: NONE,
	},
	permissionMode: {
		check: (value) => (value === "dontAsk" ? undefined : `must be "dontAsk", not ${JSON.stringify(value)}`),
		default: "dontAsk",
	},
	context: {
		check: (value) => (stringArray(value) ? undefined : `must be an array of strings, not ${JSON.stringify(value)}`),
		default: NONE,
	},
};

/** The child's environment as plain strings: the parent's, minus what `claudeCodeEnv` strips. */
function childEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(claudeCodeEnv(process.env))) if (value !== undefined) env[key] = value;
	return env;
}

export function claudeCodeRunner({ binary = "claude" }: ClaudeCodeRunnerOptions = {}): ProcessRunner {
	return {
		kind: "process",
		label: "Claude Code",
		grantKeys: GRANT_KEYS,
		prepare({ instructions, terms, workspace }) {
			const context: string[] = [];
			for (const entry of terms["context"] as readonly string[]) {
				const file = resolve(workspace.root, entry);
				if (!existsSync(file)) return { error: `context file not found: ${entry} (${file})` };
				context.push(file);
			}
			const tools = terms["tools"] as readonly string[];
			const allow = terms["allow"] as readonly string[];
			const model = terms["model"] as string | undefined;
			const argv = [binary, "-p", "--safe-mode"];
			if (model !== undefined) argv.push("--model", model);
			argv.push("--output-format", "json", "--no-session-persistence", "--tools", tools.join(","), "--permission-mode", "dontAsk");
			for (const file of context) argv.push("--append-system-prompt-file", file);
			argv.push(
				"--allowedTools",
				...tools.filter((tool) => tool !== "Bash"),
				...(tools.includes("Bash") ? allow.map((word) => `Bash(${word}:*)`) : []),
			);
			return { argv, stdin: instructions, env: childEnv() };
		},
		read({ code, stdout, stderr }) {
			try {
				const parsed = JSON.parse(stdout) as { result?: unknown; is_error?: unknown };
				const summary = typeof parsed.result === "string" ? parsed.result : stdout;
				return { ok: code === 0 && parsed.is_error !== true, summary };
			} catch {
				return { ok: false, summary: (stdout + stderr).trim() || `Claude Code exited ${code} with no output` };
			}
		},
	};
}
