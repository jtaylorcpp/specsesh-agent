import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject, TaskId } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupOutcome, Iteration, LoopOutcome, TaskOutcome, check } from "../../src/openspec/index.js";
import { TaskLoopStartError } from "../../src/task/index.js";
import {
	DEFAULT_MAX_REWORKS,
	GROUP_LOOP_NAME,
	GROUP_LOOP_VERSION,
	GroupLoopTask,
	blockedBy,
	buildGroupOutcome,
	decodeCheckpoint,
	encodeCheckpoint,
	endedGroup,
	finishGroup,
	recordEntry,
	roundIteration,
	taskLoopInputFor,
	type GroupEntry,
	type GroupLoopInput,
	formatCheckOutput,
	initialGroupCheckpoint,
	type GroupCheckpoint,
	findGroup,
	readGroupInput,
	resolveGroupOptions,
	validateGroupStart,
	type GroupLoopOptions,
} from "../../src/task/group.js";
import type { GroupVerdict } from "../../src/task/group-judge.js";
import { DELTA, JUDGE_ONLY, PROPOSAL } from "./helpers.js";

// Every file read, so a test can count one read per source.
const reads = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	const readFileSync = ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
		reads.paths.push(String(path));
		return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
	}) as typeof fs.readFileSync;
	return { ...fs, readFileSync, default: { ...fs, readFileSync } };
});

