import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage, defineExtension, defineTask, type Harness, type TaskId } from "@earendil-works/pi-durable";
import type { Escalation } from "../../src/openspec/index.js";
import * as task from "../../src/task/index.js";
import { CHANGE_LOOP_TASK } from "../../src/task/change-input.js";
import type { ChangeLoopResult } from "../../src/task/change-loop.js";
import { changeState } from "../../src/task/change-state.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context, temp } from "./helpers.js";
import { STAGE_SCRIPT, draft, specWorkspace } from "./spec-helpers.js";

afterEach(cleanTemps);

const CHANGE = "add-plan-export";

const proposal: SpecStage = { name: "proposal", owns: ["proposal.md"], script: { text: STAGE_SCRIPT }, gate: () => [] };
const design: SpecStage = { name: "design", owns: ["design.md"], after: ["proposal"], script: { text: STAGE_SCRIPT }, gate: () => [] };

const AT = "2026-10-13T00:00:00.000Z";

/** A stand-in `agentscript.change-loop`: it ends at once with the result its input carries. */
const FakeChangeLoopTask = defineTask<{ tasksPath: string; result: ChangeLoopResult }, { phase: "end" }, ChangeLoopResult>({
	name: CHANGE_LOOP_TASK,
	version: 1,
	initial: () => ({ phase: "end" }),
	phases: {
		end: async (t, runtime, ctx) => {
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: t.input.result } }), ctx);
		},
	},
	abort: async (_t, runtime, ctx) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), ctx);
	},
});
const FakeChangeLoop = defineExtension({ name: CHANGE_LOOP_TASK, tasks: [FakeChangeLoopTask] });

const escalation = (question: string, to: Escalation["to"] = "principal"): Escalation => ({ level: "change", to, reason: "question", question });

/** A change result: group 1 converged; for `blocked`, group 2 blocked at task 2.3 on `esc`. */
function changeResult(status: "converged" | "blocked" | "exhausted" | "failed", esc?: Escalation): ChangeLoopResult {
	const converged = { group: 1, outcome: { status: "converged", iterations: [], result: { group: 1, tasks: [] } }, runs: 1 };
	if (status !== "blocked") {
		return { outcome: { status, iterations: [], result: { groups: [converged], unclaimed: [] } } as ChangeLoopResult["outcome"], notes: [], blocked: null };
	}
	const taskBlock = { ...esc!, level: "task" };
	const blockedGroup = {
		group: 2,
		outcome: {
			status: "blocked",
			iterations: [],
			escalation: { ...esc!, level: "group" },
			result: { group: 2, tasks: [{ task: "2.3", outcome: { status: "blocked", iterations: [], escalation: taskBlock }, runs: 1 }] },
		},
		runs: 1,
	};
	return {
		outcome: { status, iterations: [], escalation: esc!, result: { groups: [converged, blockedGroup], unclaimed: [] } } as ChangeLoopResult["outcome"],
		notes: [],
		blocked: { group: 2, loop: 99 },
	};
}

/** Create a change loop for `change` that ends with `result`, and wait for it; with `settle: false` it is created only. */
async function changeLoop(harness: Harness, workspace: string, result: ChangeLoopResult, { change = CHANGE, settle = true } = {}) {
	const input = { tasksPath: join(workspace, "openspec", "changes", change, "tasks.md"), result };
	const owner = await harness.root(context);
	const id = await owner.commit((tx) => tx.createTask(FakeChangeLoopTask, input, { ownership: { kind: "conversation" } }), context);
	if (settle) {
		harness.resume();
		await harness.waitForTask(id as TaskId<ChangeLoopResult>, context);
	}
	return Number(id);
}

/** A faux-model harness with the draft loop over `stages`, and a workspace holding the change. */
async function withHarness(stages: readonly SpecStage[], body: (h: { harness: Harness; env: ReturnType<typeof setup>; workspace: string; changeDir: string }) => Promise<void>) {
	const { workspace, changeDir } = specWorkspace(CHANGE);
	const env = setup();
	for (const extension of task.draftLoopExtensions({ workspace, stages })) env.registry.install(extension);
	env.registry.install(FakeChangeLoop);
	const harness = await openHarness(new MemoryStorage(), env);
	try {
		await body({ harness, env, workspace, changeDir });
	} finally {
		await harness.close(context);
	}
}

