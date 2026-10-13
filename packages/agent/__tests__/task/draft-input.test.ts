import { describe, expect, it } from "vitest";
import { DRAFT_LOOP_TASK, DRAFT_LOOP_VERSION, decodeDraftCheckpoint } from "../../src/task/draft-input.js";

describe("task/draft-input", () => {
	it("names the task agentscript.draft-loop, version 1", () => {
		expect(DRAFT_LOOP_TASK).toBe("agentscript.draft-loop");
		expect(DRAFT_LOOP_VERSION).toBe(1);
	});

	it("decodes a checkpoint in each of the three phases", () => {
		const entries = [{ stage: "proposal", approved: true, runs: 0 }];
		expect(decodeDraftCheckpoint({ phase: "next", entries: [] })).toEqual({ phase: "next", entries: [] });
		expect(decodeDraftCheckpoint({ phase: "stage", stage: "design", child: 7, entries })).toEqual({ phase: "stage", stage: "design", child: 7, entries });
		expect(decodeDraftCheckpoint({ phase: "answer", stage: "design", child: 8, entries })).toEqual({ phase: "answer", stage: "design", child: 8, entries });
	});

	it("refuses an unknown phase, a string child and negative runs", () => {
		expect(() => decodeDraftCheckpoint({ phase: "gate", entries: [] })).toThrow("draft-loop checkpoint malformed: phase");
		expect(() => decodeDraftCheckpoint({ phase: "stage", child: "7", entries: [] })).toThrow("draft-loop checkpoint malformed: child");
		expect(() => decodeDraftCheckpoint({ phase: "next", entries: [{ stage: "proposal", approved: true, runs: -1 }] })).toThrow(
			"draft-loop checkpoint malformed: entries",
		);
	});
});
