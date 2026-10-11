import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { RunResult, RunState } from "../../src/interpreter/index.js";
import { fauxAssistantMessage, fauxText, fauxToolCall, type Context as PiContext } from "@earendil-works/pi-ai";
import { MemoryStorage, type StorageWrite, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
	agentScriptExtensions,
	builtinActions,
	createActionRegistry,
	runScript,
	startScript,
	waitForScript,
	type HostAction,
} from "../../src/durable/index.js";
import { context, ENTRIES, openHarness, PIPELINE, setup } from "./helpers.js";
import { deterministicScript, hostAction, OFFERING, recordingAction } from "./action-scripts.js";
import { taskAgentFile } from "../core/helpers/actions.js";

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

/** MemoryStorage keeping every commit's writes, in order. */
class RecordingStorage extends MemoryStorage {
	readonly commits: StorageWrite[][] = [];
	override async commit(writes: readonly StorageWrite[], ctx: Parameters<MemoryStorage["commit"]>[1]) {
		this.commits.push([...writes]);
		return super.commit(writes, ctx);
	}
}

type Checkpoint = { phase: string; step?: number; intent?: { replay: string } | null; state: RunState };

/** The run task's committed checkpoints as labels (`act:null`, `act:unsafe`, …), then `terminal`. */
function runTaskLabels(commits: readonly StorageWrite[][]): { label: string; checkpoint?: Checkpoint }[] {
	const out: { label: string; checkpoint?: Checkpoint }[] = [];
	for (const write of commits.flat()) {
		if (write.type !== "task" || write.value.kind !== "agentscript.run") continue;
		const state = write.value.state;
		if (state.status === "pending") continue;
		if (state.status === "terminal") {
			out.push({ label: "terminal" });
			continue;
		}
		const checkpoint = state.checkpoint as unknown as Checkpoint;
		const label =
			checkpoint.phase === "act"
				? `act:${checkpoint.intent === null ? "null" : checkpoint.intent?.replay}`
				: checkpoint.step === undefined
					? checkpoint.phase
					: `${checkpoint.phase}:${checkpoint.step}`;
		if (out.at(-1)?.label === label) continue;
		out.push({ label, checkpoint });
	}
	return out;
}

/** A faux-model environment with Agent Script installed over the given host actions. */
function withActions(actions: HostAction[], workspace = temp("agentscript-ws-")) {
	const env = setup();
	const installed = agentScriptExtensions({ actions: createActionRegistry(actions), workspace });
	env.registry.install(installed.run);
	env.registry.install(installed.step);
	return { env, workspace };
}

/** pi-durable sends the system prompt as leading system messages: named sections, and the tools it adds. */
type SystemMessage = { role: string; sections?: Record<string, string>; toolsAdded?: { name: string }[] };
const systemMessages = (request: PiContext | undefined) =>
	((request?.messages ?? []) as unknown as SystemMessage[]).filter((m) => m.role === "system");
const toolNames = (request: PiContext | undefined) =>
	systemMessages(request).flatMap((m) => m.toolsAdded ?? []).map((t) => t.name);
const sections = (request: PiContext | undefined): Record<string, string> =>
	Object.assign({}, ...systemMessages(request).map((m) => m.sections ?? {}));
const userMessages = (request: PiContext | undefined) =>
	(request?.messages ?? [])
		.filter((m) => m.role === "user")
		.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join("")));

function crashAct(dbPath: string, action: string, workspace: string): { out: string; status: number | null } {
	try {
		const out = execFileSync(
			process.execPath,
			["--import", TS_HOOK, join(HERE, "fixtures", "crash-act-child.ts"), dbPath, action, workspace],
			{ encoding: "utf8", timeout: 60_000 },
		);
		return { out, status: 0 };
	} catch (error) {
		const e = error as { stdout?: string; status?: number | null };
		return { out: e.stdout ?? "", status: e.status ?? null };
	}
}

/** Crash a one-action run mid-action, then resume it in this process over `actions`. */
async function crashThenResume(action: "run_checks" | "run_command" | "edit_file", actions: HostAction[], workspace: string) {
	const dbPath = join(temp("agentscript-act-crash-"), "run.sqlite");
	const child = crashAct(dbPath, action, workspace);
	expect(child.out).toContain("CRASH");
	expect(child.status).toBe(137);
	const id = Number(/TASK (\d+)/.exec(child.out)?.[1]) as TaskId<RunResult>;
	expect(Number.isInteger(id)).toBe(true);

	const { env } = withActions(actions, workspace);
	const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
	const stranded = (await harness.getTask(id, context))?.state as { checkpoint?: Checkpoint };
	harness.resume();
	const result = await waitForScript(harness, id, context);
	await harness.close(context);
	return { result, stranded: stranded.checkpoint, env };
}

