import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage, type Storage } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { ChangeOutcome, LoopOutcome, check, type Escalation } from "../../src/openspec/index.js";
import { CHANGE_LOOP_TASK } from "../../src/task/change-input.js";
import { GROUP_LOOP_NAME } from "../../src/task/group.js";
import {
	EscalationAnswerError,
	TASK_LOOP,
	answerChangeEscalation,
	changeLoopExtensions,
	startChangeLoop,
	waitForChangeLoop,
	type ChangeLoopOptions,
} from "../../src/task/index.js";
import { setup } from "../durable/helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, loopHarness, prompts, temp, verdict } from "./helpers.js";
import { stagedCheck } from "./staged-check.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The repo's pinned `openspec` (1.14.1): the guard validates the change with it. */
const OPENSPEC_BIN = join(HERE, "..", "..", "..", "..", "node_modules", ".bin");

let savedPath: string | undefined;
beforeEach(() => {
	savedPath = process.env.PATH;
	process.env.PATH = `${OPENSPEC_BIN}:${savedPath ?? ""}`;
});
afterEach(() => {
	process.env.PATH = savedPath;
	cleanTemps();
});

const ChangeLoopOutcome = LoopOutcome(ChangeOutcome);
const CHANGE = "add-three-groups";
const PROPOSAL = "## Why\nBecause three files have to exist, for a reason long enough to pass.\n\n## What Changes\n- Adds the files.\n";
const TASKS = [
	{ group: "One", id: "1.1", text: "Group one builds" },
	{ group: "Two", id: "2.1", text: "Group two builds" },
	{ group: "Three", id: "3.1", text: "Group three builds" },
];

/** A strictly valid change of three groups, one unticked task each, and no `approvals.json` (as in change-loop.test.ts). */
function writeChange(): { workspace: string; changeDir: string } {
	const workspace = temp("change-groups-ws-");
	mkdirSync(join(workspace, "openspec", "specs"), { recursive: true });
	const changeDir = join(workspace, "openspec", "changes", CHANGE);
	mkdirSync(join(changeDir, "specs", "thing", "core"), { recursive: true });
	writeFileSync(join(changeDir, "proposal.md"), PROPOSAL);
	const requirements = TASKS.map(
		(t, i) => `### Requirement: Thing ${i + 1}\nThing ${i + 1} SHALL exist.\n\n#### Scenario: ${t.text}\n- **WHEN** it runs\n- **THEN** it SHALL work\n`,
	);
	// `## Purpose`, so the change check's trial fold creates the capability clean.
	const purpose = "## Purpose\nThings that exist, so the change-loop tests have a capability to build.\n\n";
	writeFileSync(join(changeDir, "specs", "thing", "core", "spec.md"), `${purpose}## ADDED Requirements\n\n${requirements.join("\n")}`);
	const tasks = TASKS.flatMap((t, i) => [`## ${i + 1}. ${t.group}`, "", `- [ ] ${t.id} \`${t.id}.txt\`: "${t.text}"`, ""]);
	writeFileSync(join(changeDir, "tasks.md"), tasks.join("\n"));
	return { workspace, changeDir };
}

/** A fake `pnpm` first on PATH: prints what it ran and exits 1. */
function failingPnpm(): void {
	const bin = temp("change-groups-bin-");
	writeFileSync(join(bin, "pnpm"), `#!${process.execPath}\nprocess.stdout.write("ran " + process.argv.slice(2).join(" "));\nprocess.exit(1);\n`, {
		mode: 0o755,
	});
	process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
}

const judgeRework = (task: string) =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { next_action: "rework", rework_task: task, feedback: "try again", question: "" })], {
		stopReason: "toolUse",
	});
const asksWhichApi = () => verdict(false, "which API?", "amend-spec", "Which API?");

type Responses = Parameters<ReturnType<typeof setup>["faux"]["setResponses"]>[0];

/** Start a change loop over the three groups, answer with `responses`, and wait for it; the harness is left open. */
async function startChange(responses: Responses, passes: readonly boolean[] = [true], overrides: Partial<ChangeLoopOptions> = {}) {
	const storage = new MemoryStorage();
	const { workspace, changeDir } = writeChange();
	const staged = stagedCheck(passes);
	const checks = [staged.command];
	const env = setup();
	for (const extension of changeLoopExtensions({ workspace, checks, allow: [] })) env.registry.install(extension);
	const harness = await loopHarness(env, storage);
	env.faux.setResponses(responses);
	const options: ChangeLoopOptions = {
		change: { dir: changeDir },
		script: { text: JUDGE_ONLY },
		groupScript: { text: GROUP_JUDGE },
		workspace,
		checks,
		model: env.model,
		...overrides,
	};
	const id = await startChangeLoop(harness, options, context);
	harness.resume();
	const outcome = await waitForChangeLoop(harness, id, context);
	return { id, outcome, env, storage, harness, staged };
}

const scan = async (storage: Storage, kind: string) => (await storage.scanTasks({ kind }, 100, undefined, context)).items;
const groupLoops = async (storage: Storage) => (await scan(storage, GROUP_LOOP_NAME)).map((t) => (t.input as unknown as { group: number }).group);
const taskLoops = async (storage: Storage) => (await scan(storage, TASK_LOOP)).map((t) => (t.input as unknown as { task: string }).task);
const escalationOf = (outcome: LoopOutcome<ChangeOutcome>) => (outcome as { escalation: Escalation }).escalation;

