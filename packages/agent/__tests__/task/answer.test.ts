import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStorage, type Storage } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeOutcome, LoopOutcome, check, type Escalation } from "../../src/openspec/index.js";
import { CHANGE_LOOP_TASK } from "../../src/task/change-input.js";
import { formatTrialFold, trialFold, type TrialFoldResult } from "../../src/task/cmd-close.js";
import { answerGroupEscalation } from "../../src/task/group-answer.js";
import { GROUP_LOOP_NAME } from "../../src/task/group.js";
import {
	EscalationAnswerError,
	TASK_LOOP,
	answerChangeEscalation,
	answerEscalation,
	changeLoopExtensions,
	startChangeLoop,
	waitForChangeLoop,
	waitForTaskLoop,
	waitForTaskLoopResult,
	type ChangeLoopOptions,
} from "../../src/task/index.js";
import { setup } from "../durable/helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, loopHarness, prompts, runLoop, runTasks, temp, tinyChange, verdict } from "./helpers.js";
import { stagedCheck } from "./staged-check.js";

// The trial fold is stubbed for the change loop's answers: its own tests are in cli-close.test.ts. `formatTrialFold`
// stays real, loaded after the static imports: loading cmd-close in the factory would bind the loop to the real fold.
vi.mock("../../src/task/cmd-close.js", () => ({ formatTrialFold: vi.fn(), trialFold: vi.fn() }));
const actual = await vi.importActual<typeof import("../../src/task/cmd-close.js")>("../../src/task/cmd-close.js");
vi.mocked(formatTrialFold).mockImplementation(actual.formatTrialFold);
// The real `answerGroupEscalation`, spied on, so a test can show the change loop never called it.
vi.mock("../../src/task/group-answer.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../src/task/group-answer.js")>();
	return { ...original, answerGroupEscalation: vi.fn(original.answerGroupEscalation) };
});

afterEach(cleanTemps);

/** JUDGE_ONLY that also reads `amend_path` and `amend_text` back from the result. */
const JUDGE_AMENDING = JUDGE_ONLY.replace(
	"            set @variables.question = @outputs.question\n",
	"            set @variables.question = @outputs.question\n" +
		"            set @variables.amend_path = @outputs.amend_path\n" +
		"            set @variables.amend_text = @outputs.amend_text\n",
);
const HOST = "specs/durable/host/spec.md";
const QUESTION = "The spec says run throws UndeclaredVariableError; the lint refuses first. Amend?";
const AMEND_TEXT =
	"## MODIFIED Requirements\n\n### Requirement: An undeclared variable is refused by the lint\nThe lint SHALL refuse an undeclared variable before run starts.\n";

const carriedOf = (run: { input: unknown } | undefined) =>
	(run?.input as { options: { variables: { carried: string } } }).options.variables.carried;

/**
 * A loop over a change with a `durable/host` delta (so `HOST` is an `amend_path` choice),
 * blocked after two iterations and escalated to the principal; its harness still open.
 * The second verdict is `amend-spec` with an amendment, or with `ask` a plain question.
 */
async function blockedLoop(last: "amend-spec" | "ask" = "amend-spec") {
	const dir = tinyChange({ capabilities: ["durable/host"] });
	const r = await runLoop(
		[
			verdict(false, "the --json case is untested", "retry"),
			last === "amend-spec"
				? verdict(false, "the spec and the lint disagree", "amend-spec", QUESTION, { amend_path: HOST, amend_text: AMEND_TEXT })
				: verdict(false, "two ways to do it", "ask", "Which way?"),
		],
		{ change: { dir }, script: { text: JUDGE_AMENDING } },
	);
	const { outcome } = await waitForTaskLoopResult(r.harness, r.id, context);
	expect(outcome.status).toBe("blocked");
	expect(outcome.iterations).toHaveLength(2);
	const escalation = (outcome as { escalation: Escalation }).escalation;
	expect(escalation.to).toBe("principal");
	if (last === "amend-spec") expect(escalation.amendment).toEqual({ delta: HOST, text: AMEND_TEXT });
	else expect(escalation).not.toHaveProperty("amendment");
	return { ...r, dir, escalation };
}

