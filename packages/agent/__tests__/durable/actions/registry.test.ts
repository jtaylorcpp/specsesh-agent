import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@earendil-works/pi-durable";
import type { ActionResult } from "../../../src/interpreter/index.js";
import { Action, Evidence, check, explain } from "../../../src/openspec/index.js";
import {
	ActionBindingError,
	AgentScript,
	AgentScriptStepExtension,
	agentScriptExtensions,
	createActionRegistry,
	startScript,
	workspaceActions,
	type HostAction,
} from "../../../src/durable/index.js";
import { builtinActions, localWorkspace } from "../../../src/node/index.js";
import { context, openHarness, setup } from "../helpers.js";
import { RUN_CHECKS_DEFINITION, subagentDocument } from "../../core/helpers/actions.js";

const dirs: string[] = [];
const savedPath = process.env.PATH;
let workspace: string;
let bin: string;

beforeEach(() => {
	workspace = temp("agentscript-ws-");
	bin = temp("agentscript-bin-");
});
afterEach(() => {
	process.env.PATH = savedPath;
	delete process.env.FAKE_LOG;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

/**
 * A fake executable in `bin`, run by this Node: it appends its argv, cwd, stdin
 * and environment to $FAKE_LOG as one JSON line, prints `stdout`, and exits with
 * `exit` (or 1 when its first argument is `fail-on`).
 */
function fake(name: string, options: { stdout?: string; failOn?: string; sleepMs?: number } = {}): void {
	const path = join(bin, name);
	writeFileSync(
		path,
		`#!${process.execPath}
const fs = require("node:fs");
let stdin = "";
try { stdin = fs.readFileSync(0, "utf8"); } catch {}
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ name: ${JSON.stringify(name)}, argv: process.argv.slice(2), cwd: process.cwd(), stdin, env: process.env }) + "\\n");
setTimeout(() => {
	process.stdout.write(${JSON.stringify(options.stdout ?? "")} || ("ran " + process.argv.slice(2).join(" ")));
	process.exit(process.argv[2] === ${JSON.stringify(options.failOn ?? "\u0000")} ? 1 : 0);
}, ${options.sleepMs ?? 0});
`,
	);
	chmodSync(path, 0o755);
}

/** Only the fake bin directory on PATH: a real `claude`, `pnpm` or `rm` cannot be found. */
function onlyFakesOnPath(): string {
	const log = join(bin, "log.jsonl");
	process.env.PATH = bin;
	process.env.FAKE_LOG = log;
	return log;
}

const logged = (log: string): { name: string; argv: string[]; cwd: string; stdin: string; env: Record<string, string> }[] =>
	existsSync(log)
		? readFileSync(log, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line))
		: [];

function builtins(options: Partial<Parameters<typeof builtinActions>[0]> = {}) {
	const actions = builtinActions({ workspace, ...options });
	return Object.fromEntries(actions.map((a) => [a.name, a])) as Record<string, HostAction>;
}

const exec = (action: HostAction | undefined, inputs: Record<string, string>) =>
	(action as HostAction).execute(inputs, { workspace });

/** A record's Action and Evidence, each checked against the ontology schemas. */
function ontologyRecord(result: ActionResult): { action: unknown; evidence: unknown[] } {
	const record = result.record as { action: unknown; evidence: unknown[] };
	expect(explain(Action, record.action)).toEqual([]);
	for (const evidence of record.evidence) expect(explain(Evidence, evidence)).toEqual([]);
	expect(check(Action, record.action)).toBe(true);
	return record;
}

const failure = (result: ActionResult) => (result.ok ? "" : result.message);

const SCRIPT_WITH_CHECKS = subagentDocument({
	name: "check",
	variables: 'task_id: mutable string = "2.4"\nchecks_passed: mutable boolean = False\ncheck_output: mutable string = ""',
	actions: RUN_CHECKS_DEFINITION,
	instructions:
		"run @actions.run_checks\n    with task_id = @variables.task_id\n    set @variables.checks_passed = @outputs.passed\n    set @variables.check_output = @outputs.output",
});

describe("actions/registry: A host action has a name, a kind, typed inputs and outputs, a replay policy and an executor", () => {
	it("Scenario: A host action declares everything the binding check needs", () => {
		const runChecks = builtins()["run_checks"];
		expect(runChecks?.kind).toBe("command");
		expect(runChecks?.inputs).toEqual({ task_id: "string" });
		expect(runChecks?.outputs).toEqual({ passed: "boolean", output: "string" });
		expect(runChecks?.replay).toBe("unsafe");
		expect(typeof runChecks?.execute).toBe("function");
	});
});

describe("actions/registry: An action registry maps names to host actions", () => {
	it("Scenario: A duplicate name is refused", () => {
		const runChecks = builtins()["run_checks"] as HostAction;
		expect(() => createActionRegistry([runChecks, { ...runChecks }])).toThrow(/run_checks/);
	});

	it("Scenario: No delegate is built in", () => {
		for (const actions of [builtinActions({ workspace }), workspaceActions(localWorkspace(workspace))]) {
			const names = actions.map((a) => a.name);
			expect(names).toEqual(["read_file", "edit_file", "run_command", "run_checks"]);
			expect(names).not.toContain("delegate_claude_code");
			expect(names.filter((name) => name.startsWith("delegate/"))).toEqual([]);
		}
	});

	it("a host may add its own actions beside the built-ins", () => {
		const actions = builtinActions({ workspace });
		const own: HostAction = { ...(actions[0] as HostAction), name: "deploy" };
		expect([...createActionRegistry([...actions, own]).keys()]).toContain("deploy");
	});
});

describe("actions/registry: A host installs the extensions with its registry", () => {
	it("Scenario: The plain extension refuses a script with actions", async () => {
		const env = setup();
		const harness = await openHarness(new MemoryStorage(), env);
		const error = await startScript(harness, SCRIPT_WITH_CHECKS, { model: env.model }, context).catch((e: unknown) => e);
		await harness.close(context);
		expect(error).toBeInstanceOf(ActionBindingError);
		expect((error as Error).message).toContain("run_checks");
		expect((error as Error).message).toContain("not registered");
		expect(env.requests).toHaveLength(0);
		// The plain exports carry the result tool only.
		expect(AgentScriptStepExtension.tools?.map((t) => t.name)).toEqual(["submit_result"]);
		expect(AgentScript.name).toBe("agentscript");
	});
});

describe("actions/registry: Bindings are checked whole before anything runs", () => {
	async function startWith(source: string, actions: HostAction[]) {
		const env = setup();
		const installed = agentScriptExtensions({ actions: createActionRegistry(actions), workspace });
		env.registry.install(installed.run);
		env.registry.install(installed.step);
		const harness = await openHarness(new MemoryStorage(), env);
		const error = await startScript(harness, source, { model: env.model }, context).catch((e: unknown) => e);
		await harness.close(context);
		return { error, env };
	}

	it("Scenario: An unregistered tool is refused up front", async () => {
		const source = SCRIPT_WITH_CHECKS.replace("mcpTool://run_checks", "mcpTool://deploy");
		const { error, env } = await startWith(source, builtinActions({ workspace }));
		expect(error).toBeInstanceOf(ActionBindingError);
		expect((error as Error).message).toContain("deploy");
		expect(env.requests).toHaveLength(0);
	});

	it("Scenario: A type mismatch is refused up front", async () => {
		const source = SCRIPT_WITH_CHECKS.replace("passed: boolean", "passed: string").replace(
			"checks_passed: mutable boolean = False",
			'checks_passed: mutable string = ""',
		);
		const { error, env } = await startWith(source, builtinActions({ workspace }));
		expect(error).toBeInstanceOf(ActionBindingError);
		const problem = (error as ActionBindingError).problems[0];
		expect(problem?.subagent).toBe("check");
		expect(problem?.action).toBe("run_checks");
		const message = (error as Error).message;
		for (const word of ["passed", "string", "boolean"]) expect(message).toContain(word);
		expect(env.requests).toHaveLength(0);
	});

	it("a script matching the registry starts", async () => {
		const { error } = await startWith(SCRIPT_WITH_CHECKS, builtinActions({ workspace }));
		expect(error).toBeTypeOf("number");
	});
});

describe("actions/registry: File actions are confined to the workspace", () => {
	it("Scenario: A parent-directory escape is refused", async () => {
		const result = await exec(builtins()["edit_file"], { path: "../outside.txt", content: "x" });
		expect(result.ok).toBe(false);
		expect(failure(result)).toContain("outside the workspace");
		expect(existsSync(join(workspace, "..", "outside.txt"))).toBe(false);
	});

	it("Scenario: A symlink out of the workspace is refused", async () => {
		symlinkSync("/etc", join(workspace, "link"));
		const result = await exec(builtins()["read_file"], { path: "link/passwd" });
		expect(result.ok).toBe(false);
		expect(failure(result)).toContain("outside the workspace");
	});

	it("refuses an absolute path, and an edit through a symlinked directory", async () => {
		const outside = temp("agentscript-outside-");
		symlinkSync(outside, join(workspace, "out"));
		const absolute = await exec(builtins()["read_file"], { path: "/etc/hostname" });
		expect(failure(absolute)).toContain("outside the workspace");
		const through = await exec(builtins()["edit_file"], { path: "out/new.txt", content: "x" });
		expect(failure(through)).toContain("outside the workspace");
		expect(existsSync(join(outside, "new.txt"))).toBe(false);
	});
});

describe("actions/registry: read_file and edit_file read and replace a file", () => {
	it("Scenario: An edit then a read round-trips", async () => {
		const actions = builtins();
		const edit = await exec(actions["edit_file"], { path: "src/a.ts", content: "hello" });
		expect(edit.ok).toBe(true);
		const read = await exec(actions["read_file"], { path: "src/a.ts" });
		expect(read).toEqual({ ok: true, outputs: { content: "hello" } });
		expect(actions["read_file"]?.replay).toBe("safe");
		expect(actions["edit_file"]?.replay).toBe("safe");
	});

	it("a missing file is a refusal naming it", async () => {
		const read = await exec(builtins()["read_file"], { path: "nope.ts" });
		expect(read.ok).toBe(false);
		expect(failure(read)).toContain("nope.ts");
	});
});

describe("actions/registry: run_command runs an allowlisted command without a shell", () => {
	it("Scenario: A chained command cannot smuggle a second command", async () => {
		fake("pnpm");
		fake("rm");
		const log = onlyFakesOnPath();
		mkdirSync(join(workspace, "src"));
		const result = await exec(builtins({ allow: ["pnpm"] })["run_command"], { command: "pnpm test; rm -rf src" });
		expect(result.ok).toBe(true);
		const runs = logged(log);
		expect(runs.map((r) => r.name)).toEqual(["pnpm"]);
		expect(runs[0]?.argv).toEqual(["test;", "rm", "-rf", "src"]);
		expect(runs[0]?.cwd).toBe(workspace);
		expect(existsSync(join(workspace, "src"))).toBe(true);
	});

	it("Scenario: An unlisted command is refused", async () => {
		fake("curl");
		const log = onlyFakesOnPath();
		const result = await exec(builtins({ allow: ["pnpm"] })["run_command"], { command: "curl example.com" });
		expect(result.ok).toBe(false);
		expect(failure(result)).toContain("not on the allowlist");
		expect(logged(log)).toEqual([]);
	});

	it("Scenario: A failing command is a result, not a refusal", async () => {
		fake("pnpm", { failOn: "test", stdout: "1 failed" });
		onlyFakesOnPath();
		const result = await exec(builtins({ allow: ["pnpm"] })["run_command"], { command: "pnpm test" });
		expect(result).toMatchObject({ ok: true, outputs: { exit_code: 1, output: "1 failed" } });
		const record = ontologyRecord(result);
		expect(record.action).toEqual({ kind: "command", summary: "pnpm test", refs: ["pnpm test"] });
		expect(record.evidence).toEqual([{ kind: "check", command: "pnpm test", exitCode: 1, output: "1 failed" }]);
	});

	it("a command past its timeout is killed and refused", async () => {
		fake("pnpm", { sleepMs: 5_000 });
		onlyFakesOnPath();
		const result = await exec(builtins({ allow: ["pnpm"], timeoutMs: 200 })["run_command"], { command: "pnpm test" });
		expect(result.ok).toBe(false);
		expect(failure(result)).toContain("timed out");
	});
});

describe("actions/registry: run_checks passes only when every configured check exits 0", () => {
	it("Scenario: One failing check fails the set", async () => {
		fake("pnpm", { failOn: "test" });
		onlyFakesOnPath();
		const result = await exec(builtins({ checks: ["pnpm check", "pnpm test"] })["run_checks"], { task_id: "2.4" });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.outputs["passed"]).toBe(false);
		expect(result.outputs["output"]).toContain("pnpm check");
		expect(result.outputs["output"]).toContain("pnpm test");
		const record = ontologyRecord(result);
		expect(record.evidence.map((e) => (e as { exitCode: number }).exitCode)).toEqual([0, 1]);
	});

	it("passes when every check exits 0", async () => {
		fake("pnpm");
		onlyFakesOnPath();
		const result = await exec(builtins({ checks: ["pnpm check", "pnpm test"] })["run_checks"], { task_id: "2.4" });
		expect(result.ok && result.outputs["passed"]).toBe(true);
	});

	it("Scenario: No checks is not a pass", async () => {
		const result = await exec(builtins()["run_checks"], { task_id: "2.4" });
		expect(result.ok).toBe(false);
		expect(failure(result)).toContain("no checks configured");
	});
});

describe("actions/registry: Every execution that changes the workspace records an Action and its Evidence", () => {
	it("Scenario: An edit records its diff", async () => {
		const result = await exec(builtins()["edit_file"], { path: "src/new.ts", content: "export {};" });
		const record = ontologyRecord(result);
		expect(record.action).toMatchObject({ kind: "edit", refs: ["src/new.ts"] });
		expect(record.evidence).toEqual([{ kind: "diff", files: [{ path: "src/new.ts", change: "added" }] }]);
		const again = await exec(builtins()["edit_file"], { path: "src/new.ts", content: "export const x = 1;" });
		expect(ontologyRecord(again).evidence).toEqual([{ kind: "diff", files: [{ path: "src/new.ts", change: "modified" }] }]);
	});

	it("Scenario: A read records nothing", async () => {
		writeFileSync(join(workspace, "a.txt"), "x");
		const result = await exec(builtins()["read_file"], { path: "a.txt" });
		expect(result.ok).toBe(true);
		const record = result.record as { action?: unknown; evidence?: unknown[] } | undefined;
		expect(record?.action).toBeUndefined();
		expect(record?.evidence ?? []).toEqual([]);
	});
});
