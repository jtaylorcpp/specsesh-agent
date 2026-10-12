import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceError, memoryWorkspace } from "../../src/durable/index.js";
import { localWorkspace } from "../../src/node/index.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("actions/workspace", () => {
	it("Scenario: A local workspace cannot publish", () => {
		const dir = mkdtempSync(join(tmpdir(), "agentscript-local-publish-"));
		dirs.push(dir);
		const ws = localWorkspace(dir);
		expect(ws.publish).toBeUndefined();
		expect("publish" in ws).toBe(false);
	});

	it("Scenario: An in-memory edit round-trips", async () => {
		const ws = memoryWorkspace({ "a.txt": "1" });
		await ws.write("a.txt", "2");
		expect(await ws.read("a.txt")).toBe("2");
		expect(ws.exec).toBeUndefined();
		expect("exec" in ws).toBe(false);
	});
});

describe("memoryWorkspace", () => {
	it("is rooted at memory: and has no snapshot or publish", () => {
		const ws = memoryWorkspace();
		expect(ws.root).toBe("memory:");
		expect("snapshot" in ws).toBe(false);
		expect("publish" in ws).toBe(false);
	});

	it("refuses absolute paths and .. escapes", async () => {
		const ws = memoryWorkspace({ "a.txt": "1" });
		for (const attempt of [ws.read("/etc/passwd"), ws.write("../x", "y"), ws.write("a/../../x", "y"), ws.read("C:/x")]) {
			await expect(attempt).rejects.toThrow(WorkspaceError);
			await expect(attempt).rejects.toThrow("outside the workspace");
		}
		expect(() => memoryWorkspace({ "../seed": "x" })).toThrow("outside the workspace");
	});

	it("normalises ./ and inner .. to the same file", async () => {
		const ws = memoryWorkspace({ "src/a.ts": "a" });
		expect(await ws.read("./src/a.ts")).toBe("a");
		await ws.write("src/x/../b.ts", "b");
		expect(await ws.list!("**/*")).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("rejects a missing file with no such file", async () => {
		const ws = memoryWorkspace();
		await expect(ws.read("missing.txt")).rejects.toMatchObject({ reason: "no such file", message: "no such file: missing.txt" });
	});

	it("lists by glob, sorted", async () => {
		const ws = memoryWorkspace({ "src/b.ts": "", "src/deep/a.ts": "", "README.md": "", "a.ts": "" });
		expect(await ws.list!("**/*.ts")).toEqual(["a.ts", "src/b.ts", "src/deep/a.ts"]);
		expect(await ws.list!("src/*.ts")).toEqual(["src/b.ts"]);
	});

	it("searches line by line, skipping files with a NUL byte", async () => {
		const ws = memoryWorkspace({
			"src/a.ts": "// header\r\n\r\nexport const a = 1;\r\n",
			"src/bin.ts": "export const\0b = 2;\n",
			"notes.md": "export nothing\n",
		});
		expect(await ws.search!("export const", { glob: "**/*.ts" })).toEqual([{ path: "src/a.ts", line: 3, text: "export const a = 1;" }]);
		expect(await ws.search!("export")).toHaveLength(2);
		expect(await ws.search!("export", { limit: 1 })).toEqual([{ path: "notes.md", line: 1, text: "export nothing" }]);
		await expect(ws.search!("(")).rejects.toThrow(SyntaxError);
	});
});
