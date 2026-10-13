import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { WorkspaceError, type ExecOptions, type ExecResult, type Workspace } from "../../src/durable/index.js";
import type { LoopOutcome, TaskOutcome } from "../../src/openspec/index.js";
import { LoopWatcher, type StreamEvent, type TaskEvent } from "../../src/task/events.js";
import { judgeIteration } from "../../src/task/judge.js";
import type { IterationRead } from "../../src/task/iteration.js";
import type { LoopCheckpoint, TaskLoopInput } from "../../src/task/loop-input.js";
import { startTaskLoop, taskLoopExtensions, waitForTaskLoop, waitForTaskLoopResult } from "../../src/task/index.js";
import type { TaskLoopOptions } from "../../src/task/index.js";
import {
	cleanTemps,
	context,
	COUNT_CHECK,
	JUDGE_ONLY,
	loopEnv,
	loopHarness,
	runTasks,
	temp,
	tinyChange,
	verdict,
} from "./helpers.js";
import { setup } from "../durable/helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_HOOK = join(HERE, "..", "durable", "fixtures", "ts-resolve.mjs");

afterEach(cleanTemps);

// Commands are split on whitespace and run with no shell, so none of these contain a space.
const PASS = "node -e process.exit(0)";
const FAIL = "node -e process.exit(1)";

const REASON = (...failed: string[]) => `the judge said met, but the checks failed: ${failed.join(", ")}`;
const isTicked = (dir: string) => readFileSync(join(dir, "tasks.md"), "utf8").includes("- [x] 1.1");
/** How many rounds of `COUNT_CHECK` have run in the workspace. */
const rounds = (workspace: string) => {
	const file = join(workspace, "count.txt");
	return existsSync(file) ? readFileSync(file, "utf8").split("\n").length - 1 : 0;
};

const MET: IterationRead = { ok: true, plan: "", actions: [], evidence: [], met: true, unmet: "", nextAction: "retry", question: "", amendPath: "", amendText: "" };

function loopInput(checks: string[]): TaskLoopInput {
	return {
		task: "1.1",
		taskText: "",
		proposal: "",
		design: "",
		deltas: "",
		script: "",
		workspace: "/tmp",
		budget: { maxIterations: 8 },
		checks,
		allow: [],
		escalateTo: "principal",
		carried: "",
		earlier: [],
	};
}

/** One checkpoint the loop wrote: its phase, its iteration, and whether tasks.md was ticked just before the write. */
type Seen = { phase: string; iteration: number; ticked: boolean; checkpoint?: LoopCheckpoint };

/** MemoryStorage that lists every checkpoint the task loop writes, in order, and `terminal` for its outcome. */
class SpyStorage extends MemoryStorage {
	readonly seen: Seen[] = [];
	private readonly dir: string;
	constructor(dir: string) {
		super();
		this.dir = dir;
	}
	override async commit(writes: Parameters<MemoryStorage["commit"]>[0], ctx: Parameters<MemoryStorage["commit"]>[1]) {
		for (const write of writes) {
			if (write.type !== "task" || write.value.kind !== "agentscript.task-loop") continue;
			const state = write.value.state as unknown as { status: string; checkpoint?: LoopCheckpoint };
			const ticked = isTicked(this.dir);
			const entry: Seen | undefined =
				state.status === "terminal"
					? { phase: "terminal", iteration: 0, ticked }
					: state.checkpoint === undefined
						? undefined
						: { phase: state.checkpoint.phase, iteration: state.checkpoint.iterations.length + 1, ticked, checkpoint: state.checkpoint };
			const last = this.seen.at(-1);
			if (entry === undefined || (last?.phase === entry.phase && last.iteration === entry.iteration)) continue;
			this.seen.push(entry);
		}
		return super.commit(writes, ctx);
	}
}