describe("task/agent: An answered escalation resumes the loop as a new run", () => {
	it("Scenario: The wrong recipient is rejected", async () => {
		const r = await blockedLoop();
		const before = await runTasks(r.storage);
		const answer = answerEscalation(r.harness, r.id, { escalation: r.escalation, by: "agent", decision: "go", feedback: [] }, context);
		await expect(answer).rejects.toThrow(EscalationAnswerError);
		await expect(answer).rejects.toThrow(/goes to the principal, not the agent/);
		const loops = (await r.storage.scanTasks({ kind: "agentscript.task-loop" }, 10, undefined, context)).items;
		const after = await runTasks(r.storage);
		const still = await waitForTaskLoop(r.harness, r.id, context);
		await r.harness.close(context);
		expect(loops).toHaveLength(1);
		expect(after).toHaveLength(before.length);
		expect(after).toHaveLength(2);
		expect(still).toEqual(r.outcome);
		expect(still.status).toBe("blocked");
		expect(still.iterations).toHaveLength(2);
	});

	it("Scenario: A principal's answer resumes the loop", async () => {
		const r = await blockedLoop();
		const earlier = structuredClone(r.outcome.iterations);
		r.env.faux.appendResponses([verdict(true)]);
		const next = await answerEscalation(
			r.harness,
			r.id,
			{ escalation: r.escalation, by: "principal", decision: "Amend the spec; keep the code", feedback: [] },
			context,
		);
		const outcome = await waitForTaskLoop(r.harness, next, context);
		const original = await waitForTaskLoop(r.harness, r.id, context);
		const runs = await runTasks(r.storage);
		await r.harness.close(context);

		expect(next).not.toBe(r.id);
		expect(outcome.status).toBe("converged");
		expect(outcome.iterations.map((i) => i.n)).toEqual([1, 2, 3]);
		expect(outcome.iterations.slice(0, 2)).toEqual(earlier);
		expect(runs).toHaveLength(3);
		expect(carriedOf(runs[2])).toBe("Amend the spec; keep the code");
		const third = prompts(r.env.requests)[2];
		expect(third).toContain("Carried: Amend the spec; keep the code");
		expect(third).toContain("iteration 3");
		// The blocked run is untouched.
		expect(original).toEqual(r.outcome);
	});

	it("Scenario: An applied amendment is carried", async () => {
		const r = await blockedLoop();
		const earlier = structuredClone(r.outcome.iterations);
		const delta = readFileSync(join(r.dir, HOST), "utf8");
		r.env.faux.appendResponses([verdict(true)]);
		const next = await answerEscalation(
			r.harness,
			r.id,
			{ escalation: r.escalation, by: "principal", decision: "amendment-applied", feedback: [] },
			context,
		);
		const outcome = await waitForTaskLoop(r.harness, next, context);
		const runs = await runTasks(r.storage);
		await r.harness.close(context);

		expect(runs).toHaveLength(3);
		expect(carriedOf(runs[2])).toBe(`The principal applied your amendment to ${HOST}. That delta now reads:\n\n${AMEND_TEXT}`);
		expect(outcome.iterations.map((i) => i.n)).toEqual([1, 2, 3]);
		expect(outcome.iterations.slice(0, 2)).toEqual(earlier);
		// Applying the amendment is the principal's job: the loop writes no delta.
		expect(readFileSync(join(r.dir, HOST), "utf8")).toBe(delta);
	});

	it("rejects an answer to a loop that is not blocked, or to another escalation", async () => {
		const done = await runLoop([verdict(true)]);
		const escalation: Escalation = { level: "task", to: "principal", reason: "r", question: "q" };
		await expect(
			answerEscalation(done.harness, done.id, { escalation, by: "principal", decision: "d", feedback: [] }, context),
		).rejects.toThrow(/ended converged, not blocked/);
		await done.harness.close(context);

		const r = await blockedLoop();
		await expect(
			answerEscalation(r.harness, r.id, { escalation: { ...r.escalation, question: "another" }, by: "principal", decision: "d", feedback: [] }, context),
		).rejects.toThrow(/another escalation/);
		await r.harness.close(context);
	});
});

