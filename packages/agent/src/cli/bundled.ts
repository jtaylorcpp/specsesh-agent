/**
 * The catalogue of bundled scripts, for `specsesh agents`.
 *
 * Read from what ships, never from a list kept beside it: the task scripts from
 * the `.agent` files in `task/scripts/` (beside `src/cli` and `dist/cli` alike,
 * as `BUNDLED_SCRIPTS` finds them), and the delegate scripts from `READ_AGENT`
 * and `EDIT_AGENT`, whose only copy is source text so a Worker can use them. A
 * script added to either appears here with no code; `RUN_BY` only says which
 * command runs it, and an unmapped one is `"bundled"`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../authoring/index.js";
import { EDIT_AGENT, READ_AGENT } from "../durable/delegate-scripts.js";
import { type Node, childName, childValue, childrenOf, documentRoot, isNode, kindOf } from "../interpreter/ast.js";

export interface BundledScript {
	/** The file's base name for a task script, the grant's `script` value for a delegate. */
	readonly name: string;
	readonly kind: "task" | "delegate";
	/** The script's `config.description`. */
	readonly description: string;
	/** The command that runs it, or `"bundled"` when `RUN_BY` does not name it. */
	readonly runBy: string;
	/** Variables the script reads (`@variables.x` anywhere but a `set` target), in declaration order. */
	readonly reads: readonly string[];
	/** Variables the script sets, in declaration order. */
	readonly writes: readonly string[];
	/** The shipped file; absent for a delegate script, which ships as source text. */
	readonly path?: string;
	/** The script exactly as shipped. */
	readonly source: string;
}

/** The directory of the bundled task scripts. */
export const BUNDLED_DIR: string = fileURLToPath(new URL("../task/scripts/", import.meta.url));

/** The bundled delegate scripts, by the name a grant's `script` gives them. */
export const BUNDLED_DELEGATES: Readonly<Record<string, string>> = { read: READ_AGENT, edit: EDIT_AGENT };

/** The command that runs each bundled script. */
export const RUN_BY: Readonly<Record<string, string>> = {
	task: "specsesh task <change> <task-id> --script task",
	"task-delegate": "specsesh task <change> <task-id> --script task-delegate",
	group: "specsesh task <change> <group>",
	"spec-proposal": "specsesh change draft <change> (proposal stage)",
	"spec-design": "specsesh change draft <change> (design stage)",
	"spec-specify": "specsesh change draft <change> (specs stage)",
	"spec-plan": "specsesh change draft <change> (tasks stage)",
	"ci-test-pick": "specsesh task pick-tests --input <file.json>",
	read: 'a delegate grant with "runner": "agent", "script": "read"',
	edit: 'a delegate grant with "runner": "agent", "script": "edit"',
};

export function runByFor(name: string): string {
	return Object.hasOwn(RUN_BY, name) ? RUN_BY[name]! : "bundled";
}

export interface ListOptions {
	/** The task scripts' directory. Default `BUNDLED_DIR`. */
	readonly dir?: string;
	/** The delegate scripts by name. Default `BUNDLED_DELEGATES`. */
	readonly delegates?: Readonly<Record<string, string>>;
}

/** Every bundled script, sorted by name. A script with error diagnostics throws, naming it. */
export function listBundled(options: ListOptions = {}): BundledScript[] {
	const dir = options.dir ?? BUNDLED_DIR;
	const scripts: BundledScript[] = [];
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".agent"))) {
		const path = join(dir, file);
		scripts.push(describe(basename(file, ".agent"), "task", readFileSync(path, "utf8"), path));
	}
	for (const [name, source] of Object.entries(options.delegates ?? BUNDLED_DELEGATES)) {
		scripts.push(describe(name, "delegate", source));
	}
	return scripts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** One bundled script by name, or undefined. */
export function findBundled(name: string, options: ListOptions = {}): BundledScript | undefined {
	return listBundled(options).find((script) => script.name === name);
}

function describe(name: string, kind: BundledScript["kind"], source: string, path?: string): BundledScript {
	const where = path ?? `the ${name} delegate script`;
	const analysis = analyze(source);
	const errors = analysis.diagnostics.filter((d) => (d as { severity?: number }).severity === 1);
	const root = documentRoot(analysis.parsed);
	if (root === undefined || errors.length > 0) {
		throw new Error(`${where} has errors: ${errors.map((d) => d.message).join("; ") || "no document"}`);
	}
	const config = root["config"];
	const description = isNode(config) ? stringValue(config["description"]) : undefined;
	const declared = childrenOf(root["variables"]).map(childName);
	const { reads, writes } = variableUse(root["subagent"]);
	return {
		name,
		kind,
		description: description ?? "",
		runBy: runByFor(name),
		reads: declared.filter((v) => reads.has(v)),
		writes: declared.filter((v) => writes.has(v)),
		...(path === undefined ? {} : { path }),
		source,
	};
}

function stringValue(value: unknown): string | undefined {
	return kindOf(value) === "StringLiteral" && typeof (value as Node)["value"] === "string"
		? ((value as Node)["value"] as string)
		: undefined;
}

/** Keys that hold source spans, scopes or bookkeeping rather than authored nodes. */
const SKIPPED_KEYS = new Set(["__cst", "__symbol", "__scope", "__comments", "__diagnostics", "__paramCstNode"]);

/**
 * Which variables the subagents read and set, over every node, not only the
 * statements a step composes: a `with` argument or a `set` under a `run` counts.
 */
function variableUse(subagents: unknown): { reads: Set<string>; writes: Set<string> } {
	const reads = new Set<string>();
	const writes = new Set<string>();
	const seen = new Set<object>();
	const variable = (node: unknown): string | undefined => {
		if (kindOf(node) !== "MemberExpression") return undefined;
		const object = (node as Node)["object"];
		const property = (node as Node)["property"];
		return isNode(object) && object["name"] === "variables" && typeof property === "string" ? property : undefined;
	};
	const walk = (value: unknown): void => {
		if (typeof value !== "object" || value === null || seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) walk(item);
			return;
		}
		const node = value as Node;
		if (kindOf(node) === "SetClause") {
			const target = variable(node["target"]);
			if (target !== undefined) writes.add(target);
			walk(node["value"]);
			return;
		}
		const read = variable(node);
		if (read !== undefined) {
			reads.add(read);
			return;
		}
		for (const [key, child] of Object.entries(node)) {
			if (!SKIPPED_KEYS.has(key)) walk(child);
		}
	};
	for (const entry of childrenOf(subagents)) walk(childValue(entry));
	return { reads, writes };
}