describe("durable/run-task: The act phase executes one action call with its intent recorded first", () => {
	it("Scenario: Intent is committed before execution", async () => {
		const storage = new RecordingStorage();
		let labelsAtExecution: string[] = [];
		const runChecks = hostAction("run_checks", async () => {
			labelsAtExecution = runTaskLabels(storage.commits).map((s) => s.label);
			return { ok: true, outputs: { passed: true, output: "ok" } };
		});
		const { env } = withActions([runChecks]);
		const harness = await openHarness(storage, env);
		const result = await runScript(harness, deterministicScript("run_checks"), { model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(labelsAtExecution).toEqual(["next", "act:null", "act:unsafe"]);
	});

	it("Scenario: A throwing action becomes a failed result", async () => {
		const runChecks = hostAction("run_checks", async () => {
			throw new Error("boom");
		});
		const { env } = withActions([runChecks]);
		const harness = await openHarness(new MemoryStorage(), env);
		const result = await runScript(harness, deterministicScript("run_checks"), { model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("failed");
		expect(result.actions.at(-1)?.result).toEqual({ ok: false, message: "boom" });
	});
});

describe("durable/run-task: An interrupted action follows its replay policy", () => {
	it("Scenario: An unsafe interrupted call is not executed on resume", async () => {
		const workspace = temp("agentscript-ws-");
		const { action, calls } = recordingAction("run_command", { ok: true, outputs: { exit_code: 0, output: "" } });
		const { result, stranded } = await crashThenResume("run_command", [action], workspace);

		expect(stranded).toMatchObject({ phase: "act", intent: { replay: "unsafe" } });
		expect(calls).toHaveLength(0);
		expect(result.actions.at(-1)?.result).toEqual({ ok: false, message: "run_command was interrupted and not re-run" });
	}, 90_000);
});

describe("durable/run-task: Offered action tools run as pi-durable tools with their replay policy", () => {
	it("Scenario: Bound inputs are merged into the call", async () => {
		const edit = recordingAction("edit_file", { ok: true, outputs: { ok: true } });
		const shell = recordingAction("run_command", { ok: true, outputs: { exit_code: 0, output: "" } });
		const { env } = withActions([edit.action, shell.action]);
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("note", { content: "x" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Noted.")]),
		]);
		const harness = await openHarness(new MemoryStorage(), env);
		const result = await runScript(harness, OFFERING, { model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(edit.calls).toEqual([{ path: "NOTES.md", content: "x" }]);
		expect(shell.calls).toHaveLength(0);
	});

	it("Scenario: A refused command is an error the model sees", async () => {
		const workspace = temp("agentscript-ws-");
		const actions = builtinActions({ workspace, allow: ["pnpm"] });
		const { env } = withActions(actions, workspace);
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("shell", { command: "curl example.com" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("I may not use curl.")]),
		]);
		const harness = await openHarness(new MemoryStorage(), env);
		// OFFERING's `shell` carries `set @variables.last_exit = @outputs.exit_code`:
		// a refused call is not a successful one, so it sets nothing and fails nothing.
		expect(OFFERING).toContain("set @variables.last_exit = @outputs.exit_code");
		const result = await runScript(harness, OFFERING, { model: env.model }, context);
		await harness.close(context);

		// The step went on to a second model request, which carried the error result.
		expect(env.requests).toHaveLength(2);
		const toolResult = env.requests[1]?.messages.find((m) => m.role === "toolResult");
		expect(toolResult?.role === "toolResult" && toolResult.isError).toBe(true);
		expect(JSON.stringify(toolResult)).toContain("not on the allowlist");
		expect(result.kind).toBe("completed");
		expect(result.steps[0]?.outcome).toMatchObject({ kind: "answered", text: "I may not use curl." });
		const calls = result.steps[0]?.outcome.kind === "answered" ? result.steps[0].outcome.toolCalls : undefined;
		expect(calls).toEqual([{ name: "shell", inputs: { command: "curl example.com" }, ok: false, outputs: {} }]);
		expect(result.variables["last_exit"]).toBe(99);
	});
});

describe("durable/run-task: A step's tool calls reach the machine in call order", () => {
	it("Scenario: Two shell calls are reported", async () => {
		let n = 0;
		const shell = hostAction("run_command", async (inputs) => {
			n += 1;
			return {
				ok: true,
				outputs: { exit_code: n === 1 ? 1 : 0, output: `run ${n}: ${String(inputs["command"])}` },
				record: { action: { kind: "command", summary: String(inputs["command"]), refs: [] }, evidence: [] },
			};
		});
		const edit = recordingAction("edit_file", { ok: true, outputs: { ok: true } });
		const { env } = withActions([shell, edit.action]);
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("shell", { command: "pnpm test" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("shell", { command: "pnpm check" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Both ran.")]),
		]);
		const harness = await openHarness(new MemoryStorage(), env);
		const result = await runScript(harness, OFFERING, { model: env.model }, context);
		await harness.close(context);

		const outcome = result.steps[0]?.outcome;
		expect(outcome?.kind).toBe("answered");
		const calls = outcome?.kind === "answered" ? outcome.toolCalls : undefined;
		expect(calls?.map((c) => c.name)).toEqual(["shell", "shell"]);
		expect(calls?.map((c) => c.ok)).toEqual([true, true]);
		expect(calls?.map((c) => c.inputs)).toEqual([{ command: "pnpm test" }, { command: "pnpm check" }]);
		expect(calls?.map((c) => c.outputs)).toEqual([
			{ exit_code: 1, output: "run 1: pnpm test" },
			{ exit_code: 0, output: "run 2: pnpm check" },
		]);
		expect(calls?.[0]?.record).toEqual({ action: { kind: "command", summary: "pnpm test", refs: [] }, evidence: [] });
		// The reasoning-action set took the last call's exit code.
		expect(result.variables["last_exit"]).toBe(0);
	});
});

describe("durable/run-task: Checkpoints have exactly three phases", () => {
	it("Scenario: A deterministic subagent walks next, act, next", async () => {
		const storage = new RecordingStorage();
		const { action } = recordingAction("run_checks", { ok: true, outputs: { passed: true, output: "ok" } });
		const { env } = withActions([action]);
		const harness = await openHarness(storage, env);
		const result = await runScript(harness, deterministicScript("run_checks"), { model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables).toMatchObject({ passed: true, after: "continued" });
		expect(runTaskLabels(storage.commits).map((s) => s.label)).toEqual(["next", "act:null", "act:unsafe", "next", "terminal"]);
		expect(env.requests).toHaveLength(0);
	});
});

describe("durable/run-task: The next phase asks the step machine and either finishes or schedules a dispatch", () => {
	it("Scenario: A finished machine ends the task completed", async () => {
		const storage = new RecordingStorage();
		const env = setup();
		const harness = await openHarness(storage, env);
		// `gate` alone is logic only: the very first next phase consumes every entry.
		const result = await runScript(harness, PIPELINE, { entry: "gate", model: env.model }, context);
		await harness.close(context);

		expect(runTaskLabels(storage.commits).map((s) => s.label)).toEqual(["next", "terminal"]);
		const terminal = storage.commits
			.flat()
			.find((w) => w.type === "task" && w.value.kind === "agentscript.run" && w.value.state.status === "terminal");
		const outcome = (terminal as Extract<StorageWrite, { type: "task" }>).value.state.outcome as unknown as { status: string; result: RunResult };
		expect(outcome.status).toBe("completed");
		expect(outcome.result.kind).toBe("completed");
		expect(result.kind).toBe("completed");
	});

	it("Scenario: A request moves the task to dispatch", async () => {
		const storage = new RecordingStorage();
		const env = setup();
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("submit_result", { severity: "low" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Queued.")]),
		]);
		const harness = await openHarness(storage, env);
		await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		await harness.close(context);

		const [first, second] = runTaskLabels(storage.commits);
		expect(first?.label).toBe("next");
		expect(second?.checkpoint).toMatchObject({ phase: "dispatch", step: 0 });
		expect(second?.checkpoint?.state.awaiting?.subagent).toBe("classify");
	});

	it("Scenario: An action call moves the task to act", async () => {
		const storage = new RecordingStorage();
		let executedBeforeAct = -1;
		const runChecks = hostAction("run_checks", async () => ({ ok: true, outputs: { passed: true, output: "ok" } }));
		const counted: HostAction = {
			...runChecks,
			execute: async (inputs, ctx) => {
				executedBeforeAct = Math.max(executedBeforeAct, 0) + 1;
				return runChecks.execute(inputs, ctx);
			},
		};
		const { env } = withActions([counted]);
		const harness = await openHarness(storage, env);
		await runScript(harness, deterministicScript("run_checks"), { model: env.model }, context);
		await harness.close(context);

		const act = runTaskLabels(storage.commits)[1];
		expect(act?.label).toBe("act:null");
		expect(act?.checkpoint?.intent).toBeNull();
		const awaiting = act?.checkpoint?.state.awaiting as { call?: { tool: string } } | undefined;
		expect(awaiting?.call?.tool).toBe("run_checks");
		// That commit came from the next phase; the action ran once, later, in act.
		const actCommit = storage.commits.findIndex((writes) =>
			writes.some(
				(w) =>
					w.type === "task" &&
					w.value.kind === "agentscript.run" &&
					(w.value.state as { checkpoint?: Checkpoint }).checkpoint?.phase === "act",
			),
		);
		expect(actCommit).toBeGreaterThan(-1);
		expect(executedBeforeAct).toBe(1);
	});
});

describe("durable/run-task: A step conversation is configured with the script's system block, the step extension, and only the tools the step needs", () => {
	it("Scenario: A structured step offers the result tool", async () => {
		const env = setup();
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("submit_result", { severity: "low" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Queued.")]),
		]);
		const harness = await openHarness(new MemoryStorage(), env);
		await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		await harness.close(context);
		expect(toolNames(env.requests[0])).toEqual(["submit_result"]);
		expect(sections(env.requests[0])["instructions"]).toContain("You triage bug reports.");
	});

	it("Scenario: A text-only step offers no tool", async () => {
		const env = setup();
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("submit_result", { severity: "low" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Queued.")]),
		]);
		const harness = await openHarness(new MemoryStorage(), env);
		await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		await harness.close(context);
		expect(toolNames(env.requests[1])).toEqual([]);
		expect(sections(env.requests[1])["result"]).toBeUndefined();
		expect(sections(env.requests[0])["result"]).toContain('"severity"');
	});

	it("Scenario: A step with reasoning actions offers its action tools", async () => {
		const workspace = temp("agentscript-ws-");
		const { env } = withActions(builtinActions({ workspace, allow: ["pnpm"], checks: ["pnpm test"] }), workspace);
		env.faux.setResponses([fauxAssistantMessage([fauxText("Nothing to change.")])]);
		const harness = await openHarness(new MemoryStorage(), env);
		const result = await runScript(harness, taskAgentFile("task.agent"), { entry: "act", model: env.model }, context);
		await harness.close(context);
		expect(result.kind).toBe("completed");
		expect(toolNames(env.requests[0])).toEqual(["read", "edit", "shell"]);
	});
});

describe("durable/run-task: A step sees only the system block, its own prompt, and the result tool", () => {
	it("Scenario: The second step does not see the first step's prompt", async () => {
		const env = setup();
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("submit_result", { severity: "low" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Queued.")]),
		]);
		const harness = await openHarness(new MemoryStorage(), env);
		await runScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, context);
		await harness.close(context);

		expect(env.requests).toHaveLength(2);
		expect(userMessages(env.requests[0])).toEqual(["Classify: it crashes"]);
		expect(userMessages(env.requests[1])).toEqual(["Write a routine reply about: it crashes"]);
		expect(JSON.stringify(env.requests[1])).not.toContain("Classify:");
		for (const request of env.requests) {
			for (const message of userMessages(request)) expect(message).not.toContain("You triage bug reports.");
		}
	});
});

describe("durable/run-task: A run survives its process dying and resumes from the last commit", () => {
	it("Scenario: A crash during an unsafe action is reported, not repeated", async () => {
		const workspace = temp("agentscript-ws-");
		const { action, calls } = recordingAction("run_checks", { ok: true, outputs: { passed: true, output: "ok" } });
		const { result, env } = await crashThenResume("run_checks", [action], workspace);

		expect(calls).toHaveLength(0);
		expect(result.kind).toBe("failed");
		const last = result.actions.at(-1);
		expect(last?.result.ok === false ? last.result.message : "").toContain("interrupted and not re-run");
		// Rolled back to before the subagent: its own logic line is not committed.
		expect(result.variables["stage"]).toBe("start");
		expect(env.requests).toHaveLength(0);
	}, 90_000);

	it("Scenario: A crash during a safe action re-runs it", async () => {
		const workspace = temp("agentscript-ws-");
		const real = builtinActions({ workspace }).find((a) => a.name === "edit_file") as HostAction;
		const calls: unknown[] = [];
		const edit: HostAction = {
			...real,
			execute: async (inputs, ctx) => {
				calls.push(inputs);
				return real.execute(inputs, ctx);
			},
		};
		const { result, stranded } = await crashThenResume("edit_file", [edit], workspace);

		expect(stranded).toMatchObject({ phase: "act", intent: { replay: "safe" } });
		expect(calls).toEqual([{ path: "src/a.ts", content: "hello" }]);
		expect(readFileSync(join(workspace, "src/a.ts"), "utf8")).toBe("hello");
		expect(result.kind).toBe("completed");
		expect(result.variables).toMatchObject({ edited: true, after: "continued", stage: "acting" });
	}, 90_000);
});

describe("the default task scripts, end to end on a faux model", () => {
	it("task.agent and task-delegate.agent run every subagent against a temp workspace", async () => {
		// Fake pnpm and claude, first on PATH for this test only: no real process of either.
		const bin = temp("agentscript-bin-");
		const { writeFileSync, chmodSync } = await import("node:fs");
		const write = (name: string, body: string) => {
			writeFileSync(join(bin, name), `#!${process.execPath}\n${body}\n`);
			chmodSync(join(bin, name), 0o755);
		};
		write("pnpm", 'process.stdout.write("ran " + process.argv.slice(2).join(" ")); process.exit(0);');
		write(
			"claude",
			'require("node:fs").writeFileSync("DELEGATED.md", "done"); process.stdout.write(JSON.stringify({ is_error: false, result: "Wrote DELEGATED.md" }));',
		);
		const savedPath = process.env.PATH;
		process.env.PATH = bin;
		try {
			for (const script of ["task.agent", "task-delegate.agent"] as const) {
				const workspace = temp("agentscript-ws-");
				const { env } = withActions(builtinActions({ workspace, allow: ["pnpm"], checks: ["pnpm test"] }), workspace);
				const judge = fauxAssistantMessage(
					[fauxToolCall("submit_result", { met: true, unmet: "", next_action: "retry", question: "" })],
					{ stopReason: "toolUse" },
				);
				const plan = fauxAssistantMessage([fauxToolCall("submit_result", { plan: "write src/a.ts" })], { stopReason: "toolUse" });
				env.faux.setResponses(
					script === "task.agent"
						? [
								plan,
								fauxAssistantMessage([fauxToolCall("edit", { path: "src/a.ts", content: "export {};" })], { stopReason: "toolUse" }),
								fauxAssistantMessage([fauxToolCall("shell", { command: "pnpm test" })], { stopReason: "toolUse" }),
								fauxAssistantMessage([fauxText("Wrote src/a.ts.")]),
								judge,
							]
						: [plan, judge],
				);
				const harness = await openHarness(new MemoryStorage(), env);
				const result = await runScript(
					harness,
					taskAgentFile(script),
					{ entry: ["orient", "act", "check", "judge"], variables: { task_id: "2.4" }, model: env.model },
					context,
				);
				await harness.close(context);

				expect(result.kind, script).toBe("completed");
				expect(result.variables).toMatchObject({ checks_passed: true, met: true });
				expect(String(result.variables["check_output"])).toContain("ran test");
				if (script === "task.agent") {
					expect(readFileSync(join(workspace, "src/a.ts"), "utf8")).toBe("export {};");
					expect(result.actions).toHaveLength(1);
				} else {
					expect(readFileSync(join(workspace, "DELEGATED.md"), "utf8")).toBe("done");
					expect(result.variables).toMatchObject({ act_ok: true, act_summary: "Wrote DELEGATED.md" });
					expect(result.actions.map((a) => a.call.tool)).toEqual(["delegate_claude_code", "run_checks"]);
				}
			}
		} finally {
			process.env.PATH = savedPath;
		}
	}, 60_000);
});