describe.skipIf(process.platform === "win32")("task/change: groups that do not converge, and the change check", () => {
	it("Scenario: A blocked group blocks the change", async () => {
		const r = await startChange([verdict(true), asksWhichApi()]);
		try {
			expect(r.outcome.status).toBe("blocked");
			expect(escalationOf(r.outcome)).toMatchObject({ level: "change", to: "principal", question: "Which API?" });
			expect(r.outcome.result?.groups.map((g) => [g.group, g.outcome.status])).toEqual([
				[1, "converged"],
				[2, "blocked"],
			]);
			expect(check(ChangeLoopOutcome, r.outcome)).toBe(true);

			// Group 3 never ran: no group loop, no task loop, no prompt.
			expect(await groupLoops(r.storage)).toEqual([1, 2]);
			expect(await taskLoops(r.storage)).toEqual(["1.1", "2.1"]);
			expect(prompts(r.env.requests).some((p) => p.includes("Task 3.1"))).toBe(false);
			expect(r.env.faux.getPendingResponseCount()).toBe(0);
		} finally {
			await r.harness.close(context);
		}
	}, 60_000);

	it("Scenario: A failed group ends the change", async () => {
		// 1.1's gate passes, group 1's check fails, the judge reworks 1.1, its gate passes, the check fails again: no reworks left.
		const r = await startChange([verdict(true), judgeRework("1.1"), verdict(true), judgeRework("1.1")], [true, false, true, false], {
			budget: { maxIterations: 1, maxReworks: 1 },
		});
		try {
			expect(r.outcome.status).toBe("failed");
			expect(r.outcome.result?.groups.map((g) => [g.group, g.outcome.status])).toEqual([[1, "exhausted"]]);
			expect(check(ChangeLoopOutcome, r.outcome)).toBe(true);

			// Named in the stored result's notes: "group 1 ended exhausted".
			const [change] = await scan(r.storage, CHANGE_LOOP_TASK);
			const state = change?.state as unknown as { outcome: { result: { notes: string[] } } };
			expect(state.outcome.result.notes).toContainEqual(expect.stringMatching(/group 1\b.*exhausted/));

			expect(await groupLoops(r.storage)).toEqual([1]);
			expect(prompts(r.env.requests).some((p) => p.includes("Task 2.1"))).toBe(false);
			expect(r.env.faux.getPendingResponseCount()).toBe(0);
		} finally {
			await r.harness.close(context);
		}
	}, 60_000);

	it("Scenario: A failing change check fails the change", async () => {
		failingPnpm();
		const r = await startChange([verdict(true), verdict(true), verdict(true)], [true], { changeChecks: ["pnpm docs:check"] });
		try {
			expect(r.outcome.status).toBe("failed");
			expect(r.outcome.result?.groups.map((g) => [g.group, g.outcome.status])).toEqual([
				[1, "converged"],
				[2, "converged"],
				[3, "converged"],
			]);
			expect(r.outcome.iterations).toHaveLength(1);
			const [iteration] = r.outcome.iterations;
			expect(iteration?.verdict.met).toBe(false);
			expect(iteration?.verdict.unmet.map((u) => u.target)).toEqual([{ check: "change" }]);
			expect(iteration?.evidence).toEqual([expect.objectContaining({ kind: "check", command: "pnpm docs:check", exitCode: 1 })]);
			expect(check(ChangeLoopOutcome, r.outcome)).toBe(true);
			// Each task's gate and each group's check used the staged check; the change check did not.
			expect(r.staged.calls()).toBe(6);
		} finally {
			await r.harness.close(context);
		}
	}, 60_000);

	it("Scenario: Answering a blocked group resumes the change", async () => {
		const r = await startChange([verdict(true), asksWhichApi()]);
		try {
			expect(r.outcome.status).toBe("blocked");
			const escalation = escalationOf(r.outcome);
			const answer = (by: "principal" | "agent") => ({ escalation, by, decision: "Use the v2 API", feedback: [] });

			// Only the escalation's recipient may answer; a refusal starts nothing.
			await expect(answerChangeEscalation(r.harness, r.id, answer("agent"), context)).rejects.toThrow(EscalationAnswerError);
			expect(await scan(r.storage, CHANGE_LOOP_TASK)).toHaveLength(1);
			expect(await groupLoops(r.storage)).toEqual([1, 2]);

			r.env.faux.appendResponses([verdict(true), verdict(true)]);
			const next = await answerChangeEscalation(r.harness, r.id, answer("principal"), context);
			const outcome = await waitForChangeLoop(r.harness, next, context);

			expect(next).not.toBe(r.id);
			expect(outcome.status).toBe("converged");
			expect(outcome.result?.groups.map((g) => [g.group, g.runs, g.outcome.status])).toEqual([
				[1, 1, "converged"],
				[2, 2, "converged"],
				[3, 1, "converged"],
			]);
			expect(check(ChangeLoopOutcome, outcome)).toBe(true);

			// Group 1 was carried, not rebuilt; group 2 reran with the decision; group 3 came after it.
			expect(await groupLoops(r.storage)).toEqual([1, 2, 2, 3]);
			expect(await taskLoops(r.storage)).toEqual(["1.1", "2.1", "2.1", "3.1"]);
			const asked = prompts(r.env.requests);
			expect(asked).toHaveLength(4);
			expect(asked[2]).toContain("Task 2.1");
			expect(asked[2]).toContain("Carried: Use the v2 API");
			expect(asked[3]).toContain("Task 3.1");
			expect(asked[3]).not.toContain("Use the v2 API");
			expect(r.env.faux.getPendingResponseCount()).toBe(0);
		} finally {
			await r.harness.close(context);
		}
	}, 60_000);
});
