/**
 * The repo config: `agentscript.config.json`, found by walking up from the
 * current directory, of which only the `task` and `delegates` objects are read.
 *
 * Every field is optional and typed. An unknown key or a wrongly typed value
 * refuses the run, naming the key and the file: a typo must never fall back
 * to a default silently. Values resolve field by field as flag, then
 * environment (`AGENTSCRIPT_PROVIDER`, `AGENTSCRIPT_MODEL`), then config, then
 * default; paths from the config are relative to the config's directory.
 * `delegates` maps grant names to `DelegateGrant`s, checked whole against
 * `defaultRunners`; without it, nothing is granted.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DelegateGrantError, validateGrants, type DelegateGrant, type DelegateGrants } from "../durable/delegation.js";
import { defaultRunners } from "../node/index.js";
import { DEFAULT_MAX_REWORKS } from "./group.js";
import { BUNDLED_SCRIPTS, DEFAULT_ESCALATE_TO, DEFAULT_MAX_ITERATIONS } from "./options.js";

export const CONFIG_FILE = "agentscript.config.json";

export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-haiku-4-5";
export const DEFAULT_CHANGES_DIR = "openspec/changes";

type FieldKind = "string" | "strings" | "positive-integer" | "recipient" | "boolean";

const FIELDS = {
	changesDir: "string",
	db: "string",
	provider: "string",
	model: "string",
	script: "string",
	groupScript: "string",
	checks: "strings",
	allow: "strings",
	maxIterations: "positive-integer",
	maxReworks: "positive-integer",
	escalateTo: "recipient",
	requireCleanTree: "boolean",
	worktree: "boolean",
	worktreeDir: "string",
	worktreeSetup: "strings",
} as const satisfies Record<string, FieldKind>;

/** `task` keys that moved to `delegates`: refused with directions rather than as unknown. */
const RETIRED = ["delegateModel", "delegateContext"] as const;

const DESCRIBE: Record<FieldKind, string> = {
	string: "a string",
	strings: "an array of strings",
	"positive-integer": "a positive integer",
	recipient: '"principal" or "agent"',
	boolean: "true or false",
};

/** The `task` object, as validated. */
export interface TaskConfig {
	readonly changesDir?: string;
	readonly db?: string;
	readonly provider?: string;
	readonly model?: string;
	readonly script?: string;
	readonly groupScript?: string;
	readonly checks?: readonly string[];
	readonly allow?: readonly string[];
	readonly maxIterations?: number;
	readonly maxReworks?: number;
	readonly escalateTo?: "principal" | "agent";
	readonly requireCleanTree?: boolean;
	readonly worktree?: boolean;
	readonly worktreeDir?: string;
	readonly worktreeSetup?: readonly string[];
}

export interface LoadedConfig {
	/** The config file, when one was found. */
	readonly path?: string;
	/** The directory config paths are relative to: the file's, or the current directory without one. */
	readonly dir: string;
	readonly task: TaskConfig;
	/** The granted delegates, each `context` entry absolute; `{}` grants nothing. */
	readonly delegates: DelegateGrants;
}

/** A config the CLI refuses to run with. Exit 2. */
export class ConfigError extends Error {
	override readonly name = "ConfigError";
}

/** The nearest `agentscript.config.json`: `cwd`, then each parent up to the root. */
export function findConfig(cwd: string): string | undefined {
	let dir = resolve(cwd);
	for (;;) {
		const candidate = join(dir, CONFIG_FILE);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

function matches(kind: FieldKind, value: unknown): boolean {
	switch (kind) {
		case "string":
			return typeof value === "string";
		case "strings":
			return Array.isArray(value) && value.every((item) => typeof item === "string");
		case "positive-integer":
			return typeof value === "number" && Number.isInteger(value) && value >= 1;
		case "recipient":
			return value === "principal" || value === "agent";
		case "boolean":
			return typeof value === "boolean";
	}
}

/** Validate a parsed config file's `task` object, naming the first bad key. */
export function validateTaskConfig(value: unknown, path: string): TaskConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ConfigError(`${path}: "task" must be an object`);
	}
	for (const key of RETIRED) {
		if (Object.hasOwn(value, key)) throw new ConfigError(`${path}: task.${key}: moved: grant a delegate under "delegates" instead`);
	}
	for (const [key, field] of Object.entries(value)) {
		const kind = (FIELDS as Record<string, FieldKind>)[key];
		if (kind === undefined) {
			throw new ConfigError(`${path}: unknown key "task.${key}" (known: ${Object.keys(FIELDS).join(", ")})`);
		}
		if (!matches(kind, field)) {
			throw new ConfigError(`${path}: "task.${key}" must be ${DESCRIBE[kind]}, got ${JSON.stringify(field)}`);
		}
	}
	return value as TaskConfig;
}

