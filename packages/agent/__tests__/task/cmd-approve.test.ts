/**
 * `prepareApprove` and `runApprove`: the approval, and each refusal, in process on a faux
 * model over stages defined in the tests. The CLI's scenarios are in `__tests__/change/`.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage, type Harness } from "@earendil-works/pi-durable";
import * as task from "../../src/task/index.js";
import { prepareApprove, runApprove, type ApproveResult } from "../../src/task/cmd-approve.js";
import { prepareDraft, runDraft } from "../../src/task/cmd-draft.js";
import { DRAFT_LOOP_TASK } from "../../src/task/draft-input.js";
import { readApprovals } from "../../src/task/spec-approvals.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context, temp } from "./helpers.js";
import { STAGE_SCRIPT, draft } from "./spec-helpers.js";

afterEach(cleanTemps);

const CHANGE = "add-plan-export";

const proposal: SpecStage = { name: "proposal", owns: ["proposal.md"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const design: SpecStage = { name: "design", owns: ["design.md"], after: ["proposal"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const stages = [proposal, design];

type Env = ReturnType<typeof setup>;

interface Session {
	workspace: string;
	changeDir: string;
	env: Env;
	harness: Harness;
	/** `draft <change>` (with `--intent "Export a plan"` for a new change), its run answering `responses`. */
	start: (responses: ReturnType<typeof draft>[]) => Promise<void>;
	approve: (principal: string | undefined, responses?: ReturnType<typeof draft>[]) => Promise<ApproveResult & { loops: number[] }>;
	/** Every draft loop run in the database. */
	draftRuns: () => Promise<number>;
}

/** One harness over a workspace kept across calls, as the database is across CLI runs. */
async function session(body: (s: Session) => Promise<void>) {
	const workspace = temp("cmd-approve-");
	const changesDir = join(workspace, "openspec", "changes");
	const changeDir = join(changesDir, CHANGE);
	const env = setup();
	for (const extension of task.draftLoopExtensions({ workspace, stages })) env.registry.install(extension);
	const harness = await openHarness(new MemoryStorage(), env);
	const start = async (responses: ReturnType<typeof draft>[]) => {
		env.faux.setResponses(responses);
		const prepared = prepareDraft({ change: CHANGE, ...(existsSync(changeDir) ? {} : { intent: "Export a plan" }) }, { workspace, changesDir, cwd: workspace });
		if (prepared.kind === "refused") throw new Error(prepared.message);
		await runDraft(harness, prepared, { model: env.model, stages }, context);
	};
	const approve = async (principal: string | undefined, responses: ReturnType<typeof draft>[] = []) => {
		env.faux.setResponses(responses);
		const prepared = prepareApprove({ change: CHANGE }, { workspace, changesDir });
		const loops: number[] = [];
		if (prepared.kind === "refused") return { ...prepared, loops };
		const result = await runApprove(harness, prepared, { model: env.model, stages, ...(principal !== undefined ? { principal } : {}), onLoop: (loop) => loops.push(loop) }, context);
		return { ...result, loops };
	};
	const draftRuns = async () => (await harness.commit((tx) => tx.scanTasks({ kind: DRAFT_LOOP_TASK }, 100), context)).items.length;
	try {
		await body({ workspace, changeDir, env, harness, start, approve, draftRuns });
	} finally {
		await harness.close(context);
	}
}

describe("task/cmd-approve", () => {
	it("approves the proposal under review as the principal, and drafts the design", async () => {
		await session(async ({ changeDir, start, approve }) => {
			await start([draft("=== proposal.md\n## Why\n")]);
			const result = await approve("jesse", [draft("=== design.md\n## Context\n")]);
			expect(result).toMatchObject({ kind: "review", stage: "design", files: ["design.md"], approved: ["proposal"], approvedStage: "proposal", ran: true, exitCode: 0 });
			expect(result.loops).toHaveLength(1);
			expect(readApprovals(changeDir).approvals).toMatchObject([{ stage: "proposal", approved: true, by: "principal", principal: "jesse" }]);
		});
	});

	it("approving the last stage ends drafted", async () => {
		await session(async ({ start, approve }) => {
			await start([draft("=== proposal.md\n## Why\n")]);
			await approve("alice", [draft("=== design.md\n## Context\n")]);
			expect(await approve("alice")).toMatchObject({ kind: "drafted", approved: ["proposal", "design"], approvedStage: "design", exitCode: 0 });
		});
	});

	it("refuses a review without a principal, answering nothing", async () => {
		await session(async ({ changeDir, start, approve, draftRuns }) => {
			await start([draft("=== proposal.md\n## Why\n")]);
			for (const principal of [undefined, "  "]) {
				expect(await approve(principal)).toMatchObject({ kind: "refused", exitCode: 2, message: "approve needs a principal: pass --principal <name>", loops: [] });
			}
			expect(await draftRuns()).toBe(1);
			expect(existsSync(join(changeDir, "approvals.json"))).toBe(false);
		});
	});

	it("refuses a question, naming the draft command, and starts nothing", async () => {
		await session(async ({ env, start, approve, draftRuns }) => {
			await start([draft("", "ask", "CSV too?")]);
			const calls = env.faux.state.callCount;
			// No principal: the state refuses first.
			const result = await approve(undefined);
			expect(result).toMatchObject({ kind: "refused", exitCode: 2, loops: [] });
			expect((result as { message: string }).message).toBe(`${CHANGE} is waiting on a question, not a review:\nCSV too?\nanswer: specsesh change draft ${CHANGE} "<answer>"`);
			expect(await draftRuns()).toBe(1);
			expect(env.faux.state.callCount).toBe(calls);
		});
	});

	it("refuses when nothing is under review: a missing change, one never drafted, one fully drafted", async () => {
		await session(async ({ changeDir, start, approve }) => {
			const nothing = { kind: "refused", exitCode: 2, message: `nothing in ${CHANGE} is under review`, loops: [] };
			expect(await approve("jesse")).toMatchObject(nothing);
			mkdirSync(changeDir, { recursive: true });
			writeFileSync(join(changeDir, "intent.md"), "Export a plan");
			expect(await approve("jesse")).toMatchObject(nothing);

			await start([draft("=== proposal.md\n## Why\n")]);
			await approve("jesse", [draft("=== design.md\n## Context\n")]);
			await approve("jesse");
			expect(await approve("jesse")).toMatchObject(nothing);
		});
	});

	it("refuses ids that are not one directory name under changesDir", () => {
		const workspace = temp("cmd-approve-dir-");
		for (const change of ["../x", "a/b", ".", ""]) {
			expect(prepareApprove({ change }, { workspace, changesDir: join(workspace, "openspec", "changes") })).toMatchObject({ kind: "refused", exitCode: 2 });
		}
	});
});
