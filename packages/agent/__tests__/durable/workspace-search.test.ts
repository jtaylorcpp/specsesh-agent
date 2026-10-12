import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fauxProvider } from "@earendil-works/pi-ai";
import { MemoryStorage, type ModelRef } from "@earendil-works/pi-durable";
import type { ActionResult } from "../../src/interpreter/index.js";
import { createAgentHarness, searchActions, type HostAction, type Workspace } from "../../src/durable/index.js";
import { localWorkspace } from "../../src/node/index.js";
import { context } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A git work tree holding `src/a.ts`, whose line 3 is `export const a = 1;`. */
function makeGitDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-workspace-search-"));
	dirs.push(dir);
	execFileSync("git", ["init", "-q"], { cwd: dir });
	mkdirSync(join(dir, "src"));
	writeFileSync(join(dir, "src", "a.ts"), "// header\n\nexport const a = 1;\n");
	return dir;
}

/** A workspace with neither `list` nor `search`. */
const fakeWorkspace: Workspace = {
	root: "fake",
	read: async () => "",
	write: async () => undefined,
	exec: async () => ({ kind: "exited", code: 0, stdout: "", stderr: "" }),
	snapshot: async () => undefined,
};

function byName(actions: HostAction[]): Record<string, HostAction> {
	return Object.fromEntries(actions.map((action) => [action.name, action]));
}

function run(action: HostAction | undefined, inputs: Record<string, string>): Promise<ActionResult> {
	if (action === undefined) throw new Error("no such action");
	return action.execute(inputs, { workspace: "test" });
}

function fauxModels() {
	const faux = fauxProvider();
	const model = faux.getModel();
	const ref: ModelRef = { provider: model.provider, modelId: model.id };
	return { default: () => ({ provider: faux.provider, model: ref }) };
}

describe("actions/workspace: localWorkspace lists and searches", () => {
	it("Scenario: A search finds lines in matching files", async () => {
		const ws = localWorkspace(makeGitDir());
		expect(await ws.search!("const a", { glob: "src/**/*.ts" })).toEqual([{ path: "src/a.ts", line: 3, text: "export const a = 1;" }]);
	});

	it("Scenario: An ignored file is not listed", async () => {
		const dir = makeGitDir();
		writeFileSync(join(dir, ".gitignore"), "dist/\n");
		mkdirSync(join(dir, "dist"));
		writeFileSync(join(dir, "dist", "a.js"), "export const a = 1;\n");
		const listed = await localWorkspace(dir).list!("**/*");
		expect(listed).toContain("src/a.ts");
		expect(listed).not.toContain("dist/a.js");
	});

	it("Scenario: search_files formats matches", async () => {
		const action = byName(searchActions(localWorkspace(makeGitDir())))["search_files"];
		expect(await run(action, { pattern: "const a", glob: "src/**/*.ts" })).toEqual({
			ok: true,
			outputs: { matches: "src/a.ts:3: export const a = 1;" },
		});
		expect(action?.kind).toBe("read");
		expect(action?.replay).toBe("safe");
	});

	it("Scenario: Search needs a searchable workspace", async () => {
		const result = await run(byName(searchActions(fakeWorkspace))["search_files"], { pattern: "a", glob: "" });
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toContain("cannot search files");
	});
});

describe("host/agent-config: the harness registers search actions when its workspace can search", () => {
	it("Scenario: A local workspace gets list_files and search_files", async () => {
		const dir = makeGitDir();
		const { harness, actions } = await createAgentHarness(
			{ models: fauxModels(), workspace: () => localWorkspace(dir) },
			{ storage: new MemoryStorage(), env: {}, context },
		);
		await harness.close(context);

		expect(actions.has("list_files")).toBe(true);
		expect(actions.has("search_files")).toBe(true);
	});

	it("Scenario: A workspace that cannot search gets neither", async () => {
		const { harness, actions } = await createAgentHarness(
			{ models: fauxModels(), workspace: () => fakeWorkspace },
			{ storage: new MemoryStorage(), env: {}, context },
		);
		await harness.close(context);

		expect(actions.has("list_files")).toBe(false);
		expect(actions.has("search_files")).toBe(false);
	});
});