/**
 * Validate a parsed config file's `delegates` object with the grant rules,
 * every grant before any is returned. The grants come back as written (no
 * defaults filled in), with each `context` entry resolved against `dir`.
 */
export function validateDelegates(value: unknown, path: string, dir: string): DelegateGrants {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ConfigError(`${path}: "delegates" must be an object`);
	}
	const grants = value as DelegateGrants;
	try {
		validateGrants(grants, defaultRunners);
	} catch (error) {
		if (error instanceof DelegateGrantError) throw new ConfigError(`${path}: ${error.message}`);
		throw error;
	}
	return Object.fromEntries(
		Object.entries(grants).map(([name, grant]): [string, DelegateGrant] => {
			const copy: Record<string, unknown> = structuredClone(grant);
			const context = copy["context"];
			if (Array.isArray(context)) copy["context"] = context.map((entry: string) => resolve(dir, entry));
			return [name, copy as DelegateGrant];
		}),
	);
}

/** The nearest config's `task` and `delegates` objects, or empty ones when there is no config. */
export function loadConfig(cwd: string): LoadedConfig {
	const path = findConfig(cwd);
	if (path === undefined) return { dir: resolve(cwd), task: {}, delegates: {} };
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new ConfigError(`${path}: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ConfigError(`${path}: the file must hold a JSON object`);
	}
	const dir = dirname(path);
	const task = (parsed as Record<string, unknown>)["task"];
	const delegates = (parsed as Record<string, unknown>)["delegates"];
	return {
		path,
		dir,
		task: task === undefined ? {} : validateTaskConfig(task, path),
		delegates: delegates === undefined ? {} : validateDelegates(delegates, path, dir),
	};
}

/** The bundled scripts by name. */
export const BUNDLED_SCRIPT_NAMES: Readonly<Record<string, URL>> = {
	task: BUNDLED_SCRIPTS.task,
	"task-delegate": BUNDLED_SCRIPTS.delegate,
};

/** The bundled group judge script's name. */
export const BUNDLED_GROUP_SCRIPT = "group";

/** A resolved script: a bundled one's file, or a `.agent` file that exists. */
export interface ResolvedScript {
	/** As given: the bundled name or the path. */
	readonly label: string;
	/** Absolute. */
	readonly path: string;
}

/**
 * `task` or `task-delegate` select the bundled script; anything else is a path
 * relative to `base`. A path that does not exist refuses the run.
 */
export function resolveScript(value: string, base: string): ResolvedScript {
	const bundled = BUNDLED_SCRIPT_NAMES[value];
	if (bundled !== undefined) return { label: value, path: fileURLToPath(bundled) };
	const path = resolve(base, value);
	if (!existsSync(path)) throw new ConfigError(`the script ${value} does not exist (looked for ${path})`);
	return { label: value, path };
}

/**
 * `group` selects the bundled group judge script; anything else is a path
 * relative to `base`. A path that does not exist refuses the run.
 */
export function resolveGroupScript(value: string, base: string): ResolvedScript {
	if (value === BUNDLED_GROUP_SCRIPT) return { label: value, path: fileURLToPath(BUNDLED_SCRIPTS.group) };
	const path = resolve(base, value);
	if (!existsSync(path)) throw new ConfigError(`the group script ${value} does not exist (looked for ${path})`);
	return { label: value, path };
}

/** The flags `run` reads, as parsed; each undefined when not given. */
export interface RunFlags {
	readonly db?: string;
	readonly script?: string;
	readonly groupScript?: string;
	readonly maxReworks?: number;
	readonly workspace?: string;
	readonly check?: readonly string[];
	readonly allow?: readonly string[];
	readonly maxIterations?: number;
	readonly escalateTo?: "principal" | "agent";
	readonly provider?: string;
	readonly model?: string;
	readonly allowDirty?: boolean;
	readonly worktree?: boolean;
}

/** A database: the path to open, and how messages and hints name it (as given, or absolute from the config). */
export interface DbPath {
	readonly path: string;
	readonly label: string;
}

/** Every value `run` runs with, resolved flag → environment → config → default. Paths absolute. */
export interface RunSettings {
	readonly changesDir: string;
	/** Undefined when neither `--db` nor the config gives one (or worktree mode without `--db`). */
	readonly db?: DbPath;
	readonly provider: string;
	readonly model: string;
	readonly script: ResolvedScript;
	/** Not resolved here: only a group run needs the file, so a task run never refuses over it. Pass to `resolveGroupScript`. */
	readonly groupScript: { readonly value: string; readonly base: string };
	readonly workspace: string;
	readonly checks: readonly string[];
	readonly allow: readonly string[];
	readonly maxIterations: number;
	readonly maxReworks: number;
	readonly escalateTo: "principal" | "agent";
	readonly requireCleanTree: boolean;
	readonly worktree: boolean;
	/** Absolute; undefined means the default beside the repository. */
	readonly worktreeDir?: string;
	readonly worktreeSetup: readonly string[];
}

/**
 * Resolve each value on its own. Flag paths are relative to `cwd`, config paths
 * to the config's directory. In worktree mode only `--db` names the database.
 */
export function resolveRunSettings(
	flags: RunFlags,
	env: Readonly<Record<string, string | undefined>>,
	config: Pick<LoadedConfig, "dir" | "task">,
	cwd: string,
): RunSettings {
	const task = config.task;
	const fromConfig = (path: string) => resolve(config.dir, path);
	const worktree = flags.worktree ?? task.worktree ?? false;
	const db = worktree && flags.db === undefined ? undefined : resolveDb(flags.db, config, cwd);
	const script =
		flags.script !== undefined
			? resolveScript(flags.script, cwd)
			: task.script !== undefined
				? resolveScript(task.script, config.dir)
				: resolveScript("task", config.dir);
	return {
		changesDir: fromConfig(task.changesDir ?? DEFAULT_CHANGES_DIR),
		...(db !== undefined ? { db } : {}),
		provider: flags.provider ?? env["AGENTSCRIPT_PROVIDER"] ?? task.provider ?? DEFAULT_PROVIDER,
		model: flags.model ?? env["AGENTSCRIPT_MODEL"] ?? task.model ?? DEFAULT_MODEL,
		script,
		groupScript:
			flags.groupScript !== undefined
				? { value: flags.groupScript, base: cwd }
				: { value: task.groupScript ?? BUNDLED_GROUP_SCRIPT, base: config.dir },
		workspace: resolve(cwd, flags.workspace ?? "."),
		checks: flags.check ?? task.checks ?? [],
		allow: flags.allow ?? task.allow ?? [],
		maxIterations: flags.maxIterations ?? task.maxIterations ?? DEFAULT_MAX_ITERATIONS,
		maxReworks: flags.maxReworks ?? task.maxReworks ?? DEFAULT_MAX_REWORKS,
		escalateTo: flags.escalateTo ?? task.escalateTo ?? DEFAULT_ESCALATE_TO,
		requireCleanTree: flags.allowDirty === true ? false : (task.requireCleanTree ?? true),
		worktree,
		...(task.worktreeDir !== undefined ? { worktreeDir: fromConfig(task.worktreeDir) } : {}),
		worktreeSetup: task.worktreeSetup ?? [],
	};
}

/** The database `resume`, `answer` and `status` use: `--db`, else the config's. */
export function resolveDb(flag: string | undefined, config: Pick<LoadedConfig, "dir" | "task">, cwd: string): DbPath | undefined {
	if (flag !== undefined) return { path: resolve(cwd, flag), label: flag };
	if (config.task.db === undefined) return undefined;
	const path = resolve(config.dir, config.task.db);
	return { path, label: path };
}