describe("openspec/loops: An answered escalation resumes the loop", () => {
	it("Scenario: A blocked task loop resumes with the answer", async () => {
		const r = await blockedLoop("ask");
		const earlier = structuredClone(r.outcome.iterations);
		// A retry feedback as the loop itself records it, from the first iteration.
		const retry = earlier[0]?.feedback[0];
		expect(retry?.action).toBe("retry");
		if (retry === undefined) return;
		r.env.faux.appendResponses([verdict(true)]);
		const next = await answerEscalation(
			r.harness,
			r.id,
			{ escalation: r.escalation, by: "principal", decision: "Test the --json case first", feedback: [retry] },
			context,
		);
		const outcome = await waitForTaskLoop(r.harness, next, context);
		const runs = await runTasks(r.storage);
		await r.harness.close(context);

		expect(runs).toHaveLength(3);
		expect(outcome.iterations.map((i) => i.n)).toEqual([1, 2, 3]);
		expect(outcome.iterations.slice(0, 2)).toEqual(earlier);
		const carried = carriedOf(runs[2]);
		expect(carried).toContain("Test the --json case first");
		expect(carried).toContain(retry.from.message);
	});
});

/** The repo's pinned `openspec` (1.14.1): the change loop's start guard validates the change with it. */
const OPENSPEC_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "node_modules", ".bin");
const FOLD_COMMAND = "openspec validate --specs --strict --json";
const FOLD_PREFIX = "trial fold failed: openspec validate --specs --strict\n";
const passingFold = (): TrialFoldResult => ({ ok: true, command: FOLD_COMMAND, exit: 0, issues: [] });
const tooLongFold = (): TrialFoldResult => ({
	ok: false,
	command: FOLD_COMMAND,
	exit: 1,
	issues: [{ level: "ERROR", spec: "spec/judge", message: 'Requirement "The judge scores each draft" text exceeds 500 characters (612)' }],
});
const CHANGE = "add-three-groups";
const GROUP_TASKS = [
	{ group: "One", id: "1.1", text: "Group one builds" },
	{ group: "Two", id: "2.1", text: "Group two builds" },
	{ group: "Three", id: "3.1", text: "Group three builds" },
];

/** A strictly valid change of three groups, one unticked task each, and no `approvals.json` (as in change-groups.test.ts). */
function writeThreeGroups(): { workspace: string; changeDir: string } {
	const workspace = temp("answer-change-ws-");
	mkdirSync(join(workspace, "openspec", "specs"), { recursive: true });
	const changeDir = join(workspace, "openspec", "changes", CHANGE);
	mkdirSync(join(changeDir, "specs", "thing", "core"), { recursive: true });
	writeFileSync(join(changeDir, "proposal.md"), "## Why\nBecause three files have to exist, for a reason long enough to pass.\n\n## What Changes\n- Adds the files.\n");
	const requirements = GROUP_TASKS.map(
		(t, i) => `### Requirement: Thing ${i + 1}\nThing ${i + 1} SHALL exist.\n\n#### Scenario: ${t.text}\n- **WHEN** it runs\n- **THEN** it SHALL work\n`,
	);
	const purpose = "## Purpose\nThings that exist, so the change-loop tests have a capability to build.\n\n";
	writeFileSync(join(changeDir, "specs", "thing", "core", "spec.md"), `${purpose}## ADDED Requirements\n\n${requirements.join("\n")}`);
	const tasks = GROUP_TASKS.flatMap((t, i) => [`## ${i + 1}. ${t.group}`, "", `- [ ] ${t.id} \`${t.id}.txt\`: "${t.text}"`, ""]);
	writeFileSync(join(changeDir, "tasks.md"), tasks.join("\n"));
	return { workspace, changeDir };
}