/** A loop of JUDGE_ONLY over a tiny change, answering `responses`, on a storage that spies on the loop's checkpoints. */
async function spyLoop(
	responses: Parameters<ReturnType<typeof loopEnv>["env"]["faux"]["setResponses"]>[0],
	overrides: { checks?: string[]; budget?: { maxIterations: number }; workspace?: string } = {},
) {
	const dir = tinyChange();
	const { env, workspace } = loopEnv({ ...(overrides.workspace !== undefined ? { workspace: overrides.workspace } : {}), checks: overrides.checks ?? [] });
	const storage = new SpyStorage(dir);
	const harness = await loopHarness(env, storage);
	env.faux.setResponses(responses);
	const options: TaskLoopOptions = {
		change: { dir },
		task: "1.1",
		script: { text: JUDGE_ONLY },
		workspace,
		model: env.model,
		...(overrides.checks !== undefined ? { checks: overrides.checks } : {}),
		...(overrides.budget !== undefined ? { budget: overrides.budget } : {}),
	};
	const id = await startTaskLoop(harness, options, context);
	harness.resume();
	const { outcome } = await waitForTaskLoopResult(harness, id, context);
	const runs = await runTasks(storage);
	await harness.close(context);
	/** The loop's event stream, as the watcher reads it from the checkpoints and the outcome. */
	const events: TaskEvent[] = [];
	const watcher = new LoopWatcher(id, (event) => {
		if (isTaskEvent(event)) events.push(event);
	});
	for (const seen of storage.seen) if (seen.checkpoint !== undefined) watcher.observe(seen.checkpoint);
	watcher.finish(outcome);
	return { id, dir, workspace, outcome, env, storage, runs, seen: storage.seen, events };
}

const GROUP_EVENTS = new Set<string>(["group-started", "group-check", "rework", "group-ended"]);
const isTaskEvent = (event: StreamEvent): event is TaskEvent => !GROUP_EVENTS.has(event.event);

const carriedOf = (run: { input: unknown } | undefined) =>
	(run?.input as { options: { variables: { carried: string } } }).options.variables.carried;

describe("task/agent: Judge maps a failed run and a met verdict", () => {
	it("Scenario: A met verdict with checks goes to the gate", async () => {
		expect(judgeIteration(loopInput([PASS]), [], MET)).toEqual({ kind: "gate" });

		const r = await spyLoop([verdict(true)], { checks: [PASS] });
		const gate = r.seen.findIndex((s) => s.phase === "gate" && s.iteration === 1);
		expect(gate).toBeGreaterThan(-1);
		// Nothing is ticked when the gate checkpoint is written ...
		expect(r.seen[gate]?.ticked).toBe(false);
		// ... only the converged outcome after it is.
		const terminal = r.seen.findIndex((s) => s.phase === "terminal");
		expect(terminal).toBeGreaterThan(gate);
		expect(r.seen.slice(0, terminal).some((s) => s.ticked)).toBe(false);
		expect(isTicked(r.dir)).toBe(true);
	});

	it("Scenario: A met verdict converges", async () => {
		const r = await spyLoop([verdict(false, "not yet", "retry"), verdict(true)]);
		expect(r.outcome.status).toBe("converged");
		expect(r.outcome.iterations).toHaveLength(2);
		const [first, second] = r.outcome.iterations;
		expect(first?.verdict.met).toBe(false);
		expect(first?.feedback).toEqual([expect.objectContaining({ action: "retry" })]);
		expect(second?.verdict.met).toBe(true);
		expect(r.seen.some((s) => s.phase === "gate")).toBe(false);
		expect(isTicked(r.dir)).toBe(true);
	});
});

