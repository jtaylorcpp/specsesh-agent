import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Harness, TaskId } from "@earendil-works/pi-durable";
import type { LoopOutcome } from "../../src/openspec/index.js";
import { EscalationAnswerError, answerSpecLoop, waitForSpecLoop, type SpecLoopAnswer, type StageOutcome } from "../../src/task/index.js";
import { SPEC_LOOP, type SpecLoopInput } from "../../src/task/spec-loop.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { cleanTemps, context } from "./helpers.js";
import { STAGE_SCRIPT, draft, proposalStage, specHarness, specWorkspace, startBare, waitForOutcome } from "./spec-helpers.js";

afterEach(cleanTemps);

type SpecId = TaskId<LoopOutcome<StageOutcome>>;

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const designStage: SpecStage = { name: "design", owns: ["design.md"], after: ["proposal"], script: { text: STAGE_SCRIPT }, gate: () => [] };

const entry = (stage: string, files: Record<string, string>) => ({
	stage,
	approved: true,
	by: "principal",
	principal: "jesse",
	notes: "",
	at: "2026-10-01T00:00:00.000Z",
	files,
});

const principal = (decision: string): SpecLoopAnswer => ({ by: "principal", principal: "jesse", decision });

/**
 * Runs the proposal stage until it blocks (on a review, or on `ask` a question), then hands
 * the open harness to `body`. `before` prepares the change directory first.
 */
async function blocked(
	first: ReturnType<typeof draft>,
	body: (r: { harness: Harness; id: SpecId; changeDir: string; respond: (...m: ReturnType<typeof draft>[]) => void; runs: () => Promise<readonly { input: unknown }[]>; loops: () => Promise<readonly unknown[]> }) => Promise<void>,
	{ before, input }: { before?: (changeDir: string) => void; input?: Partial<SpecLoopInput> } = {},
) {
	const { workspace, changeDir } = specWorkspace();
	before?.(changeDir);
	const stage = proposalStage();
	const { env, harness, task, storage } = await specHarness([stage, designStage]);
	env.faux.setResponses([first]);
	const id = await startBare(harness, task, { workspace, stage: { name: stage.name, owns: stage.owns }, model: env.model, ...input });
	harness.resume();
	try {
		const outcome = await waitForOutcome(harness, id);
		expect(outcome.status).toBe("blocked");
		await body({
			harness,
			id: id as unknown as SpecId,
			changeDir,
			respond: (...m) => env.faux.setResponses(m),
			runs: async () => (await storage.scanTasks({ kind: "agentscript.run" }, 100, undefined, context)).items,
			loops: async () => (await storage.scanTasks({ kind: SPEC_LOOP }, 100, undefined, context)).items,
		});
	} finally {
		await harness.close(context);
	}
}

const variablesOf = (run: { input: unknown }) => (run.input as { options: { variables: Record<string, unknown> } }).options.variables;

const refusal = (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e);

