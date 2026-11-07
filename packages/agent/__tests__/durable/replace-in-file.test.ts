// replace_in_file (#36): change part of a file by exact text, instead of sending the whole file
// back through edit_file. old_text must occur exactly once unless replace_all; a refused call
// writes nothing and says how often old_text occurs.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionResult, VariableValue } from "../../src/interpreter/index.js";
import { EDIT_AGENT, memoryWorkspace, workspaceActions, type ExecutedHostAction, type Workspace } from "../../src/durable/index.js";
import { localWorkspace } from "../../src/node/index.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function replaceIn(workspace: Workspace): ExecutedHostAction {
	const action = workspaceActions(workspace).find((a) => a.name === "replace_in_file");
	if (action === undefined) throw new Error("replace_in_file is not a built-in");
	return action;
}

const call = (workspace: Workspace, inputs: Record<string, VariableValue>): Promise<ActionResult> =>
	replaceIn(workspace).execute({ replace_all: false, ...inputs }, { workspace: "memory" });

const failure = (result: ActionResult) => (result.ok ? "" : result.message);

describe("actions/workspace: replace_in_file replaces exact text", () => {
	it("is a built-in edit with its inputs, outputs and an unsafe replay", () => {
		const action = replaceIn(memoryWorkspace());
		expect(action.kind).toBe("edit");
		expect(action.inputs).toEqual({ path: "string", old_text: "string", new_text: "string", replace_all: "boolean" });
		expect(action.outputs).toEqual({ replaced: "number" });
		// Run again after it wrote, it would find new_text where old_text was.
		expect(action.replay).toBe("unsafe");
	});

	it("replaces the one occurrence and records an edit with a modified diff", async () => {
		const workspace = memoryWorkspace({ "src/a.ts": "export const a = 1;\nexport const b = 2;\n" });
		const result = await call(workspace, { path: "src/a.ts", old_text: "a = 1", new_text: "a = 10" });
		expect(result).toMatchObject({ ok: true, outputs: { replaced: 1 } });
		expect(await workspace.read("src/a.ts")).toBe("export const a = 10;\nexport const b = 2;\n");
		expect(result.ok && result.record).toEqual({
			action: { kind: "edit", summary: "replace 1 occurrence in src/a.ts", refs: ["src/a.ts"] },
			evidence: [{ kind: "diff", files: [{ path: "src/a.ts", change: "modified" }] }],
		});
	});

	it("refuses text that occurs more than once, saying how often, and writes nothing", async () => {
		const workspace = memoryWorkspace({ "a.txt": "x = 1\ny = 1\n" });
		const result = await call(workspace, { path: "a.txt", old_text: " = 1", new_text: " = 2" });
		expect(result.ok).toBe(false);
		expect(failure(result)).toBe(
			"old_text occurs 2 times in a.txt; give more of the surrounding text so it occurs once, or set replace_all; nothing was written",
		);
		expect(await workspace.read("a.txt")).toBe("x = 1\ny = 1\n");
	});

	it("replaces every occurrence with replace_all, and counts them", async () => {
		const workspace = memoryWorkspace({ "a.txt": "x = 1\ny = 1\nz = 1\n" });
		const result = await call(workspace, { path: "a.txt", old_text: " = 1", new_text: " = 2", replace_all: true });
		expect(result).toMatchObject({ ok: true, outputs: { replaced: 3 } });
		const record = result.ok ? (result.record as { action: { summary: string } } | undefined) : undefined;
		expect(record?.action.summary).toBe("replace 3 occurrences in a.txt");
		expect(await workspace.read("a.txt")).toBe("x = 2\ny = 2\nz = 2\n");
	});

	it("replace_all with new_text containing old_text replaces each original once", async () => {
		const workspace = memoryWorkspace({ "a.txt": "foo foo" });
		const result = await call(workspace, { path: "a.txt", old_text: "foo", new_text: "foobar", replace_all: true });
		expect(result).toMatchObject({ ok: true, outputs: { replaced: 2 } });
		expect(await workspace.read("a.txt")).toBe("foobar foobar");
	});

	it("keeps $ patterns in new_text as written", async () => {
		const workspace = memoryWorkspace({ "a.txt": "price: X\n" });
		await call(workspace, { path: "a.txt", old_text: "X", new_text: "$& $1 $$" });
		expect(await workspace.read("a.txt")).toBe("price: $& $1 $$\n");
	});

	it("refuses text that does not occur, and empty old_text", async () => {
		const workspace = memoryWorkspace({ "a.txt": "hello\n" });
		expect(failure(await call(workspace, { path: "a.txt", old_text: "bye", new_text: "x" }))).toBe(
			"old_text does not occur in a.txt; nothing was written",
		);
		expect(failure(await call(workspace, { path: "a.txt", old_text: "", new_text: "x" }))).toBe("old_text is empty; nothing was written to a.txt");
		expect(await workspace.read("a.txt")).toBe("hello\n");
	});

	it("refuses a missing file: it never creates one", async () => {
		const workspace = memoryWorkspace();
		const result = await call(workspace, { path: "new.txt", old_text: "a", new_text: "b" });
		expect(result.ok).toBe(false);
		expect(failure(result)).toContain("nothing was written");
		await expect(workspace.read("new.txt")).rejects.toThrow();
	});

	it("records nothing when new_text equals old_text", async () => {
		const workspace = memoryWorkspace({ "a.txt": "same\n" });
		const result = await call(workspace, { path: "a.txt", old_text: "same", new_text: "same" });
		expect(result).toEqual({ ok: true, outputs: { replaced: 1 } });
	});

	it("is confined to a local workspace like edit_file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agentscript-replace-"));
		dirs.push(dir);
		writeFileSync(join(dir, "a.txt"), "one\n");
		const workspace = localWorkspace(dir);
		expect(await call(workspace, { path: "a.txt", old_text: "one", new_text: "two" })).toMatchObject({ ok: true });
		expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("two\n");
		const outside = await call(workspace, { path: "../escape.txt", old_text: "a", new_text: "b" });
		expect(failure(outside)).toContain("outside the workspace");
	});
});

describe("actions/agent-runner: EDIT_AGENT offers replace_in_file beside edit_file", () => {
	it("declares and offers it", () => {
		expect(EDIT_AGENT).toContain('target: "mcpTool://replace_in_file"');
		expect(EDIT_AGENT).toContain("replace_in_file: @actions.replace_in_file");
	});
});