describe("task/agent: The gate converges a met verdict only when every check passes", () => {
	it("Scenario: Passing checks converge", async () => {
		const r = await spyLoop([verdict(true)], { checks: [COUNT_CHECK] });
		expect(r.outcome).toMatchObject({ status: "converged", result: { task: "1.1", ticked: true } });
		expect(r.outcome.iterations.at(-1)?.verdict.met).toBe(true);
		expect(isTicked(r.dir)).toBe(true);
		// The check ran, once: the gate was not skipped.
		expect(rounds(r.workspace)).toBe(1);
	});

	it("Scenario: Failing checks turn a met verdict into a retry", async () => {
		const r = await spyLoop([verdict(true), verdict(false, "stop", "ask", "which way?")], { checks: [FAIL], budget: { maxIterations: 8 } });
		const reason = REASON(`${FAIL} exited 1`);
		const first = r.outcome.iterations[0];
		expect(first?.n).toBe(1);
		expect(first?.verdict).toEqual({ met: false, satisfied: [], unmet: [{ target: { check: "task 1.1" }, reason }] });
		expect(first?.feedback).toHaveLength(1);
		expect(first?.feedback[0]).toMatchObject({ action: "retry", from: { kind: "code-defect" } });
		const evidence = first?.feedback[0]?.from.evidence;
		expect(evidence).toHaveLength(1);
		expect(evidence?.[0]).toMatchObject({ kind: "check", command: FAIL, exitCode: 1 });

		expect(r.events).toContainEqual(expect.objectContaining({ event: "verdict", iteration: 1, met: false, unmet: reason }));
		// Iteration 2 started: a second child run, and an iterate checkpoint for it.
		expect(r.runs).toHaveLength(2);
		expect(r.seen).toContainEqual(expect.objectContaining({ phase: "iterate", iteration: 2 }));
		expect(isTicked(r.dir)).toBe(false);
	});

	it("Scenario: A gate failure on the last iteration exhausts", async () => {
		const r = await spyLoop([verdict(true), verdict(true)], { checks: [FAIL], budget: { maxIterations: 2 } });
		const reason = REASON(`${FAIL} exited 1`);
		expect(r.outcome.status).toBe("exhausted");
		expect(r.outcome.iterations).toHaveLength(2);
		expect(r.outcome.iterations.map((i) => i.n)).toEqual([1, 2]);
		for (const iteration of r.outcome.iterations) {
			expect(iteration.verdict.met).toBe(false);
			expect(iteration.verdict.unmet.map((u) => u.reason)).toEqual([reason]);
		}
		expect(r.runs).toHaveLength(2);
		expect(isTicked(r.dir)).toBe(false);
	});
});

describe("task/agent: A gate failure carries the failing output", () => {
	it("Scenario: The next iteration sees what failed", async () => {
		const workspace = temp("task-ws-");
		const good = "node good.js";
		const bad = "node bad.js";
		writeFileSync(join(workspace, "good.js"), "process.stdout.write('CHECK-OK');");
		// A unique head, more than 5000 filler characters, then the line that names the failure; no trailing newline.
		const output = `HEAD-MARKER\n${"x".repeat(5200)}\n1 failed`;
		writeFileSync(join(workspace, "bad.js"), `process.stdout.write(${JSON.stringify(output)});process.exit(1);`);

		const r = await spyLoop([verdict(true), verdict(false, "x", "retry")], { checks: [good, bad], budget: { maxIterations: 2 }, workspace });
		const carried = carriedOf(r.runs[1]);

		const header = `$ ${bad} (exit 1)\n`;
		const reason = REASON(`${bad} exited 1`);
		expect(carried.startsWith(`${reason}\n\n`)).toBe(true);
		expect(carried).toContain(header);
		expect(carried).toContain("1 failed");
		// Cut to the last 4000 characters: the head is gone.
		expect(carried).not.toContain("HEAD-MARKER");
		const section = carried.slice(carried.indexOf(header) + header.length);
		expect(section.length).toBeLessThanOrEqual(4000);
		expect(section).toBe(output.slice(-4000));
		expect(carried).toBe(`${reason}\n\n${header}${output.slice(-4000)}`);
		// The passing check is not carried ...
		expect(carried).not.toContain(`$ ${good}`);
		expect(carried).not.toContain("CHECK-OK");
		// ... though the record keeps every check.
		expect(r.outcome.iterations[0]?.feedback[0]?.from.evidence).toEqual([
			expect.objectContaining({ command: good, exitCode: 0 }),
			expect.objectContaining({ command: bad, exitCode: 1 }),
		]);
	});
});

/** An in-memory workspace logging every `exec`, each answered `exited 0`; or, with `exec` false, one that cannot run commands. */
function recordingWorkspace(exec = true) {
	const execs: (readonly string[])[] = [];
	const workspace: Workspace = {
		root: "memory",
		read: async (path) => {
			throw new WorkspaceError("no such file", path);
		},
		write: async () => {},
		...(exec
			? {
					exec: async (argv: readonly string[], _options: ExecOptions): Promise<ExecResult> => {
						execs.push(argv);
						return { kind: "exited", code: 0, stdout: "", stderr: "" };
					},
				}
			: {}),
	};
	return { workspace, execs };
}