const temps: string[] = [];
afterEach(() => {
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TASKS = [
	"## 1. Setup",
	"",
	"- [x] 1.1 first",
	"- [ ] 1.2 second",
	"  - [X] 1.3 third, indented",
	"",
	"## 2. Build",
	"",
	"- [ ] 2.1 later group",
	"",
].join("\n");

const options = (over: Partial<GroupLoopOptions> = {}): GroupLoopOptions => ({
	change: { proposal: { text: PROPOSAL }, deltas: [{ text: DELTA }], tasks: { text: TASKS } },
	group: 1,
	script: { text: JUDGE_ONLY },
	groupScript: { text: JUDGE_ONLY },
	workspace: "/tmp/ws",
	checks: ["pnpm test"],
	...over,
});

const refusal = (fn: () => unknown) => {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(TaskLoopStartError);
		return (error as Error).message;
	}
	throw new Error("expected a refusal");
};

describe("task/group: A group is found by its number in tasks.md", () => {
	it("Scenario: An unknown group lists the groups", () => {
		const message = refusal(() => validateGroupStart(options({ group: 9 })));
		expect(message).toBe("no group 9 in tasks.md; groups: 1, 2");
	});

	it("Scenario: A group needs a check", () => {
		expect(refusal(() => validateGroupStart(options({ checks: [] })))).toContain("at least one check");
		expect(refusal(() => validateGroupStart(options({ checks: undefined })))).toContain("at least one check");
	});

	it("an empty group is refused", () => {
		expect(refusal(() => findGroup("## 3. Empty\n\nnotes only\n## 4. Next\n- [ ] 4.1 x\n", 3))).toBe("group 3 has no tasks");
	});

	it("refuses in order: options, then the group, then the checks", () => {
		expect(refusal(() => validateGroupStart(options({ group: 0, checks: [] })))).toContain("group must be a positive integer");
		expect(refusal(() => validateGroupStart(options({ group: 9, checks: [] })))).toContain("no group 9");
	});

	it("ticked and unticked lines come out in file order, bounded by the next heading", () => {
		const found = findGroup(TASKS, 1);
		expect(found.title).toBe("Setup");
		expect(found.tasks).toEqual([
			{ id: "1.1", text: "first", ticked: true },
			{ id: "1.2", text: "second", ticked: false },
			{ id: "1.3", text: "third, indented", ticked: true },
		]);
		expect(findGroup(TASKS, 2).tasks.map((t) => t.id)).toEqual(["2.1"]);
	});
});

describe("task/group: Group options are the task options with a group, a judge script and a rework budget", () => {
	it("Scenario: Defaults for a group", () => {
		const { groupScript: _omit, ...rest } = options();
		const resolved = resolveGroupOptions(rest);
		expect(resolved.groupScript).toEqual({ bundled: "group" });
		expect(resolved.budget.maxReworks).toBe(DEFAULT_MAX_REWORKS);
		expect(DEFAULT_MAX_REWORKS).toBe(2);
		expect(resolved.budget.maxIterations).toBe(3);
	});

	it("rejects maxReworks 0 and a group that is not a positive integer", () => {
		expect(refusal(() => resolveGroupOptions(options({ budget: { maxReworks: 0 } })))).toContain("budget.maxReworks");
		expect(refusal(() => resolveGroupOptions(options({ group: 1.5 })))).toContain("group must be a positive integer");
		expect(refusal(() => resolveGroupOptions(options({ group: -1 })))).toContain("group");
	});

	it("reads each source once, into an input that survives JSON", () => {		const dir = mkdtempSync(join(tmpdir(), "group-"));
		temps.push(dir);
		const paths = {
			proposal: join(dir, "proposal.md"),
			delta: join(dir, "specs", "a", "spec.md"),
			tasks: join(dir, "tasks.md"),
			script: join(dir, "task.agent"),
			groupScript: join(dir, "group.agent"),
		};
		writeFileSync(paths.proposal, PROPOSAL);
		writeFileSync(paths.tasks, TASKS);
		writeFileSync(paths.script, JUDGE_ONLY);
		writeFileSync(paths.groupScript, JUDGE_ONLY);
		mkdirSync(join(dir, "specs", "a"), { recursive: true });
		writeFileSync(paths.delta, DELTA);

		reads.paths.length = 0;
		const input = readGroupInput(
			resolveGroupOptions(
				options({
					change: { proposal: { path: paths.proposal }, deltas: [{ path: paths.delta }], tasks: { path: paths.tasks } },
					script: { path: paths.script },
					groupScript: { path: paths.groupScript },
				}),
			),
		);
		for (const path of Object.values(paths)) expect(reads.paths.filter((p) => p === path)).toHaveLength(1);
		expect(input.tasksPath).toBe(paths.tasks);
		expect(input.groupTitle).toBe("Setup");
		expect(JSON.parse(JSON.stringify(input))).toEqual(input);
	});
});

describe("task/group: The group loop is a durable task over a queue", () => {
	const input = () => validateGroupStart(options({ change: { proposal: { text: PROPOSAL }, deltas: [{ text: DELTA }], tasks: { text: TASKS } } }));

	// Runs the `next` phase against a runtime that records what it commits.
	const runNext = async (checkpoint: GroupCheckpoint) => {
		const committed: unknown[] = [];
		const runtime = {
			commit: async (fn: () => unknown) => {
				committed.push(fn());
			},
		};
		const handler = GroupLoopTask.definition.phases.next as unknown as (t: unknown, r: unknown, c: unknown) => Promise<void>;
		await handler({ state: { checkpoint: encodeCheckpoint(checkpoint) }, input: input() }, runtime, undefined);
		const { status, checkpoint: out } = committed[0] as { status: string; checkpoint: JsonObject };
		return { status, checkpoint: decodeCheckpoint(out) };
	};

	it("is agentscript.group-loop, version 1", () => {
		expect(GroupLoopTask.definition.name).toBe(GROUP_LOOP_NAME);
		expect(GROUP_LOOP_NAME).toBe("agentscript.group-loop");
		expect(GroupLoopTask.definition.version).toBe(GROUP_LOOP_VERSION);
		expect(GROUP_LOOP_VERSION).toBe(1);
	});

	it("Scenario: A ticked task is not run again", () => {
		const checkpoint = initialGroupCheckpoint(input().tasks);
		expect(checkpoint.phase).toBe("next");
		expect(checkpoint.queue).toEqual(["1.2"]);
		expect(checkpoint.reworks).toBe(0);
		const ticked = checkpoint.entries.filter((e) => e.task === "1.1" || e.task === "1.3");
		expect(ticked.map((e) => [e.task, e.runs, e.outcome.status])).toEqual([
			["1.1", 0, "converged"],
			["1.3", 0, "converged"],
		]);
		expect(ticked[0]?.outcome).toEqual({ status: "converged", iterations: [], result: { task: "1.1", ticked: true } });
		expect(JSON.parse(JSON.stringify(checkpoint))).toEqual(checkpoint);
	});

	it("Scenario: The next phase pops the queue head", async () => {
		const start = { ...initialGroupCheckpoint(input().tasks), queue: ["1.1", "1.2"] };
		const { status, checkpoint } = await runNext(start);
		expect(status).toBe("running");
		expect(checkpoint).toEqual({ ...start, phase: "task", queue: ["1.2"], child: { task: "1.1" } });
	});

	it("Scenario: An empty queue goes to the check", async () => {
		const { checkpoint } = await runNext({ ...initialGroupCheckpoint(input().tasks), queue: [], child: { task: "1.2" } });
		expect(checkpoint.phase).toBe("check");
		expect(checkpoint.queue).toEqual([]);
		expect(checkpoint.child).toBeUndefined();
	});

	it("queues the unticked tasks in file order", () => {
		const cp = initialGroupCheckpoint([
			{ id: "1.1", ticked: false },
			{ id: "1.2", ticked: true },
			{ id: "1.3", ticked: false },
		]);
		expect(cp.queue).toEqual(["1.1", "1.3"]);
		expect(cp.entries.map((e) => e.task)).toEqual(["1.2"]);
	});

	it("a ticked entry is a converged outcome with no iterations", () => {
		const entry = initialGroupCheckpoint([{ id: "1.1", ticked: true }]).entries[0];
		expect(entry?.outcome).toEqual({ status: "converged", iterations: [], result: { task: "1.1", ticked: true } });
	});

	it("Scenario: A task ticked before the group loop has no runs", () => {
		const entry = initialGroupCheckpoint(input().tasks).entries.find((e) => e.task === "1.1");
		expect(entry?.runs).toBe(0);
		expect(entry?.outcome.status).toBe("converged");
	});

	it("a ticked entry's outcome passes the ontology check", () => {
		for (const entry of initialGroupCheckpoint(input().tasks).entries) {
			expect(check(LoopOutcome(TaskOutcome), entry.outcome)).toBe(true);
		}
	});

	it("round-trips through encode and decode, with no undefined values", () => {
		const cp: GroupCheckpoint = { ...initialGroupCheckpoint(input().tasks), phase: "task", carried: "note", child: { task: "1.2" } };
		const encoded = encodeCheckpoint(cp);
		expect(decodeCheckpoint(encoded)).toEqual(cp);
		expect(JSON.parse(JSON.stringify(encoded))).toEqual(encoded);
		const { carried: _carried, child: _child, ...bare } = cp;
		expect(Object.keys(encodeCheckpoint(bare))).toEqual(["phase", "queue", "entries", "reworks", "iterations"]);
		const withId = encodeCheckpoint({ ...cp, child: { task: "1.2", id: 7 as TaskId } });
		expect(decodeCheckpoint(withId).child).toEqual({ task: "1.2", id: 7 });
	});

	describe("the task phase", () => {
		type Outcome = (typeof initialGroupCheckpoint extends (...a: never[]) => infer C ? C : never)["entries"][number]["outcome"];
		const converged = (task: string): Outcome => ({ status: "converged", iterations: [], result: { task, ticked: true } });
		const blocked = (): Outcome => ({
			status: "blocked",
			iterations: [],
			escalation: { level: "task", to: "principal", reason: "needs-decision: ask", question: "Which API?" },
		});

		// Runs the `task` phase against a fake runtime: records created children and commits;
		// `settled` is what waiting on any child returns.
		const runTask = async (checkpoint: GroupCheckpoint, settled?: Outcome, groupInput = input()) => {
			const created: { input: { task: string; carried: string } }[] = [];
			const committed: { status: string; checkpoint?: JsonObject; outcome?: { result: { outcome: JsonObject; notes: string[] } } }[] = [];
			const runtime = {
				taskId: 1 as TaskId,
				commit: async (fn: (tx: unknown) => unknown) => {
					const tx = {
						createTask: async (_def: unknown, taskInput: { task: string; carried: string }) => {
							created.push({ input: taskInput });
							return 42 as TaskId;
						},
					};
					committed.push((await fn(tx)) as (typeof committed)[number]);
				},
				waitForTask: async () => ({ state: { outcome: { status: "completed", result: { outcome: settled, notes: [] } } } }),
			};
			const handler = GroupLoopTask.definition.phases.task as unknown as (t: unknown, r: unknown, c: unknown) => Promise<void>;
			await handler({ state: { checkpoint: encodeCheckpoint(checkpoint) }, input: groupInput }, runtime, undefined);
			return { created, commit: committed[0] as (typeof committed)[number] };
		};

		// The group's outcome as the task committed it, checked against the ontology before it is typed.
		const endedOutcome = (commit: { outcome?: { result: { outcome: JsonObject } } }): LoopOutcome<GroupOutcome> => {
			const stored = commit.outcome?.result.outcome;
			expect(stored).toBeDefined();
			expect(check(LoopOutcome(GroupOutcome), stored!)).toBe(true);
			return stored as unknown as LoopOutcome<GroupOutcome>;
		};

		const atTask = (over: Partial<GroupCheckpoint> = {}): GroupCheckpoint => ({
			...initialGroupCheckpoint(input().tasks),
			phase: "task",
			queue: ["1.2"],
			child: { task: "1.2" },
			...over,
		});

		it("starts the child once, and stores its id in the same commit", async () => {
			const { created, commit } = await runTask(atTask({ carried: "fix the test" }));
			expect(created).toHaveLength(1);
			expect(created[0]?.input).toMatchObject({ task: "1.2", taskText: "second", carried: "fix the test" });
			expect(commit.status).toBe("waiting");
			expect(decodeCheckpoint(commit.checkpoint as JsonObject).child).toEqual({ task: "1.2", id: 42 });
		});

		it("Scenario: Killed during a task", async () => {
			const { created, commit } = await runTask(atTask({ child: { task: "1.2", id: 42 as TaskId } }), converged("1.2"));
			expect(created).toHaveLength(0);
			const cp = decodeCheckpoint(commit.checkpoint as JsonObject);
			expect(cp.entries.find((e) => e.task === "1.2")?.runs).toBe(1);
		});

		it("Scenario: A converged task is recorded", async () => {
			const { commit } = await runTask(atTask({ child: { task: "1.2", id: 42 as TaskId }, carried: "x" }), converged("1.2"));
			expect(commit.status).toBe("running");
			const cp = decodeCheckpoint(commit.checkpoint as JsonObject);
			expect(cp.phase).toBe("next");
			expect(cp.child).toBeUndefined();
			expect(cp.carried).toBeUndefined();
			const entries = cp.entries.filter((e) => e.task === "1.2");
			expect(entries).toHaveLength(1);
			expect(entries[0]).toMatchObject({ runs: 1, outcome: { status: "converged" } });
		});

		it("a rework counts runs on: 1 becomes 2, once in the list", async () => {
			const first = { task: "1.2", runs: 1, outcome: converged("1.2") as never };
			const start = atTask({ child: { task: "1.2", id: 42 as TaskId }, carried: "rework", entries: [...atTask().entries, first] });
			const { commit } = await runTask(start, converged("1.2"));
			const entries = decodeCheckpoint(commit.checkpoint as JsonObject).entries.filter((e) => e.task === "1.2");
			expect(entries.map((e) => e.runs)).toEqual([2]);
		});

		it("Scenario: A blocked task blocks the group", async () => {
			const twoTasks = {
				...input(),
				tasks: [
					{ id: "1.1", text: "first", ticked: false },
					{ id: "1.2", text: "second", ticked: false },
				],
			};
			const at = { phase: "task" as const, queue: ["1.2"], entries: [], reworks: 0, iterations: [] };
			const started = await runTask({ ...at, child: { task: "1.1" } }, undefined, twoTasks);
			expect(started.created.map((c) => c.input.task)).toEqual(["1.1"]);

			const { created, commit } = await runTask({ ...at, child: { task: "1.1", id: 42 as TaskId } }, blocked(), twoTasks);
			expect(created).toHaveLength(0);
			expect(commit.status).toBe("terminal");
			const outcome = endedOutcome(commit);
			expect(outcome.status).toBe("blocked");
			expect(outcome).toMatchObject({ escalation: { level: "group", to: "principal", question: "Which API?" } });
			expect(outcome.result?.tasks).toEqual([{ task: "1.1", outcome: blocked(), runs: 1 }]);
			expect(Object.keys(commit.outcome?.result ?? {}).sort()).toEqual(["notes", "outcome"]);
			expect(blockedBy(commit.outcome?.result.outcome as never)).toBe("1.1");
		});

		for (const status of ["exhausted", "failed"] as const) {
			it(`Scenario: An exhausted task fails the group (${status})`, async () => {
				const { commit } = await runTask(
					atTask({ child: { task: "1.2", id: 42 as TaskId } }),
					{ status, iterations: [] } as Outcome,
				);
				const outcome = endedOutcome(commit);
				expect(outcome.status).toBe("failed");
				expect(commit.outcome?.result.notes).toEqual([`task 1.2 ended ${status}`]);
				expect(outcome.result?.tasks.map((t) => [t.task, t.runs])).toEqual([["1.1", 0], ["1.2", 1], ["1.3", 0]]);
				expect(outcome.result?.tasks[1]).toMatchObject({ outcome: { status, iterations: [] } });
			});
		}

		for (const status of ["blocked", "exhausted"] as const) {
			it(`Scenario: A task still queued when the group ends has no entry (${status})`, async () => {
				const { created, commit } = await runTask(
					{ phase: "task", queue: ["1.2", "1.3"], entries: [], reworks: 0, iterations: [], child: { task: "1.1", id: 42 as TaskId } },
					status === "blocked" ? blocked() : ({ status, iterations: [] } as Outcome),
				);
				expect(created).toHaveLength(0);
				expect(commit.status).toBe("terminal");
				const outcome = endedOutcome(commit);
				expect(outcome.status).toBe(status === "blocked" ? "blocked" : "failed");
				expect(outcome.result?.tasks.map((t) => [t.task, t.runs, t.outcome.status])).toEqual([["1.1", 1, status]]);
			});
		}
	});

	describe("The group check runs every check over the workspace", () => {
		// Runs the `check` phase against a runtime that records what it commits.
		const runCheck = async (checks: string[], checkpoint?: Partial<GroupCheckpoint>) => {
			const dir = mkdtempSync(join(tmpdir(), "group-check-"));
			temps.push(dir);
			const committed: { status: string; checkpoint?: JsonObject; outcome?: { result: { outcome: JsonObject; notes: string[] } } }[] = [];
			const runtime = { commit: async (fn: () => unknown) => void committed.push(fn() as (typeof committed)[number]) };
			const cp: GroupCheckpoint = { phase: "check", queue: [], entries: [], reworks: 0, iterations: [], ...checkpoint };
			const handler = GroupLoopTask.definition.phases.check as unknown as (t: unknown, r: unknown, c: unknown) => Promise<void>;
			await handler({ state: { checkpoint: encodeCheckpoint(cp) }, input: { ...input(), checks, workspace: dir } }, runtime, undefined);
			expect(committed).toHaveLength(1);
			return committed[0] as (typeof committed)[number];
		};

		it("Scenario: A passing check converges the group", async () => {
			const entries = initialGroupCheckpoint(input().tasks).entries;
			const commit = await runCheck(["node -e process.exit(0)"], { entries });
			expect(commit.status).toBe("terminal");
			const outcome = commit.outcome?.result.outcome as unknown as LoopOutcome<GroupOutcome>;
			expect(check(LoopOutcome(GroupOutcome), outcome)).toBe(true);
			expect(outcome.status).toBe("converged");
			expect(outcome.result?.tasks.map((t) => t.task)).toEqual(["1.1", "1.3"]);
		});

		it("Scenario: A failing check goes to the judge", async () => {
			const command = "node -e console.log('boom');process.exit(1)";
			const commit = await runCheck([command]);
			expect(commit.status).toBe("running");
			const cp = decodeCheckpoint(commit.checkpoint as JsonObject);
			expect(cp.phase).toBe("judge");
			expect(cp.checkOutput).toHaveLength(1);
			expect(cp.checkOutput?.[0]).toMatchObject({ command, exitCode: 1 });
			expect(cp.checkOutput?.[0]?.output).toContain("boom");
		});

		it("spawns without a shell", async () => {
			const commit = await runCheck(["node -e console.log(process.argv[1]);process.exit(1) $HOME"]);
			const cp = decodeCheckpoint(commit.checkpoint as JsonObject);
			expect(cp.checkOutput?.[0]?.output.trim()).toBe("$HOME");
		});

		it("records a missing binary as exit 127 without throwing", async () => {
			const commit = await runCheck(["definitely-not-a-binary"]);
			const cp = decodeCheckpoint(commit.checkpoint as JsonObject);
			expect(cp.phase).toBe("judge");
			expect(cp.checkOutput?.[0]).toMatchObject({ command: "definitely-not-a-binary", exitCode: 127 });
			expect(cp.checkOutput?.[0]?.output).toContain("ENOENT");
		});

		it("runs every check in order, even after a failure", async () => {
			const commit = await runCheck(["node -e process.exit(3)", "node -e console.log('second')"]);
			const cp = decodeCheckpoint(commit.checkpoint as JsonObject);
			expect(cp.checkOutput?.map((r) => [r.command, r.exitCode])).toEqual([
				["node -e process.exit(3)", 3],
				["node -e console.log('second')", 0],
			]);
		});

		it("formatCheckOutput renders only the failing checks", () => {
			expect(
				formatCheckOutput([
					{ command: "a", exitCode: 0, output: "fine" },
					{ command: "b c", exitCode: 2, output: "bad\n" },
				]),
			).toBe("$ b c\nexit 2\nbad\n");
		});
	});

	it("decoding a malformed checkpoint throws", () => {
		const good = encodeCheckpoint(initialGroupCheckpoint(input().tasks));
		expect(() => decodeCheckpoint(null)).toThrow("group-loop checkpoint malformed: checkpoint");
		expect(() => decodeCheckpoint({ ...good, phase: "nope" })).toThrow("malformed: phase");
		expect(() => decodeCheckpoint({ ...good, queue: [1] })).toThrow("malformed: queue");
		expect(() => decodeCheckpoint({ ...good, entries: "x" })).toThrow("malformed: entries");
		expect(() => decodeCheckpoint({ ...good, reworks: "0" })).toThrow("malformed: reworks");
	});
});

describe("task/group: Each group check round is an ontology Iteration", () => {
	const groupInput = (checks: string[], dir: string) =>
		({ ...validateGroupStart(options()), checks, workspace: dir }) as ReturnType<typeof validateGroupStart>;
	const FAIL = "node -e process.exit(1)";
	const PASS = "node -e process.exit(0)";

	type Commit = { status: string; checkpoint?: JsonObject; outcome?: { result: { outcome: JsonObject; notes: string[] } } };
	const phase = async (name: "check" | "judge", cp: GroupCheckpoint, input: ReturnType<typeof validateGroupStart>, settled?: unknown) => {
		const committed: Commit[] = [];
		const runtime = {
			commit: async (fn: () => unknown) => void committed.push(fn() as Commit),
			waitForTask: async () => ({ state: { outcome: { status: "completed", result: settled } } }),
		};
		const handler = GroupLoopTask.definition.phases[name] as unknown as (t: unknown, r: unknown, c: unknown) => Promise<void>;
		await handler({ state: { checkpoint: encodeCheckpoint(cp) }, input }, runtime, undefined);
		expect(committed).toHaveLength(1);
		return committed[0] as Commit;
	};
	// The scripted judge's final variables.
	const judged = (vars: Record<string, string>) => ({
		kind: "completed",
		variables: { next_action: "", rework_task: "", feedback: "", question: "", ...vars },
	});
	const dirOf = () => {
		const dir = mkdtempSync(join(tmpdir(), "group-round-"));
		temps.push(dir);
		return dir;
	};
	const start = (input: ReturnType<typeof validateGroupStart>): GroupCheckpoint => ({
		...initialGroupCheckpoint(input.tasks),
		phase: "check",
		queue: [],
	});
	const atJudge = async (checks: string[]) => {
		const input = groupInput(checks, dirOf());
		const commit = await phase("check", start(input), input);
		return { input, cp: { ...decodeCheckpoint(commit.checkpoint as JsonObject), child: { task: "judge", id: 9 as TaskId } } };
	};

	it("Scenario: A failed check round is recorded", async () => {
		const { input, cp } = await atJudge([FAIL]);
		expect(cp.phase).toBe("judge");
		expect(cp.iterations).toEqual([]);

		const reworked = await phase("judge", cp, input, judged({ next_action: "rework", rework_task: "1.1", feedback: "fix it" }));
		const next = decodeCheckpoint(reworked.checkpoint as JsonObject);
		expect(next.phase).toBe("next");
		expect(next.iterations).toHaveLength(1);
		const [round] = next.iterations;
		expect(round).toMatchObject({
			n: 1,
			actions: [],
			evidence: [{ kind: "check", command: FAIL, exitCode: 1, output: expect.any(String) }],
			verdict: { met: false, unmet: [{ target: { check: "group 1" } }] },
			feedback: [{ action: "rework-task", from: { kind: "code-defect", target: { check: "group 1" } } }],
		});
		expect(round?.feedback[0]?.from.message).toContain("1.1");
		expect(round?.feedback[0]?.from.message).toContain("fix it");
		expect(check(Iteration, round)).toBe(true);

		const second = await phase("check", { ...next, phase: "check", queue: [] }, groupInput([PASS], dirOf()));
		const outcome = second.outcome?.result.outcome as unknown as LoopOutcome<GroupOutcome>;
		expect(outcome.status).toBe("converged");
		expect(outcome.iterations.map((i) => [i.n, i.verdict.met])).toEqual([[1, false], [2, true]]);
		expect(check(LoopOutcome(GroupOutcome), outcome)).toBe(true);
	});

	for (const [action, kind, feedback] of [
		["ask", "needs-decision", "ask"],
		["amend-spec", "spec-defect", "amend-spec"],
	] as const) {
		it(`a ${action} round is a ${kind} finding with ${feedback} feedback`, async () => {
			const { input, cp } = await atJudge([FAIL]);
			const commit = await phase("judge", cp, input, judged({ next_action: action, question: "Which?" }));
			const outcome = commit.outcome?.result.outcome as unknown as LoopOutcome<GroupOutcome>;
			expect(outcome.status).toBe("blocked");
			expect(outcome.iterations).toHaveLength(1);
			expect(outcome.iterations[0]?.feedback).toMatchObject([{ action: feedback, from: { kind, message: "Which?" } }]);
		});
	}

	it("two checks give two evidence entries in order, and one failure is unmet", () => {
		const round = roundIteration({
			groupNumber: 1,
			round: 1,
			checks: [
				{ command: "a", exitCode: 0, output: "fine" },
				{ command: "b", exitCode: 2, output: "bad" },
			],
		});
		expect(round.evidence).toEqual([
			{ kind: "check", command: "a", exitCode: 0, output: "fine" },
			{ kind: "check", command: "b", exitCode: 2, output: "bad" },
		]);
		expect(round.verdict.met).toBe(false);
		expect(check(Iteration, round)).toBe(true);
		expect(roundIteration({ groupNumber: 1, round: 1, checks: [{ command: "a", exitCode: 0, output: "" }] }).verdict.met).toBe(true);
	});

	it("a verdict outside the contract still records the round, and the run fails", async () => {
		const { input, cp } = await atJudge([FAIL]);
		const commit = await phase("judge", cp, input, judged({ next_action: "rework", rework_task: "9.9" }));
		const outcome = commit.outcome?.result.outcome as unknown as LoopOutcome<GroupOutcome>;
		expect(outcome.status).toBe("failed");
		expect(outcome.iterations).toHaveLength(1);
		expect(outcome.iterations[0]?.verdict.met).toBe(false);
		expect(check(LoopOutcome(GroupOutcome), outcome)).toBe(true);
	});

	it("a resume during check leaves no duplicate iteration", async () => {
		const input = groupInput([FAIL], dirOf());
		const before = start(input);
		const first = await phase("check", before, input);
		const again = await phase("check", before, input); // the replay after a crash
		for (const commit of [first, again]) expect(decodeCheckpoint(commit.checkpoint as JsonObject).iterations).toEqual([]);

		const passing = groupInput([PASS], dirOf());
		const a = await phase("check", start(passing), passing);
		const b = await phase("check", start(passing), passing);
		for (const commit of [a, b]) {
			expect((commit.outcome?.result.outcome as unknown as LoopOutcome<GroupOutcome>).iterations).toHaveLength(1);
		}
	});
});

describe("task/group: The outcome is a LoopOutcome of GroupOutcome", () => {
	const tasks = [
		{ id: "1.1", text: "first", ticked: false },
		{ id: "1.2", text: "second", ticked: false },
		{ id: "1.3", text: "third", ticked: false },
	];
	const ref = { group: 1, tasks };
	const converged = (task: string): GroupEntry["outcome"] => ({ status: "converged", iterations: [], result: { task, ticked: true } });
	const blocked: GroupEntry["outcome"] = {
		status: "blocked",
		iterations: [],
		escalation: { level: "task", to: "principal", reason: "needs-decision: ask", question: "Which API?" },
	};
	const met = (round: number) =>
		roundIteration({ groupNumber: 1, round, checks: [{ command: "pnpm test", exitCode: 0, output: "" }] });
	const unmet = (round: number, verdict?: GroupVerdict) =>
		roundIteration({ groupNumber: 1, round, checks: [{ command: "pnpm test", exitCode: 1, output: "boom" }], verdict });
	const entries: GroupEntry[] = [
		{ task: "1.1", outcome: converged("1.1"), runs: 1 },
		{ task: "1.2", outcome: blocked, runs: 1 },
	];

	it("Scenario: The outcome checks against the ontology", () => {
		const cp = { entries, iterations: [unmet(1, { kind: "rework", task: "1.1", feedback: "x" }), met(2)] };
		const results = [
			finishGroup("converged", cp, { input: ref }),
			endedGroup(ref, { entries, iterations: [] }, "1.2", blocked),
			finishGroup("blocked", { entries, iterations: [unmet(1, { kind: "ask", question: "Q?" })] }, {
				input: ref,
				escalation: { level: "group", to: "principal", reason: "needs-decision: ask", question: "Q?" },
			}),
			finishGroup("exhausted", { entries, iterations: [unmet(1, { kind: "rework", task: "1.1", feedback: "x" })] }, { input: ref }),
			endedGroup(ref, { entries, iterations: [] }, "1.2", { status: "failed", iterations: [] }),
		];
		expect(results.map((r) => r.outcome.status)).toEqual(["converged", "blocked", "blocked", "exhausted", "failed"]);
		for (const { outcome } of results) expect(check(LoopOutcome(GroupOutcome), outcome)).toBe(true);
	});

	it("entries are in file order after a rework ran 1.1 after 1.2; a queued task has no entry", () => {
		const reworked: GroupEntry[] = [
			{ task: "1.2", outcome: converged("1.2"), runs: 1 },
			{ task: "1.1", outcome: converged("1.1"), runs: 2 },
		];
		const outcome = buildGroupOutcome("exhausted", { entries: reworked, iterations: [] }, { input: ref });
		expect(outcome.result?.tasks.map((t) => [t.task, t.runs])).toEqual([["1.1", 2], ["1.2", 1]]);
	});

	it("an outcome that breaks the ontology is stored as failed with a note; one that cannot be fixed throws", () => {
		// Blocked without an escalation breaks the ontology; the same entries as a failed run do not.
		const done = finishGroup("blocked", { entries, iterations: [] }, { input: ref });
		expect(done.outcome.status).toBe("failed");
		expect(done.notes.join("\n")).toContain("broke the ontology");
		expect(check(LoopOutcome(GroupOutcome), done.outcome)).toBe(true);
		const badRound = { ...met(1), n: 5 };
		expect(() => finishGroup("converged", { entries, iterations: [badRound] }, { input: ref })).toThrow("ontology refuses");
	});
});

describe("task/group: a round's verdict target is the group number, not the round number", () => {
	const TWO_GROUPS = ["## 1. Setup", "", "- [x] 1.1 first", "", "## 2. Build", "", "- [ ] 2.1 build", "- [ ] 2.2 test", ""].join("\n");
	const FAIL = "node -e process.exit(1)";
	const PASS = "node -e process.exit(0)";
	const TARGET = { check: "group 2" };
	type Input = ReturnType<typeof validateGroupStart>;
	type Commit = { checkpoint?: JsonObject; outcome?: { result: { outcome: JsonObject } } };

	const groupTwo = (check: string): Input => {
		const dir = mkdtempSync(join(tmpdir(), "group-two-"));
		temps.push(dir);
		const base = options({ group: 2, change: { proposal: { text: PROPOSAL }, deltas: [{ text: DELTA }], tasks: { text: TWO_GROUPS } } });
		return { ...validateGroupStart(base), checks: [check], workspace: dir } as Input;
	};
	const phase = async (name: "check" | "judge", cp: GroupCheckpoint, input: Input, settled?: unknown) => {
		const committed: Commit[] = [];
		const runtime = {
			commit: async (fn: () => unknown) => void committed.push(fn() as Commit),
			waitForTask: async () => ({ state: { outcome: { status: "completed", result: settled } } }),
		};
		const handler = GroupLoopTask.definition.phases[name] as unknown as (t: unknown, r: unknown, c: unknown) => Promise<void>;
		await handler({ state: { checkpoint: encodeCheckpoint(cp) }, input }, runtime, undefined);
		expect(committed).toHaveLength(1);
		return committed[0] as Commit;
	};
	const judged = (vars: Record<string, string>) => ({
		kind: "completed",
		variables: { next_action: "", rework_task: "", feedback: "", question: "", ...vars },
	});
	const converged = (task: string): GroupEntry["outcome"] => ({ status: "converged", iterations: [], result: { task, ticked: true } });
	const toJudge = async (input: Input) => {
		const cp: GroupCheckpoint = { ...initialGroupCheckpoint(input.tasks), phase: "check", queue: [] };
		const commit = await phase("check", cp, input);
		return { ...decodeCheckpoint(commit.checkpoint as JsonObject), child: { task: "judge", id: 9 as TaskId } };
	};

	it("Scenario: A failed check round is recorded, on group 2 in every round", async () => {
		const failing = groupTwo(FAIL);
		expect(failing.group).toBe(2);
		const atJudge = await toJudge(failing);
		const reworked = await phase("judge", atJudge, failing, judged({ next_action: "rework", rework_task: "2.1", feedback: "fix it" }));
		const next = decodeCheckpoint(reworked.checkpoint as JsonObject);
		const [first] = next.iterations;
		expect(first?.n).toBe(1);
		expect(first?.verdict).toMatchObject({ met: false, unmet: [{ target: TARGET }] });
		expect(first?.feedback).toMatchObject([{ action: "rework-task", from: { kind: "code-defect", target: TARGET } }]);
		expect(first?.feedback[0]?.from.message).toContain("2.1");

		// The rework ran 2.1 again (a second run) after 2.1 and 2.2 each ran once; the check now passes.
		let entries = recordEntry([], "2.1", converged("2.1"));
		entries = recordEntry(entries, "2.2", converged("2.2"));
		entries = recordEntry(entries, "2.1", converged("2.1"));
		const second = await phase("check", { ...next, phase: "check", queue: [], entries }, groupTwo(PASS));
		const outcome = second.outcome?.result.outcome as unknown as LoopOutcome<GroupOutcome>;
		expect(outcome.status).toBe("converged");
		expect(outcome.iterations.map((i) => i.n)).toEqual([1, 2]);
		expect(outcome.iterations[1]?.verdict).toMatchObject({ met: true, satisfied: [TARGET], unmet: [] });
		for (const iteration of outcome.iterations) {
			expect([...iteration.verdict.satisfied, ...iteration.verdict.unmet.map((u) => u.target)]).toEqual([TARGET]);
			expect(JSON.stringify(iteration)).not.toMatch(/group [13-9]/);
		}
		expect(outcome.result?.tasks.map((t) => [t.task, t.runs])).toEqual([["2.1", 2], ["2.2", 1]]);
		expect(check(LoopOutcome(GroupOutcome), outcome)).toBe(true);
	});

	it("an ask on group 2 targets group 2 as needs-decision / ask", async () => {
		const input = groupTwo(FAIL);
		const commit = await phase("judge", await toJudge(input), input, judged({ next_action: "ask", question: "Which?" }));
		const outcome = commit.outcome?.result.outcome as unknown as LoopOutcome<GroupOutcome>;
		expect(outcome.status).toBe("blocked");
		expect(outcome.iterations[0]?.verdict.unmet.map((u) => u.target)).toEqual([TARGET]);
		expect(outcome.iterations[0]?.feedback).toMatchObject([{ action: "ask", from: { kind: "needs-decision", target: TARGET } }]);
	});
});

describe("task/group: taskLoopInputFor carries the group's worktree to every child task loop", () => {
	const worktree = { path: "/tmp/repo-worktrees/add-group-loop-2", branch: "task/add-group-loop/2" };
	const tasksPath = `${worktree.path}/openspec/changes/add-group-loop/tasks.md`;
	const input: GroupLoopInput = {
		group: 2,
		groupTitle: "Build",
		tasks: [
			{ id: "2.1", text: "first", ticked: false },
			{ id: "2.2", text: "second", ticked: false },
		],
		proposal: PROPOSAL,
		design: "",
		deltas: DELTA,
		tasksText: TASKS,
		tasksPath,
		script: JUDGE_ONLY,
		groupScript: JUDGE_ONLY,
		workspace: worktree.path,
		budget: { maxIterations: 3, maxReworks: 2 },
		checks: ["true"],
		allow: ["true"],
		escalateTo: "principal",
		worktree,
	};

	it("keeps the worktree, the rebased workspace and the rebased tasks.md path", () => {
		for (const task of ["2.1", "2.2"]) {
			const child = taskLoopInputFor(input, task, "");
			expect(child.worktree).toEqual(worktree);
			expect(child.workspace).toBe(worktree.path);
			expect(child.tasksPath).toBe(tasksPath);
			expect(child.task).toBe(task);
		}
	});

	it("leaves worktree out of a child when the group has none", () => {
		const { worktree: _dropped, ...plain } = input;
		expect("worktree" in taskLoopInputFor(plain, "2.1", "")).toBe(false);
	});
});
