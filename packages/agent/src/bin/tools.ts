/**
 * `--tools <module>`: load host actions from the user's own JavaScript modules.
 *
 * Each module's `default` export, else its `tools` export, is a `HostAction[]` or
 * a function of `{ workspace }` returning one, sync or async. Every entry is
 * shape-checked here, so a bad module is refused with `--tools <path>: <problem>`
 * before any registry, harness or model is touched. Shared by both bins.
 *
 * `--mcp <file>`: JSON files holding `mcpServers`, merged and connected through
 * `mcpTools`; their actions join the `--tools` actions in one registry.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createActionRegistry, type ActionRegistry, type HostAction } from "../durable/actions.js";
import type { McpServerConfig, McpSkipped, McpTools } from "../node/mcp.js";

export type LoadToolsResult =
	| { readonly ok: true; readonly registry: ActionRegistry; readonly actions: HostAction[] }
	| { readonly ok: false; readonly message: string };

export type LoadMcpResult = { readonly ok: true; readonly mcp: McpTools } | { readonly ok: false; readonly message: string };

export type LoadActionsResult =
	| { readonly ok: true; readonly registry: ActionRegistry; readonly mcp: McpTools }
	| { readonly ok: false; readonly message: string };

const NO_MCP: McpTools = { actions: [], skipped: [], close: async () => {} };

/**
 * Read each `--mcp` file (resolved from `cwd`), merge their `mcpServers` and
 * connect them with `mcpTools`. A bad file or a server repeated across files is
 * refused as `--mcp <file>: <problem>`; an `McpServerError`'s own message is
 * answered as it is. With no files, nothing is imported or connected.
 */
export async function loadMcp(files: readonly string[], options: { readonly cwd: string }): Promise<LoadMcpResult> {
	if (files.length === 0) return { ok: true, mcp: NO_MCP };
	const servers: Record<string, McpServerConfig> = {};
	const firstFile = new Map<string, string>();
	for (const file of files) {
		const refuse = (problem: string): LoadMcpResult => ({ ok: false, message: `--mcp ${file}: ${problem}` });
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(resolve(options.cwd, file), "utf8"));
		} catch (err) {
			return refuse(`${err instanceof Error ? err.message : String(err)}; expected JSON with a top-level "mcpServers" object`);
		}
		if (!isPlainObject(parsed) || !isPlainObject(parsed.mcpServers)) {
			return refuse('expected a top-level "mcpServers" object');
		}
		for (const [name, config] of Object.entries(parsed.mcpServers)) {
			const first = firstFile.get(name);
			if (first !== undefined) return refuse(`server "${name}" is already defined in ${first}`);
			firstFile.set(name, file);
			servers[name] = config as McpServerConfig;
		}
	}
	// Imported only when asked for, so the SDK stays an optional peer.
	const { mcpTools, McpServerError } = await import("../node/mcp.js");
	try {
		return { ok: true, mcp: await mcpTools(servers) };
	} catch (err) {
		if (err instanceof McpServerError) return { ok: false, message: err.message };
		throw err;
	}
}

/**
 * `--tools` modules and `--mcp` files in one registry, which refuses a name both
 * define. On success the caller owns `mcp` and must `close()` it; on a refusal
 * every connection is already closed.
 */
export async function loadActions(
	toolPaths: readonly string[],
	mcpFiles: readonly string[],
	options: { readonly cwd: string; readonly workspace: string },
): Promise<LoadActionsResult> {
	const tools = await loadTools(toolPaths, options);
	if (!tools.ok) return tools;
	const loaded = await loadMcp(mcpFiles, options);
	if (!loaded.ok) return loaded;
	try {
		return { ok: true, registry: createActionRegistry([...tools.actions, ...loaded.mcp.actions]), mcp: loaded.mcp };
	} catch (err) {
		await loaded.mcp.close();
		return { ok: false, message: `${mcpFiles.length > 0 ? "--mcp" : "--tools"}: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/** One stderr line per tool `mcpTools` could not map. */
export function reportSkipped(skipped: readonly McpSkipped[], stderr: { write(line: string): unknown }): void {
	for (const { server, tool, reason } of skipped) stderr.write(`mcp: skipped ${server}/${tool}: ${reason}\n`);
}

/** Keyed by `HostAction["kind"]`, so a fifth kind fails to compile until it is listed. */
const KINDS: Readonly<Record<HostAction["kind"], true>> = { read: true, edit: true, command: true, delegate: true };
const PARAMETER_TYPES = new Set(["string", "number", "boolean"]);
const DELEGATE_PREFIX = "delegate/";

/**
 * Import each module in `paths` (resolved from `cwd`), in order, and check what
 * it exports. Answers the registry and its actions, or the first problem found.
 * Every message names the path as given.
 */
export async function loadTools(
	paths: readonly string[],
	options: { readonly cwd: string; readonly workspace: string },
): Promise<LoadToolsResult> {
	const actions: HostAction[] = [];
	const firstModule = new Map<string, string>();
	for (const path of paths) {
		const refuse = (problem: string): LoadToolsResult => ({ ok: false, message: `--tools ${path}: ${problem}` });
		let exported: unknown;
		try {
			const mod = (await import(pathToFileURL(resolve(options.cwd, path)).href)) as Record<string, unknown>;
			exported = mod.default ?? mod.tools;
			if (exported === undefined) return refuse("exports neither default nor tools");
			if (typeof exported === "function") exported = await exported({ workspace: options.workspace });
		} catch (err) {
			return refuse(err instanceof Error ? err.message : String(err));
		}
		if (!Array.isArray(exported)) return refuse("expected an array of tools");
		for (const [index, entry] of exported.entries()) {
			const label = isRecord(entry) && typeof entry.name === "string" && entry.name !== "" ? entry.name : String(index);
			const problem = entryProblem(entry);
			if (problem !== undefined) return refuse(`tool ${label}: ${problem}`);
			const first = firstModule.get(label);
			if (first !== undefined) {
				return refuse(`tool ${label}: ${first === path ? "duplicate within module" : `duplicate of ${first}`}`);
			}
			firstModule.set(label, path);
			actions.push(entry as HostAction);
		}
	}
	try {
		return { ok: true, registry: createActionRegistry(actions), actions };
	} catch (err) {
		return { ok: false, message: `--tools: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/** What makes `entry` not a valid executed `HostAction`, or `undefined` when it is one. */
function entryProblem(entry: unknown): string | undefined {
	if (!isRecord(entry)) return "is not an object";
	if (typeof entry.name !== "string" || entry.name === "") return "name must be a non-empty string";
	if (entry.name.startsWith(DELEGATE_PREFIX)) return `${DELEGATE_PREFIX} names are reserved`;
	if (entry.durable !== undefined) return "durable actions are not supported from a module";
	if (typeof entry.kind !== "string" || !Object.hasOwn(KINDS, entry.kind)) {
		return `kind must be one of ${Object.keys(KINDS).join(", ")}`;
	}
	for (const field of ["inputs", "outputs"] as const) {
		const parameters = entry[field];
		if (!isPlainObject(parameters)) return `${field} must be a plain object`;
		for (const [name, type] of Object.entries(parameters)) {
			if (typeof type !== "string" || !PARAMETER_TYPES.has(type)) {
				return `${field}.${name} must be "string", "number" or "boolean"`;
			}
		}
	}
	if (entry.replay !== "safe" && entry.replay !== "unsafe") return 'replay must be "safe" or "unsafe"';
	if (typeof entry.execute !== "function") return "execute must be a function";
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