/** A loop of JUDGE_ONLY checking `pnpm test`, its extensions given `workspace` (the input keeps a directory). */
async function boundLoop(workspace: Workspace, responses: Parameters<ReturnType<typeof setup>["faux"]["setResponses"]>[0], maxIterations = 8) {
	const dir = tinyChange();
	const env = setup();
	for (const extension of taskLoopExtensions({ workspace, checks: ["pnpm test"] })) env.registry.install(extension);
	const harness = await loopHarness(env);
	env.faux.setResponses(responses);
	const options: TaskLoopOptions = {
		change: { dir },
		task: "1.1",
		script: { text: JUDGE_ONLY },
		workspace: temp("task-ws-"),
		model: env.model,
		checks: ["pnpm test"],
		budget: { maxIterations },
	};
	const id = await startTaskLoop(harness, options, context);
	harness.resume();
	const { outcome } = await waitForTaskLoopResult(harness, id, context);
	await harness.close(context);
	return { dir, outcome };
}

describe("actions/workspace: The loop's checks run through the workspace", () => {
	it("Scenario: The gate's checks go through the workspace", async () => {
		const { workspace, execs } = recordingWorkspace();
		const r = await boundLoop(workspace, [verdict(true)]);
		expect(execs).toEqual([["pnpm", "test"]]);
		expect(r.outcome.status).toBe("converged");
		expect(isTicked(r.dir)).toBe(true);
	});

	it("without exec the gate fails with `this workspace cannot run commands` and the iteration is unmet", async () => {
		const { workspace } = recordingWorkspace(false);
		const r = await boundLoop(workspace, [verdict(true)], 1);
		expect(r.outcome.status).toBe("exhausted");
		const first = r.outcome.iterations[0];
		expect(first?.verdict.met).toBe(false);
		expect(first?.feedback[0]?.from.evidence).toEqual([
			expect.objectContaining({ command: "pnpm test", output: "this workspace cannot run commands" }),
		]);
		expect(isTicked(r.dir)).toBe(false);
	});
});

describe("task/agent: The loop is one durable task with four phases", () => {
	it("Scenario: A crash during gate reruns the checks and starts no run", async () => {
		const dir = tinyChange();
		const workspace = temp("task-ws-");
		const dbPath = join(temp("task-crash-"), "loops.sqlite");
		let out = "";
		let signal: string | null = null;
		try {
			out = execFileSync(process.execPath, ["--import", TS_HOOK, join(HERE, "fixtures", "crash-gate-2-child.ts"), dbPath, dir, workspace], {
				encoding: "utf8",
				timeout: 60_000,
			});
		} catch (error) {
			const e = error as { stdout?: string; signal?: string | null };
			out = e.stdout ?? "";
			signal = e.signal ?? null;
		}
		expect(signal).toBe("SIGKILL");
		const id = Number(/LOOP (\d+)/.exec(out)?.[1]) as TaskId<LoopOutcome<TaskOutcome>>;
		expect(Number.isInteger(id)).toBe(true);

		const storage = await openNodeSqliteStorage(dbPath);
		const { env } = loopEnv({ workspace });
		env.faux.setResponses([]);
		const harness = await loopHarness(env, storage);
		const stranded = await harness.getTask(id, context);
		const checkpoint = (stranded?.state as { checkpoint?: { phase: string; iterations: unknown[] } }).checkpoint;
		// Iteration 1 was retry; the loop died with iteration 2's met verdict read and its checks not yet run.
		expect(checkpoint?.phase).toBe("gate");
		expect(checkpoint?.iterations).toHaveLength(1);
		const roundsBefore = rounds(workspace);
		const before = await runTasks(storage);
		expect(roundsBefore).toBe(0);
		expect(before).toHaveLength(2);

		harness.resume();
		const outcome = await waitForTaskLoop(harness, id, context);
		const after = await runTasks(storage);
		await harness.close(context);

		expect(outcome.status).toBe("converged");
		expect(outcome.iterations).toHaveLength(2);
		expect(rounds(workspace) - roundsBefore).toBe(1);
		expect(after.map((t) => t.id)).toEqual(before.map((t) => t.id));
		expect(env.requests).toHaveLength(0);
		expect(isTicked(dir)).toBe(true);
	}, 90_000);
});
