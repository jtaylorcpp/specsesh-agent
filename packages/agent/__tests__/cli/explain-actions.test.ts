/**
 * package/explain: `specsesh agent actions`, through `main`.
 */

import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { deleteActions } from "../../src/durable/actions.js";
import { memoryWorkspace, searchActions, workspaceActions } from "../../src/durable/workspace.js";

async function run(argv: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(["agent", "actions", ...argv], { out: (line) => out.push(line), err: (line) => err.push(line) });
	return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

interface Listed {
	name: string;
	description: string;
	input: string[];
	output: string[];
	writes: boolean;
}

describe("specsesh agent actions lists the built-in actions", () => {
	it("Scenario: delete_file is a write", async () => {
		const { code, stdout } = await run(["--json"]);
		expect(code).toBe(0);
		const deleteFile = (JSON.parse(stdout) as Listed[]).find((a) => a.name === "delete_file");
		expect(deleteFile?.writes).toBe(true);
		expect(deleteFile?.input).toContain("path");
	});

	it("lists exactly the definitions, each described, reads marked as reads", async () => {
		const workspace = memoryWorkspace();
		const defined = [...workspaceActions(workspace), ...searchActions(workspace), ...deleteActions(workspace)];
		const listed = JSON.parse((await run(["--json"])).stdout) as Listed[];
		expect(listed.map((a) => a.name)).toEqual(defined.map((a) => a.name).sort());
		for (const action of listed) expect(action.description).not.toBe("");
		expect(listed.find((a) => a.name === "read_file")).toMatchObject({ input: ["path"], output: ["content"], writes: false });
	});

	it("Markdown lists one row per action", async () => {
		const { code, stdout } = await run([]);
		expect(code).toBe(0);
		const lines = stdout.split("\n");
		expect(lines[0]).toBe("| name | description | input | output | writes |");
		expect(lines.find((l) => l.startsWith("| `delete_file` |"))).toMatch(/\| `path` \| `ok` \| yes \|$/);
	});

	it("any other argument prints usage and exits 2", async () => {
		for (const argv of [["frobnicate"], ["--nope"]]) {
			const { code, stderr } = await run(argv);
			expect(code).toBe(2);
			expect(stderr).toContain("usage: specsesh agent actions [--json]");
		}
	});
});
