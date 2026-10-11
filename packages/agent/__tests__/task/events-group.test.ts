import { describe, expect, it } from "vitest";
import type { GroupOutcome, LoopOutcome } from "../../src/openspec/index.js";
import {
	groupCheck,
	groupEnded,
	groupEndedFromOutcome,
	groupStarted,
	rework,
	withGroup,
	type StreamEvent,
	type TaskEvent,
} from "../../src/task/events.js";

const taskEvents: TaskEvent[] = [
	{ event: "loop-started", loop: 7, change: "c", task: "1.1", script: "task-delegate", at: "2026-10-11T00:00:00.000Z" },
	{ event: "iteration-started", loop: 7, iteration: 1, at: "2026-10-11T00:00:00.000Z" },
	{ event: "action", loop: 7, iteration: 1, kind: "delegate", summary: "edit", refs: [] },
	{ event: "evidence", loop: 7, iteration: 1, kind: "check", command: "pnpm test", exitCode: 0 },
	{ event: "verdict", loop: 7, iteration: 1, met: true, unmet: "", next: "done" },
	{ event: "loop-ended", loop: 7, status: "converged", iterations: 1, ticked: true, changed: [] },
];

describe("task/headless: A group loop streams four more event kinds", () => {
	it("group constructors give exactly the spec's fields", () => {
		const started = groupStarted(3, "c", 1, ["1.1", "1.2"]);
		expect(Object.keys(started).sort()).toEqual(["at", "change", "event", "group", "loop", "tasks"]);
		expect(started).toMatchObject({ event: "group-started", loop: 3, change: "c", group: 1, tasks: ["1.1", "1.2"] });
		expect(new Date((started as { at: string }).at).toISOString()).toBe((started as { at: string }).at);

		const commands = [
			{ command: "pnpm check", exitCode: 0 },
			{ command: "pnpm test", exitCode: 1 },
		];
		expect(groupCheck(3, commands, false)).toEqual({ event: "group-check", loop: 3, commands, passed: false });
		expect(rework(3, "1.2", "tests fail")).toEqual({ event: "rework", loop: 3, task: "1.2", reason: "tests fail" });
		const tasks = [{ task: "1.1", status: "converged" as const, runs: 1 }];
		expect(groupEnded(3, "converged", tasks, ["a.ts"])).toEqual({ event: "group-ended", loop: 3, status: "converged", tasks, changed: ["a.ts"] });
	});

	it("groupEndedFromOutcome maps each task to its own status and runs", () => {
		const task = (status: "converged" | "failed") => ({ status, iterations: [], result: { task: "1.1", ticked: status === "converged" } });
		const outcome = {
			status: "failed",
			iterations: [],
			result: {
				group: 1,
				tasks: [
					{ task: "1.1", outcome: task("converged"), runs: 2 },
					{ task: "1.2", outcome: task("failed"), runs: 1 },
				],
			},
		} as unknown as LoopOutcome<GroupOutcome>;
		expect(groupEndedFromOutcome(3, outcome, ["a.ts"])).toEqual({
			event: "group-ended",
			loop: 3,
			status: "failed",
			tasks: [
				{ task: "1.1", status: "converged", runs: 2 },
				{ task: "1.2", status: "failed", runs: 1 },
			],
			changed: ["a.ts"],
		});
	});
});

describe("task/headless: withGroup", () => {
	it("adds group to all six task kinds and keeps the task loop's id", () => {
		const seen: StreamEvent[] = [];
		const sink = withGroup((e) => seen.push(e), 1);
		for (const event of taskEvents) sink(event);
		expect(seen.map((e) => e.event)).toEqual(taskEvents.map((e) => e.event));
		for (const event of seen) expect(event).toMatchObject({ group: 1, loop: 7 });
	});

	it("leaves group events and warnings alone", () => {
		const seen: StreamEvent[] = [];
		const sink = withGroup((e) => seen.push(e), 1);
		const others: StreamEvent[] = [
			groupStarted(3, "c", 1, ["1.1"]),
			groupCheck(3, [], true),
			rework(3, "1.1", "why"),
			groupEnded(3, "converged", [], []),
			{ event: "warning", loop: 3, message: "m" },
		];
		for (const event of others) sink(event);
		expect(seen).toEqual(others);
		expect(seen.some((e) => "group" in e && e.event !== "group-started")).toBe(false);
	});

	it("task events without a group have no group key", () => {
		for (const event of taskEvents) expect("group" in event).toBe(false);
	});
});

describe("task/headless: A group's stream", () => {
	it("Scenario: A group's stream", () => {
		const seen: StreamEvent[] = [];
		const sink = (e: StreamEvent) => seen.push(e);
		sink(groupStarted(3, "c", 1, ["1.1", "1.2"]));
		for (const task of ["1.1", "1.2"]) {
			const child = withGroup(sink, 1);
			for (const event of taskEvents) child(event.event === "loop-started" ? { ...event, task } : event);
		}
		sink(groupCheck(3, [{ command: "pnpm test", exitCode: 0 }], true));
		sink(groupEnded(3, "converged", [{ task: "1.1", status: "converged", runs: 1 }, { task: "1.2", status: "converged", runs: 1 }], []));

		expect(seen[0]).toMatchObject({ event: "group-started", group: 1, tasks: ["1.1", "1.2"] });
		const started = seen.filter((e) => e.event === "loop-started");
		expect(started.map((e) => (e as { task: string }).task)).toEqual(["1.1", "1.2"]);
		for (const e of seen.filter((e) => e.event !== "group-started" && e.event !== "group-check" && e.event !== "group-ended")) {
			expect(e).toMatchObject({ group: 1 });
		}
		expect(seen.at(-2)).toMatchObject({ event: "group-check", passed: true });
		expect(seen.at(-1)).toMatchObject({ event: "group-ended", status: "converged" });
	});
});