/** Every stage of `SPEC_STAGES` drafted and approved, in order. */
function approveAll(changeDir: string) {
	mkdirSync(join(changeDir, "specs", "plan", "export"), { recursive: true });
	for (const [file, text] of [
		["proposal.md", "## Why\n"],
		["design.md", "## Context\n"],
		["specs/plan/export/spec.md", "## Purpose\n"],
		["tasks.md", "## 1. Code\n"],
	]) {
		writeFileSync(join(changeDir, file!), text!);
	}
	for (const stage of SPEC_STAGES) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: AT }, SPEC_STAGES);
}

async function startBlocked(harness: Harness, env: ReturnType<typeof setup>, workspace: string, stages: readonly SpecStage[], change = CHANGE) {
	const id = await task.startDraftLoop(harness, { change, intent: "Export a plan", workspace, changesDir: join(workspace, "openspec", "changes"), stages, model: env.model }, context);
	harness.resume();
	await task.waitForDraftLoop(harness, id, context);
	return Number(id);
}

describe("task/change-state", () => {
	it("a change with no directory is missing", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			const changesDir = join(workspace, "openspec", "changes");
			expect(await changeState(harness, { change: "add-nothing", changesDir }, context)).toEqual({ kind: "missing", change: "add-nothing" });
		});
	});

	it("a change with no draft loop is ready at the proposal", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			const changesDir = join(workspace, "openspec", "changes");
			expect(await changeState(harness, { change: CHANGE, changesDir }, context)).toEqual({
				kind: "ready",
				change: CHANGE,
				firstStage: "proposal",
				approved: [],
				build: { kind: "ready" },
			});
		});
	});

	it("an approved change with design.md edited is ready at the design", async () => {
		await withHarness([proposal], async ({ harness, workspace, changeDir }) => {
			approveAll(changeDir);
			writeFileSync(join(changeDir, "design.md"), "## Context\n\nEdited.\n");
			expect(await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes") }, context)).toEqual({
				kind: "ready",
				change: CHANGE,
				firstStage: "design",
				approved: ["proposal"],
				build: { kind: "ready" },
			});
		});
	});

	it("an approved, unchanged change is drafted", async () => {
		await withHarness([proposal], async ({ harness, workspace, changeDir }) => {
			approveAll(changeDir);
			expect(await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes") }, context)).toEqual({
				kind: "drafted",
				change: CHANGE,
				approved: ["proposal", "design", "specs", "tasks"],
				build: { kind: "ready" },
			});
		});
	});

	it("a draft blocked for review of design.md is a review", async () => {
		const stages = [proposal, design];
		await withHarness(stages, async ({ harness, env, workspace }) => {
			env.faux.setResponses([draft("=== proposal.md\n## Why\n")]);
			const first = await startBlocked(harness, env, workspace, stages);
			env.faux.setResponses([draft("=== design.md\n## Context\n")]);
			const next = await task.answerDraftLoop(harness, first as never, { by: "principal", principal: "jesse", decision: "approve" }, context);
			await task.waitForDraftLoop(harness, next, context);

			const state = await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes"), stages }, context);
			expect(state).toEqual({
				kind: "review",
				change: CHANGE,
				loop: Number(next),
				stage: "design",
				files: ["design.md"],
				approved: ["proposal"],
				drafts: [{ n: 1, issues: [] }],
				build: { kind: "ready" },
			});
		});
	});

	it("a draft blocked on a question is a question", async () => {
		await withHarness([proposal], async ({ harness, env, workspace }) => {
			env.faux.setResponses([draft("", "ask", "CSV too?")]);
			const loop = await startBlocked(harness, env, workspace, [proposal]);

			const state = await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes"), stages: [proposal] }, context);
			expect(state).toEqual({ kind: "question", change: CHANGE, loop, stage: "proposal", question: "CSV too?", approved: [], drafts: [], build: { kind: "ready" } });
		});
	});

	it("only the newest draft loop counts", async () => {
		await withHarness([proposal], async ({ harness, env, workspace }) => {
			env.faux.setResponses([draft("=== proposal.md\n## Why\n")]);
			const first = await startBlocked(harness, env, workspace, [proposal]);
			const next = await task.answerDraftLoop(harness, first as never, { by: "principal", principal: "jesse", decision: "approve" }, context);
			expect(await task.waitForDraftLoop(harness, next, context)).toMatchObject({ status: "converged" });

			const state = await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes"), stages: [proposal] }, context);
			expect(state).toEqual({ kind: "drafted", change: CHANGE, loop: Number(next), approved: ["proposal"], build: { kind: "ready" } });
		});
	});

	it("a draft loop of another change is ignored", async () => {
		await withHarness([proposal], async ({ harness, env, workspace }) => {
			mkdirSync(join(workspace, "openspec", "changes", "add-other"), { recursive: true });
			env.faux.setResponses([draft("=== proposal.md\n## Why\n")]);
			await startBlocked(harness, env, workspace, [proposal], "add-other");

			const state = await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes"), stages: [proposal] }, context);
			expect(state).toEqual({ kind: "ready", change: CHANGE, firstStage: "proposal", approved: [], build: { kind: "ready" } });
		});
	});

	it("a changesDir elsewhere is read as given", async () => {
		await withHarness([proposal], async ({ harness }) => {
			const changesDir = temp("changes-");
			mkdirSync(join(changesDir, CHANGE));
			expect(await changeState(harness, { change: CHANGE, changesDir, stages: [proposal] }, context)).toMatchObject({ kind: "ready", firstStage: "proposal" });
		});
	});
});

