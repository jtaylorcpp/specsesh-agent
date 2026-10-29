import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutedHostAction } from "../../src/durable/index.js";
import { mapTool, McpServerError, mcpTools, type McpTools } from "../../src/mcp/index.js";
// @ts-expect-error: the fixture is plain JavaScript, with no declarations.
import { startHttp } from "../fixtures/mcp/server.mjs";

const FIXTURE = resolve(import.meta.dirname, "../fixtures/mcp/server.mjs");
const PRELOAD = pathToFileURL(resolve(import.meta.dirname, "../fixtures/mcp/pid.mjs")).href;
const CONTEXT = { workspace: process.cwd() };

interface HttpFixture {
	readonly url: string;
	readonly requests: Record<string, string | string[] | undefined>[];
	close(): Promise<void>;
}

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-mcp-"));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** The stdio fixture, writing its pid to `pidFile`. */
function stdio(pidFile: string, env: Record<string, string> = {}) {
	return { command: process.execPath, args: ["--import", PRELOAD, FIXTURE], env: { PID_FILE: pidFile, ...env } };
}

async function http(): Promise<HttpFixture> {
	const server = (await startHttp()) as HttpFixture;
	cleanups.push(() => server.close());
	return server;
}

async function connect(...args: Parameters<typeof mcpTools>): Promise<McpTools> {
	const tools = await mcpTools(...args);
	cleanups.push(() => tools.close());
	return tools;
}

function action(tools: McpTools, name: string): ExecutedHostAction {
	const found = tools.actions.find((a) => a.name === name);
	if (found === undefined) throw new Error(`no action ${name}`);
	return found;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}

async function exited(pid: number): Promise<boolean> {
	for (let i = 0; i < 100; i++) {
		if (!alive(pid)) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	return false;
}

describe("mcpTools", () => {
	it("Scenario: A stdio server's tool becomes an action", async () => {
		const tools = await connect({ fx: stdio(join(tempDir(), "pid")) });
		const echo = action(tools, "fx/echo");
		expect(echo.inputs).toEqual({ text: "string" });
		expect(echo.outputs).toEqual({ text: "string" });
		expect(tools.skipped).toEqual([{ server: "fx", tool: "tags", reason: expect.stringContaining("tags") }]);
		expect(tools.actions.map((a) => a.name)).not.toContain("fx/tags");
	});

	it("Scenario: An HTTP server's tool runs", async () => {
		const server = await http();
		const tools = await connect({ fx: { url: server.url } });
		expect(await action(tools, "fx/echo").execute({ text: "hi" }, CONTEXT)).toEqual({ ok: true, outputs: { text: "hi" } });
		expect(await action(tools, "fx/add").execute({ a: 2, b: 3 }, CONTEXT)).toEqual({ ok: true, outputs: { sum: 5 } });
		expect(await action(tools, "fx/fail").execute({}, CONTEXT)).toEqual({ ok: false, message: "fx: fail was called" });
	});

	it("Scenario: close ends the stdio process", async () => {
		const pidFile = join(tempDir(), "pid");
		const tools = await mcpTools({ fx: stdio(pidFile) });
		const pid = Number(readFileSync(pidFile, "utf8"));
		expect(alive(pid)).toBe(true);
		await tools.close();
		expect(await exited(pid)).toBe(true);
		await tools.close();
	});

	it("Scenario: A crashing server is named", async () => {
		const dir = tempDir();
		const okPid = join(dir, "ok.pid");
		const call = mcpTools({ ok: stdio(okPid), bad: stdio(join(dir, "bad.pid"), { CRASH: "1" }) });
		await expect(call).rejects.toBeInstanceOf(McpServerError);
		await expect(call).rejects.toThrow(/"bad"/);
		await expect(call).rejects.toMatchObject({ server: "bad" });
		expect(existsSync(okPid)).toBe(true);
		expect(await exited(Number(readFileSync(okPid, "utf8")))).toBe(true);
	});

	it("Scenario: A header takes its token from the environment", async () => {
		const server = await http();
		const tools = await connect(
			{ fx: { url: server.url, headers: { Authorization: "Bearer ${FX_TOKEN}" } } },
			{ env: { FX_TOKEN: "abc" } },
		);
		expect(tools.actions.length).toBeGreaterThan(0);
		expect(server.requests.length).toBeGreaterThan(0);
		for (const headers of server.requests) expect(headers["authorization"]).toBe("Bearer abc");
	});

	it("Scenario: A missing variable is named", async () => {
		const call = mcpTools({ fx: { url: "http://127.0.0.1:1/${NOPE}" } }, { env: {} });
		await expect(call).rejects.toBeInstanceOf(McpServerError);
		await expect(call).rejects.toThrow(/"fx".*NOPE/);
	});

	it("Scenario: Structured outputs are read from structuredContent", async () => {
		const server = await http();
		const add = action(await connect({ fx: { url: server.url } }), "fx/add");
		expect(add.outputs).toEqual({ sum: "number" });
		expect(await add.execute({ a: 2, b: 3 }, CONTEXT)).toEqual({ ok: true, outputs: { sum: 5 } });
	});

	it("Scenario: A tool with an array parameter is skipped", async () => {
		const server = await http();
		const tools = await connect({ fx: { url: server.url } });
		expect(tools.skipped).toContainEqual({ server: "fx", tool: "tags", reason: expect.stringContaining("tags") });
		expect(tools.actions.map((a) => a.name)).not.toContain("fx/tags");
	});

	it("Scenario: An error result is a failed call", async () => {
		const server = await http();
		const result = await action(await connect({ fx: { url: server.url } }), "fx/fail").execute({}, CONTEXT);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.message).toContain("fx: fail was called");
	});
});

describe("mapTool", () => {
	const client = { callTool: () => Promise.reject(new Error("not called")) };
	const tool = (annotations?: Tool["annotations"]): Tool => ({
		name: "t",
		inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
		...(annotations !== undefined ? { annotations } : {}),
	});

	it("Scenario: Annotations choose kind and replay", () => {
		const read = mapTool("fx", tool({ readOnlyHint: true, idempotentHint: true }), client);
		const plain = mapTool("fx", tool(), client);
		const readOnly = mapTool("fx", tool({ readOnlyHint: true }), client);
		if (!("action" in read) || !("action" in plain) || !("action" in readOnly)) throw new Error("all tools should map");
		expect([read.action.kind, read.action.replay]).toEqual(["read", "safe"]);
		expect([plain.action.kind, plain.action.replay]).toEqual(["command", "unsafe"]);
		expect([readOnly.action.kind, readOnly.action.replay]).toEqual(["read", "unsafe"]);
		expect(plain.action.inputs).toEqual({ q: "string" });
	});

	it("execute answers a throw as a failed result", async () => {
		const mapped = mapTool("fx", tool(), client);
		if (!("action" in mapped)) throw new Error("should map");
		expect(await mapped.action.execute({}, CONTEXT)).toEqual({ ok: false, message: "not called" });
	});
});
