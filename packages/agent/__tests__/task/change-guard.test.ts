import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStorage, type Storage } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANGE_LOOP_TASK } from "../../src/task/change-input.js";
import { GROUP_LOOP_NAME } from "../../src/task/group.js";
import { TASK_LOOP, changeLoopExtensions, startChangeLoop, waitForChangeLoop, type ChangeLoopOptions } from "../../src/task/index.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { setup } from "../durable/helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, loopHarness, temp } from "./helpers.js";
import { stagedCheck } from "./staged-check.js";

/** The repo's pinned `openspec` (1.14.1): the guard validates the change with it. */
const OPENSPEC_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "node_modules", ".bin");

let savedPath: string | undefined;
beforeEach(() => {
	savedPath = process.env.PATH;
	process.env.PATH = `${OPENSPEC_BIN}:${savedPath ?? ""}`;
});
afterEach(() => {
	process.env.PATH = savedPath;
	cleanTemps();
});

const CHANGE = "add-thing";
const PROPOSAL = "## Why\nBecause the thing has to exist, for a reason long enough to pass.\n\n## What Changes\n- Adds the thing.\n";
const scenario = (name: string) => `#### Scenario: ${name}\n- **WHEN** it runs\n- **THEN** it SHALL work\n`;
const SPEC = `## ADDED Requirements\n\n### Requirement: Things exist\nThings SHALL exist.\n\n${scenario("A thing exists")}`;
/** One group whose only task is already ticked: the loop needs no task loop and no model. */
const TASKS = ["## 1. Build", "", '- [x] 1.1 `src/thing.ts`: "A thing exists"', ""].join("\n");

/** A workspace holding `openspec/changes/add-thing`, written by hand: no `approvals.json`. */
function writeChange(spec = SPEC): { workspace: string; changeDir: string } {
	const workspace = temp("change-guard-ws-");
	mkdirSync(join(workspace, "openspec", "specs"), { recursive: true });
	const changeDir = join(workspace, "openspec", "changes", CHANGE);
	mkdirSync(join(changeDir, "specs", "thing", "core"), { recursive: true });
	writeFileSync(join(changeDir, "proposal.md"), PROPOSAL);
	writeFileSync(join(changeDir, "design.md"), "## Context\nA design.\n");
	writeFileSync(join(changeDir, "specs", "thing", "core", "spec.md"), spec);
	writeFileSync(join(changeDir, "tasks.md"), TASKS);
	return { workspace, changeDir };
}

const approveAll = (changeDir: string) => {
	for (const stage of SPEC_STAGES) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
};

const scan = async (storage: Storage, kind: string) => (await storage.scanTasks({ kind }, 100, undefined, context)).items;

/** Every loop in `storage`: change, group and task loops. */
const loops = async (storage: Storage) => [
	...(await scan(storage, CHANGE_LOOP_TASK)),
	...(await scan(storage, GROUP_LOOP_NAME)),
	...(await scan(storage, TASK_LOOP)),
];

/** A harness with the change loop installed, on `storage`, over the change in `workspace`. */
async function openChange(storage: Storage, workspace: string, changeDir: string) {
	const staged = stagedCheck([true]);
	const checks = [staged.command];
	const env = setup();
	for (const extension of changeLoopExtensions({ workspace, checks, allow: [] })) env.registry.install(extension);
	const harness = await loopHarness(env, storage);
	const options: ChangeLoopOptions = {
		change: { dir: changeDir },
		script: { text: JUDGE_ONLY },
		groupScript: { text: GROUP_JUDGE },
		workspace,
		checks,
		model: env.model,
	};
	return { harness, options, env };
}

describe.skipIf(process.platform === "win32")("task/change: the build guard", () => {
	it("Scenario: An invalid change refuses the build", async () => {
		const storage = new MemoryStorage();
		const { workspace, changeDir } = writeChange(`${SPEC}\n### Requirement: Lonely rule\nA lonely rule SHALL have no scenario.\n`);
		const { harness, options } = await openChange(storage, workspace, changeDir);
		try {
			await expect(startChangeLoop(harness, options, context)).rejects.toThrow(/Lonely rule/);
			expect(await loops(storage)).toEqual([]);
		} finally {
			await harness.close(context);
		}
	}, 60_000);

	it("Scenario: An edited approved tasks.md refuses the build", async () => {
		const storage = new MemoryStorage();
		const { workspace, changeDir } = writeChange();
		approveAll(changeDir);
		appendFileSync(join(changeDir, "tasks.md"), "- [ ] 1.2 one more\n");
		const tasksStage = SPEC_STAGES.find((stage) => stage.owns.includes("tasks.md"))!;
		const { harness, options } = await openChange(storage, workspace, changeDir);
		try {
			const refused = startChangeLoop(harness, options, context);
			await expect(refused).rejects.toThrow(/tasks\.md/);
			await expect(refused).rejects.toThrow(new RegExp(`the ${tasksStage.name} stage`));
			expect(await loops(storage)).toEqual([]);
		} finally {
			await harness.close(context);
		}
	}, 60_000);

	it("Scenario: A hand-written change builds", async () => {
		const storage = new MemoryStorage();
		const { workspace, changeDir } = writeChange();
		const { harness, options, env } = await openChange(storage, workspace, changeDir);
		try {
			const id = await startChangeLoop(harness, options, context);
			expect((await scan(storage, CHANGE_LOOP_TASK)).map((task) => task.id)).toEqual([id]);

			harness.resume();
			expect((await waitForChangeLoop(harness, id, context)).status).toBe("converged");
			expect(await scan(storage, TASK_LOOP)).toEqual([]);
			expect(env.faux.getPendingResponseCount()).toBe(0);
		} finally {
			await harness.close(context);
		}
	}, 60_000);
});