describe("task/change-state build", () => {
	const buildOf = async (harness: Harness, workspace: string) => {
		const state = await changeState(harness, { change: CHANGE, changesDir: join(workspace, "openspec", "changes"), stages: [proposal] }, context);
		return state.kind === "missing" ? undefined : state.build;
	};

	it("a change with no change loop is ready", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			expect(await buildOf(harness, workspace)).toEqual({ kind: "ready" });
		});
	});

	it("a change whose newest loop ended exhausted is ready", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			const loop = await changeLoop(harness, workspace, changeResult("exhausted"));
			expect(await buildOf(harness, workspace)).toEqual({ kind: "ready", loop });
		});
	});

	it("a change whose newest loop ended failed is ready", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			const loop = await changeLoop(harness, workspace, changeResult("failed"));
			expect(await buildOf(harness, workspace)).toEqual({ kind: "ready", loop });
		});
	});

	it("a blocked loop to the principal is waiting, with its question", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			const loop = await changeLoop(harness, workspace, changeResult("blocked", escalation("Which API?")));
			expect(await buildOf(harness, workspace)).toEqual({
				kind: "waiting",
				loop,
				escalation: { level: "change", to: "principal", reason: "question", question: "Which API?", group: 2, task: "2.3" },
			});
		});
	});

	it("a blocked loop to the agent is waiting for the agent", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			await changeLoop(harness, workspace, changeResult("blocked", escalation("Which API?", "agent")));
			expect(await buildOf(harness, workspace)).toMatchObject({ kind: "waiting", escalation: { to: "agent", question: "Which API?" } });
		});
	});

	it("a converged loop is built", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			const loop = await changeLoop(harness, workspace, changeResult("converged"));
			expect(await buildOf(harness, workspace)).toEqual({ kind: "built", loop });
		});
	});

	it("only the newest change loop counts", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			await changeLoop(harness, workspace, changeResult("converged"));
			const loop = await changeLoop(harness, workspace, changeResult("blocked", escalation("Which API?")));
			expect(await buildOf(harness, workspace)).toMatchObject({ kind: "waiting", loop });
		});
	});

	it("a change loop of another change is ignored", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			await changeLoop(harness, workspace, changeResult("converged"), { change: "add-other" });
			expect(await buildOf(harness, workspace)).toEqual({ kind: "ready" });
		});
	});

	it("a change loop not settled yet is ready and running", async () => {
		await withHarness([proposal], async ({ harness, workspace }) => {
			const loop = await changeLoop(harness, workspace, changeResult("converged"), { settle: false });
			expect(await buildOf(harness, workspace)).toEqual({ kind: "ready", loop, running: true });
		});
	});
});
