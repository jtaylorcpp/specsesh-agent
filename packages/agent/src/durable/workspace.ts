/**
 * Where an agent's work happens, with no runtime in it: a `Workspace` reads and
 * writes confined paths, and may run processes and take snapshots. The four
 * built-in actions, the checks and every `DiffEvidence` go through one.
 *
 *   read_file   { path } → { content }                read     safe
 *   edit_file   { path, content } → { ok }            edit     safe
 *   run_command { command } → { exit_code, output }   command  unsafe
 *   run_checks  { task_id } → { passed, output }      command  unsafe
 *
 * No `node:` import here: a workspace over a directory lives in `./node`, one
 * over a sandbox in `./cloudflare`. A workspace with no `exec` runs no command,
 * and its checks fail rather than pass.
 */

import { Action, Evidence, check, explain, type CheckEvidence, type DiffEvidence } from "../openspec/index.js";
import type { ExecutedHostAction } from "./actions.js";

export interface ExecOptions {
	readonly stdin?: string;
	/** Exactly the child's environment, never merged with the host's. */
	readonly env?: Readonly<Record<string, string>>;
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
}

export type ExecResult =
	| { readonly kind: "exited"; readonly code: number; readonly stdout: string; readonly stderr: string }
	| { readonly kind: "timed-out"; readonly stdout: string; readonly stderr: string }
	| { readonly kind: "spawn-error"; readonly message: string };

/** Path → a value that changes when the path's status or content does (`status:contentHash`). */
export type WorkspaceSnapshot = ReadonlyMap<string, string>;

export interface Workspace {
	/** A display name for records and messages. */
	readonly root: string;
	/** Rejects with `WorkspaceError`: `outside the workspace` or `no such file`. */
	read(path: string): Promise<string>;
	/** Creates missing parent directories inside the workspace. */
	write(path: string, content: string): Promise<void>;
	/** Runs `argv[0]` with the rest as arguments, no shell, in the workspace. */
	exec?(argv: readonly string[], options: ExecOptions): Promise<ExecResult>;
	/** `undefined`: no history to diff against. */
	snapshot?(): Promise<WorkspaceSnapshot | undefined>;
	/** The workspace's file paths matching `glob` (see `matchGlob`), relative and sorted. */
	list?(glob: string): Promise<string[]>;
	/**
	 * Each line matching the regular expression `pattern` in the files matching
	 * `glob`, in path then line order, at most `limit` (default 200).
	 */
	search?(pattern: string, options?: SearchOptions): Promise<SearchMatch[]>;
	/**
	 * Delete one file. Rejects with `WorkspaceError` when it refuses. Without it a
	 * workspace cannot delete files; `memoryWorkspace` has none.
	 */
	remove?(path: string): Promise<void>;
	/**
	 * Record the workspace's changes in its history of record. `localWorkspace`
	 * has none: the local runner never commits.
	 */
	publish?(message: string): Promise<PublishResult>;
}

/** `commit` is the head after publishing; `changed` is false when there was nothing to record. */
export interface PublishResult {
	readonly commit: string;
	readonly changed: boolean;
}

export interface SearchOptions {
	readonly glob?: string;
	/** Default `DEFAULT_SEARCH_LIMIT`. */
	readonly limit?: number;
}

/** One matching line; `line` counts from 1. */
export interface SearchMatch {
	readonly path: string;
	readonly line: number;
	readonly text: string;
}

export const DEFAULT_SEARCH_LIMIT = 200;
export const NO_LIST = "this workspace cannot list files";
export const NO_SEARCH = "this workspace cannot search files";

/** Expand `{a,b}` (nested allowed) into its alternatives. An unclosed `{` is literal. */
function expandBraces(glob: string): string[] {
	const open = glob.indexOf("{");
	if (open === -1) return [glob];
	let depth = 0;
	const commas: number[] = [];
	for (let i = open; i < glob.length; i++) {
		const c = glob[i];
		if (c === "{") depth++;
		else if (c === "}" && --depth === 0) {
			const head = glob.slice(0, open);
			const tail = expandBraces(glob.slice(i + 1));
			const bounds = [open, ...commas, i];
			const parts = bounds.slice(1).flatMap((end, k) => expandBraces(glob.slice(bounds[k]! + 1, end)));
			return parts.flatMap((part) => tail.map((rest) => head + part + rest));
		} else if (c === "," && depth === 1) commas.push(i);
	}
	return expandBraces(glob.slice(open + 1)).map((rest) => glob.slice(0, open + 1) + rest);
}

