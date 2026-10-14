import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRefusal, unclaimedAtStart } from "../../src/task/change-guard.js";
import { resetOpenspecCache } from "../../src/task/openspec-bin.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { cleanTemps, temp } from "./helpers.js";

afterEach(() => {
	vi.unstubAllEnvs();
	cleanTemps();
});

const CHANGE = "add-thing";
/** The repo's pinned `openspec` (1.14.1), first on PATH. */
const OPENSPEC_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "node_modules", ".bin");

const PROPOSAL = "## Why\nBecause the thing has to exist, for a reason long enough to pass.\n\n## What Changes\n- Adds the thing.\n";
const scenario = (name: string) => `#### Scenario: ${name}\n- **WHEN** it runs\n- **THEN** it SHALL work\n`;
const SPEC = `## ADDED Requirements\n\n### Requirement: Things exist\nThings SHALL exist.\n\n${scenario("A thing exists")}\n${scenario("An empty plan")}\n${scenario("A plan without quotes")}`;
const TASKS = [
	"## 1. Build",
	"",
	'- [ ] 1.1 `src/thing.ts`: "A thing exists"',
	"- [ ] 1.2 `src/plan.ts`: A plan without quotes",
	"",
].join("\n");

/** A workspace holding `openspec/changes/add-thing` with the given delta and tasks. */
function change(spec = SPEC, tasks = TASKS): { workspace: string; changeDir: string } {
	const workspace = temp("guard-ws-");
	mkdirSync(join(workspace, "openspec", "specs"), { recursive: true });
	const changeDir = join(workspace, "openspec", "changes", CHANGE);
	mkdirSync(join(changeDir, "specs", "thing", "core"), { recursive: true });
	writeFileSync(join(changeDir, "proposal.md"), PROPOSAL);
	writeFileSync(join(changeDir, "design.md"), "## Context\nA design.\n");
	writeFileSync(join(changeDir, "specs", "thing", "core", "spec.md"), spec);
	writeFileSync(join(changeDir, "tasks.md"), tasks);
	return { workspace, changeDir };
}

/** `dir`, with the real `openspec` first on PATH (the temp workspace has no `node_modules`), resolved afresh. */
function pinned(dir: string): string {
	vi.stubEnv("PATH", `${OPENSPEC_BIN}:${process.env["PATH"] ?? ""}`);
	resetOpenspecCache();
	return dir;
}

const approveAll = (changeDir: string) => {
	for (const stage of SPEC_STAGES) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
};

describe.skipIf(process.platform === "win32")("buildRefusal, with the real openspec", () => {
	it("refuses a delta whose requirement has no scenario, naming the requirement", async () => {
		const { workspace, changeDir } = change("## ADDED Requirements\n\n### Requirement: Things exist\nThings SHALL exist.\n");
		const guard = await buildRefusal(CHANGE, changeDir, pinned(workspace));
		expect(guard).toEqual({ ok: false, refusal: expect.stringContaining('"Things exist"') });
		expect(guard.ok || guard.refusal).toMatch(/^change add-thing is not valid: thing\/core\/spec\.md: /);
	});

	it("refuses an approved change whose tasks.md was edited afterwards, naming tasks.md and the tasks stage", async () => {
		const { workspace, changeDir } = change();
		approveAll(changeDir);
		writeFileSync(join(changeDir, "tasks.md"), `${TASKS}- [ ] 1.3 one more\n`);
		const guard = await buildRefusal(CHANGE, changeDir, pinned(workspace));
		expect(guard).toEqual({
			ok: false,
			refusal: "change add-thing is not as approved: tasks.md changed since the tasks stage was approved; review it again",
		});
	});

	it("builds a change whose four stages are approved and unchanged", async () => {
		const { workspace, changeDir } = change();
		approveAll(changeDir);
		expect((await buildRefusal(CHANGE, changeDir, pinned(workspace))).ok).toBe(true);
	});

	it("refuses an approvals.json missing a stage, naming the first one", async () => {
		const { workspace, changeDir } = change();
		const [proposal, design] = SPEC_STAGES;
		recordApproval(changeDir, proposal!, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
		recordApproval(changeDir, design!, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
		const guard = await buildRefusal(CHANGE, changeDir, pinned(workspace));
		expect(guard).toEqual({ ok: false, refusal: expect.stringContaining("the specs stage of add-thing is not approved") });
	});

	it("refuses an approvals.json that fails its schema, naming the file", async () => {
		const { workspace, changeDir } = change();
		writeFileSync(join(changeDir, "approvals.json"), '{"approvals":[{"stage":"proposal","by":"agent"}]}\n');
		const guard = await buildRefusal(CHANGE, changeDir, pinned(workspace));
		expect(guard).toEqual({ ok: false, refusal: expect.stringContaining("approvals.json is not valid") });
	});

	it("builds a valid change with no approvals.json, listing the scenarios no task quotes", async () => {
		const { workspace, changeDir } = change();
		const guard = await buildRefusal(CHANGE, changeDir, pinned(workspace));
		expect(guard).toEqual({
			ok: true,
			unclaimedAtStart: [
				{ capability: ["thing", "core"], requirement: "Things exist", scenario: "An empty plan" },
				{ capability: ["thing", "core"], requirement: "Things exist", scenario: "A plan without quotes" },
			],
		});
	});
});

describe("unclaimedAtStart", () => {
	const ref = (scenario: string) => ({ capability: ["thing", "core"], requirement: "Things exist", scenario });

	it("claims only an exact name in double quotes, continuation lines included", () => {
		const tasks = ['## 1. Build', "", '- [x] 1.1 ticked: "A thing exists"', "- [ ] 1.2 covers", '  "An empty plan" too', "- [ ] 1.3 An empty plan, unquoted", ""].join("\n");
		expect(unclaimedAtStart(tasks, [ref("A thing exists"), ref("An empty plan"), ref("A plan")])).toEqual([ref("A plan")]);
	});

	it("lists every scenario when there is no tasks.md", () => {
		expect(unclaimedAtStart("", [ref("A thing exists")])).toEqual([ref("A thing exists")]);
	});
});
