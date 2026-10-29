/**
 * The tool bridge on Node: a step's offered tools served to `claude -p` as one
 * Streamable HTTP MCP server on loopback, named `agentscript`.
 *
 * Each bridge listens on `127.0.0.1`, port 0, and refuses any request without its
 * random bearer token. The token reaches Claude Code only through the
 * `--mcp-config` file, mode `0600` in a private directory, so it is never in argv.
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BRIDGE_SERVER, type BridgeHandler, type BridgeReply, type BridgeTool, type ToolBridge, type ToolBridgeFactory } from "../claude-code/tool-bridge.js";

/**
 * A `ToolBridgeFactory` for the claude-code port.
 */
export function mcpBridge(): ToolBridgeFactory {
	return async (tools, handler) => {
		const sdk = SDK;
		const token = randomBytes(32).toString("hex");
		const authorization = `Bearer ${token}`;

		const http = createServer((req, res) => {
			if (req.headers.authorization !== authorization) {
				res.writeHead(401).end();
				return;
			}
			if (new URL(req.url ?? "/", "http://127.0.0.1").pathname !== "/mcp") {
				res.writeHead(404).end();
				return;
			}
			void serve(sdk, tools, handler, req, res);
		});
		await new Promise<void>((resolve, reject) => {
			http.once("error", reject);
			http.listen(0, "127.0.0.1", () => {
				http.off("error", reject);
				resolve();
			});
		});

		let dir: string | undefined;
		let closed: Promise<void> | undefined;
		const close = (): Promise<void> =>
			(closed ??= (async () => {
				await stop(http);
				if (dir !== undefined) await rm(dir, { recursive: true, force: true });
			})());

		try {
			const { port } = http.address() as AddressInfo;
			const url = `http://127.0.0.1:${port}/mcp`;
			dir = await mkdtemp(join(tmpdir(), "agentscript-bridge-"));
			const mcpConfig = join(dir, "mcp.json");
			const config = { mcpServers: { [BRIDGE_SERVER]: { type: "http", url, headers: { Authorization: authorization } } } };
			await writeFile(mcpConfig, JSON.stringify(config), { mode: 0o600 });
			// The umask can only narrow `mode`, but be explicit.
			await chmod(mcpConfig, 0o600);
			return { mcpConfig, allowedTools: tools.map((tool) => `mcp__${BRIDGE_SERVER}__${tool.name}`), close } satisfies ToolBridge;
		} catch (error) {
			await close();
			throw error;
		}
	};
}

type Sdk = typeof SDK;

/** One stateless MCP exchange: a fresh server and transport per request. */
async function serve(
	sdk: Sdk,
	tools: readonly BridgeTool[],
	handler: BridgeHandler,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const server = new sdk.Server({ name: BRIDGE_SERVER, version: "0" }, { capabilities: { tools: {} } });
	server.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({
		tools: tools.map(({ name, description, inputSchema }) => ({
			name,
			description,
			inputSchema: inputSchema as { type: "object"; [key: string]: unknown },
		})),
	}));
	server.setRequestHandler(sdk.CallToolRequestSchema, async (request) => {
		let reply: BridgeReply;
		try {
			reply = await handler(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>);
		} catch (error) {
			reply = { ok: false, text: messageOf(error) };
		}
		return { content: [{ type: "text" as const, text: reply.text }], ...(reply.ok ? {} : { isError: true }) };
	});
	const transport = new sdk.StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
	res.on("close", () => {
		void transport.close();
		void server.close();
	});
	try {
		await server.connect(transport);
		await transport.handleRequest(req, res);
	} catch (error) {
		if (!res.headersSent) res.writeHead(500).end(messageOf(error));
	}
}

function stop(http: HttpServer): Promise<void> {
	return new Promise((resolve) => {
		http.close(() => resolve());
		http.closeAllConnections();
	});
}

const SDK = { Server, StreamableHTTPServerTransport, ListToolsRequestSchema, CallToolRequestSchema };

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
