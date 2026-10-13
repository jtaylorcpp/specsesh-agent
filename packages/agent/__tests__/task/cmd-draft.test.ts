/**
 * `prepareDraft` and `runDraft`: the refusals, and each change state's branch, in process
 * on a faux model over stages defined in the tests. The CLI's scenarios are in `__tests__/change/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage, type Harness } from "@earendil-works/pi-durable";
import { main } from "../../src/bin/agentscript-change.js";
import * as task from "../../src/task/index.js";
import { changeState } from "../../src/task/change-state.js";
import { prepareApprove, runApprove } from "../../src/task/cmd-approve.js";
import { isApproveFeedback, prepareDraft, runDraft, type DraftArgs, type DraftResult } from "../../src/task/cmd-draft.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context, temp } from "./helpers.js";
import { STAGE_SCRIPT, draft } from "./spec-helpers.js";

afterEach(cleanTemps);

const CHANGE = "add-plan-export";
const AT = "2026-10-13T00:00:00.000Z";

const proposal: SpecStage = { name: "proposal", owns: ["proposal.md"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const design: SpecStage = { name: "design", owns: ["design.md"], after: ["proposal"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const stages = [proposal, design];

type Env = ReturnType<typeof setup>;

/** One harness over a workspace kept across `draft` calls, as the database is across CLI runs. */
async function session(body: (s: { workspace: string; changeDir: string; env: Env; harness: Harness; draft: (args: Omit<DraftArgs, "change">, responses?: ReturnType<typeof draft>[]) => Promise<DraftResult & { loops: number[] }> }) => Promise<void>) {
	const workspace = temp("cmd-draft-");
	const changeDir = join(workspace, "openspec", "changes", CHANGE);
	const env = setup();
	for (const extension of task.draftLoopExtensions({ workspace, stages })) env.registry.install(extension);
	const harness = await openHarness(new MemoryStorage(), env);
	const run = async (args: Omit<DraftArgs, "change">, responses: ReturnType<typeof draft>[] = []) => {
		env.faux.setResponses(responses);
		const prepared = prepareDraft({ change: CHANGE, ...args }, { workspace, changesDir: join(workspace, "openspec", "changes"), cwd: workspace });
		const loops: number[] = [];
		if (prepared.kind === "refused") return { ...prepared, loops } as DraftResult & { loops: number[] };
		const result = await runDraft(harness, prepared, { model: env.model, principal: "jesse", stages, onLoop: (loop) => loops.push(loop) }, context);
		return { ...result, loops };
	};
	try {
		await body({ workspace, changeDir, env, harness, draft: run });
	} finally {
		await harness.close(context);
	}
}

/** Every prompt the faux model was sent, joined. */
const prompts = (env: Env) => env.requests.map((request) => JSON.stringify(request.messages)).join("\n");

