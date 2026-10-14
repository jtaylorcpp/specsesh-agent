#!/usr/bin/env node
/**
 * agentscript-change — what happens to an OpenSpec change, addressed by change,
 * never by loop. Each command finds the change's loop itself and ends with the
 * command to run next.
 *
 *   agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]
 *   agentscript-change approve <change> [--principal <name>] [--db <path>]
 *   agentscript-change build <change> [<answer>|--amend] [--change-check <command>]... [--allow-dirty] [--db <path>] [options]
 *   agentscript-change close <change> [--db <path>]
 *
 * `draft` starts, continues or answers the change's draft loop (`task/cmd-draft.ts`);
 * `approve` approves the stage under review (`task/cmd-approve.ts`). Both print
 * `formatDraftOutput` (`task/change-output.ts`). The database comes from `--db` or
 * the nearest `agentscript.config.json`, the model from
 * `AGENTSCRIPT_PROVIDER`/`AGENTSCRIPT_MODEL` or the config, as `agentscript-task`
 * resolves them. Feedback and approvals are given as the principal: `--principal`
 * (approve only), else `git config user.name`, else `$USER`.
 *
 * `build` starts, continues or answers the change's change loop (`task/cmd-build.ts`)
 * and prints `formatBuildOutput`. It takes the group run's flags, resolved as
 * `agentscript-task run` resolves them, and its harness is `agentscript-task`'s with
 * the change loop installed beside the task and group loops.
 *
 * `close` folds a finished change into `openspec/specs/` (`task/cmd-close.ts`). It needs
 * no model, and reads the database, when there is one, only for the change's newest loop.
 *
 * Headless: it never reads stdin and never prompts. Every refusal exits 2 before
 * the database opens, except those `runDraft`, `runApprove`, `runBuild` and `runClose` find in
 * the database or the tree. A review, a drafted, a built or a closed change exits 0; a question,
 * a waiting build or a failed draft or build exits 1.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type ModelRef } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { DelegateGrantError } from "../durable/delegation.js";
import { createAgentHarness } from "../durable/harness.js";
import { defaultRunners, localWorkspace } from "../node/index.js";
import { GroupLoop, TaskLoop, draftLoopExtensions } from "../task/index.js";
import { ChangeLoop } from "../task/change-api.js";
import { formatBuildOutput, formatDraftOutput } from "../task/change-output.js";
import { prepareApprove, runApprove, type ApproveArgs } from "../task/cmd-approve.js";
import { parseBuild, prepareBuild, runBuild, type BuildArgs } from "../task/cmd-build.js";
import { prepareClose, runClose, type CloseArgs, type CloseResult } from "../task/cmd-close.js";
import { prepareDraft, runDraft, type DraftRequest } from "../task/cmd-draft.js";
import { ConfigError, DEFAULT_CHANGES_DIR, DEFAULT_MODEL, DEFAULT_PROVIDER, loadConfig, resolveDb, resolveNamedModels, type DbPath, type LoadedConfig } from "../task/config.js";
import { gitUserName } from "../task/git.js";
import { DatabaseLockedError, lockDatabase } from "../task/lock.js";
import type { SpecStage } from "../task/spec-stage.js";
import { SPEC_STAGES } from "../task/spec-stages.js";
import { readSlices, type Slice } from "../task/stages/slices-md.js";
import { builtin, resolvePrincipal } from "./agentscript-task.js";

/** One line per command. */
const USAGE = `usage:
  agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]
  agentscript-change approve <change> [--principal <name>] [--db <path>]
  agentscript-change build <change> [<answer>|--amend] [--change-check <command>]... [--allow-dirty] [--db <path>] [options]
  agentscript-change close <change> [--db <path>]`;

