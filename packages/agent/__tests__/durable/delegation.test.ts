// A smoke test of the delegation mechanism over an in-memory workspace and a fake runner.
// The `actions/delegation` scenarios are pinned in delegation-grants and delegation-records.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { ActionResult, RunResult } from "../../src/interpreter/index.js";
import {
	DelegateGrantError,
	agentScriptExtensions,
	createActionRegistry,
	delegationActions,
	runScript,
	waitForScript,
	type ActionContext,
	type DelegateGrants,
	type ExecOptions,
	type ExecResult,
	type HostAction,
	type ProcessRunner,
	type Workspace,
} from "../../src/durable/index.js";
import { localWorkspace } from "../../src/node/index.js";
import { hostAction } from "./action-scripts.js";
import { DELEGATE_THEN_OFFER, delegateTwice, fakeClaude, fakeClaudeRunner } from "./delegation-scripts.js";
import { context, openHarness, setup } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_HOOK = join(HERE, "fixtures", "ts-resolve.mjs");
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

interface Exec {
	readonly argv: readonly string[];
	readonly options: ExecOptions;
}

/** Files in a Map; `exec` writes `out.txt` (or answers `answer`) and records its call; `snapshot` reads the Map. */
function memory(options: { exec?: boolean; answer?: ExecResult } = {}) {
	const files = new Map<string, string>([["a.txt", "a"]]);
	const execs: Exec[] = [];
	const workspace: Workspace = {
		root: "memory",
		async read(path) {
			const content = files.get(path);
			if (content === undefined) throw new Error(`no such file: ${path}`);
			return content;
		},
		async write(path, content) {
			files.set(path, content);
		},
		async snapshot() {
			return new Map([...files].map(([path, content]) => [path, `??:${content}`]));
		},
		...(options.exec === false
			? {}
			: {
					async exec(argv: readonly string[], execOptions: ExecOptions): Promise<ExecResult> {
						execs.push({ argv, options: execOptions });
						if (options.answer !== undefined) return options.answer;
						files.set("out.txt", "made");
						return { kind: "exited", code: 0, stdout: "done", stderr: "" };
					},
				}),
	};
	return { workspace, files, execs };
}

const fake: ProcessRunner = {
	kind: "process",
	label: "Fake",
	grantKeys: {
		allow: {
			check: (value) => (Array.isArray(value) && value.every((v) => typeof v === "string") ? undefined : "must be a list of strings"),
			default: [],
		},
	},
	prepare: ({ instructions }) => ({ argv: ["fake", "--go"], stdin: instructions, env: {} }),
	read: (exited) => ({ ok: exited.code === 0, summary: exited.stdout }),
};

function call(action: HostAction | undefined, instructions: string, context: Partial<ActionContext> = {}): Promise<ActionResult> {
	if (action === undefined) throw new Error("no such action");
	return action.execute({ instructions }, { workspace: "memory", ...context });
}

