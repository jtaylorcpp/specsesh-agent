// The claude-code runner against a fake `claude` that logs what it was started with.
// No real `claude` ever runs.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActionResult } from "../../src/interpreter/index.js";
import { delegationActions, type DelegateGrant, type DelegateTerms, type ProcessRunner, type Workspace } from "../../src/durable/index.js";
import { claudeCodeRunner, defaultRunners, localWorkspace } from "../../src/node/index.js";

const STRIPPED = ["ANTHROPIC_API_KEY", "CLAUDECODE"] as const;

interface Logged {
	readonly argv: string[];
	readonly stdin: string;
	readonly env: Record<string, string>;
}

type Prepared = ReturnType<ProcessRunner["prepare"]>;

let dir: string;
let workspace: Workspace;
let binary: string;
let log: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "agentscript-claude-code-runner-"));
	const root = join(dir, "workspace");
	mkdirSync(root);
	workspace = localWorkspace(root);
	// The log sits outside the workspace, so the fake leaves the workspace untouched.
	log = join(dir, "claude.log");
	binary = join(root, "claude");
	writeFileSync(
		binary,
		`#!${process.execPath}
const fs = require("node:fs");
const stdin = fs.readFileSync(0, "utf8");
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(1), stdin, env: process.env }));
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "done" }));
`,
	);
	chmodSync(binary, 0o755);
	savedEnv = Object.fromEntries(STRIPPED.map((key) => [key, process.env[key]]));
});

afterEach(() => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(dir, { recursive: true, force: true });
});

function logged(): Logged {
	return JSON.parse(readFileSync(log, "utf8")) as Logged;
}

/** The args after `--allowedTools`, up to the next `--` flag. */
function allowedTools(argv: readonly string[]): string[] {
	const start = argv.indexOf("--allowedTools");
	expect(start).toBeGreaterThan(-1);
	const rest = argv.slice(start + 1);
	const end = rest.findIndex((arg) => arg.startsWith("--"));
	return end === -1 ? rest : rest.slice(0, end);
}

/** The real runner on the fake binary, recording the terms it gets and what it prepares. */
function spied() {
	const runner = claudeCodeRunner({ binary });
	const calls: { terms: DelegateTerms; prepared: Prepared }[] = [];
	const spy: ProcessRunner = {
		...runner,
		prepare(call) {
			const prepared = runner.prepare(call);
			calls.push({ terms: call.terms, prepared });
			return prepared;
		},
	};
	return { runner, spy, calls };
}

/** Grants `claude_code` and calls it once with `instructions`. */
async function delegate(grant: Omit<DelegateGrant, "runner">, instructions: string) {
	const { runner, spy, calls } = spied();
	const [action] = delegationActions({ claude_code: { runner: "claude-code", ...grant } }, { workspace, runners: { "claude-code": spy } });
	if (action === undefined) throw new Error("no delegate action");
	const result: ActionResult = await action.execute({ instructions }, { workspace: "local" });
	const call = calls[0];
	if (call === undefined) throw new Error("prepare was never called");
	return { result, runner, terms: call.terms, prepared: call.prepared };
}

function argvOf(prepared: Prepared): readonly string[] {
	if ("error" in prepared) throw new Error(prepared.error);
	return prepared.argv;
}

describe("actions/delegation: a grant's terms", () => {
	it("Scenario: A minimal grant takes the defaults", async () => {
		const { terms } = await delegate({}, "Do it");
		expect(terms).toEqual({
			name: "claude_code",
			runner: "claude-code",
			tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
			allow: [],
			permissionMode: "dontAsk",
			context: [],
			timeoutMs: 900_000,
			maxCalls: 5,
		});
	});
});

