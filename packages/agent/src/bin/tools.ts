/**
 * `--tools <module>`: load host actions from the user's own JavaScript modules.
 *
 * Each module's `default` export, else its `tools` export, is a `HostAction[]` or
 * a function of `{ workspace }` returning one, sync or async. Every entry is
 * shape-checked here, so a bad module is refused with `--tools <path>: <problem>`
 * before any registry, harness or model is touched. Shared by both bins.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createActionRegistry, type ActionRegistry, type HostAction } from "../durable/actions.js";

export type LoadToolsResult =
	| { readonly ok: true; readonly registry: ActionRegistry; readonly actions: HostAction[] }
	| { readonly ok: false; readonly message: string };

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