function globBody(glob: string): string {
	let out = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]!;
		if (c === "*" && glob[i + 1] === "*") {
			const atStart = i === 0 || glob[i - 1] === "/";
			if (atStart && glob[i + 2] === "/") {
				out += "(?:.*/)?";
				i += 2;
			} else {
				out += ".*";
				i += 1;
			}
		} else if (c === "*") out += "[^/]*";
		else if (c === "?") out += "[^/]";
		else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return out;
}

/**
 * A glob as an anchored regular expression over `/`-separated relative paths:
 * `*` and `?` stay within a segment, `**` crosses them (`**\/` also matches no
 * directory), and `{a,b}` is either alternative.
 */
export function globToRegExp(glob: string): RegExp {
	return new RegExp(`^(?:${expandBraces(glob).map(globBody).join("|")})$`);
}

export function matchGlob(glob: string, path: string): boolean {
	return globToRegExp(glob).test(path);
}

/** `inside .git` and `is a directory` come only from `remove`. */
export type WorkspaceErrorReason = "outside the workspace" | "no such file" | "inside .git" | "is a directory";

export class WorkspaceError extends Error {
	readonly reason: WorkspaceErrorReason;
	readonly path: string;

	constructor(reason: WorkspaceErrorReason, path: string) {
		super(
			reason === "outside the workspace" || reason === "inside .git" ? `${path} is ${reason}` : `${reason}: ${path}`,
		);
		this.name = "WorkspaceError";
		this.reason = reason;
		this.path = path;
	}
}

/**
 * Append each line of `text` that `regex` matches to `matches`, stopping at
 * `limit`; true when it was reached. A trailing `\r` is not part of a line.
 * Module-internal: not in `./index.ts`.
 */
export function matchLines(path: string, text: string, regex: RegExp, matches: SearchMatch[], limit: number): boolean {
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!.endsWith("\r") ? lines[i]!.slice(0, -1) : lines[i]!;
		if (!regex.test(line)) continue;
		matches.push({ path, line: i + 1, text: line });
		if (matches.length >= limit) return true;
	}
	return false;
}

/**
 * `path` as a relative `/`-separated key with no `.` or `..` segment, or
 * `WorkspaceError("outside the workspace")`. Module-internal: not in `./index.ts`.
 */
export function confine(path: string): string {
	const refuse = () => new WorkspaceError("outside the workspace", path);
	if (path === "" || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) throw refuse();
	const parts: string[] = [];
	for (const part of path.replaceAll("\\", "/").split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (parts.pop() === undefined) throw refuse();
		} else parts.push(part);
	}
	if (parts.length === 0) throw refuse();
	return parts.join("/");
}

/**
 * A `Workspace` over an in-memory map seeded from `files`, its `root` `memory:`.
 * Paths are confined as `localWorkspace` confines them; there is no `exec`,
 * `snapshot` or `publish`.
 */
export function memoryWorkspace(files: Readonly<Record<string, string>> = {}): Workspace {
	const contents = new Map<string, string>();
	for (const [path, content] of Object.entries(files)) contents.set(confine(path), content);

	async function list(glob: string): Promise<string[]> {
		return [...contents.keys()].filter((path) => matchGlob(glob, path)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	}

	return {
		root: "memory:",
		async read(path) {
			const content = contents.get(confine(path));
			if (content === undefined) throw new WorkspaceError("no such file", path);
			return content;
		},
		async write(path, content) {
			contents.set(confine(path), content);
		},
		list,
		async search(pattern, options = {}) {
			// No `g` flag: `test` keeps no state from one line to the next. An invalid pattern rejects here.
			const regex = new RegExp(pattern);
			const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
			const matches: SearchMatch[] = [];
			if (limit <= 0) return matches;
			for (const path of await list(options.glob ?? "**/*")) {
				const content = contents.get(path)!;
				if (content.includes("\0")) continue;
				if (matchLines(path, content, regex, matches, limit)) break;
			}
			return matches;
		},
	};
}

export const NO_EXEC = "this workspace cannot run commands";
/** Per command, before it is killed: 10 minutes. */
export const DEFAULT_TIMEOUT_MS = 600_000;
/** Exit code recorded for a command that could not be spawned, as a shell reports a missing command. Module-internal. */
export const SPAWN_FAILED_EXIT_CODE = 127;

/** A git snapshot value: the two-letter porcelain code, `:`, then the content hash (`-` for no file). */
const PORCELAIN = /^([ MTADRCU?!]{2}):/;

/**
 * The paths whose entry differs, sorted. Absent after, listed with no file (a
 * `-` hash) or with a `D` code: `deleted`. Absent before: `added`, except a
 * porcelain entry that is neither untracked (`??`) nor added (`A`), which is a
 * tracked file that was clean before (git lists no clean file): `modified`.
 * Otherwise `modified`.
 */
export function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): DiffEvidence["files"] {
	const paths = [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path)).sort();
	return paths.map((path) => {
		const now = after.get(path);
		const code = now === undefined ? undefined : PORCELAIN.exec(now)?.[1];
		if (now === undefined || now.endsWith(":-") || code?.includes("D") === true) return { path, change: "deleted" };
		if (before.has(path)) return { path, change: "modified" };
		const tracked = code !== undefined && code !== "??" && !code.includes("A");
		return { path, change: tracked ? "modified" : "added" };
	});
}

