/**
 * change/cli: `approve` approves the stage under review, and `draft` refuses `approve` as
 * feedback. `agentscript-change` in process, on a faux model, over the `SPEC_STAGES` names,
 * files and order with a test script and an empty gate. The principal's name comes from a
 * temp global gitconfig (`jesse`), with `$USER` set to someone else so the git name visibly wins.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FauxResponseStep } from "@earendil-works/pi-ai";
import { main } from "../../src/bin/agentscript-change.js";
import { APPROVALS_FILE, readApprovals } from "../../src/task/spec-approvals.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { fauxModels } from "../task/cli-helpers.js";
import { cleanTemps, temp } from "../task/helpers.js";
import { STAGE_SCRIPT, draft } from "../task/spec-helpers.js";
import { CHANGE, change, draftLoopsIn, loopsIn, workspace } from "./helpers.js";

const stages: readonly SpecStage[] = SPEC_STAGES.map((stage) => ({ ...stage, script: { text: STAGE_SCRIPT }, gate: () => [] }));

// git reads the principal's name from a temp global gitconfig, never the real one.
const GIT_ENV = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = Object.fromEntries(GIT_ENV.map((key) => [key, process.env[key]]));
	const gitconfig = join(temp("change-gitconfig-"), "gitconfig");
	writeFileSync(gitconfig, "[user]\n\tname = jesse\n");
	process.env["GIT_CONFIG_GLOBAL"] = gitconfig;
	process.env["GIT_CONFIG_NOSYSTEM"] = "1";
});

afterEach(() => {
	for (const key of GIT_ENV) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	cleanTemps();
});

/** main() in process as `change()` runs it, but with `$USER` not `jesse`, so only git can name the principal. */
async function changeAsGitUser(argv: string[], cwd: string, responses: FauxResponseStep[] = []) {
	const { faux, models } = fauxModels();
	faux.setResponses(responses);
	const model = faux.getModel();
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(argv, {
		models: () => models,
		out: (line) => out.push(line),
		err: (line) => err.push(line),
		cwd,
		env: { AGENTSCRIPT_PROVIDER: model.provider, AGENTSCRIPT_MODEL: model.id, USER: "someone-else" },
		stages,
	});
	return { code, out: out.join("\n"), err: err.join("\n"), calls: faux.state.callCount };
}

/** A new change whose proposal waits for review of a clean `proposal.md`. */
async function reachProposalReview(dir: string) {
	const run = await change(["draft", CHANGE, "--intent", "Export a plan"], dir, [draft("=== proposal.md\n## Why\n\nPlans export.\n")], stages);
	expect(run.code).toBe(0);
}

/** A new change whose proposal stage asks `CSV too?`. */
async function reachQuestion(dir: string) {
	const run = await change(["draft", CHANGE, "--intent", "Export a plan"], dir, [draft("", "ask", "CSV too?")], stages);
	expect(run.code).toBe(1);
}

/** Every loop in the database: draft loops and the spec loops they run. */
async function allLoops(db: string) {
	return { drafts: await draftLoopsIn(db), loops: await loopsIn(db) };
}

/** The change's `approvals.json` as bytes, or null when it does not exist. */
function approvalsBytes(changeDir: string): string | null {
	const path = join(changeDir, APPROVALS_FILE);
	return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** The output's last `n` lines, trimmed. */
const tail = (out: string, n: number) =>
	out
		.trimEnd()
		.split("\n")
		.slice(-n)
		.map((line) => line.trim());

describe("change/cli approve", () => {
	it("Scenario: Approving the proposal drafts the design", async () => {
		const { dir, changeDir, db } = workspace();
		await reachProposalReview(dir);

		const run = await changeAsGitUser(["approve", CHANGE], dir, [draft("=== design.md\n## Context\n\nDrafted.\n")]);
		expect(run.code).toBe(0);
		const { approvals } = readApprovals(changeDir);
		expect(approvals).toHaveLength(1);
		expect(approvals[0]).toMatchObject({ stage: "proposal", approved: true, by: "principal", principal: "jesse" });
		expect(Object.keys(approvals[0]!.files)).toEqual(["proposal.md"]);
		// The approval is an answer to the blocked loop, and its run drafts the design.
		expect(await draftLoopsIn(db)).toHaveLength(2);
		expect(run.out).toContain("design.md");
		const [revise, approve] = tail(run.out, 2);
		expect(revise).toContain(`pnpm change draft ${CHANGE} "<what to change>"`);
		expect(approve).toContain(`pnpm change approve ${CHANGE}`);
	});

	it("Scenario: A question cannot be approved", async () => {
		const { dir, changeDir, db } = workspace();
		await reachQuestion(dir);
		const before = await allLoops(db);
		const approvals = approvalsBytes(changeDir);

		const run = await changeAsGitUser(["approve", CHANGE], dir);
		expect(run.code).toBe(2);
		expect(run.calls).toBe(0);
		expect(`${run.err}\n${run.out}`).toContain(`pnpm change draft ${CHANGE} "<answer>"`);
		expect(`${run.err}\n${run.out}`).toContain("CSV too?");
		expect(await allLoops(db)).toEqual(before);
		expect(approvalsBytes(changeDir)).toBe(approvals);
	});

	it("Scenario: Nothing to approve is refused", async () => {
		const { dir, changeDir, db } = workspace();

		const run = await changeAsGitUser(["approve", CHANGE], dir);
		expect(run.code).toBe(2);
		expect(run.calls).toBe(0);
		expect(run.err).toMatch(/nothing in add-plan-export is under review/);
		expect(await allLoops(db)).toEqual({ drafts: [], loops: [] });
		expect(approvalsBytes(changeDir)).toBeNull();
	});

	it("Scenario: approve is not feedback", async () => {
		const { dir, changeDir, db } = workspace();
		await reachProposalReview(dir);
		const before = await allLoops(db);
		const approvals = approvalsBytes(changeDir);

		const run = await changeAsGitUser(["draft", CHANGE, " Approve "], dir);
		expect(run.code).toBe(2);
		expect(run.calls).toBe(0);
		expect(`${run.err}\n${run.out}`).toContain(`pnpm change approve ${CHANGE}`);
		expect(approvalsBytes(changeDir)).toBe(approvals);
		expect(await allLoops(db)).toEqual(before);
	});
});
