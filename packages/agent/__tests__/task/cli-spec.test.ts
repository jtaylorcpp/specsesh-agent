/**
 * `spec` through `main()`: the bin's dispatch, the bundled proposal stage
 * (`SPEC_STAGES`) and its gate, on a faux model in a temp git repository.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cli, fauxModels, gitIn, gitRepo } from "./cli-helpers.js";
import { cleanTemps } from "./helpers.js";
import { draft } from "./spec-helpers.js";

afterEach(() => cleanTemps());

/** All five sections, in order, naming one new capability. */
const PROPOSAL = ["Why", "What Changes", "Out of scope", "Capabilities", "Impact"]
	.map((heading) => `## ${heading}\n\n${heading === "Capabilities" ? "- **New:** `plan/export`." : `- ${heading} text.`}\n`)
	.join("\n");

/** A repository with one existing capability, so the proposal stage has a base to seed. */
const specRepo = () => gitRepo({ "openspec/specs/task/cli/spec.md": "## Purpose\nCLI purpose.\n\n## Requirements\n" });

/** `spec <args>` in `repo`, on a faux model answering `responses`. */
async function spec(repo: string, args: string[], responses: ReturnType<typeof draft>[] = []) {
	const env = fauxModels();
	env.faux.setResponses(responses);
	const model = env.faux.getModel();
	return cli(["spec", ...args, "--db", join(repo, ".agentscript", "spec.sqlite")], env, {
		cwd: repo,
		env: { AGENTSCRIPT_PROVIDER: model.provider, AGENTSCRIPT_MODEL: model.id },
	});
}

const changeDir = (repo: string) => join(repo, "openspec", "changes", "add-plan-export");

describe("task/cli: spec runs one stage of a change (through the CLI)", () => {
	it("Scenario: A new change starts at the proposal", async () => {
		const repo = specRepo();
		const r = await spec(repo, ["add-plan-export", "--intent", "Export a plan"], [draft(`=== proposal.md\n${PROPOSAL}`)]);
		expect(r.code, r.err).toBe(0);
		expect(readFileSync(join(changeDir(repo), "intent.md"), "utf8")).toBe("Export a plan");
		expect(readFileSync(join(changeDir(repo), "proposal.md"), "utf8")).toBe(PROPOSAL);
		expect(r.out).toMatch(/^# spec loop \d+ — blocked \(review\)\n## proposal draft 1: clean\n/);
		expect(r.env.faux.state.callCount).toBe(1);
	});

	it("Scenario: A new change without an intent is refused", async () => {
		const repo = specRepo();
		const r = await spec(repo, ["add-plan-export"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("--intent");
		expect(existsSync(changeDir(repo))).toBe(false);
		expect(existsSync(join(repo, ".agentscript"))).toBe(false);
		expect(r.env.faux.state.callCount).toBe(0);
	});

	it("Scenario: A dirty tree does not refuse spec", async () => {
		const repo = specRepo();
		const head = gitIn(repo, "rev-parse", "HEAD");
		writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
		writeFileSync(join(repo, "notes.txt"), "untracked\n");
		expect(gitIn(repo, "status", "--porcelain")).toContain("src/a.ts");

		const r = await spec(repo, ["add-plan-export", "--intent", "Export a plan"], [draft(`=== proposal.md\n${PROPOSAL}`)]);
		expect(r.code, r.err).toBe(0);
		expect(r.err).not.toMatch(/uncommitted|--allow-dirty/);
		expect(r.out).toContain("## proposal draft 1: clean");

		// The edits outside the change are untouched, and nothing was committed.
		expect(readFileSync(join(repo, "src", "a.ts"), "utf8")).toBe("export const a = 2;\n");
		expect(readFileSync(join(repo, "notes.txt"), "utf8")).toBe("untracked\n");
		expect(gitIn(repo, "rev-parse", "HEAD")).toBe(head);
	});
});
