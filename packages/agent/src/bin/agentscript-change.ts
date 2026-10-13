#!/usr/bin/env node
/**
 * agentscript-change — what happens to an OpenSpec change, addressed by change,
 * never by loop. Each command finds the change's loop itself and ends with the
 * command to run next.
 *
 *   agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]
 *
 * `draft` starts, continues or answers the change's draft loop (`task/cmd-draft.ts`);
 * its output is `formatDraftOutput` (`task/change-output.ts`). The database comes
 * from `--db` or the nearest `agentscript.config.json`, the model from
 * `AGENTSCRIPT_PROVIDER`/`AGENTSCRIPT_MODEL` or the config, as `agentscript-task`
 * resolves them. Feedback is answered as the principal: `git config user.name`,
 * else `$USER`.
 *
 * Headless: it never reads stdin and never prompts. Every refusal exits 2 before
 * the database opens, except those `runDraft` finds in the database. A review or
 * a drafted change exits 0; a question or a failed draft exits 1.
 */

import { mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type ModelRef } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { draftLoopExtensions } from "../task/index.js";
import { formatDraftOutput } from "../task/change-output.js";
import { prepareDraft, runDraft } from "../task/cmd-draft.js";
import { ConfigError, DEFAULT_CHANGES_DIR, DEFAULT_MODEL, DEFAULT_PROVIDER, loadConfig, resolveDb, type LoadedConfig } from "../task/config.js";
import { gitUserName } from "../task/git.js";
import { DatabaseLockedError, lockDatabase } from "../task/lock.js";
import type { SpecStage } from "../task/spec-stage.js";
import { SPEC_STAGES } from "../task/spec-stages.js";
import { builtin, resolvePrincipal } from "./agentscript-task.js";

/** One line per command. */
const USAGE = `usage:
  agentscript-change draft <change> [<feedback>] [--intent <words>|--intent-file <path>] [--db <path>]`;

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
	if (command !== "draft") return usage();

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
		return await draft(
			{
				change,
				...(feedback !== undefined ? { feedback } : {}),
				...(values.intent !== undefined ? { intent: values.intent } : {}),
				...(values["intent-file"] !== undefined ? { intentFile: values["intent-file"] } : {}),
			},
			values.db,
			config,
			{ out, err, cwd, env, models: deps.models ?? builtin, stages: deps.stages ?? SPEC_STAGES },
		);
	} catch (error) {
		if (error instanceof DatabaseLockedError) {
			err(error.message);
			return 2;
		}
		throw error;
	}
}

interface DraftIo {
	readonly out: (line: string) => void;
	readonly err: (line: string) => void;
	readonly cwd: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly models: () => Promise<Models> | Models;
	readonly stages: readonly SpecStage[];
}

/** `draft <change> [<feedback>]`: the exit code. */
async function draft(args: Parameters<typeof prepareDraft>[0], dbFlag: string | undefined, config: LoadedConfig, io: DraftIo): Promise<number> {
	const refuse = (text: string) => {
		io.err(text);
		return 2;
	};
	// The workspace is the config's directory, as for `agentscript-task spec`; changes live under its `changesDir`.
	const changesDir = resolve(config.dir, config.task.changesDir ?? DEFAULT_CHANGES_DIR);
	const request = prepareDraft(args, { workspace: config.dir, changesDir, cwd: io.cwd });
	if (request.kind === "refused") return refuse(request.message);

	const db = resolveDb(dbFlag, config, io.cwd);
	if (db === undefined) return refuse("draft needs --db <path>, or a db in agentscript.config.json");
	const model: ModelRef = {
		provider: io.env["AGENTSCRIPT_PROVIDER"] ?? config.task.provider ?? DEFAULT_PROVIDER,
		modelId: io.env["AGENTSCRIPT_MODEL"] ?? config.task.model ?? DEFAULT_MODEL,
	};
	const models = await io.models();
	if (models.getProvider(model.provider) === undefined || models.getModel(model.provider, model.modelId) === undefined) {
		return refuse(`no model "${model.modelId}" on provider "${model.provider}"`);
	}
	// Only feedback answers anything, so nothing else asks git for a name.
	const principal = args.feedback !== undefined ? resolvePrincipal(undefined, () => gitUserName(io.cwd), io.env) : undefined;

	mkdirSync(dirname(db.path), { recursive: true });
	const lock = lockDatabase(db.path);
	try {
		const storage = await openNodeSqliteStorage(db.path);
		const registry = createRegistry();
		for (const extension of draftLoopExtensions({ workspace: request.workspace, stages: io.stages })) registry.install(extension);
		const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
		try {
			const result = await runDraft(
				harness,
				request,
				{
					model,
					stages: io.stages,
					...(config.task.maxIterations !== undefined ? { budget: { maxIterations: config.task.maxIterations } } : {}),
					...(config.task.escalateTo !== undefined ? { escalateTo: config.task.escalateTo } : {}),
					...(principal !== undefined ? { principal } : {}),
					// Before any model call, so a crash still leaves the way back.
					onLoop: (loop) => io.err(`draft loop ${loop} — resume with: agentscript-change draft ${request.change} --db ${db.label}`),
				},
				BACKGROUND_CONTEXT,
			);
			if (result.kind === "refused") return refuse(result.message);
			for (const line of formatDraftOutput(result, { changePath: request.changePath })) io.out(line);
			return result.exitCode;
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
	} finally {
		lock.release();
	}
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
