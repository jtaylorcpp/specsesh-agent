import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStorage, type JsonObject, type Storage, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChangeOutcome, LoopOutcome, check } from "../../src/openspec/index.js";
import { CHANGE_LOOP_TASK, decodeChangeCheckpoint } from "../../src/task/change-input.js";
import { GROUP_LOOP_NAME } from "../../src/task/group.js";
import { TASK_LOOP, changeLoopExtensions, startChangeLoop, waitForChangeLoop, type ChangeLoopOptions } from "../../src/task/index.js";
import { openHarness, setup } from "../durable/helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, loopHarness, temp, verdict } from "./helpers.js";
import { stagedCheck } from "./staged-check.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_HOOK = join(HERE, "..", "durable", "fixtures", "ts-resolve.mjs");
const RUNNER = join(HERE, "fixtures", "change-crash-runner.ts");
/** The repo's pinned `openspec` (1.14.1): the guard validates the change with it. */
const OPENSPEC_BIN = join(HERE, "..", "..", "..", "..", "node_modules", ".bin");

let savedPath: string | undefined;
let runner: ChildProcess | undefined;
beforeEach(() => {
	savedPath = process.env.PATH;
	process.env.PATH = `${OPENSPEC_BIN}:${savedPath ?? ""}`;
});
afterEach(() => {
	process.env.PATH = savedPath;
	if (runner?.pid !== undefined) {
		try {
			process.kill(-runner.pid, "SIGKILL");
		} catch {
			// already gone
		}
	}
	runner = undefined;
	cleanTemps();
});

const CHANGE = "add-two-groups";
const PROPOSAL = "## Why\nBecause two files have to exist, for a reason long enough to pass.\n\n## What Changes\n- Adds both files.\n";
const scenario = (name: string) => `#### Scenario: ${name}\n- **WHEN** it runs\n- **THEN** it SHALL work\n`;

/** Carried by every delta that creates a capability, so the change check's trial fold passes. */
const PURPOSE ="## Purpose\nThings that exist, so the change-loop tests have a capability to build.\n\n";

/** One requirement per scenario, so strict validation passes. */
function delta(scenarios: readonly string[]): string {
	const requirements = scenarios.map((name, i) => `### Requirement: Thing ${i + 1}\nThing ${i + 1} SHALL exist.\n\n${scenario(name)}`);
	return `${PURPOSE}## ADDED Requirements\n\n${requirements.join("\n")}`;
}

type GroupSpec = { title: string; tasks: { id: string; text: string; ticked?: boolean }[] };

/**
 * A workspace holding `openspec/changes/<CHANGE>`, written by hand: no `approvals.json`.
 * Each task quotes its scenario by exact name, in double quotes.
 */
function writeChange(groups: readonly GroupSpec[], extraScenarios: readonly string[] = []): { workspace: string; changeDir: string } {
	const workspace = temp("change-loop-ws-");
	mkdirSync(join(workspace, "openspec", "specs"), { recursive: true });
	const changeDir = join(workspace, "openspec", "changes", CHANGE);
	mkdirSync(join(changeDir, "specs", "thing", "core"), { recursive: true });
	writeFileSync(join(changeDir, "proposal.md"), PROPOSAL);
	const claimed = groups.flatMap((g) => g.tasks.map((t) => t.text));
	writeFileSync(join(changeDir, "specs", "thing", "core", "spec.md"), delta([...claimed, ...extraScenarios]));
	const tasks = groups.flatMap((g, i) => [
		`## ${i + 1}. ${g.title}`,
		"",
		...g.tasks.map((t) => `- [${t.ticked === true ? "x" : " "}] ${t.id} \`${t.id}.txt\`: "${t.text}"`),
		"",
	]);
	writeFileSync(join(changeDir, "tasks.md"), tasks.join("\n"));
	return { workspace, changeDir };
}

const TWO_GROUPS: GroupSpec[] = [
	{ title: "One", tasks: [{ id: "1.1", text: "Group one builds" }] },
	{ title: "Two", tasks: [{ id: "2.1", text: "Group two builds" }] },
];

