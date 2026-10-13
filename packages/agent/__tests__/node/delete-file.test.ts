import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionResult } from "../../src/interpreter/index.js";
import { deleteActions } from "../../src/durable/index.js";
import { localWorkspace } from "../../src/node/index.js";

const OLD = "src/legacy/old-runner.ts";

const dirs: string[] = [];

/** A workspace directory holding `src/legacy/old-runner.ts`, inside a parent that also holds `outside.txt`. */
function workspaceDir(): { parent: string; dir: string } {
	const parent = mkdtempSync(join(tmpdir(), "agentscript-delete-file-"));
	dirs.push(parent);
	const dir = join(parent, "ws");
	mkdirSync(dirname(join(dir, OLD)), { recursive: true });
	writeFileSync(join(dir, OLD), "export const old = true;\n");
	writeFileSync(join(parent, "outside.txt"), "o");
	return { parent, dir };
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function deleteFile(dir: string, path: string): Promise<ActionResult> {
	const [action] = deleteActions(localWorkspace(dir));
	if (action === undefined || action.durable !== undefined) throw new Error("deleteActions returned no executed action");
	return action.execute({ path }, { workspace: dir, signal: new AbortController().signal });
}

describe("actions/registry: delete_file deletes one workspace file", () => {
	it("Scenario: A file is deleted", async () => {
		const { dir } = workspaceDir();
		const result = await deleteFile(dir, OLD);
		expect(result).toMatchObject({ ok: true, outputs: { ok: true } });
		expect(existsSync(join(dir, OLD))).toBe(false);
	});

	it("Scenario: Deleting a missing file is refused, not thrown", async () => {
		const { dir } = workspaceDir();
		expect((await deleteFile(dir, OLD)).ok).toBe(true);
		const again = deleteFile(dir, OLD);
		await expect(again).resolves.toMatchObject({ ok: false });
		const result = await again;
		expect(result.ok === false && result.message).toContain(`no such file: ${OLD}`);
	});
});

describe("actions/registry: delete_file records the deletion and nothing on refusal", () => {
	it("Scenario: A delete records its diff", async () => {
		const { dir } = workspaceDir();
		const result = await deleteFile(dir, OLD);
		expect(result.record).toMatchObject({ action: { kind: "edit", refs: [OLD] } });
		const evidence = (result.record as { evidence: { kind: string; files: unknown[] }[] }).evidence;
		const diffs = evidence.filter((e) => e.kind === "diff");
		expect(diffs).toHaveLength(1);
		expect(diffs[0]?.files).toEqual([{ path: OLD, change: "deleted" }]);
	});

	it("Scenario: A refusal records nothing", async () => {
		const { parent, dir } = workspaceDir();
		const result = await deleteFile(dir, "../outside.txt");
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toContain("outside the workspace");
		expect(result.record).toBeUndefined();
		expect(readFileSync(join(parent, "outside.txt"), "utf8")).toBe("o");
		expect(existsSync(join(dir, OLD))).toBe(true);
	});
});