describe("delegation smoke test", () => {
	it("builds one delegate/<name> per grant, kind delegate, replay unsafe", () => {
		const { workspace } = memory();
		const actions = delegationActions({ one: { runner: "fake" }, two: { runner: "fake" } }, { workspace, runners: { fake } });
		expect(actions.map((a) => [a.name, a.kind, a.replay])).toEqual([
			["delegate/one", "delegate", "unsafe"],
			["delegate/two", "delegate", "unsafe"],
		]);
		expect(actions[0]?.inputs).toEqual({ instructions: "string" });
		expect(actions[0]?.outputs).toEqual({ ok: "boolean", summary: "string", files_changed: "number" });
	});

	it("runs the process with the terms on stdin and records its diff", async () => {
		const { workspace, execs } = memory();
		const [action] = delegationActions({ one: { runner: "fake", allow: ["pnpm", "node"], timeoutMs: 900_000 } }, { workspace, runners: { fake } });
		const result = await call(action, "Fix the test\nmore detail");

		expect(execs).toHaveLength(1);
		expect(execs[0]?.argv).toEqual(["fake", "--go"]);
		expect(execs[0]?.options.timeoutMs).toBe(900_000);
		const stdin = execs[0]?.options.stdin ?? "";
		expect(stdin.startsWith("Fix the test\nmore detail\n\nYour terms for this delegation")).toBe(true);
		expect(stdin.endsWith(
			[
				"- Shell: only commands whose first word is one of: pnpm, node.",
				"- One command per Bash call. Chained or prefixed commands (cd … &&, ;, |) are denied; use the tool's own flags, e.g. pnpm -C <dir> or pnpm --filter <pkg>.",
				"- Time limit: 900 seconds.",
			].join("\n"),
		)).toBe(true);

		expect(result).toMatchObject({ ok: true, outputs: { ok: true, summary: "done", files_changed: 1 } });
		const record = (result as { record: { action: unknown; evidence: unknown[] } }).record;
		expect(record.action).toEqual({ kind: "delegate", summary: "Fix the test", refs: ["delegate/one"] });
		expect(record.evidence).toEqual([
			{ kind: "diff", files: [{ path: "out.txt", change: "added" }] },
			{ kind: "check", command: "fake --go", exitCode: 0, output: "done" },
		]);
	});

	it("says Shell: none without an allowlist", async () => {
		const { workspace, execs } = memory();
		const [action] = delegationActions({ one: { runner: "fake" } }, { workspace, runners: { fake } });
		await call(action, "x");
		expect(execs[0]?.options.stdin).toContain("- Shell: none.\n");
		expect(execs[0]?.options.stdin).toContain("- Time limit: 900 seconds.");
	});

	it("answers ok: false past maxCalls without running anything", async () => {
		const { workspace, execs } = memory();
		const [action] = delegationActions({ one: { runner: "fake", maxCalls: 2 } }, { workspace, runners: { fake } });
		const asked: string[] = [];
		const priorCalls = (name: string) => (asked.push(name), 2);
		expect(await call(action, "x", { priorCalls })).toEqual({
			ok: true,
			outputs: { ok: false, summary: "delegate one reached its limit of 2 calls in this run", files_changed: -1 },
		});
		expect(asked).toEqual(["delegate/one"]);
		expect(execs).toHaveLength(0);
	});

	it("fails without exec", async () => {
		const { workspace } = memory({ exec: false });
		const [action] = delegationActions({ one: { runner: "fake" } }, { workspace, runners: { fake } });
		expect(await call(action, "x")).toEqual({ ok: false, message: "this workspace cannot run processes" });
	});

	it("fails a timed-out process, recording it", async () => {
		const { workspace } = memory({ answer: { kind: "timed-out", stdout: "", stderr: "" } });
		const [action] = delegationActions({ one: { runner: "fake", timeoutMs: 200 } }, { workspace, runners: { fake } });
		const result = await call(action, "x");
		expect(result).toMatchObject({ ok: false, message: "Fake timed out after 200ms" });
		expect((result as { record: { evidence: unknown[] } }).record.evidence).toMatchObject([{ kind: "check", exitCode: -1 }]);
	});

	it("reports -1 files changed without snapshots", async () => {
		const { workspace } = memory();
		const blind: Workspace = { ...workspace, snapshot: async () => undefined };
		const [action] = delegationActions({ one: { runner: "fake" } }, { workspace: blind, runners: { fake } });
		const result = await call(action, "x");
		expect(result).toMatchObject({ ok: true, outputs: { files_changed: -1 } });
		expect((result as { record: { evidence: { kind: string }[] } }).record.evidence.map((e) => e.kind)).toEqual(["check"]);
	});

	it.each<[string, DelegateGrants, string, string[]]>([
		["an unknown runner", { good: { runner: "fake" }, bad: { runner: "codex" } }, "runner", ["codex", "fake"]],
		["a bad maxCalls", { good: { runner: "fake" }, bad: { runner: "fake", maxCalls: 0 } }, "maxCalls", []],
		["an unknown key", { good: { runner: "fake" }, bad: { runner: "fake", tools: ["Read"] } }, "tools", []],
		["a bad runner key", { good: { runner: "fake" }, bad: { runner: "fake", allow: "pnpm" } }, "allow", []],
	])("refuses %s whole, naming the grant and the key", (_, grants, key, mentions) => {
		const { workspace } = memory();
		let thrown: unknown;
		let built: HostAction[] | undefined;
		try {
			built = delegationActions(grants, { workspace, runners: { fake } });
		} catch (error) {
			thrown = error;
		}
		expect(built).toBeUndefined();
		expect(thrown).toBeInstanceOf(DelegateGrantError);
		const error = thrown as DelegateGrantError;
		expect([error.grant, error.key]).toEqual(["bad", key]);
		for (const word of ["bad", key, ...mentions]) expect(error.message).toContain(word);
	});
});