export interface ChangeCliDeps {
	/** The pi-ai model collection. Defaults to every built-in provider plus claude-code. */
	readonly models?: () => Promise<Models> | Models;
	readonly out?: (line: string) => void;
	readonly err?: (line: string) => void;
	/** The directory the CLI runs in. Defaults to `process.cwd()`. */
	readonly cwd?: string;
	/** The environment it reads. Defaults to `process.env`. */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** The stages a draft runs. Defaults to `SPEC_STAGES`. */
	readonly stages?: readonly SpecStage[];
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function main(argv: readonly string[], deps: ChangeCliDeps = {}): Promise<number> {
	const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
	const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
	const cwd = deps.cwd ?? process.cwd();
	const env = deps.env ?? process.env;
	const usage = (text?: string) => {
		if (text !== undefined) err(text);
		err(USAGE);
		return 2;
	};
	const [command, ...rest] = argv;

	let run: (config: LoadedConfig, io: ChangeIo) => Promise<number>;
	if (command === "draft") {
		let parsed;
		try {
			parsed = parseArgs({
				args: [...rest],
				allowPositionals: true,
				options: {
					intent: { type: "string" },
					"intent-file": { type: "string" },
					db: { type: "string" },
				},
			});
		} catch (error) {
			return usage(message(error));
		}
		const { values, positionals } = parsed;
		const [change, feedback, ...extra] = positionals;
		if (change === undefined) return usage("draft needs a change");
		if (extra.length > 0) return usage(`draft takes a change and at most one feedback, got ${positionals.join(" ")}; quote the feedback`);
		run = (config, io) =>
			draft(
				{
					change,
					...(feedback !== undefined ? { feedback } : {}),
					...(values.intent !== undefined ? { intent: values.intent } : {}),
					...(values["intent-file"] !== undefined ? { intentFile: values["intent-file"] } : {}),
				},
				values.db,
				config,
				io,
			);
	} else if (command === "approve") {
		let parsed;
		try {
			parsed = parseArgs({
				args: [...rest],
				allowPositionals: true,
				options: {
					principal: { type: "string" },
					db: { type: "string" },
				},
			});
		} catch (error) {
			return usage(message(error));
		}
		const { values, positionals } = parsed;
		const [change, ...extra] = positionals;
		if (change === undefined) return usage("approve needs a change");
		if (extra.length > 0) return usage(`approve takes only a change, got ${positionals.join(" ")}`);
		run = (config, io) => approve({ change }, values.principal, values.db, config, io);
	} else if (command === "build") {
		const args = parseBuild(rest);
		if ("kind" in args) {
			if (args.kind === "usage") return usage(args.message);
			err(args.message);
			return args.exitCode;
		}
		run = (config, io) => build(args, config, io);
	} else if (command === "close") {
		let parsed;
		try {
			parsed = parseArgs({ args: [...rest], allowPositionals: true, options: { db: { type: "string" } } });
		} catch (error) {
			return usage(message(error));
		}
		const { values, positionals } = parsed;
		const [change, ...extra] = positionals;
		if (change === undefined) return usage("close needs a change");
		if (extra.length > 0) return usage(`close takes only a change, got ${positionals.join(" ")}`);
		run = (config, io) => close({ change }, values.db, config, io);
	} else {
		return usage();
	}

	let config: LoadedConfig;
	try {
		config = loadConfig(cwd);
	} catch (error) {
		if (error instanceof ConfigError) {
			err(error.message);
			return 2;
		}
		throw error;
	}
	try {
		return await run(config, { out, err, cwd, env, models: deps.models ?? builtin, stages: deps.stages ?? SPEC_STAGES });
	} catch (error) {
		if (error instanceof DatabaseLockedError) {
			err(error.message);
			return 2;
		}
		throw error;
	}
}

interface ChangeIo {
	readonly out: (line: string) => void;
	readonly err: (line: string) => void;
	readonly cwd: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly models: () => Promise<Models> | Models;
	readonly stages: readonly SpecStage[];
}

/** Where a command's loop runs: the database, the model and the collection holding it. */
interface Target {
	readonly db: DbPath;
	readonly model: ModelRef;
	readonly models: Models;
}

const refuser = (io: ChangeIo) => (text: string) => {
	io.err(text);
	return 2;
};

// The workspace is the config's directory, as for `agentscript-task spec`; changes live under its `changesDir`.
const changesDirOf = (config: LoadedConfig) => resolve(config.dir, config.task.changesDir ?? DEFAULT_CHANGES_DIR);

/** The database and the model, as `agentscript-task` resolves them, or why there are none. Opens nothing. */
async function resolveTarget(command: string, dbFlag: string | undefined, config: LoadedConfig, io: ChangeIo): Promise<Target | string> {
	const db = resolveDb(dbFlag, config, io.cwd);
	if (db === undefined) return `${command} needs --db <path>, or a db in agentscript.config.json`;
	const model: ModelRef = {
		provider: io.env["AGENTSCRIPT_PROVIDER"] ?? config.task.provider ?? DEFAULT_PROVIDER,
		modelId: io.env["AGENTSCRIPT_MODEL"] ?? config.task.model ?? DEFAULT_MODEL,
	};
	const models = await io.models();
	if (models.getProvider(model.provider) === undefined || models.getModel(model.provider, model.modelId) === undefined) {
		return `no model "${model.modelId}" on provider "${model.provider}"`;
	}
	return { db, model, models };
}

/** The run options both commands share: the model, the stages, the config's budget and escalation, and the resume hint. */
function loopOptions(request: DraftRequest, target: Target, config: LoadedConfig, io: ChangeIo) {
	return {
		model: target.model,
		stages: io.stages,
		...(config.task.maxIterations !== undefined ? { budget: { maxIterations: config.task.maxIterations } } : {}),
		...(config.task.escalateTo !== undefined ? { escalateTo: config.task.escalateTo } : {}),
		// Before any model call, so a crash still leaves the way back.
		onLoop: (loop: number) => io.err(`draft loop ${loop} — resume with: agentscript-change draft ${request.change} --db ${target.db.label}`),
	};
}

/** Lock and open the database with the draft loop extensions, work on the harness, then close and unlock. */
async function withHarness(request: DraftRequest, target: Target, io: ChangeIo, work: (harness: Harness) => Promise<number>): Promise<number> {
	mkdirSync(dirname(target.db.path), { recursive: true });
	const lock = lockDatabase(target.db.path);
	try {
		const storage = await openNodeSqliteStorage(target.db.path);
		const registry = createRegistry();
		for (const extension of draftLoopExtensions({ workspace: request.workspace, stages: io.stages })) registry.install(extension);
		const harness = await Harness.open(storage, { models: target.models, registry }, BACKGROUND_CONTEXT);
		try {
			return await work(harness);
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
	} finally {
		lock.release();
	}
}

/** `draft <change> [<feedback>]`: the exit code. */
async function draft(args: Parameters<typeof prepareDraft>[0], dbFlag: string | undefined, config: LoadedConfig, io: ChangeIo): Promise<number> {
	const refuse = refuser(io);
	const request = prepareDraft(args, { workspace: config.dir, changesDir: changesDirOf(config), cwd: io.cwd });
	if (request.kind === "refused") return refuse(request.message);
	const target = await resolveTarget("draft", dbFlag, config, io);
	if (typeof target === "string") return refuse(target);
	// Only feedback answers anything, so nothing else asks git for a name.
	const principal = args.feedback !== undefined ? resolvePrincipal(undefined, () => gitUserName(io.cwd), io.env) : undefined;

	return withHarness(request, target, io, async (harness) => {
		const result = await runDraft(
			harness,
			request,
			{ ...loopOptions(request, target, config, io), ...(principal !== undefined ? { principal } : {}) },
			BACKGROUND_CONTEXT,
		);
		if (result.kind === "refused") return refuse(result.message);
		for (const line of formatDraftOutput(result, { changePath: request.changePath })) io.out(line);
		return result.exitCode;
	});
}

/** `approve <change>`: the exit code. */
async function approve(args: ApproveArgs, principalFlag: string | undefined, dbFlag: string | undefined, config: LoadedConfig, io: ChangeIo): Promise<number> {
	const refuse = refuser(io);
	const request = prepareApprove(args, { workspace: config.dir, changesDir: changesDirOf(config) });
	if (request.kind === "refused") return refuse(request.message);
	const target = await resolveTarget("approve", dbFlag, config, io);
	if (typeof target === "string") return refuse(target);
	const principal = resolvePrincipal(principalFlag, () => gitUserName(io.cwd), io.env);

	return withHarness(request, target, io, async (harness) => {
		const result = await runApprove(
			harness,
			request,
			{ ...loopOptions(request, target, config, io), ...(principal !== undefined ? { principal } : {}) },
			BACKGROUND_CONTEXT,
		);
		if (result.kind === "refused") return refuse(result.message);
		const slices = result.approvedStage === "proposal" ? slicesOf(request.changeDir) : undefined;
		for (const line of formatDraftOutput(result, { changePath: request.changePath, ...(slices !== undefined ? { slices } : {}) })) io.out(line);
		return result.exitCode;
	});
}

/** `build <change> [<answer>|--amend]`: the exit code. */
async function build(args: BuildArgs, config: LoadedConfig, io: ChangeIo): Promise<number> {
	const refuse = refuser(io);
	const request = prepareBuild(args, { config, env: io.env, cwd: io.cwd });
	if (request.kind === "refused") return refuse(request.message);
	const models = await io.models();
	const provider = models.getProvider(request.provider);
	if (provider === undefined || models.getModel(request.provider, request.model) === undefined) {
		return refuse(`no model "${request.model}" on provider "${request.provider}"`);
	}
	const model: ModelRef = { provider: request.provider, modelId: request.model };
	let named;
	try {
		named = resolveNamedModels(config.models, models);
	} catch (error) {
		if (error instanceof ConfigError) return refuse(error.message);
		throw error;
	}
	const others = Object.fromEntries(Object.entries(named).map(([name, entry]) => [name, () => ({ provider: entry.provider, model: entry.model })]));

	mkdirSync(dirname(request.db.path), { recursive: true });
	const lock = lockDatabase(request.db.path);
	try {
		const storage = await openNodeSqliteStorage(request.db.path);
		// `agentscript-task`'s harness, with the change loop beside the task and group loops it runs.
		let built;
		try {
			built = await createAgentHarness<Record<string, never>>(
				{
					models: { default: () => ({ provider, model }), ...others },
					workspace: () => localWorkspace(request.workspace),
					checks: request.checks,
					allow: request.allow,
					delegates: request.delegates,
					runners: defaultRunners,
				},
				{ storage, env: {}, extensions: [TaskLoop, GroupLoop, ChangeLoop], context: BACKGROUND_CONTEXT },
			);
		} catch (error) {
			if (error instanceof DelegateGrantError) return refuse(error.message);
			throw error;
		}
		const { harness } = built;
		try {
			const result = await runBuild(
				harness,
				request,
				{
					model: built.models["default"] ?? model,
					// Before any model call, so a crash still leaves the way back: build without an answer resumes a running loop.
					onLoop: (loop) => io.err(`change loop ${loop} — resume with: agentscript-change build ${request.change} --db ${request.db.label}`),
				},
				BACKGROUND_CONTEXT,
			);
			if (result.kind === "refused") return refuse(result.message);
			for (const line of formatBuildOutput(result)) io.out(line);
			return result.exitCode;
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
	} finally {
		lock.release();
	}
}

/** `close <change>`: the exit code. Needs no model; the database, when there is one, is only read for the change loop. */
async function close(args: CloseArgs, dbFlag: string | undefined, config: LoadedConfig, io: ChangeIo): Promise<number> {
	const refuse = refuser(io);
	const request = prepareClose(args, { workspace: config.dir, changesDir: changesDirOf(config) });
	if (request.kind === "refused") return refuse(request.message);
	const db = resolveDb(dbFlag, config, io.cwd);

	const show = (result: CloseResult) => {
		if (result.kind === "refused") return refuse(result.message);
		for (const line of closeLines(result)) io.out(line);
		return result.exitCode;
	};
	// No database, or none yet, holds no change loop: a change built with `pnpm task` closes on its ticked tasks.
	if (db === undefined || !existsSync(db.path)) return show(await runClose(undefined, request, BACKGROUND_CONTEXT));
	const lock = lockDatabase(db.path);
	try {
		const storage = await openNodeSqliteStorage(db.path);
		const harness = await Harness.open(storage, { models: await io.models(), registry: createRegistry() }, BACKGROUND_CONTEXT);
		try {
			return show(await runClose(harness, request, BACKGROUND_CONTEXT));
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
	} finally {
		lock.release();
	}
}

/** A closed change as text, as design.md's session shows it, ending with the commit command. */
function closeLines(result: Extract<CloseResult, { kind: "closed" }>): string[] {
	const folded = result.capabilities.map(({ capability, created, requirements }) => `${capability} (${created ? "new" : `${requirements} modified`})`);
	const list = folded.length < 2 ? folded.join("") : `${folded.slice(0, -1).join(", ")} and ${folded.at(-1)}`;
	return [
		`# ${result.change} — closed`,
		...(folded.length > 0 ? [`Folded into ${list}.`] : []),
		`Moved to ${result.archive}`,
		"",
		"Commit it: git add -A openspec && git commit",
	];
}

/** The entries of the change's `slices.md`, this change first; none when it is missing or has a malformed line. */
function slicesOf(changeDir: string): readonly Slice[] | undefined {
	const path = join(changeDir, "slices.md");
	if (!existsSync(path)) return undefined;
	const slices = readSlices(readFileSync(path, "utf8"));
	return slices.malformed.length === 0 ? slices.entries : undefined;
}

// Run only as the entry point: through a bin symlink argv[1] is the link, so compare real paths.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	// An interrupt still releases the database lock: process.exit runs the lock's exit handler.
	process.once("SIGINT", () => process.exit(130));
	process.once("SIGTERM", () => process.exit(143));
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error: unknown) => {
			process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
			process.exit(1);
		},
	);
}
