import { describe, expect, it } from "vitest";
import type { LoopOutcome } from "../../src/openspec/index.js";
import { specEvents, stageDraft, stageEnded, stageOutcome, stageStarted } from "../../src/task/events.js";
import { recordStageRound, type StageOutcome } from "../../src/task/spec-loop.js";

const at = "2026-10-12T17:00:02.114Z";
const start = { change: "add-plan-export", stage: "proposal", script: "spec-proposal", at };
const warning = { level: "WARNING" as const, path: "proposal.md", message: "touches 3 capabilities, over the budget of 2." };
const question = "Review proposal.md for the proposal stage of add-plan-export. Answer approve, or say what to change.";
const drafts = [recordStageRound(1, "proposal", "first", ["proposal.md"], [warning]), recordStageRound(2, "proposal", "second", ["proposal.md"], [])];
const result: StageOutcome = { change: "add-plan-export", stage: "proposal", files: ["proposal.md"], approved: false };

const review = {
	status: "blocked",
	iterations: drafts,
	escalation: { level: "change", to: "principal", reason: "review", question },
	result,
} as LoopOutcome<StageOutcome>;

describe("task/headless: A spec loop streams its own event kinds (builders)", () => {
	it("a review's stream serializes as design.md's example", () => {
		expect(specEvents(12, start, review).map((event) => JSON.stringify(event))).toEqual([
			`{"event":"stage-started","loop":12,"change":"add-plan-export","stage":"proposal","script":"spec-proposal","at":"${at}"}`,
			`{"event":"stage-draft","loop":12,"draft":1,"written":["proposal.md"],"issues":[{"level":"WARNING","path":"proposal.md","message":"touches 3 capabilities, over the budget of 2."}]}`,
			`{"event":"stage-draft","loop":12,"draft":2,"written":["proposal.md"],"issues":[]}`,
			`{"event":"stage-review","loop":12,"files":["proposal.md"],"question":${JSON.stringify(question)}}`,
			`{"event":"stage-ended","loop":12,"status":"blocked","drafts":2,"approved":false}`,
		]);
	});

	it("an approval streams stage-started then a converged, approved stage-ended", () => {
		const approved = { status: "converged", iterations: [], result: { ...result, approved: true } } as LoopOutcome<StageOutcome>;
		expect(specEvents(4, start, approved).map((event) => event.event)).toEqual(["stage-started", "stage-ended"]);
		expect(stageEnded(4, approved)).toEqual({ event: "stage-ended", loop: 4, status: "converged", drafts: 0, approved: true });
		expect(stageOutcome(4, approved)).toBeUndefined();
	});

	it("a question is a stage-question, never a stage-review", () => {
		const asked = {
			status: "blocked",
			iterations: [],
			escalation: { level: "change", to: "principal", reason: "question", question: "Which flag name?" },
			result: { ...result, files: [] },
		} as LoopOutcome<StageOutcome>;
		const events = specEvents(5, start, asked);
		expect(events.map((event) => event.event)).toEqual(["stage-started", "stage-question", "stage-ended"]);
		expect(events[1]).toEqual({ event: "stage-question", loop: 5, question: "Which flag name?" });
	});

	it("an answered run streams only its own drafts, counting them all", () => {
		const events = specEvents(6, start, review, 1);
		expect(events.filter((event) => event.event === "stage-draft").map((event) => (event as { draft: number }).draft)).toEqual([2]);
		expect(events.at(-1)).toMatchObject({ event: "stage-ended", drafts: 2 });
	});

	it("each builder gives exactly the spec's fields", () => {
		const started = stageStarted(1, "c", "proposal", "spec-proposal");
		expect(Object.keys(started)).toEqual(["event", "loop", "change", "stage", "script", "at"]);
		expect(new Date((started as { at: string }).at).toISOString()).toBe((started as { at: string }).at);
		expect(Object.keys(stageDraft(1, drafts[0]!))).toEqual(["event", "loop", "draft", "written", "issues"]);
		expect(Object.keys((stageDraft(1, drafts[0]!) as { issues: object[] }).issues[0]!)).toEqual(["level", "path", "message"]);
		expect(Object.keys(stageOutcome(1, review)!)).toEqual(["event", "loop", "files", "question"]);
		expect(Object.keys(stageEnded(1, review))).toEqual(["event", "loop", "status", "drafts", "approved"]);
	});
});
