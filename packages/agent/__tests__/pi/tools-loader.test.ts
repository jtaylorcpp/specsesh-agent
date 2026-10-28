import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTools, type LoadToolsResult } from "../../src/bin/tools.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "tools");
const WORKSPACE = "/tmp/tools-loader-workspace";

function load(paths: string[], cwd = FIXTURES): Promise<LoadToolsResult> {
	return loadTools(paths, { cwd, workspace: WORKSPACE });
}

function refusal(result: LoadToolsResult): string {
	if (result.ok) throw new Error("expected a refusal, got ok");
	return result.message;
}

describe("loadTools", () => {
	it("loads a default array export", async () => {
		const result = await load(["./echo.mjs"]);
		if (!result.ok) throw new Error(result.message);
		expect(result.actions.map((a) => a.name)).toEqual(["echo"]);
		expect(result.registry.get("echo")).toBe(result.actions[0]);
	});

	it("calls a named tools function once with the workspace", async () => {
		const result = await load(["./fn.mjs"]);
		if (!result.ok) throw new Error(result.message);
		const mod = (await import(pathToFileURL(join(FIXTURES, "fn.mjs")).href)) as { calls: unknown[] };
		expect(mod.calls).toEqual([{ workspace: WORKSPACE }]);
		expect(result.actions.map((a) => a.name)).toEqual(["fn_echo"]);
	});

	it("concatenates modules in flag order", async () => {
		const result = await load(["./echo.mjs", "./fn.mjs"]);
		if (!result.ok) throw new Error(result.message);
		expect(result.actions.map((a) => a.name)).toEqual(["echo", "fn_echo"]);
	});

	it("answers an empty registry for no paths", async () => {
		const result = await load([]);
		if (!result.ok) throw new Error(result.message);
		expect(result.actions).toEqual([]);
		expect(result.registry.size).toBe(0);
	});

	it("reports a module that throws on import", async () => {
		const message = refusal(await load(["./throws.mjs"]));
		expect(message.startsWith("--tools ./throws.mjs:")).toBe(true);
		expect(message).toContain("boom");
	});

	it("refuses an entry without execute", async () => {
		const message = refusal(await load(["./no-execute.mjs"]));
		expect(message).toContain("--tools");
		expect(message).toContain("./no-execute.mjs");
		expect(message).toContain("execute");
	});

	it("refuses a durable entry", async () => {
		const message = refusal(await load(["./durable.mjs"]));
		expect(message).toContain("./durable.mjs");
		expect(message).toContain("durable");
	});

	it("refuses a name repeated across modules", async () => {
		const message = refusal(await load(["./echo.mjs", "./dupe.mjs"]));
		expect(message).toContain("./dupe.mjs");
		expect(message).toContain("echo");
		expect(message).toContain("duplicate");
		expect(message).toContain("./echo.mjs");
	});

	it("refuses a missing module, naming the path", async () => {
		const message = refusal(await load(["./nowhere.mjs"]));
		expect(message).toContain("--tools ./nowhere.mjs:");
	});

	describe("shape refusals", () => {
		let dir: string;
		let count = 0;

		beforeAll(() => {
			dir = mkdtempSync(join(tmpdir(), "tools-loader-"));
		});
		afterAll(() => {
			rmSync(dir, { recursive: true, force: true });
		});

		/** A one-module refusal: writes `source` as a fresh `.mjs` and loads it. */
		async function refuseModule(source: string): Promise<{ path: string; message: string }> {
			const path = `./bad-${count++}.mjs`;
			writeFileSync(join(dir, path), source);
			return { path, message: refusal(await load([path], dir)) };
		}

		const entry = (overrides: string) => `export default [{
	name: "t",
	kind: "read",
	inputs: { text: "string" },
	outputs: { text: "string" },
	replay: "safe",
	async execute() { return { ok: true, outputs: { text: "" } }; },
	${overrides}
}];
`;

		it("names kind", async () => {
			const { path, message } = await refuseModule(entry(`kind: "write",`));
			expect(message).toContain(`--tools ${path}: tool t: kind`);
		});

		it("names the input field and its type", async () => {
			const { message } = await refuseModule(entry(`inputs: { text: "object" },`));
			expect(message).toContain("inputs.text");
		});

		it("names a non-object outputs", async () => {
			const { message } = await refuseModule(entry(`outputs: ["text"],`));
			expect(message).toContain("outputs");
		});

		it("names replay", async () => {
			const { message } = await refuseModule(entry(`replay: "sometimes",`));
			expect(message).toContain("replay");
		});

		it("labels an entry with an empty name by its index", async () => {
			const { path, message } = await refuseModule(entry(`name: "",`));
			expect(message).toContain(`--tools ${path}: tool 0: name`);
		});

		it("refuses a delegate/ name", async () => {
			const { message } = await refuseModule(entry(`name: "delegate/x",`));
			expect(message).toContain("tool delegate/x: delegate/ names are reserved");
		});

		it("refuses an entry that is not an object", async () => {
			const { message } = await refuseModule(`export default [42];\n`);
			expect(message).toContain("tool 0: is not an object");
		});

		it("refuses a non-array export", async () => {
			const { message } = await refuseModule(`export const tools = { name: "t" };\n`);
			expect(message).toContain("expected an array of tools");
		});

		it("refuses a module exporting neither default nor tools", async () => {
			const { message } = await refuseModule(`export const other = [];\n`);
			expect(message).toContain("exports neither default nor tools");
		});

		it("reports an async tools function that rejects", async () => {
			const { message } = await refuseModule(`export async function tools() { throw new Error("no tools today"); }\n`);
			expect(message).toContain("no tools today");
		});

		it("refuses a name repeated within one module", async () => {
			const { message } = await refuseModule(
				`const t = { name: "t", kind: "read", inputs: {}, outputs: {}, replay: "safe", async execute() { return { ok: true, outputs: {} }; } };
export default [t, { ...t }];
`,
			);
			expect(message).toContain("tool t: duplicate within module");
		});
	});
});
