import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import type { ActionResult } from "../../src/interpreter/index.js";
import {
	ActionBindingError,
	agentScriptExtensions,
	createActionRegistry,
	deleteActions,
	memoryWorkspace,
	runScript,
	startScript,
	workspaceActions,
	type ExecutedHostAction,
	type HostAction,
	type Workspace,
} from "../../src/durable/index.js";
import { builtinActions, localWorkspace } from "../../src/node/index.js";
import { context, openHarness, setup } from "./helpers.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-delete-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(action: ExecutedHostAction | undefined, inputs: Record<string, string>): Promise<ActionResult> {
	if (action === undefined) throw new Error("no such action");
	return action.execute(inputs, { workspace: "memory", signal: new AbortController().signal });
}

/** Writes `marker.txt`, deletes `old.txt`, then asks the model once. */
const DELETING = `config:
    agent_name: "deleting"

system:
    instructions: "You answer briefly."

variables:
    marked: mutable boolean = False
    deleted: mutable boolean = False

subagent act:
    description: "Mark, then delete"

    actions:
        edit_file:
            description: "Replace a file's content in the workspace"
            inputs:
                path: string
                content: string
            outputs:
                ok: boolean
            target: "mcpTool://edit_file"
        delete_file:
            description: "Delete one file in the workspace"
            inputs:
                path: string
            outputs:
                ok: boolean
            target: "mcpTool://delete_file"

    reasoning:
        instructions: ->
            run @actions.edit_file
                with path = "marker.txt"
                with content = "ran"
                set @variables.marked = @outputs.ok
            run @actions.delete_file
                with path = "old.txt"
                set @variables.deleted = @outputs.ok

subagent confirm:
    description: "Confirm"

    reasoning:
        instructions: ->
            | Say done.
`;

/** A harness over `dir` whose registry is `actions`, and `old.txt` in it. */
async function host(dir: string, actions: HostAction[]) {
	writeFileSync(join(dir, "old.txt"), "old");
	const env = setup();
	const installed = agentScriptExtensions({ actions: createActionRegistry(actions), workspace: dir });
	env.registry.install(installed.run);
	env.registry.install(installed.step);
	const harness = await openHarness(new MemoryStorage(), env);
	return { env, harness };
}

function builtins(dir: string): ExecutedHostAction[] {
	return builtinActions({ workspace: dir, allow: ["node"], checks: [], timeoutMs: 1000 });
}

describe("actions/registry: delete_file", () => {
	it("Scenario: delete_file declares everything the binding check needs", () => {
		const actions = deleteActions(memoryWorkspace({}));
		expect(actions).toHaveLength(1);
		const [action] = actions;
		expect(action!.name).toBe("delete_file");
		expect(action!.kind).toBe("edit");
		expect(action!.inputs).toEqual({ path: "string" });
		expect(action!.outputs).toEqual({ ok: "boolean" });
		expect(action!.replay).toBe("unsafe");
	});
});

describe("actions/registry: delete_file is available only when a host grants it", () => {
	it("Scenario: An ungranted delete_file is refused up front", async () => {
		const dir = tempDir();
		expect(builtins(dir).map((action) => action.name)).not.toContain("delete_file");
		expect(workspaceActions(memoryWorkspace({})).map((action) => action.name)).not.toContain("delete_file");

		const { env, harness } = await host(dir, builtins(dir));
		const error = await startScript(harness, DELETING, { model: env.model }, context).catch((e: unknown) => e);
		await harness.close(context);

		expect(error).toBeInstanceOf(ActionBindingError);
		expect((error as Error).message).toContain("delete_file");
		// The first step would have written marker.txt; the model is asked only after it.
		expect(existsSync(join(dir, "marker.txt"))).toBe(false);
		expect(existsSync(join(dir, "old.txt"))).toBe(true);
		expect(env.faux.state.callCount).toBe(0);
		expect(env.requests).toHaveLength(0);
	});

	it("Scenario: A granted delete_file binds", async () => {
		const dir = tempDir();
		const { env, harness } = await host(dir, [...builtins(dir), ...deleteActions(localWorkspace(dir))]);
		env.faux.setResponses([fauxAssistantMessage([fauxText("Done.")])]);
		const result = await runScript(harness, DELETING, { model: env.model }, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables["marked"]).toBe(true);
		expect(result.variables["deleted"]).toBe(true);
		expect(existsSync(join(dir, "old.txt"))).toBe(false);
	});

	it("Scenario: The factory loads without Node built-ins", () => {
		const seen = new Set<string>();
		const pending = [join(SRC, "durable", "actions.ts")];
		while (pending.length > 0) {
			const file = pending.pop() as string;
			if (seen.has(file)) continue;
			seen.add(file);
			const code = readFileSync(file, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "");
			for (const [, a, b] of code.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
				const spec = (a ?? b) as string;
				expect(spec, `${file} imports ${spec}`).not.toMatch(/^node:/);
				if (spec.startsWith(".")) {
					const target = resolve(dirname(file), spec.replace(/\.js$/, ".ts"));
					pending.push(existsSync(target) ? target : join(resolve(dirname(file), spec), "index.ts"));
				}
			}
		}
		expect(seen.size).toBeGreaterThan(1);
	});
});

describe("actions/workspace: delete_file is over workspace.remove", () => {
	it("Scenario: delete_file uses the workspace it was given", async () => {
		const calls: string[] = [];
		const workspace: Workspace = {
			...memoryWorkspace({ "a.txt": "1" }),
			async remove(path) {
				calls.push(path);
			},
		};
		const result = await run(deleteActions(workspace)[0], { path: "a.txt" });
		expect(calls).toEqual(["a.txt"]);
		expect(result.ok).toBe(true);
		expect(result.ok === true && result.outputs).toEqual({ ok: true });
	});

	it("Scenario: Deleting needs remove", async () => {
		const ws = memoryWorkspace({ "a.txt": "1" });
		expect("remove" in ws).toBe(false);
		const result = await run(deleteActions(ws)[0], { path: "a.txt" });
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toContain("this workspace cannot delete files");
		expect(await ws.read("a.txt")).toBe("1");
	});
});