describe("task/spec-answer: answerSpecLoop", () => {
	it("approves a proposal review answered ` Approve `, recording the sha256 and drafting nothing", async () => {
		await blocked(draft("=== proposal.md\n## Why\n\nDrafted.\n"), async ({ harness, id, changeDir, runs }) => {
			const next = await answerSpecLoop(harness, id, principal(" Approve "), context);
			const outcome = await waitForSpecLoop(harness, next, context);

			expect(outcome).toMatchObject({ status: "converged", result: { stage: "proposal", files: ["proposal.md"], approved: true } });
			const file = JSON.parse(readFileSync(join(changeDir, "approvals.json"), "utf8"));
			expect(file.approvals).toHaveLength(1);
			expect(file.approvals[0]).toMatchObject({ stage: "proposal", by: "principal", principal: "jesse" });
			expect(file.approvals[0].files).toEqual({ "proposal.md": sha256(join(changeDir, "proposal.md")) });
			expect(await runs()).toHaveLength(1);
		});
	});

	it("re-approving the proposal drops the design's approval", async () => {
		const stages = [proposalStage(), designStage].map(({ name, owns, after }) => ({ name, owns, ...(after !== undefined ? { after } : {}) }));
		await blocked(
			draft("=== proposal.md\n## Why\n\nRevised.\n"),
			async ({ harness, id, changeDir }) => {
				const next = await answerSpecLoop(harness, id, principal("approve"), context);
				expect((await waitForSpecLoop(harness, next, context)).status).toBe("converged");

				const file = JSON.parse(readFileSync(join(changeDir, "approvals.json"), "utf8"));
				expect(file.approvals.map((a: { stage: string }) => a.stage)).toEqual(["proposal"]);
				expect(file.approvals[0].files).toEqual({ "proposal.md": sha256(join(changeDir, "proposal.md")) });
			},
			{
				input: { stages },
				before: (changeDir) =>
					writeFileSync(
						join(changeDir, "approvals.json"),
						JSON.stringify({ approvals: [entry("proposal", { "proposal.md": "0".repeat(64) }), entry("design", { "design.md": "1".repeat(64) })] }),
					),
			},
		);
	});

	it("carries a revision into the next draft, numbering on from the blocked run", async () => {
		await blocked(draft("=== proposal.md\n## Why\n\nCSV and JSON.\n"), async ({ harness, id, respond, runs, changeDir }) => {
			writeFileSync(join(changeDir, "proposal.md"), "## Why\n\nEdited by hand.\n");
			respond(draft("=== proposal.md\n## Why\n\nJSON.\n"));
			const next = await answerSpecLoop(harness, id, principal("JSON only"), context);
			const outcome = await waitForSpecLoop(harness, next, context);

			const all = await runs();
			expect(all).toHaveLength(2);
			const second = variablesOf(all[1]!);
			expect(second["carried"]).toContain("The principal asked for: JSON only");
			expect(second["iteration"]).toBe(2);
			expect(second["current"]).toBe("=== proposal.md\n## Why\n\nEdited by hand.\n");
			expect(outcome.status).toBe("blocked");
			expect(outcome.iterations.map((i) => i.n)).toEqual([1, 2]);
			expect(existsSync(join(changeDir, "approvals.json"))).toBe(false);
		});
	});

	it("carries an answered question into a new draft, even \"approve\", recording nothing", async () => {
		await blocked(draft("", "ask", "CSV or JSON?"), async ({ harness, id, respond, runs, changeDir }) => {
			respond(draft("=== proposal.md\n## Why\n\nDrafted.\n"));
			const next = await answerSpecLoop(harness, id, { by: "principal", decision: "approve" }, context);
			const outcome = await waitForSpecLoop(harness, next, context);

			const all = await runs();
			expect(all).toHaveLength(2);
			expect(variablesOf(all[1]!)["carried"]).toContain("The principal asked for: approve");
			expect(outcome).toMatchObject({ status: "blocked", escalation: { reason: "review" }, result: { approved: false } });
			expect(existsSync(join(changeDir, "approvals.json"))).toBe(false);
		});
	});

	it("refuses an agent's approval of a review, starting nothing and leaving approvals.json as it was", async () => {
		const before = `${JSON.stringify({ approvals: [entry("other", {})] })}\n`;
		await blocked(
			draft("=== proposal.md\n## Why\n\nDrafted.\n"),
			async ({ harness, id, changeDir, loops, runs }) => {
				const error = await refusal(answerSpecLoop(harness, id, { by: "agent", principal: "bot", decision: "approve" }, context));
				const blank = await refusal(answerSpecLoop(harness, id, { by: "principal", principal: "  ", decision: "approve" }, context));

				expect(error).toBeInstanceOf(EscalationAnswerError);
				expect((error as Error).message).toContain("only the principal answers the review of the proposal stage");
				expect(blank).toBeInstanceOf(EscalationAnswerError);
				expect(await loops()).toHaveLength(1);
				expect(await runs()).toHaveLength(1);
				expect(readFileSync(join(changeDir, "approvals.json"), "utf8")).toBe(before);
			},
			{ before: (changeDir) => writeFileSync(join(changeDir, "approvals.json"), before) },
		);
	});

	it("refuses to approve over a malformed approvals.json, naming it", async () => {
		const malformed = JSON.stringify({ approvals: [{ ...entry("proposal", {}), by: "agent" }] });
		await blocked(
			draft("=== proposal.md\n## Why\n\nDrafted.\n"),
			async ({ harness, id, changeDir, loops }) => {
				const error = await refusal(answerSpecLoop(harness, id, principal("approve"), context));

				expect(error).toBeInstanceOf(EscalationAnswerError);
				expect((error as Error).message).toContain("approvals.json is not valid");
				expect(await loops()).toHaveLength(1);
				expect(readFileSync(join(changeDir, "approvals.json"), "utf8")).toBe(malformed);
			},
			{ before: (changeDir) => writeFileSync(join(changeDir, "approvals.json"), malformed) },
		);
	});
});
