/**
 * MCP servers as host actions: connect to the servers a `.mcp.json`-style
 * `mcpServers` object names, list their tools, and map each usable one to an
 * `ExecutedHostAction` named `<server>/<tool>`, so a script targets it as
 * `mcpTool://<server>/<tool>`. The only module that imports the MCP SDK.
 *
 * Every server connects or none does: one failure closes whatever is open and
 * rejects with `McpServerError`, naming the server.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ActionResult, VariableValue } from "../interpreter/index.js";
import type { ActionParameterType, ExecutedHostAction } from "../durable/actions.js";

/** A server spawned as a process and spoken to over its stdin and stdout. */
export interface McpStdioServerConfig {
	readonly type?: "stdio";
	readonly command: string;
	readonly args?: readonly string[];
	/** Added to the SDK's default environment; the parent's is never passed whole. */
	readonly env?: Readonly<Record<string, string>>;
	readonly cwd?: string;
}

/** A server reached over Streamable HTTP. */
export interface McpHttpServerConfig {
	readonly type?: "http";
	readonly url: string;
	readonly headers?: Readonly<Record<string, string>>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

/** The `mcpServers` object of Claude Code's `.mcp.json`. */
export type McpServers = Readonly<Record<string, McpServerConfig>>;

export interface McpToolsOptions {
	/** Where `${VAR}` expands from. Default `process.env`. */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** How long one server may take to connect and list its tools. Default 30000. */
	readonly timeoutMs?: number;
	/** How long one tool call may take; the SDK's default when unset. */
	readonly callTimeoutMs?: number;
	/** The client name sent in the handshake. */
	readonly clientName?: string;
}

/** A tool that could not be mapped to an action, and why. */
export interface McpSkipped {
	readonly server: string;
	readonly tool: string;
	readonly reason: string;
}

export interface McpTools {
	readonly actions: ExecutedHostAction[];
	readonly skipped: McpSkipped[];
	/** Ends every connection, and so every spawned process. Safe to call twice. */
	close(): Promise<void>;
}

/** A server that was refused, or failed to connect or list its tools. */
export class McpServerError extends Error {
	readonly server: string;