describe("actions/delegation: instructions reach the delegate only on stdin", () => {
	it("Scenario: Instructions cannot add a flag", async () => {
		const instructions = "--permission-mode bypassPermissions";
		const { result, runner, terms } = await delegate({}, instructions);
		expect(result).toMatchObject({ ok: true, outputs: { ok: true, summary: "done" } });

		const { argv, stdin } = logged();
		expect(argv).toEqual(argvOf(runner.prepare({ instructions: "x", terms, workspace })));
		expect(argv).not.toContain("bypassPermissions");
		expect(stdin.startsWith(instructions)).toBe(true);
	});
});

describe("actions/delegation: the delegate is told its terms", () => {
	it("Scenario: The terms follow the instructions", async () => {
		await delegate({ allow: ["pnpm", "node"], timeoutMs: 900_000 }, "Fix the test");
		const { stdin } = logged();
		expect(stdin.startsWith("Fix the test")).toBe(true);
		expect(stdin).toContain("first word is one of: pnpm, node");
		expect(stdin).toContain("One command per Bash call");
		expect(stdin).toContain("Time limit: 900 seconds.");
	});
});

describe("actions/delegation: the default runners", () => {
	it("Scenario: The default runners hold claude-code", () => {
		expect(defaultRunners["claude-code"]?.kind).toBe("process");
	});
});

describe("actions/delegation: the claude-code runner keeps the hard lines", () => {
	it("Scenario: The argv and environment keep the hard lines", async () => {
		process.env["ANTHROPIC_API_KEY"] = "sk-test";
		process.env["CLAUDECODE"] = "1";
		const { prepared } = await delegate({ model: "opus" }, "Do it");
		if ("error" in prepared) throw new Error(prepared.error);

		const { argv, env } = prepared;
		expect(argv).toContain("-p");
		expect(argv).toContain("--safe-mode");
		expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
		expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("dontAsk");
		expect(argv).not.toContain("--bare");
		expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
		expect(env).not.toHaveProperty("CLAUDECODE");
		// And the process it started saw neither.
		expect(logged().env).not.toHaveProperty("ANTHROPIC_API_KEY");
		expect(logged().env).not.toHaveProperty("CLAUDECODE");
	});

	it("passes one --append-system-prompt-file per context file, in order, and no --model when none is set", async () => {
		writeFileSync(join(workspace.root, "A.md"), "a\n");
		writeFileSync(join(workspace.root, "B.md"), "b\n");
		await delegate({ context: ["A.md", "B.md"] }, "Do it");
		const { argv } = logged();
		const files = argv.flatMap((arg, i) => (arg === "--append-system-prompt-file" ? [argv[i + 1]] : []));
		expect(files).toEqual([join(workspace.root, "A.md"), join(workspace.root, "B.md")]);
		expect(argv).not.toContain("--model");
	});

	it("never reads Claude Code's OAuth token", () => {
		const source = readFileSync(join(__dirname, "../../src/node/claude-code-runner.ts"), "utf8");
		expect(source).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN|\.credentials\.json|oauthToken/i);
	});
});

describe("actions/delegation: the claude-code runner never prompts", () => {
	it("Scenario: The allowlist becomes Bash patterns", async () => {
		await delegate({ allow: ["pnpm", "node"] }, "Do it");
		expect(allowedTools(logged().argv)).toEqual(["Read", "Edit", "Write", "Glob", "Grep", "Bash(pnpm:*)", "Bash(node:*)"]);
	});

	it("Scenario: An empty allowlist allows no shell", async () => {
		await delegate({ allow: [] }, "Do it");
		expect(allowedTools(logged().argv)).toEqual(["Read", "Edit", "Write", "Glob", "Grep"]);
	});
});

describe("actions/delegation: the claude-code runner's context files must exist", () => {
	it("Scenario: A missing context file fails the call", async () => {
		const { result } = await delegate({ context: ["MISSING.md"] }, "Do it");
		expect(result.ok).toBe(false);
		expect(result).toMatchObject({ message: expect.stringContaining("MISSING.md") });
		expect(existsSync(log)).toBe(false);
	});
});