describe("task/cmd-draft", () => {
	it("starts a new change at the proposal, with intent.md, and waits for its review", async () => {
		await session(async ({ changeDir, draft: run }) => {
			const result = await run({ intent: "Export a plan" }, [draft("=== proposal.md\n## Why\n")]);
			expect(readFileSync(join(changeDir, "intent.md"), "utf8")).toBe("Export a plan");
			expect(result).toMatchObject({ kind: "review", stage: "proposal", files: ["proposal.md"], ran: true, exitCode: 0, approved: [] });
			expect(result.loops).toEqual([(result as { loop: number }).loop]);
		});
	});

	it("refuses a missing change without an intent, naming --intent, and creates nothing", async () => {
		await session(async ({ workspace, draft: run }) => {
			const result = await run({});
			expect(result).toMatchObject({ kind: "refused", exitCode: 2 });
			expect((result as { message: string }).message).toContain("--intent");
			expect(existsSync(join(workspace, "openspec"))).toBe(false);
		});
	});

	it("refuses an intent on an existing change, both intents, a bad id and a missing intent file", async () => {
		await session(async ({ workspace, changeDir, draft: run }) => {
			expect(prepareDraft({ change: "../x", intent: "x" }, { workspace, changesDir: join(workspace, "openspec", "changes"), cwd: workspace })).toMatchObject({ kind: "refused" });
			expect(await run({ intent: "x", intentFile: "f.md" })).toMatchObject({ kind: "refused", message: "give --intent or --intent-file, not both" });
			expect(await run({ intentFile: "missing.md" })).toMatchObject({ kind: "refused" });
			mkdirSync(changeDir, { recursive: true });
			expect(await run({ intent: "x" })).toMatchObject({ kind: "refused", exitCode: 2 });
		});
	});

	it("reads --intent-file", async () => {
		await session(async ({ workspace, changeDir, draft: run }) => {
			writeFileSync(join(workspace, "intent.txt"), "From a file\n");
			await run({ intentFile: "intent.txt" }, [draft("=== proposal.md\n## Why\n")]);
			expect(readFileSync(join(changeDir, "intent.md"), "utf8")).toBe("From a file\n");
		});
	});

	it("refuses feedback when nothing waits", async () => {
		await session(async ({ changeDir, draft: run }) => {
			mkdirSync(changeDir, { recursive: true });
			writeFileSync(join(changeDir, "intent.md"), "Export a plan");
			const result = await run({ feedback: "JSON only" });
			expect(result).toMatchObject({ kind: "refused", exitCode: 2, loops: [] });
		});
	});

	it("starts nothing on a fully approved change, and redrafts from an edited design", async () => {
		await session(async ({ changeDir, draft: run }) => {
			mkdirSync(changeDir, { recursive: true });
			writeFileSync(join(changeDir, "intent.md"), "Export a plan");
			writeFileSync(join(changeDir, "proposal.md"), "## Why\n");
			writeFileSync(join(changeDir, "design.md"), "## Context\n");
			for (const stage of stages) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: AT }, stages);

			expect(await run({})).toMatchObject({ kind: "drafted", ran: false, approved: ["proposal", "design"], exitCode: 0, loops: [] });

			writeFileSync(join(changeDir, "design.md"), "## Context\n\nEdited.\n");
			const result = await run({}, [draft("=== design.md\n## Context\n\nRedrafted.\n")]);
			expect(result).toMatchObject({ kind: "review", stage: "design", approved: ["proposal"], exitCode: 0 });
		});
	});

	it("shows a waiting review again without starting a loop, and revises it with feedback", async () => {
		await session(async ({ env, draft: run }) => {
			const first = await run({ intent: "Export a plan" }, [draft("=== proposal.md\n## Why\n")]);
			const shown = await run({});
			expect(shown).toMatchObject({ kind: "review", loop: (first as { loop: number }).loop, ran: false, exitCode: 0, loops: [] });

			const revised = await run({ feedback: "JSON only" }, [draft("=== proposal.md\n## Why\n\nJSON.\n")]);
			expect(revised).toMatchObject({ kind: "review", stage: "proposal", ran: true, drafts: [{ n: 1 }, { n: 2 }] });
			expect(prompts(env)).toContain("The principal asked for: JSON only");
		});
	});

	it("shows a waiting question again with exit 1, and answers it with feedback", async () => {
		await session(async ({ env, draft: run }) => {
			const asked = await run({ intent: "Export a plan" }, [draft("", "ask", "CSV too?")]);
			expect(asked).toMatchObject({ kind: "question", question: "CSV too?", ran: true, exitCode: 1 });
			expect(await run({})).toMatchObject({ kind: "question", question: "CSV too?", ran: false, exitCode: 1, loops: [] });

			const answered = await run({ feedback: "No" }, [draft("=== proposal.md\n## Why\n")]);
			expect(answered).toMatchObject({ kind: "review", stage: "proposal", ran: true, exitCode: 0 });
			expect(prompts(env)).toContain("The principal asked for: No");
		});
	});

	describe("under a changesDir other than openspec/changes", () => {
		const prepareIn = (workspace: string, args: DraftArgs) => prepareDraft(args, { workspace, changesDir: join(workspace, "specs", "changes"), cwd: workspace });

		it("creates intent.md under changesDir, not under openspec/changes", async () => {
			await session(async ({ workspace, harness, env }) => {
				const prepared = prepareIn(workspace, { change: CHANGE, intent: "Export a plan" });
				expect(prepared).toMatchObject({ kind: "request", changeDir: join(workspace, "specs", "changes", CHANGE), changePath: `specs/changes/${CHANGE}` });
				if (prepared.kind === "refused") return;
				await runDraft(harness, prepared, { model: env.model, stages }, context);
				expect(readFileSync(join(workspace, "specs", "changes", CHANGE, "intent.md"), "utf8")).toBe("Export a plan");
				expect(existsSync(join(workspace, "openspec", "changes", CHANGE, "intent.md"))).toBe(false);
			});
		});

		it("finds an existing change under changesDir, refusing --intent with exit 2", () => {
			const workspace = temp("cmd-draft-dir-");
			mkdirSync(join(workspace, "specs", "changes", CHANGE), { recursive: true });
			const result = prepareIn(workspace, { change: CHANGE, intent: "Export a plan" });
			expect(result).toMatchObject({ kind: "refused", exitCode: 2 });
			expect((result as { message: string }).message).toContain(`specs/changes/${CHANGE}/intent.md`);
		});

		it("agentscript-change reads changesDir from agentscript.config.json", async () => {
			const workspace = temp("cmd-draft-dir-");
			writeFileSync(join(workspace, "agentscript.config.json"), JSON.stringify({ task: { changesDir: "specs/changes" } }));
			mkdirSync(join(workspace, "specs", "changes", CHANGE), { recursive: true });
			const err: string[] = [];
			const code = await main(["draft", CHANGE, "--intent", "Export a plan"], { cwd: workspace, env: {}, out: () => {}, err: (line) => err.push(line) });
			expect(code).toBe(2);
			expect(err.join("\n")).toContain(`specs/changes/${CHANGE}/intent.md`);
			expect(existsSync(join(workspace, "openspec"))).toBe(false);
		});

		it("refuses ids that are not one directory name under changesDir, creating nothing", () => {
			const workspace = temp("cmd-draft-dir-");
			for (const change of ["../x", "a/b", "a\\b", ".", "..", ""]) {
				expect(prepareIn(workspace, { change, intent: "x" })).toMatchObject({ kind: "refused", exitCode: 2 });
			}
			expect(existsSync(join(workspace, "specs"))).toBe(false);
			expect(existsSync(join(workspace, "x"))).toBe(false);
		});
	});

	it("refuses approve as feedback at a review, naming pnpm change approve, and answers nothing", async () => {
		await session(async ({ workspace, changeDir, env, harness, draft: run }) => {
			const first = await run({ intent: "Export a plan" }, [draft("=== proposal.md\n## Why\n")]);
			const approvals = join(changeDir, "approvals.json");
			const before = existsSync(approvals) ? readFileSync(approvals) : undefined;
			const calls = env.requests.length;

			const result = await run({ feedback: " Approve " });
			expect(result).toMatchObject({ kind: "refused", exitCode: 2, loops: [] });
			expect((result as { message: string }).message).toContain(`pnpm change approve ${CHANGE}`);
			expect(existsSync(approvals) ? readFileSync(approvals) : undefined).toEqual(before);
			expect(env.requests.length).toBe(calls);
			const state = await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes"), stages }, context);
			expect(state).toMatchObject({ kind: "review", stage: "proposal", loop: (first as { loop: number }).loop });
		});
	});

	it("isApproveFeedback matches only approve, trimmed, in any case", () => {
		for (const feedback of ["approve", "APPROVE", "  Approve\n"]) expect(isApproveFeedback(feedback)).toBe(true);
		for (const feedback of ["approved", "approve it", "approve but JSON only", ""]) expect(isApproveFeedback(feedback)).toBe(false);
	});

	it("approving with runApprove moves on to the next stage", async () => {
		await session(async ({ workspace, env, harness, draft: run }) => {
			await run({ intent: "Export a plan" }, [draft("=== proposal.md\n## Why\n")]);
			const approve = async (responses: ReturnType<typeof draft>[] = []) => {
				env.faux.setResponses(responses);
				const prepared = prepareApprove({ change: CHANGE }, { workspace, changesDir: join(workspace, "openspec", "changes") });
				if (prepared.kind === "refused") return prepared;
				return runApprove(harness, prepared, { model: env.model, principal: "jesse", stages }, context);
			};
			const next = await approve([draft("=== design.md\n## Context\n")]);
			expect(next).toMatchObject({ kind: "review", stage: "design", approved: ["proposal"] });
			const done = await approve();
			expect(done).toMatchObject({ kind: "drafted", ran: true, approved: ["proposal", "design"], exitCode: 0 });
		});
	});
});
