/**
 * The repo config: `agentscript.config.json`, found by walking up from the
 * current directory, of which only the `task`, `delegates` and `models` objects are read.
 *
 * Every field is optional and typed. An unknown key or a wrongly typed value
 * refuses the run, naming the key and the file: a typo must never fall back
 * to a default silently. Values resolve field by field as flag, then
 * environment (`AGENTSCRIPT_PROVIDER`, `AGENTSCRIPT_MODEL`), then config, then
 * default; paths from the config are relative to the config's directory.
 * `delegates` maps grant names to `DelegateGrant`s, checked whole against
 * `defaultRunners`; without it, nothing is granted. An agent grant's `script`
 * (`read`, `edit` or a path) is read here, once. `models` names more models
 * beside the run's own, `default`.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Models, Provider } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import { EDIT_AGENT, READ_AGENT } from "../durable/delegate-scripts.js";
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
	/** The granted delegates, each `context` entry absolute and each agent `script` its source; `{}` grants nothing. */
	readonly delegates: DelegateGrants;
	/** The named models beside `default`; `{}` names none. */
	readonly models: NamedModels;
}

/** One entry of the `models` object. */
export interface NamedModel {
	readonly provider: string;
	readonly model: string;
}

export type NamedModels = Readonly<Record<string, NamedModel>>;

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
			const script = copy["script"];
			if (copy["runner"] === "agent" && typeof script === "string") copy["script"] = agentScript(script, name, path, dir);
			return [name, copy as DelegateGrant];
		}),
	);
}

/** The bundled delegate scripts by name. */
export const BUNDLED_DELEGATE_SCRIPTS: Readonly<Record<string, string>> = { read: READ_AGENT, edit: EDIT_AGENT };

/** An agent grant's script source: `read` or `edit`, else the file at a path relative to `dir`. */
function agentScript(value: string, grant: string, path: string, dir: string): string {
	const bundled = Object.hasOwn(BUNDLED_DELEGATE_SCRIPTS, value) ? BUNDLED_DELEGATE_SCRIPTS[value] : undefined;
	if (bundled !== undefined) return bundled;
	const file = resolve(dir, value);
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		const problem = code === "ENOENT" ? "does not exist" : `cannot be read (${error instanceof Error ? error.message : String(error)})`;
		throw new ConfigError(`${path}: delegate grant "${grant}": script ${value} ${problem} (looked for ${file})`);
	}
}

const MODEL_KEYS = ["provider", "model"] as const;

/** Validate a parsed config file's `models` object: names other than `default`, each exactly `{ provider, model }`. */
export function validateModels(value: unknown, path: string): NamedModels {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ConfigError(`${path}: "models" must be an object`);
	}
	for (const [name, entry] of Object.entries(value)) {
		if (name === "default") {
			throw new ConfigError(`${path}: "models.default" cannot be redefined: default is the run's own provider and model`);
		}
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			throw new ConfigError(`${path}: "models.${name}" must be an object with provider and model`);
		}
		for (const key of Object.keys(entry)) {
			if (!(MODEL_KEYS as readonly string[]).includes(key)) {
				throw new ConfigError(`${path}: unknown key "models.${name}.${key}" (known: ${MODEL_KEYS.join(", ")})`);
			}
		}
		for (const key of MODEL_KEYS) {
			const field = (entry as Record<string, unknown>)[key];
			if (typeof field !== "string") throw new ConfigError(`${path}: "models.${name}.${key}" must be a string, got ${JSON.stringify(field)}`);
		}
	}
	return value as NamedModels;
}

/** A named model as the harness takes it: the provider that serves it, and its ref. */
export interface ResolvedModel {
	readonly provider: Provider;
	readonly model: ModelRef;
}

/**
 * Each named model through `models`, as the run's own provider and model are
 * resolved. An unknown provider or model refuses the run, naming it.
 */