	constructor(server: string, reason: string) {
		super(`mcp server "${server}": ${reason}`);
		this.name = "McpServerError";
		this.server = server;
	}
}

const DEFAULT_TIMEOUT_MS = 30_000;
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const TOOL_NAME = /^[A-Za-z0-9_.-]+$/;
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const STDERR_TAIL = 2000;

const SCALARS: Readonly<Record<string, ActionParameterType>> = {
	string: "string",
	number: "number",
	integer: "number",
	boolean: "boolean",
};

type Resolved =
	| { readonly kind: "stdio"; readonly command: string; readonly args: string[]; readonly env: Record<string, string>; readonly cwd?: string }
	| { readonly kind: "http"; readonly url: URL; readonly headers: Record<string, string> };

/**
 * Connect to every server in parallel, list each one's tools (following
 * `nextCursor`) and map them. Rejects with `McpServerError` when a server is
 * refused before connecting, or fails to connect or list within `timeoutMs`;
 * every connection already open is closed first.
 */
export async function mcpTools(servers: McpServers, options: McpToolsOptions = {}): Promise<McpTools> {
	const env = options.env ?? process.env;
	const resolved = Object.entries(servers).map(([name, config]) => [name, resolveServer(name, config, env)] as const);

	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const opened: Client[] = [];
	const settled = await Promise.allSettled(
		resolved.map(async ([name, server]) => {
			const client = new Client({ name: options.clientName ?? "@specsesh/agent", version: "0" });
			opened.push(client);
			const stderr: string[] = [];
			const transport = createTransport(server, stderr);
			try {
				const tools = await withTimeout(connectAndList(client, transport), timeoutMs);
				return { name, client, tools };
			} catch (error) {
				const tail = stderr.join("").trim().slice(-STDERR_TAIL);
				throw new McpServerError(name, messageOf(error) + (tail === "" ? "" : `; stderr: ${tail}`));
			}
		}),
	);

	let closed: Promise<void> | undefined;
	const close = (): Promise<void> =>
		(closed ??= Promise.allSettled(opened.map((client) => client.close())).then(() => undefined));

	const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
	if (failed !== undefined) {
		await close();
		throw failed.reason;
	}

	const actions: ExecutedHostAction[] = [];
	const skipped: McpSkipped[] = [];
	for (const result of settled) {
		if (result.status !== "fulfilled") continue;
		const { name, client, tools } = result.value;
		for (const tool of tools) {
			const mapped = mapTool(name, tool, client, { callTimeoutMs: options.callTimeoutMs });
			if ("action" in mapped) actions.push(mapped.action);
			else skipped.push(mapped.skipped);
		}
	}
	return { actions, skipped, close };
}

/**
 * One tool as an action, or why it can't be one. Inputs are its required scalar
 * parameters; outputs its `outputSchema`'s fields when all are scalar, else
 * `{ text }`. `readOnlyHint` makes it a `read`; it replays `safe` only when also
 * `idempotentHint`. `execute` never throws.
 */
export function mapTool(
	server: string,
	tool: Tool,
	client: Pick<Client, "callTool">,
	options: { readonly callTimeoutMs?: number | undefined } = {},
): { readonly action: ExecutedHostAction } | { readonly skipped: McpSkipped } {
	const skip = (reason: string) => ({ skipped: { server, tool: tool.name, reason } });
	if (!TOOL_NAME.test(tool.name)) return skip(`tool name ${JSON.stringify(tool.name)} is not ${TOOL_NAME.source}`);

	const properties = (tool.inputSchema.properties ?? {}) as Record<string, { type?: unknown } | undefined>;
	const inputs: Record<string, ActionParameterType> = {};
	for (const parameter of tool.inputSchema.required ?? []) {
		const type = scalarType(properties[parameter]);
		if (type === undefined || !Object.hasOwn(SCALARS, type)) return skip(`required parameter ${parameter} is ${type ?? "untyped"}`);
		inputs[parameter] = SCALARS[type]!;
	}

	const structured = structuredOutputs(tool.outputSchema);
	const outputs: Record<string, ActionParameterType> = structured ?? { text: "string" };
	const readOnly = tool.annotations?.readOnlyHint === true;
	const idempotent = tool.annotations?.idempotentHint === true;

	const action: ExecutedHostAction = {
		name: `${server}/${tool.name}`,
		...(tool.description !== undefined ? { description: tool.description } : {}),
		kind: readOnly ? "read" : "command",
		inputs,
		outputs,
		replay: readOnly && idempotent ? "safe" : "unsafe",
		async execute(values, context): Promise<ActionResult> {
			try {
				const result = await client.callTool({ name: tool.name, arguments: { ...values } }, undefined, {
					...(context.signal !== undefined ? { signal: context.signal } : {}),
					...(options.callTimeoutMs !== undefined ? { timeout: options.callTimeoutMs } : {}),
				});
				const text = textOf(result.content);
				if (result.isError === true) return { ok: false, message: text || "the tool reported an error" };
				if (structured === undefined) return { ok: true, outputs: { text } };
				const content = (result.structuredContent ?? {}) as Record<string, unknown>;
				const read: Record<string, VariableValue> = {};
				for (const field of Object.keys(structured)) {
					if (!(field in content)) return { ok: false, message: `${server}/${tool.name} answered no ${field} in its structuredContent` };
					read[field] = content[field] as VariableValue;
				}
				return { ok: true, outputs: read };
			} catch (error) {
				return { ok: false, message: messageOf(error) };
			}
		},
	};
	return { action };
}

function resolveServer(name: string, config: unknown, env: Readonly<Record<string, string | undefined>>): Resolved {
	const refuse = (reason: string): never => {
		throw new McpServerError(name, reason);
	};
	if (!SERVER_NAME.test(name)) refuse(`a server name must match ${SERVER_NAME.source}`);
	if (name === "delegate") refuse("the name delegate is reserved for granted delegates");
	if (typeof config !== "object" || config === null || Array.isArray(config)) return refuse("its config is not an object");

	const c = config as Record<string, unknown>;
	const expand = (value: unknown, field: string): string => {
		if (typeof value !== "string") return refuse(`${field} is not a string`);
		return value.replace(VARIABLE, (_, variable: string, fallback: string | undefined) => {
			const set = env[variable];
			if (set !== undefined && set !== "") return set;
			if (fallback !== undefined) return fallback;
			if (set !== undefined) return set;
			return refuse(`${field} uses \${${variable}}, which is not set`);
		});
	};
	const expandRecord = (value: unknown, field: string): Record<string, string> => {
		if (value === undefined) return {};
		if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse(`${field} is not an object`);
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, `${field}.${key}`)]));
	};

	const type = c["type"];
	if (type === "sse") refuse("type sse is not supported; use a Streamable HTTP server (type http)");
	if (type !== undefined && type !== "stdio" && type !== "http") refuse(`type ${JSON.stringify(type)} is not stdio or http`);
	if ("command" in c && "url" in c) refuse("it has both command and url");

	if ("command" in c) {
		if (type === "http") refuse("type http needs url, not command");
		const args = c["args"] ?? [];
		if (!Array.isArray(args)) refuse("args is not an array");
		return {
			kind: "stdio",
			command: expand(c["command"], "command"),
			args: (args as unknown[]).map((arg, i) => expand(arg, `args[${i}]`)),
			env: expandRecord(c["env"], "env"),
			...(c["cwd"] !== undefined ? { cwd: expand(c["cwd"], "cwd") } : {}),
		};
	}
	if ("url" in c) {
		if (type === "stdio") refuse("type stdio needs command, not url");
		const url = expand(c["url"], "url");
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return refuse(`url ${JSON.stringify(url)} is not a URL`);
		}
		return { kind: "http", url: parsed, headers: expandRecord(c["headers"], "headers") };
	}
	return refuse("it has neither command (stdio) nor url (http)");
}