/**
 * Change checks that exit 0 and append their name to one log, where the stubbed trial fold appends
 * `fold` too: `calls()` is every change check and fold so far, in the order they ran.
 */
function recordingChangeChecks(names: readonly string[]) {
	const dir = temp("answer-change-checks-");
	const script = join(dir, "record.cjs");
	const log = join(dir, "calls.log");
	writeFileSync(script, 'require("node:fs").appendFileSync(process.argv[2], process.argv[3] + "\\n");\n');
	writeFileSync(log, "");
	return {
		commands: names.map((name) => `${process.execPath} ${script} ${log} ${name}`),
		record: (name: string) => appendFileSync(log, `${name}\n`),
		calls: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
		reset: () => writeFileSync(log, ""),
	};
}

const changeScan = async (storage: Storage, kind: string) => (await storage.scanTasks({ kind }, 100, undefined, context)).items;

/**
 * Groups 1, 2 and 3 converge, both change checks exit 0, and the trial fold fails: the change
 * ends blocked to the principal. The harness is left open, and the call recorders are reset.
 */
async function foldBlockedChange() {
	const storage = new MemoryStorage();
	const { workspace, changeDir } = writeThreeGroups();
	const staged = stagedCheck([true]);
	const changeChecks = recordingChangeChecks(["change-1", "change-2"]);
	vi.mocked(trialFold).mockImplementation(async () => {
		changeChecks.record("fold");
		return tooLongFold();
	});
	const env = setup();
	for (const extension of changeLoopExtensions({ workspace, checks: [staged.command], allow: [] })) env.registry.install(extension);
	const harness = await loopHarness(env, storage);
	env.faux.setResponses([verdict(true), verdict(true), verdict(true)]);
	const options: ChangeLoopOptions = {
		change: { dir: changeDir },
		script: { text: JUDGE_ONLY },
		groupScript: { text: GROUP_JUDGE },
		workspace,
		checks: [staged.command],
		changeChecks: changeChecks.commands,
		model: env.model,
	};
	const id = await startChangeLoop(harness, options, context);
	harness.resume();
	const outcome = await waitForChangeLoop(harness, id, context);

	expect(outcome.status).toBe("blocked");
	const escalation = (outcome as { escalation: Escalation }).escalation;
	expect(escalation).toMatchObject({ level: "change", to: "principal" });
	expect(escalation.question.startsWith(FOLD_PREFIX)).toBe(true);
	expect(changeChecks.calls()).toEqual(["change-1", "change-2", "fold"]);
	expect(outcome.result?.groups.map((g) => [g.group, g.runs, g.outcome.status])).toEqual([
		[1, 1, "converged"],
		[2, 1, "converged"],
		[3, 1, "converged"],
	]);

	const groupLoops = await changeScan(storage, GROUP_LOOP_NAME);
	const taskLoops = await changeScan(storage, TASK_LOOP);
	const requests = env.requests.length;
	changeChecks.reset();
	vi.mocked(trialFold).mockClear();
	vi.mocked(answerGroupEscalation).mockClear();
	return { id, outcome, escalation, harness, storage, env, staged, changeChecks, groupLoops, taskLoops, requests };
}

