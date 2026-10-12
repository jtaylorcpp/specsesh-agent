import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { RunResult } from "../../src/interpreter/index.js";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { MemoryStorage, type Harness, type StorageWrite, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
	ActionBindingError,
	AgentScriptRun,
	agentScriptExtensions,
	createActionRegistry,
	runScript,
	waitForScript,
	type HostAction,
	type RunCheckpoint,
	type RunInput,
	type WorkspaceSnapshot,
} from "../../src/durable/index.js";
import { context, openHarness, setup } from "./helpers.js";
import { deterministicScript, durableChecks, recordingAction } from "./action-scripts.js";

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

/** The `agentscript.run` task IDs the commits created, in order. */
function runTasks(commits: readonly StorageWrite[][]): number[] {
	const ids: number[] = [];
	for (const write of commits.flat()) {
		if (write.type === "task" && write.value.kind === "agentscript.run" && !ids.includes(Number(write.value.id))) {
			ids.push(Number(write.value.id));
		}
	}
	return ids;
}

/** One task's committed checkpoints as labels (`act:null`, `act:safe`, `act:safe+child`, …), then `terminal`. */
function labelsOf(commits: readonly StorageWrite[][], id: number): string[] {
	const out: string[] = [];
	for (const write of commits.flat()) {
		if (write.type !== "task" || Number(write.value.id) !== id) continue;
		const state = write.value.state;
		if (state.status === "pending") continue;
		let label = "terminal";
		if (state.status !== "terminal" && state.status !== "completing") {
			const checkpoint = state.checkpoint as unknown as RunCheckpoint;
			label =
				checkpoint.phase !== "act"
					? checkpoint.phase
					: `act:${checkpoint.intent === null ? "null" : checkpoint.intent.replay}${checkpoint.child !== undefined ? "+child" : ""}`;
		}
		if (out.at(-1) !== label) out.push(label);
	}
	return out;
}

function withActions(actions: HostAction[], snapshot?: () => Promise<WorkspaceSnapshot | undefined>) {
	const env = setup();
	const workspace = temp("agentscript-ws-");
	const installed = agentScriptExtensions({
		actions: createActionRegistry(actions),
		workspace,
		...(snapshot !== undefined ? { snapshot } : {}),
	});
	env.registry.install(installed.run);
	env.registry.install(installed.step);
	return { env, workspace, installed };
}

/**
 * Create the installed `agentscript.run` task with a whole `RunInput`, as `startScript`
 * does, so `scope` and `maxSteps` reach it.
 */
async function startRun(harness: Harness, run: ReturnType<typeof agentScriptExtensions>["run"], input: RunInput) {
	const task = (run.tasks?.find((t) => t.definition.name === AgentScriptRun.definition.name) ?? AgentScriptRun) as typeof AgentScriptRun;
	const root = await harness.root(context);
	return root.commit((tx) => tx.createTask(task, input, { ownership: { kind: "conversation" } }), context);
}

/** Three model steps that each only answer in text. */
const THREE_STEPS = `config:
    agent_name: "three"

system:
    instructions: "You answer briefly."

subagent a:
    description: "First"

    reasoning:
        instructions: ->
            | Say one.

subagent b:
    description: "Second"

    reasoning:
        instructions: ->
            | Say two.

subagent c:
    description: "Third"

    reasoning:
        instructions: ->
            | Say three.
`;

describe("durable/run-task: A run's scope limits the actions it may bind and call", () => {
	it("Scenario: An action outside the scope is refused", async () => {
		const read = recordingAction("read_file", { ok: true, outputs: { content: "" } });
		const edit = recordingAction("edit_file", { ok: true, outputs: { ok: true } });
		const { env, installed } = withActions([read.action, edit.action]);
		const harness = await openHarness(new MemoryStorage(), env);
		const error = await startRun(harness, installed.run, {
			source: deterministicScript("edit_file"),
			model: env.model,
			scope: ["read_file"],
		}).catch((e: unknown) => e);
		await harness.close(context);

		expect(error).toBeInstanceOf(ActionBindingError);
		expect((error as Error).message).toContain("edit_file");
		expect((error as Error).message).toContain("outside this run's scope");
		expect(env.faux.state.callCount).toBe(0);
		expect(edit.calls).toHaveLength(0);
	});
});

describe("durable/run-task: A run stops at its step limit", () => {
	it("Scenario: The third step is never asked", async () => {
		const { env, installed } = withActions([]);
		env.faux.setResponses([
			fauxAssistantMessage([fauxText("one")]),
			fauxAssistantMessage([fauxText("two")]),
			fauxAssistantMessage([fauxText("three")]),
		]);
		const harness = await openHarness(new MemoryStorage(), env);
		const id = await startRun(harness, installed.run, {
			source: THREE_STEPS,
			options: { entry: ["a", "b", "c"] },
			model: env.model,
			maxSteps: 2,
		});
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(env.faux.state.callCount).toBe(2);
		expect(result.kind).toBe("failed");
		const outcome = result.steps.at(-1)?.outcome;
		expect(outcome).toMatchObject({ kind: "failed", category: "unknown" });
		expect(outcome?.kind === "failed" ? outcome.message : "").toContain("reached its limit of 2 steps");
	});
});

