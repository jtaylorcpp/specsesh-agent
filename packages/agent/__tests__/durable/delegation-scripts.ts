/**
 * A fake `claude` and the runner that starts it, plus scripts that delegate, for
 * the delegation tests and their crash fixture. No real `claude` ever runs.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcessRunner } from "../../src/durable/index.js";

/**
 * Writes an executable fake `claude` into `dir`. Each start appends a line to its
 * marker file and prints a summary; `starts()` counts the lines.
 */
export function fakeClaude(dir: string): { binary: string; starts: () => number } {
	const binary = join(dir, "claude");
	const marker = join(dir, "starts.log");
	writeFileSync(
		binary,
		`#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(marker)}, "start\\n");\nprocess.stdout.write("delegated");\n`,
	);
	chmodSync(binary, 0o755);
	const starts = () => (existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean).length : 0);
	return { binary, starts };
}

/** A runner that starts `binary` with the instructions on stdin, and no environment. */
export function fakeClaudeRunner(binary: string): ProcessRunner {
	return {
		kind: "process",
		label: "Fake Claude",
		grantKeys: {},
		prepare: ({ instructions }) => ({ argv: [binary], stdin: instructions, env: {} }),
		read: (exited) => ({ ok: exited.code === 0, summary: exited.stdout.trim() }),
	};
}

/** This process's environment as plain strings, as a host runner hands its child. */
function inheritedEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
	return env;
}

/**
 * A host process runner of the kind a host brings (the package bundles none): it starts
 * `binary` with the instructions on stdin and reads a Claude Code-style JSON reply,
 * `{ result, is_error }`, falling back to the raw output. Grant keys `model` and `allow`.
 */
export function jsonRunner(binary = "claude"): ProcessRunner {
	const strings = (value: unknown) =>
		Array.isArray(value) && value.every((item) => typeof item === "string") ? undefined : `must be an array of strings, not ${JSON.stringify(value)}`;
	return {
		kind: "process",
		label: "Claude Code",
		grantKeys: {
			model: { check: (value) => (typeof value === "string" ? undefined : `must be a string, not ${JSON.stringify(value)}`) },
			allow: { check: strings, default: [] },
		},
		prepare: ({ instructions }) => ({ argv: [binary], stdin: instructions, env: inheritedEnv() }),
		read({ code, stdout, stderr }) {
			try {
				const parsed = JSON.parse(stdout) as { result?: unknown; is_error?: unknown };
				return { ok: code === 0 && parsed.is_error !== true, summary: typeof parsed.result === "string" ? parsed.result : stdout };
			} catch {
				return { ok: false, summary: (stdout + stderr).trim() || `Claude Code exited ${code} with no output` };
			}
		},
	};
}

/** `delegate` targeting `mcpTool://delegate/<grant>`, with the delegate signature. */
export function delegateDefinition(grant: string): string {
	return `        delegate:
            description: "Hand the work to a delegate"
            inputs:
                instructions: string
            outputs:
                ok: boolean
                summary: string
                files_changed: number
            target: "mcpTool://delegate/${grant}"
`;
}

/**
 * Two deterministic `run @actions.delegate` calls on `claude_code`. With `pause`,
 * a safe `read_file` call sits between them, for the crash fixture to die in.
 */
export function delegateTwice(options: { pause?: boolean } = {}): string {
	const pause = options.pause === true;
	return `config:
    agent_name: "delegate-twice"

variables:
    first_ok: mutable boolean = False
    paused: mutable string = ""
    second_ok: mutable boolean = True
    second_summary: mutable string = ""

subagent act:
    description: "Delegate twice"

    actions:
${delegateDefinition("claude_code")}${
		pause
			? `        read_file:
            description: "Read a file in the workspace"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"
`
			: ""
	}
    reasoning:
        instructions: ->
            run @actions.delegate
                with instructions = "first"
                set @variables.first_ok = @outputs.ok
${
	pause
		? `            run @actions.read_file
                with path = "pause.txt"
                set @variables.paused = @outputs.content
`
		: ""
}            run @actions.delegate
                with instructions = "second"
                set @variables.second_ok = @outputs.ok
                set @variables.second_summary = @outputs.summary
`;
}

/**
 * `first` makes one `run` call of `delegate`; `offer` is a model step offering it
 * as the tool `hand_off`. Run with `entry: ["first", "offer"]`.
 */
export const DELEGATE_THEN_OFFER = `config:
    agent_name: "delegate-then-offer"

system:
    instructions: |
        You hand work off.

variables:
    first_ok: mutable boolean = False

subagent first:
    description: "Delegate once"

    actions:
${delegateDefinition("claude_code")}
    reasoning:
        instructions: ->
            run @actions.delegate
                with instructions = "first"
                set @variables.first_ok = @outputs.ok

subagent offer:
    description: "Let the model delegate"

    actions:
${delegateDefinition("claude_code")}
    reasoning:
        instructions: ->
            | Hand off the rest.
        actions:
            hand_off: @actions.delegate
                with instructions = ...
`;

/** A script with no delegate action: one model step and nothing else. */
export const NO_DELEGATE = `config:
    agent_name: "no-delegate"

system:
    instructions: "You answer."

subagent answer:
    description: "Answer"

    reasoning:
        instructions: ->
            | Say hi.
`;