describe.skipIf(process.platform === "win32")("task/change: Answering a trial fold block re-runs the check phase", () => {
	let savedPath: string | undefined;
	beforeEach(() => {
		savedPath = process.env.PATH;
		process.env.PATH = `${OPENSPEC_BIN}:${savedPath ?? ""}`;
		vi.mocked(trialFold).mockReset();
	});
	afterEach(() => {
		process.env.PATH = savedPath;
	});

	it("Scenario: Answering after fixing the deltas builds the change", async () => {
		const r = await foldBlockedChange();
		try {
			// The principal shortened the deltas: the fold now passes.
			vi.mocked(trialFold).mockImplementation(async () => {
				r.changeChecks.record("fold");
				return passingFold();
			});
			const stagedBefore = r.staged.calls();
			const next = await answerChangeEscalation(
				r.harness,
				r.id,
				{ escalation: r.escalation, by: "principal", decision: "deltas shortened", feedback: [] },
				context,
			);
			const outcome = await waitForChangeLoop(r.harness, next, context);

			expect(next).not.toBe(r.id);
			expect(outcome.status).toBe("converged");
			expect(check(LoopOutcome(ChangeOutcome), outcome)).toBe(true);
			// Groups 1, 2 and 3 carried as they were, not run again.
			expect(outcome.result?.groups).toEqual(r.outcome.result?.groups);
			expect(outcome.result?.groups.map((g) => [g.group, g.runs])).toEqual([
				[1, 1],
				[2, 1],
				[3, 1],
			]);

			// Only the change checks, in order, then the trial fold once.
			expect(r.changeChecks.calls()).toEqual(["change-1", "change-2", "fold"]);
			expect(trialFold).toHaveBeenCalledOnce();
			expect(r.staged.calls()).toBe(stagedBefore);

			// No group loop, no task loop, no model request, and the group's answer was never called.
			expect(await changeScan(r.storage, GROUP_LOOP_NAME)).toEqual(r.groupLoops);
			expect(await changeScan(r.storage, TASK_LOOP)).toEqual(r.taskLoops);
			expect(r.env.requests).toHaveLength(r.requests);
			expect(answerGroupEscalation).not.toHaveBeenCalled();
			expect(await changeScan(r.storage, CHANGE_LOOP_TASK)).toHaveLength(2);

			// The check iteration holds the fold's evidence after the change checks', exit 0.
			expect(outcome.iterations).toHaveLength(1);
			const [iteration] = outcome.iterations;
			expect(iteration?.verdict).toEqual({ met: true, satisfied: [{ check: "change" }], unmet: [] });
			expect(iteration?.evidence.map((e) => (e as { command: string }).command)).toEqual([...r.changeChecks.commands, FOLD_COMMAND]);
			expect(iteration?.evidence.at(-1)).toEqual({ kind: "check", command: FOLD_COMMAND, exitCode: 0, output: formatTrialFold(passingFold()) });
		} finally {
			await r.harness.close(context);
		}
	}, 60_000);

	it("Scenario: Answering without a fix blocks again", async () => {
		const r = await foldBlockedChange();
		try {
			// The deltas are unchanged: the fold fails as it did.
			const next = await answerChangeEscalation(
				r.harness,
				r.id,
				{ escalation: r.escalation, by: "principal", decision: "please retry", feedback: [] },
				context,
			);
			const outcome = await waitForChangeLoop(r.harness, next, context);

			expect(next).not.toBe(r.id);
			expect(outcome.status).toBe("blocked");
			expect(check(LoopOutcome(ChangeOutcome), outcome)).toBe(true);
			const escalation = (outcome as { escalation: Escalation }).escalation;
			expect(escalation).toMatchObject({ level: "change", to: "principal" });
			expect(escalation.question).toBe(r.escalation.question);
			expect(escalation.question).toBe(`${FOLD_PREFIX}${formatTrialFold(tooLongFold())}`);

			// The change checks and the fold ran again.
			expect(r.changeChecks.calls()).toEqual(["change-1", "change-2", "fold"]);
			expect(trialFold).toHaveBeenCalledOnce();

			// No group loop, no model request, and the group's answer was never called.
			expect(await changeScan(r.storage, GROUP_LOOP_NAME)).toEqual(r.groupLoops);
			expect(await changeScan(r.storage, TASK_LOOP)).toEqual(r.taskLoops);
			expect(r.env.requests).toHaveLength(r.requests);
			expect(answerGroupEscalation).not.toHaveBeenCalled();
			expect(outcome.result?.groups).toEqual(r.outcome.result?.groups);
		} finally {
			await r.harness.close(context);
		}
	}, 60_000);
});
