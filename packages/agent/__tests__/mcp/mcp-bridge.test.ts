import { existsSync, readFileSync, statSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeHandler, BridgeTool, ToolBridge } from "../../src/claude-code/index.js";
import { mcpBridge } from "../../src/mcp/index.js";

const ECHO: BridgeTool = {
	name: "echo",
	description: "Answers hi.",
	inputSchema: { type: "object", properties: { msg: { type: "string" } } },
};

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function bridge(handler: BridgeHandler): Promise<ToolBridge> {
	const started = await mcpBridge()([ECHO], handler);
	cleanups.push(() => started.close());
	return started;
}

/** The URL and headers its `mcpConfig` file names, as Claude Code would read them. */
function serverOf(started: ToolBridge): { url: string; headers: Record<string, string> } {
	const config = JSON.parse(readFileSync(started.mcpConfig, "utf8")) as {
		mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
	};
	const server = config.mcpServers["agentscript"]!;
	expect(server.type).toBe("http");
	return { url: server.url, headers: server.headers };
}

async function connect(started: ToolBridge): Promise<Client> {
	const { url, headers } = serverOf(started);
	const client = new Client({ name: "test", version: "0" });
	await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
	cleanups.push(() => client.close());
	return client;
}

describe("mcpBridge", () => {
	it("Scenario: The bridge lists and calls its tools", async () => {
		const handler = vi.fn<BridgeHandler>(async () => ({ ok: true, text: "hi" }));
		const client = await connect(await bridge(handler));

		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name)).toEqual(["echo"]);
		expect(tools[0]!.inputSchema).toEqual(ECHO.inputSchema);

		const result = await client.callTool({ name: "echo", arguments: { msg: "x" } });
		expect(result.content).toEqual([{ type: "text", text: "hi" }]);
		expect(result.isError).toBeFalsy();
		expect(handler).toHaveBeenCalledWith("echo", { msg: "x" });
	});

	it("Scenario: A request without the token is refused", async () => {
		const handler = vi.fn<BridgeHandler>(async () => ({ ok: true, text: "hi" }));
		const started = await bridge(handler);
		const { url, headers } = serverOf(started);
		const initialize = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
		});
		const json = { "content-type": "application/json", accept: "application/json, text/event-stream" };

		const refused = await fetch(url, { method: "POST", headers: json, body: initialize });
		expect(refused.status).toBe(401);
		const wrong = await fetch(url, { method: "POST", headers: { ...json, authorization: "Bearer nope" }, body: initialize });
		expect(wrong.status).toBe(401);
		const elsewhere = await fetch(new URL("/other", url), { method: "POST", headers: { ...json, ...headers }, body: initialize });
		expect(elsewhere.status).toBe(404);
		expect(handler).not.toHaveBeenCalled();
	});

	it("Scenario: A failing handler is an error result", async () => {
		const client = await connect(
			await bridge(async () => {
				throw new Error("nope");
			}),
		);
		const result = await client.callTool({ name: "echo", arguments: {} });
		expect(result.isError).toBe(true);
		expect(result.content).toEqual([{ type: "text", text: "nope" }]);
	});

	it("Scenario: The config file is private and removed on close", async () => {
		const started = await bridge(async () => ({ ok: true, text: "hi" }));
		expect(statSync(started.mcpConfig).mode & 0o777).toBe(0o600);
		expect(started.allowedTools).toEqual(["mcp__agentscript__echo"]);

		await started.close();
		expect(existsSync(started.mcpConfig)).toBe(false);
		await expect(started.close()).resolves.toBeUndefined();
	});
});
