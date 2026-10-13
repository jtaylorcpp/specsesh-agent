import { describe, expect, it } from "vitest";
import {
	CHANGE_LOOP_TASK,
	CHANGE_LOOP_VERSION,
	changeChecksOf,
	decodeChangeCheckpoint,
	initialChangeCheckpoint,
} from "../../src/task/change-input.js";

describe("task/change-input", () => {
	it("names the task agentscript.change-loop, version 1", () => {
		expect(CHANGE_LOOP_TASK).toBe("agentscript.change-loop");
		expect(CHANGE_LOOP_VERSION).toBe(1);
	});

	it("runs changeChecks when set, and the checks otherwise", () => {
		expect(changeChecksOf({ checks: ["pnpm test"], changeChecks: ["pnpm docs:check"] })).toEqual(["pnpm docs:check"]);
		expect(changeChecksOf({ checks: ["pnpm test"] })).toEqual(["pnpm test"]);
		expect(changeChecksOf({})).toEqual([]);
	});

	it("queues every group once, ascending, with no entries", () => {
		expect(initialChangeCheckpoint([2, 1, 3, 2])).toEqual({ phase: "next", queue: [1, 2, 3], entries: [] });
	});

	it("decodes a checkpoint in each of the three phases", () => {
		const entries = [{ group: 1, outcome: { status: "converged", iterations: [], result: { group: 1, tasks: [] } }, runs: 1 }];
		expect(decodeChangeCheckpoint({ phase: "next", queue: [1, 2], entries: [] })).toEqual({ phase: "next", queue: [1, 2], entries: [] });
		expect(decodeChangeCheckpoint({ phase: "group", queue: [3], entries, child: { group: 2 } })).toEqual({
			phase: "group",
			queue: [3],
			entries,
			child: { group: 2 },
		});
		expect(decodeChangeCheckpoint({ phase: "group", queue: [], entries, child: { group: 2, id: 7 } })).toEqual({
			phase: "group",
			queue: [],
			entries,
			child: { group: 2, id: 7 },
		});
		expect(decodeChangeCheckpoint({ phase: "check", queue: [], entries })).toEqual({ phase: "check", queue: [], entries });
	});

	it("refuses an unknown phase, a string queue, a string child id and zero runs", () => {
		expect(() => decodeChangeCheckpoint({ phase: "judge", queue: [], entries: [] })).toThrow("change-loop checkpoint malformed: phase");
		expect(() => decodeChangeCheckpoint({ phase: "next", queue: ["1"], entries: [] })).toThrow("change-loop checkpoint malformed: queue");
		expect(() => decodeChangeCheckpoint({ phase: "group", queue: [], entries: [], child: { group: 2, id: "7" } })).toThrow(
			"change-loop checkpoint malformed: child",
		);
		expect(() =>
			decodeChangeCheckpoint({ phase: "next", queue: [], entries: [{ group: 1, outcome: { status: "converged" }, runs: 0 }] }),
		).toThrow("change-loop checkpoint malformed: entries");
	});
});