describe("delegation maxCalls, counted from the run's own reports", () => {
	/** A faux-model environment whose registry holds a `claude_code` grant of `maxCalls` on a fake `claude`, plus `extra`. */
	function granted(maxCalls: number, extra: HostAction[] = []) {
		const workspace = temp("agentscript-ws-");
		const claude = fakeClaude(temp("agentscript-bin-"));
		const delegates = delegationActions(
			{ claude_code: { runner: "fake", maxCalls } },
			{ workspace: localWorkspace(workspace), runners: { fake: fakeClaudeRunner(claude.binary) } },
		);
		const env = setup();
		const installed = agentScriptExtensions({ actions: createActionRegistry([...extra, ...delegates]), workspace });
		env.registry.install(installed.run);
		env.registry.install(installed.step);
		return { env, workspace, claude };
	}

	it("refuses the second run call of a one-call grant, starting one process", async () => {
		const { env, claude } = granted(1);
		const harness = await openHarness(new MemoryStorage(), env);
		const result = await runScript(harness, delegateTwice(), { model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables).toMatchObject({ first_ok: true, second_ok: false });
		expect(result.variables["second_summary"]).toBe("delegate claude_code reached its limit of 1 calls in this run");
		expect(claude.starts()).toBe(1);
	});

	it("counts a step's tool calls on top of the run calls before it", async () => {
		const { env, claude } = granted(2);
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("hand_off", { instructions: "second" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("hand_off", { instructions: "third" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Handed off.")]),
		]);
		const harness = await openHarness(new MemoryStorage(), env);
		const result = await runScript(harness, DELEGATE_THEN_OFFER, { entry: ["first", "offer"], model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables["first_ok"]).toBe(true);
		const outcome = result.steps.at(-1)?.outcome;
		const calls = outcome?.kind === "answered" ? (outcome.toolCalls ?? []) : [];
		expect(calls.map((c) => c.outputs)).toEqual([
			{ ok: true, summary: "delegated", files_changed: -1 },
			{ ok: false, summary: "delegate claude_code reached its limit of 2 calls in this run", files_changed: -1 },
		]);
		expect(claude.starts()).toBe(2);
	});

	it("still holds after the process dies between the calls and the run resumes", async () => {
		const workspace = temp("agentscript-ws-");
		const claude = fakeClaude(temp("agentscript-bin-"));
		const dbPath = join(temp("agentscript-delegate-crash-"), "run.sqlite");
		let out = "";
		let status: number | null = 0;
		try {
			out = execFileSync(
				process.execPath,
				["--import", TS_HOOK, join(HERE, "fixtures", "crash-delegate-child.ts"), dbPath, workspace, claude.binary],
				{ encoding: "utf8", timeout: 60_000 },
			);
		} catch (error) {
			const e = error as { stdout?: string; status?: number | null };
			out = e.stdout ?? "";
			status = e.status ?? null;
		}
		expect(out).toContain("CRASH");
		expect(status).toBe(137);
		expect(claude.starts()).toBe(1);
		const id = Number(/TASK (\d+)/.exec(out)?.[1]) as TaskId<RunResult>;

		// A fresh process: the same grant, nothing carried over in memory.
		const pause = hostAction("read_file", async () => ({ ok: true, outputs: { content: "resumed" } }));
		const delegates = delegationActions(
			{ claude_code: { runner: "fake", maxCalls: 1 } },
			{ workspace: localWorkspace(workspace), runners: { fake: fakeClaudeRunner(claude.binary) } },
		);
		const env = setup();
		const installed = agentScriptExtensions({ actions: createActionRegistry([pause, ...delegates]), workspace });
		env.registry.install(installed.run);
		env.registry.install(installed.step);
		const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
		harness.resume();
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables).toMatchObject({ first_ok: true, paused: "resumed", second_ok: false });
		expect(result.variables["second_summary"]).toContain("reached its limit of 1 calls");
		expect(claude.starts()).toBe(1);
	}, 90_000);
});