export function resolveNamedModels(named: NamedModels, models: Pick<Models, "getProvider" | "getModel">): Record<string, ResolvedModel> {
	return Object.fromEntries(
		Object.entries(named).map(([name, entry]): [string, ResolvedModel] => {
			const provider = models.getProvider(entry.provider);
			if (provider === undefined) throw new ConfigError(`models.${name}: no provider "${entry.provider}"`);
			if (models.getModel(entry.provider, entry.model) === undefined) {
				throw new ConfigError(`models.${name}: no model "${entry.model}" on provider "${entry.provider}"`);
			}
			return [name, { provider, model: { provider: entry.provider, modelId: entry.model } }];
		}),
	);
}

/** The nearest config's `task`, `delegates` and `models` objects, or empty ones when there is no config. */
export function loadConfig(cwd: string): LoadedConfig {
	const path = findConfig(cwd);
	if (path === undefined) return { dir: resolve(cwd), task: {}, delegates: {}, models: {} };
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
	const models = (parsed as Record<string, unknown>)["models"];
	return {
		path,
		dir,
		task: task === undefined ? {} : validateTaskConfig(task, path),
		delegates: delegates === undefined ? {} : validateDelegates(delegates, path, dir),
		models: models === undefined ? {} : validateModels(models, path),
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

/** The `parseArgs` options of the flags a group run maps onto `RunFlags`, shared by every command that starts one. */
export const RUN_FLAG_OPTIONS = {
	db: { type: "string" },
	script: { type: "string" },
	workspace: { type: "string" },
	check: { type: "string", multiple: true },
	allow: { type: "string", multiple: true },
	"max-iterations": { type: "string" },
	"max-reworks": { type: "string" },
	"group-script": { type: "string" },
	"escalate-to": { type: "string" },
	provider: { type: "string" },
	model: { type: "string" },
	"allow-dirty": { type: "boolean", default: false },
	worktree: { type: "boolean" },
	"no-delegates": { type: "boolean", default: false },
} as const;

/**
 * The parsed values of `RUN_FLAG_OPTIONS` as `RunFlags`, without `worktree` (each command
 * decides it), or the usage error for a malformed number or recipient.
 */
export function runFlagsOf(values: Readonly<Record<string, string | boolean | string[] | undefined>>): Omit<RunFlags, "worktree"> | string {
	const maxIterations = values["max-iterations"] as string | undefined;
	if (maxIterations !== undefined && !/^[1-9][0-9]*$/.test(maxIterations)) {
		return `--max-iterations must be a positive integer, got "${maxIterations}"`;
	}
	const maxReworks = values["max-reworks"] as string | undefined;
	if (maxReworks !== undefined && !/^[1-9][0-9]*$/.test(maxReworks)) {
		return `--max-reworks must be a positive integer, got "${maxReworks}"`;
	}
	const escalateTo = values["escalate-to"] as string | undefined;
	if (escalateTo !== undefined && escalateTo !== "principal" && escalateTo !== "agent") {
		return `--escalate-to must be principal or agent, got "${escalateTo}"`;
	}
	return {
		...(values["db"] !== undefined ? { db: values["db"] as string } : {}),
		...(values["script"] !== undefined ? { script: values["script"] as string } : {}),
		...(values["workspace"] !== undefined ? { workspace: values["workspace"] as string } : {}),
		...(values["check"] !== undefined ? { check: values["check"] as string[] } : {}),
		...(values["allow"] !== undefined ? { allow: values["allow"] as string[] } : {}),
		...(values["group-script"] !== undefined ? { groupScript: values["group-script"] as string } : {}),
		...(maxIterations !== undefined ? { maxIterations: Number(maxIterations) } : {}),
		...(maxReworks !== undefined ? { maxReworks: Number(maxReworks) } : {}),
		...(escalateTo !== undefined ? { escalateTo } : {}),
		...(values["provider"] !== undefined ? { provider: values["provider"] as string } : {}),
		...(values["model"] !== undefined ? { model: values["model"] as string } : {}),
		allowDirty: values["allow-dirty"] === true,
	};
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