describe("durable/run-task: A durable host action runs as a child task", () => {
	it("Scenario: A durable action's child is created once", async () => {
		const storage = new RecordingStorage();
		const checks = durableChecks();
		const shell = recordingAction("run_command", { ok: true, outputs: { exit_code: 0, output: "" } });
		const { env } = withActions([checks.action, shell.action]);
		const harness = await openHarness(storage, env);
		const result = await runScript(harness, deterministicScript("run_checks"), { model: env.model }, context);
		await harness.close(context);

		const [parent, child, ...more] = runTasks(storage.commits);
		expect(more).toEqual([]);
		expect(child).toBeDefined();
		expect(checks.starts).toEqual([{ task_id: "2.4" }]);
		expect(shell.calls).toHaveLength(1);
		expect(checks.finishes).toHaveLength(1);
		expect(checks.finishes[0]?.context.child).toBe(child);
		expect(result.kind).toBe("completed");
		expect(result.actions.at(-1)?.result).toEqual({ ok: true, outputs: { passed: true, output: `child ${child} completed` } });
		expect(result.variables["passed"]).toBe(true);
		expect(parent).toBeDefined();
	});

	it("walks next, act, act with its intent, act with its child, next", async () => {
		const storage = new RecordingStorage();
		const shell = recordingAction("run_command", { ok: true, outputs: { exit_code: 0, output: "" } });
		const { env } = withActions([durableChecks().action, shell.action]);
		const harness = await openHarness(storage, env);
		await runScript(harness, deterministicScript("run_checks"), { model: env.model }, context);
		await harness.close(context);

		const [parent] = runTasks(storage.commits);
		expect(labelsOf(storage.commits, parent!)).toEqual(["next", "act:null", "act:safe", "act:safe+child", "next", "terminal"]);
	});

	it("hands finish the snapshots taken before the child and after it", async () => {
		let taken = 0;
		const snapshot = async (): Promise<WorkspaceSnapshot> => new Map([["a.ts", `M:${++taken}`]]);
		const checks = durableChecks();
		const shell = recordingAction("run_command", { ok: true, outputs: { exit_code: 0, output: "" } });
		const { env } = withActions([checks.action, shell.action], snapshot);
		const harness = await openHarness(new MemoryStorage(), env);
		await runScript(harness, deterministicScript("run_checks"), { model: env.model }, context);
		await harness.close(context);

		expect(checks.finishes[0]?.context.before).toEqual(new Map([["a.ts", "M:1"]]));
		expect(checks.finishes[0]?.context.after).toEqual(new Map([["a.ts", "M:2"]]));
	});

	it("creates no child when start refuses, and the call fails with its message", async () => {
		const storage = new RecordingStorage();
		const checks = durableChecks({ ok: false, message: "delegate/reviewer reached its limit of 5 calls" });
		const shell = recordingAction("run_command", { ok: true, outputs: { exit_code: 0, output: "" } });
		const { env } = withActions([checks.action, shell.action]);
		const harness = await openHarness(storage, env);
		const result = await runScript(harness, deterministicScript("run_checks"), { model: env.model }, context);
		await harness.close(context);

		expect(runTasks(storage.commits)).toHaveLength(1);
		expect(checks.finishes).toHaveLength(0);
		expect(result.kind).toBe("failed");
		expect(result.actions.at(-1)?.result).toEqual({ ok: false, message: "delegate/reviewer reached its limit of 5 calls" });
	});

	it("waits on resume for the child it stored, creating none", async () => {
		const workspace = temp("agentscript-ws-");
		const dbPath = join(temp("agentscript-durable-act-crash-"), "run.sqlite");
		let out = "";
		let status: number | null = 0;
		try {
			out = execFileSync(
				process.execPath,
				["--import", TS_HOOK, join(HERE, "fixtures", "crash-durable-act-child.ts"), dbPath, workspace],
				{ encoding: "utf8", timeout: 60_000 },
			);
		} catch (error) {
			const e = error as { stdout?: string; status?: number | null };
			out = e.stdout ?? "";
			status = e.status ?? null;
		}
		expect(out).toContain("CRASH");
		expect(status).toBe(137);
		const id = Number(/TASK (\d+)/.exec(out)?.[1]) as TaskId<RunResult>;

		const checks = durableChecks();
		const shell = recordingAction("run_command", { ok: true, outputs: { exit_code: 0, output: "" } });
		const env = setup();
		const installed = agentScriptExtensions({ actions: createActionRegistry([checks.action, shell.action]), workspace });
		env.registry.install(installed.run);
		env.registry.install(installed.step);
		const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
		const stranded = ((await harness.getTask(id, context))?.state as { checkpoint?: RunCheckpoint }).checkpoint;
		harness.resume();
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(stranded).toMatchObject({ phase: "act", intent: { replay: "safe" } });
		const child = stranded?.phase === "act" ? stranded.child : undefined;
		expect(child).toBeDefined();
		expect(checks.starts).toHaveLength(0);
		expect(checks.finishes.map((f) => f.context.child)).toEqual([child]);
		// The same child resumed: its interrupted unsafe call was reported, not re-run.
		expect(shell.calls).toHaveLength(0);
		expect(result.kind).toBe("completed");
		expect(result.actions.at(-1)?.result).toEqual({ ok: true, outputs: { passed: false, output: `child ${child} completed` } });
	}, 90_000);
});