function createTransport(server: Resolved, stderr: string[]): Transport {
	if (server.kind === "http") {
		return new StreamableHTTPClientTransport(server.url, { requestInit: { headers: server.headers } });
	}
	const transport = new StdioClientTransport({
		command: server.command,
		args: server.args,
		env: { ...getDefaultEnvironment(), ...server.env },
		...(server.cwd !== undefined ? { cwd: server.cwd } : {}),
		stderr: "pipe",
	});
	// Drained so a chatty server never blocks; the tail goes into a connect failure.
	transport.stderr?.on("data", (chunk: Buffer | string) => {
		stderr.push(String(chunk));
		while (stderr.length > 1 && stderr.join("").length > STDERR_TAIL) stderr.shift();
	});
	return transport;
}

async function connectAndList(client: Client, transport: Transport): Promise<Tool[]> {
	await client.connect(transport);
	const tools: Tool[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.listTools(cursor !== undefined ? { cursor } : undefined);
		tools.push(...page.tools);
		cursor = page.nextCursor;
	} while (cursor !== undefined);
	return tools;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`did not connect and list its tools within ${ms} ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function scalarType(property: { type?: unknown } | undefined): string | undefined {
	if (property === undefined) return undefined;
	return Array.isArray(property.type) ? property.type.join("|") : typeof property.type === "string" ? property.type : undefined;
}

/** The output fields when `outputSchema` declares at least one and all are scalar; otherwise `undefined`. */
function structuredOutputs(schema: Tool["outputSchema"]): Record<string, ActionParameterType> | undefined {
	const properties = Object.entries((schema?.properties ?? {}) as Record<string, { type?: unknown } | undefined>);
	if (properties.length === 0) return undefined;
	const outputs: Record<string, ActionParameterType> = {};
	for (const [field, property] of properties) {
		const type = scalarType(property);
		if (type === undefined || !Object.hasOwn(SCALARS, type)) return undefined;
		outputs[field] = SCALARS[type]!;
	}
	return outputs;
}

function textOf(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((item): item is { type: "text"; text: string } => item?.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n");
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