/** A change loop over `groups`, answered with `responses`, run to its end; `inspect` reads its storage before the harness closes it. */
async function runChange(
	groups: readonly GroupSpec[],
	responses: Parameters<ReturnType<typeof setup>["faux"]["setResponses"]>[0],
	extraScenarios: readonly string[] = [],
	inspect: (storage: Storage) => Promise<void> = async () => undefined,
) {
	const storage = new MemoryStorage();
	const { workspace, changeDir } = writeChange(groups, extraScenarios);
	const staged = stagedCheck([true]);
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
	};
	try {
		const id = await startChangeLoop(harness, options, context);
		harness.resume();
		const outcome = await waitForChangeLoop(harness, id, context);
		await inspect(storage);
		return { id, outcome, env, staged, changeDir };
	} finally {
		await harness.close(context);
	}
}

const scan = async (storage: Storage, kind: string) => (await storage.scanTasks({ kind }, 100, undefined, context)).items;

async function until(done: () => boolean, ms: number, what: string): Promise<void> {
	const deadline = Date.now() + ms;
	while (!done()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 50));
	}
}

describe.skipIf(process.platform === "win32")("task/change: the change loop", () => {
	it("Scenario: A host starts and awaits a change loop", async () => {
		const { outcome, env, staged, changeDir } = await runChange(TWO_GROUPS, [verdict(true), verdict(true)]);

		expect(outcome.status).toBe("converged");
		expect(outcome.result?.groups.map((g) => ({ group: g.group, runs: g.runs }))).toEqual([
			{ group: 1, runs: 1 },
			{ group: 2, runs: 1 },
		]);
		expect(outcome.result?.groups.map((g) => g.outcome.status)).toEqual(["converged", "converged"]);
		expect(outcome.result?.unclaimed).toEqual([]);
		expect(check(LoopOutcome(ChangeOutcome), outcome)).toBe(true);

		// One gate per task, one check per group, then the change check once.
		expect(staged.calls()).toBe(5);
		expect(outcome.iterations).toHaveLength(1);
		expect(outcome.iterations[0]?.verdict).toEqual({ met: true, satisfied: [{ check: "change" }], unmet: [] });
		// The change check, then the trial fold.
		expect(outcome.iterations[0]?.evidence).toEqual([
			{ kind: "check", command: staged.command, exitCode: 0, output: "" },
			{ kind: "check", command: "openspec validate --specs --strict --json", exitCode: 0, output: "folded into a copy of openspec/, openspec validate --specs --strict passed" },
		]);

		const tasks = readFileSync(join(changeDir, "tasks.md"), "utf8");
		expect(tasks).toContain("- [x] 1.1 ");
		expect(tasks).toContain("- [x] 2.1 ");
		expect(env.faux.getPendingResponseCount()).toBe(0);
	}, 60_000);

	it("Scenario: A finished group is checked, not rebuilt", async () => {
		const groups: GroupSpec[] = [
			{ title: "One", tasks: [{ id: "1.1", text: "Group one builds", ticked: true }] },
			{ title: "Two", tasks: [{ id: "2.1", text: "Group two builds" }] },
		];
		let taskLoops: string[] = [];
		let groupLoops: number[] = [];
		const { outcome, env, staged } = await runChange(groups, [verdict(true)], [], async (storage) => {
			taskLoops = (await scan(storage, TASK_LOOP)).map((t) => (t.input as unknown as { task: string }).task);
			groupLoops = (await scan(storage, GROUP_LOOP_NAME)).map((t) => (t.input as unknown as { group: number }).group);
		});

		expect(outcome.status).toBe("converged");
		expect(outcome.result?.groups.map((g) => ({ group: g.group, runs: g.runs }))).toEqual([
			{ group: 1, runs: 1 },
			{ group: 2, runs: 1 },
		]);

		// Group 1's loop ran its check and started no task loop; only 2.1 was built.
		expect(taskLoops).toEqual(["2.1"]);
		expect(groupLoops).toEqual([1, 2]);
		const one = outcome.result?.groups[0]?.outcome;
		expect(one?.status).toBe("converged");
		expect(one?.iterations.flatMap((i) => i.evidence)).toContainEqual(expect.objectContaining({ kind: "check", command: staged.command, exitCode: 0 }));
		// Group 1's check, 2.1's gate, group 2's check, the change check.
		expect(staged.calls()).toBe(4);
		expect(env.faux.getPendingResponseCount()).toBe(0);
	}, 60_000);

	it("Scenario: Killed during a group", async () => {
		const { workspace, changeDir } = writeChange(TWO_GROUPS);
		const gate = temp("change-crash-gate-");
		const db = join(temp("change-crash-db-"), "loops.sqlite");

		// Phase 1: a child process runs group 1, then parks inside group 2's task until it is killed.
		let out = "";
		runner = spawn(process.execPath, ["--import", TS_HOOK, RUNNER, db, workspace, gate, changeDir], {
			detached: true,
			stdio: ["ignore", "pipe", "inherit"],
		});
		runner.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
		});
		const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
			runner!.once("exit", (code, signal) => resolve({ code, signal })),
		);
		const early = exited.then((e) => {
			throw new Error(`runner exited before task 2.1 started: ${JSON.stringify(e)}\n${out}`);
		});
		early.catch(() => undefined);
		await Promise.race([until(() => existsSync(join(gate, "in-2.1")), 60_000, "task 2.1 to start"), early]);
		expect(runner.exitCode === null && runner.signalCode === null).toBe(true);
		process.kill(-runner.pid!, "SIGKILL");
		expect(await exited).toEqual({ code: null, signal: "SIGKILL" });

		const id = Number(/LOOP (\d+)/.exec(out)?.[1]) as TaskId<never>;
		expect(Number.isInteger(id)).toBe(true);

		// The change was parked in its group phase on group 2, its group loop recorded before the kill.
		const storage = await openNodeSqliteStorage(db);
		const [change] = await scan(storage, CHANGE_LOOP_TASK);
		const parked = decodeChangeCheckpoint((change?.state as unknown as { checkpoint: JsonObject }).checkpoint);
		expect(parked.phase).toBe("group");
		expect(parked.child?.group).toBe(2);
		const childId = parked.child?.id;
		expect(childId).toBeDefined();
		const groupLoops = async () =>
			(await scan(storage, GROUP_LOOP_NAME)).map((t) => ({ id: t.id, group: (t.input as unknown as { group: number }).group }));
		expect((await groupLoops()).map((g) => g.group)).toEqual([1, 2]);

		// Phase 2: a fresh harness on the same file; 2.1 now converges.
		const env = setup();
		for (const extension of changeLoopExtensions({ workspace, checks: ["node -e process.exit(0)"] })) env.registry.install(extension);
		env.faux.setResponses([verdict(true)]);
		const harness = await openHarness(storage, env);
		harness.resume();
		try {
			const outcome = await waitForChangeLoop(harness, id as never, context);

			expect(outcome.status).toBe("converged");
			expect(outcome.result?.groups.map((g) => ({ group: g.group, runs: g.runs }))).toEqual([
				{ group: 1, runs: 1 },
				{ group: 2, runs: 1 },
			]);
			const after = await groupLoops();
			expect(after.filter((g) => g.group === 1)).toHaveLength(1);
			expect(after.filter((g) => g.group === 2)).toEqual([{ id: childId, group: 2 }]);
			expect(check(LoopOutcome(ChangeOutcome), outcome)).toBe(true);
		} finally {
			await harness.close(context).catch(() => undefined);
		}
	}, 120_000);

	it("Scenario: An unclaimed scenario is reported", async () => {
		const { outcome } = await runChange(TWO_GROUPS, [verdict(true), verdict(true)], ["An empty plan"]);

		expect(outcome.status).toBe("converged");
		expect(outcome.result?.unclaimed).toEqual([{ capability: ["thing", "core"], requirement: "Thing 3", scenario: "An empty plan" }]);
		expect(check(LoopOutcome(ChangeOutcome), outcome)).toBe(true);
	}, 60_000);
});