/** Split a command line on whitespace. No quoting, no shell: what you see is the argv. */
export function splitCommand(command: string): string[] {
	return command.trim().split(/\s+/).filter((word) => word !== "");
}

export interface ChecksRun {
	/** Every check exited 0. Never true without `exec`, nor for no checks. */
	readonly passed: boolean;
	/** One per check that ran, in check order. */
	readonly evidence: readonly CheckEvidence[];
	/** Each check as `$ <command>`, its output, `(exit <code>)`; or why none ran. */
	readonly output: string;
}

/**
 * Run every check in order through `workspace.exec`, none skipped after a
 * failure. One that cannot start is a failure (127); one that times out is a
 * failure too (-1). Nothing here throws.
 */
export async function runChecks(
	workspace: Workspace,
	checks: readonly string[],
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<ChecksRun> {
	if (workspace.exec === undefined) return { passed: false, evidence: [], output: NO_EXEC };
	if (checks.length === 0) return { passed: false, evidence: [], output: "no checks configured, and an empty set of checks is not a pass" };
	const evidence: CheckEvidence[] = [];
	for (const command of checks) {
		const ran = await workspace.exec(splitCommand(command), { timeoutMs, ...(signal !== undefined ? { signal } : {}) });
		if (ran.kind === "exited") evidence.push({ kind: "check", command, exitCode: ran.code, output: ran.stdout + ran.stderr });
		else if (ran.kind === "timed-out") {
			evidence.push({ kind: "check", command, exitCode: -1, output: `${ran.stdout}${ran.stderr}\n(timed out after ${timeoutMs}ms)` });
		} else evidence.push({ kind: "check", command, exitCode: SPAWN_FAILED_EXIT_CODE, output: `(could not start: ${ran.message})` });
	}
	return {
		passed: evidence.every((e) => e.exitCode === 0),
		evidence,
		output: evidence.map((e) => `$ ${e.command}\n${e.output}\n(exit ${e.exitCode})`).join("\n\n"),
	};
}

/** What a host action puts in its result's `record`. */
export interface ActionRecord {
	readonly action: Action;
	readonly evidence: readonly Evidence[];
}

/** Build a record, checking each part against the ontology before it leaves. Module-internal: not in `./index.ts`. */
export function actionRecord(action: Action, evidence: readonly Evidence[]): ActionRecord {
	const parts: [typeof Action | typeof Evidence, unknown][] = [[Action, action], ...evidence.map((e) => [Evidence, e] as [typeof Evidence, unknown])];
	for (const [schema, value] of parts) {
		if (!check(schema, value)) {
			throw new Error(`a host action built a record the ontology refuses: ${explain(schema, value).join("; ")}`);
		}
	}
	return { action, evidence };
}

export interface WorkspaceActionOptions {
	/** First words `run_command` may run. Empty: it runs nothing. */
	readonly allow?: readonly string[];
	/** Commands `run_checks` runs, in order. Empty: it refuses rather than pass vacuously. */
	readonly checks?: readonly string[];
	/** Per command before it is killed. Defaults to 10 minutes. */
	readonly timeoutMs?: number;
}

/** The four built-ins, every read, write and process going through `workspace`. */
export function workspaceActions(workspace: Workspace, options: WorkspaceActionOptions = {}): ExecutedHostAction[] {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const allow = options.allow ?? [];
	const checks = options.checks ?? [];

	const readFileAction: ExecutedHostAction = {
		name: "read_file",
		kind: "read",
		inputs: { path: "string" },
		outputs: { content: "string" },
		replay: "safe",
		async execute(inputs) {
			try {
				return { ok: true, outputs: { content: await workspace.read(String(inputs["path"])) } };
			} catch (error) {
				if (error instanceof WorkspaceError) return { ok: false, message: `${error.message}; nothing was read` };
				throw error;
			}
		},
	};

	const editFileAction: ExecutedHostAction = {
		name: "edit_file",
		kind: "edit",
		inputs: { path: "string", content: "string" },
		outputs: { ok: "boolean" },
		replay: "safe",
		async execute(inputs) {
			const path = String(inputs["path"]);
			let change: "added" | "modified";
			try {
				await workspace.read(path);
				change = "modified";
			} catch (error) {
				if (!(error instanceof WorkspaceError)) throw error;
				if (error.reason === "outside the workspace") return { ok: false, message: `${error.message}; nothing was written` };
				change = "added";
			}
			try {
				await workspace.write(path, String(inputs["content"]));
			} catch (error) {
				if (error instanceof WorkspaceError) return { ok: false, message: `${error.message}; nothing was written` };
				throw error;
			}
			return {
				ok: true,
				outputs: { ok: true },
				record: actionRecord(
					{ kind: "edit", summary: `${change === "added" ? "create" : "replace"} ${path}`, refs: [path] },
					[{ kind: "diff", files: [{ path, change }] }],
				),
			};
		},
	};

	const runCommandAction: ExecutedHostAction = {
		name: "run_command",
		kind: "command",
		inputs: { command: "string" },
		outputs: { exit_code: "number", output: "string" },
		replay: "unsafe",
		async execute(inputs, context) {
			const command = String(inputs["command"]).trim();
			const argv = splitCommand(command);
			const first = argv[0];
			if (first === undefined) return { ok: false, message: "the command is empty" };
			if (!allow.includes(first)) {
				return {
					ok: false,
					message: `${first} is not on the allowlist (allowed: ${allow.join(", ") || "nothing"}); nothing was run`,
				};
			}
			if (workspace.exec === undefined) return { ok: false, message: NO_EXEC };
			const ran = await workspace.exec(argv, { timeoutMs, ...(context.signal !== undefined ? { signal: context.signal } : {}) });
			if (ran.kind === "timed-out") return { ok: false, message: `${command} timed out after ${timeoutMs}ms` };
			if (ran.kind === "spawn-error") return { ok: false, message: `${command} could not start: ${ran.message}` };
			const output = ran.stdout + ran.stderr;
			return {
				ok: true,
				outputs: { exit_code: ran.code, output },
				record: actionRecord({ kind: "command", summary: command, refs: [command] }, [
					{ kind: "check", command, exitCode: ran.code, output },
				]),
			};
		},
	};

	const runChecksAction: ExecutedHostAction = {
		name: "run_checks",
		kind: "command",
		inputs: { task_id: "string" },
		outputs: { passed: "boolean", output: "string" },
		replay: "unsafe",
		async execute(inputs, context) {
			if (workspace.exec === undefined) return { ok: false, message: NO_EXEC };
			if (checks.length === 0) {
				return { ok: false, message: "no checks configured, and an empty set of checks is not a pass" };
			}
			const ran = await runChecks(workspace, checks, timeoutMs, context.signal);
			return {
				ok: true,
				outputs: { passed: ran.passed, output: ran.output },
				record: actionRecord(
					{ kind: "command", summary: `run the checks for task ${String(inputs["task_id"])}`, refs: [...checks] },
					ran.evidence,
				),
			};
		},
	};

	return [readFileAction, editFileAction, runCommandAction, runChecksAction];
}

/**
 * `list_files` and `search_files`, over `workspace.list` and `workspace.search`.
 * Both only read, so they record no Action. An absent or empty `glob` is `**\/*`.
 *
 *   list_files   { glob } → { paths }               read  safe
 *   search_files { pattern, glob } → { matches }    read  safe
 */
export function searchActions(workspace: Workspace): ExecutedHostAction[] {
	const globOf = (inputs: Readonly<Record<string, unknown>>): string => {
		const glob = inputs["glob"];
		return typeof glob === "string" && glob.trim() !== "" ? glob : "**/*";
	};

	const listFilesAction: ExecutedHostAction = {
		name: "list_files",
		kind: "read",
		inputs: { glob: "string" },
		outputs: { paths: "string" },
		replay: "safe",
		async execute(inputs) {
			if (workspace.list === undefined) return { ok: false, message: NO_LIST };
			return { ok: true, outputs: { paths: (await workspace.list(globOf(inputs))).join("\n") } };
		},
	};

	const searchFilesAction: ExecutedHostAction = {
		name: "search_files",
		kind: "read",
		inputs: { pattern: "string", glob: "string" },
		outputs: { matches: "string" },
		replay: "safe",
		async execute(inputs) {
			if (workspace.search === undefined) return { ok: false, message: NO_SEARCH };
			const pattern = String(inputs["pattern"] ?? "");
			try {
				new RegExp(pattern);
			} catch (error) {
				return { ok: false, message: `${pattern} is not a regular expression: ${(error as Error).message}` };
			}
			const matches = await workspace.search(pattern, { glob: globOf(inputs) });
			return { ok: true, outputs: { matches: matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n") } };
		},
	};

	return [listFilesAction, searchFilesAction];
}
