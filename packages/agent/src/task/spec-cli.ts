/**
 * `specsesh task spec <change> [<stage>]`: run one stage of a change's spec
 * loop, in place, until it blocks for the principal's review.
 *
 *   spec <change> [<stage>] [--intent <words>|--intent-file <path>] [--db <path>] [--json]
 *
 * With no stage, the first in `stages` without a current approval runs. A new
 * change needs an intent: its directory is created and `intent.md` holds the
 * words verbatim. An existing `intent.md` is never overwritten. Unlike `run`,
 * spec never checks that the tree is clean: drafting a change is expected to
 * happen beside uncommitted work.
 *
 * Every refusal (exit 2) comes before the database or the harness opens, except
 * `startSpecLoop`'s own, after which the harness is closed. A review exits 0:
 * waiting for the principal is the expected end of a stage.
 *
 * Once the loop exists, the resume hint is the first stderr line; the spec
 * events follow it as JSON Lines when the loop settles, before the outcome.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type ModelRef } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { LoopOutcome } from "../openspec/index.js";
import { GEMINI_PROVIDER, type GeminiEnv, type RegisterGeminiResult } from "../pi/gemini.js";
import { OLLAMA_PROVIDER_ID, type RegisterOllamaResult } from "../pi/ollama.js";
import { DEFAULT_CHANGES_DIR, DEFAULT_MODEL, DEFAULT_PROVIDER, resolveDb, type LoadedConfig } from "./config.js";
import { ApprovalsFileError } from "./errors.js";
import { jsonLines, now, specEvents } from "./events.js";
import { lockDatabase } from "./lock.js";
import { hashOwnedFiles, readApprovals, type ApprovalEntry, type ApprovalStage } from "./spec-approvals.js";
import { specLoopExtensions, startSpecLoop, waitForSpecLoop } from "./spec-api.js";
import type { StageOutcome } from "./spec-loop.js";
import type { SpecStage } from "./spec-stage.js";
import { SPEC_STAGES } from "./spec-stages.js";
import { readSlices, type Slice } from "./stages/slices-md.js";

export const INTENT_FILE = "intent.md";
const SLICES_FILE = "slices.md";
/** The command every printed hint and next step names. */
const CMD = "specsesh task";

export interface SpecIo {
	readonly out: (line: string) => void;
	readonly err: (line: string) => void;
	/** The directory the CLI runs in: `--intent-file` and `--db` resolve against it. */
	readonly cwd: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	/** The pi-ai model collection the stage runs on. */
	readonly models: () => Promise<Models> | Models;
	/** Adds `ollama` to `models` when a ref is on it (the bins' `withOllama`), before the model is checked. */
	readonly withOllama?: (models: Models, refs: readonly ModelRef[]) => Promise<RegisterOllamaResult | undefined>;
	/** Points `google` at its URL and checks its key when a ref is on it (the bins' `withGemini`), before the model is checked. */
	readonly withGemini?: (models: Models, refs: readonly ModelRef[], env: GeminiEnv) => Promise<RegisterGeminiResult | undefined>;
	/** The stages, in order. Defaults to `SPEC_STAGES`. */
	readonly stages?: readonly SpecStage[];
}

/** 0 when the loop converged or waits for review; 1 when it blocked on a question, exhausted or failed. */
export function specExitCode(outcome: Pick<LoopOutcome<StageOutcome>, "status"> & { readonly escalation?: { readonly reason: string } }): number {
	if (outcome.status === "converged") return 0;
	return outcome.status === "blocked" && outcome.escalation?.reason === "review" ? 0 : 1;
}

/** The stage's approval when its recorded hashes match its owned files now; undefined otherwise. */
export function currentApproval(approvals: readonly ApprovalEntry[], stage: ApprovalStage, changeDir: string): ApprovalEntry | undefined {
	const entry = approvals.find((existing) => existing.stage === stage.name);
	if (entry === undefined) return undefined;
	const now = hashOwnedFiles(stage, changeDir);
	const recorded = Object.entries(entry.files);
	const same = recorded.length === Object.keys(now).length && recorded.every(([file, hash]) => now[file] === hash);
	return same ? entry : undefined;
}

export interface SpecOutcomeContext {
	readonly loop: number | string;
	readonly change: string;
	/** The change directory as the output names it: under the config's `changesDir`, relative to the workspace. */
	readonly changePath: string;
	/** Who approved, for an approval. */
	readonly principal?: string;
	/** The next stage without a current approval, after an approval; none when every stage is approved. */
	readonly nextStage?: string;
	/** Every entry of `slices.md`, this change first, after an approved proposal that sliced its intent. */
	readonly slices?: readonly Pick<Slice, "id" | "intent">[];
}

/** `s` in double quotes, with `"`, `\`, `$` and `` ` `` escaped, so the printed command pastes safely. */
const shellQuote = (s: string) => `"${s.replace(/["\\$`]/g, "\\$&")}"`;

/** The last line once every stage is approved. */
export const allApproved = (change: string) => `Every stage of ${change} is approved. Execute it: ${CMD} ${change} --next-group`;

/** A settled spec loop as text, ending with the next step. */
export function formatSpecOutcome(outcome: LoopOutcome<StageOutcome>, context: SpecOutcomeContext): string[] {
	const { loop, change } = context;
	const reason = outcome.status === "blocked" ? ` (${outcome.escalation.reason})` : outcome.result?.approved === true ? " (approved)" : "";
	const lines = [`# spec loop ${loop} — ${outcome.status}${reason}`];
	const stage = outcome.result?.stage ?? "stage";
	for (const iteration of outcome.iterations) {
		const issues = iteration.evidence.flatMap((evidence) => (evidence.kind === "validation" ? evidence.report.issues : []));
		lines.push(`## ${stage} draft ${iteration.n}: ${issues.length === 0 ? "clean" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}`);
		for (const issue of issues) lines.push(`   ${issue.level} ${issue.path}: ${issue.message}`);
	}
	if (outcome.status === "blocked" && outcome.escalation.reason === "review") {
		const files = (outcome.result?.files ?? []).map((file) => `${context.changePath}/${file}`);
		lines.push(
			"",
			`Review ${files.join(", ")}, then:`,
			`  approve:  ${CMD} answer ${loop} --by principal --decision approve`,
			`  revise:   ${CMD} answer ${loop} --by principal --decision "<what to change>"`,
		);
	} else if (outcome.status === "blocked") {
		lines.push(
			"",
			`question: ${outcome.escalation.question}`,
			`  answer:   ${CMD} answer ${loop} --by ${outcome.escalation.to} --decision "<your answer>"`,
		);
	} else if (outcome.status === "converged" && outcome.result.approved) {
		lines.push(`${outcome.result.stage} approved${context.principal !== undefined ? ` by ${context.principal}` : ""}.`);
		lines.push(context.nextStage !== undefined ? `Next: ${CMD} spec ${change}` : allApproved(change));
		const later = outcome.result.stage === "proposal" ? (context.slices ?? []).slice(1) : [];
		if (later.length > 0) {
			lines.push("", `Sliced into ${context.slices?.length} changes. Start the others when you're ready:`);
			for (const slice of later) lines.push(`  ${CMD} spec ${slice.id} --intent ${shellQuote(slice.intent)}`);
		}
	}
	return lines;
}

/** The script `stage-started` names: the stage script's file name without `.agent`, or `custom` for inline text. */
export function stageScriptLabel(stage: Pick<SpecStage, "script"> | undefined): string {
	return stage !== undefined && "path" in stage.script ? basename(stage.script.path, ".agent") : "custom";
}

/** A settled spec loop's events, as JSON Lines through `write`; `earlier` drafts were streamed by the run it answers. */
export function streamSpecEvents(
	write: (line: string) => void,
	loop: number,
	start: { readonly change: string; readonly stage: string; readonly script: string; readonly at: string },
	outcome: LoopOutcome<StageOutcome>,
	earlier = 0,
): void {
	const emit = jsonLines(write);
	for (const event of specEvents(loop, start, outcome, earlier)) emit(event);
}

/** A change id is one directory name under the config's `changesDir`. */
const isChangeId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");

/** `path` as output names it: relative to `workspace` when under it, else absolute. */
export const shownPath = (workspace: string, path: string): string => {
	const rel = relative(workspace, path);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : path;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `spec <change> [<stage>]`: the exit code. */
export async function runSpec(args: readonly string[], config: LoadedConfig, io: SpecIo): Promise<number> {
	const stages = io.stages ?? SPEC_STAGES;
	const refuse = (text: string) => {
		io.err(text);
		return 2;
	};

	let parsed;
	try {
		parsed = parseArgs({
			args: [...args],
			allowPositionals: true,
			options: {
				intent: { type: "string" },
				"intent-file": { type: "string" },
				db: { type: "string" },
				json: { type: "boolean", default: false },
				worktree: { type: "boolean" },
			},
		});
	} catch (error) {
		return refuse(message(error));
	}
	const { values, positionals } = parsed;
	const [change, stageName, ...extra] = positionals;
	if (change === undefined) return refuse("spec needs a change: spec <change> [<stage>]");
	if (extra.length > 0) return refuse(`spec takes a change and at most one stage, got ${positionals.join(" ")}`);
	const workspace = config.dir;
	const changesDir = resolve(config.dir, config.task.changesDir ?? DEFAULT_CHANGES_DIR);
	if (!isChangeId(change)) return refuse(`"${change}" is not a change id: give the directory name under ${shownPath(workspace, changesDir)}/`);
	if (values.worktree !== undefined) return refuse("spec runs in place; --worktree is not supported");
	if (values.intent !== undefined && values["intent-file"] !== undefined) return refuse("give --intent or --intent-file, not both");
	const named = stageName !== undefined ? stages.find((stage) => stage.name === stageName) : undefined;
	if (stageName !== undefined && named === undefined) {
		return refuse(`unknown stage ${stageName}; stages: ${stages.map((stage) => stage.name).join(", ")}`);
	}

	let given: string | undefined = values.intent;
	if (values["intent-file"] !== undefined) {
		try {
			given = readFileSync(resolve(io.cwd, values["intent-file"]), "utf8");
		} catch (error) {
			return refuse(`cannot read --intent-file: ${message(error)}`);
		}
	}

	const changeDir = join(changesDir, change);
	const changePath = shownPath(workspace, changeDir);
	const intentPath = join(changeDir, INTENT_FILE);
	const exists = existsSync(changeDir);
	if (!exists && given === undefined) return refuse(`the change ${change} does not exist; give --intent or --intent-file`);
	if (exists && given !== undefined && existsSync(intentPath)) return refuse(`${INTENT_FILE} exists; edit it instead (${changePath}/${INTENT_FILE})`);
	if (exists && given === undefined && !existsSync(intentPath)) {
		return refuse(`${changePath} has no ${INTENT_FILE}; give --intent or --intent-file`);
	}

	let approvals: ApprovalEntry[] = [];
	if (exists) {
		try {
			approvals = readApprovals(changeDir).approvals;
		} catch (error) {
			if (error instanceof ApprovalsFileError) return refuse(`${changePath}/${error.message}`);
			throw error;
		}
	}
	const current = (stage: SpecStage) => currentApproval(approvals, stage, changeDir) !== undefined;
	const stage = named ?? stages.find((candidate) => !current(candidate));
	if (stage === undefined) {
		io.out(allApproved(change));
		return 0;
	}

	const db = resolveDb(values.db, config, io.cwd);
	if (db === undefined) return refuse("spec needs --db <path>, or a db in agentscript.config.json");
	const model: ModelRef = {
		provider: io.env["AGENTSCRIPT_PROVIDER"] ?? config.task.provider ?? DEFAULT_PROVIDER,
		modelId: io.env["AGENTSCRIPT_MODEL"] ?? config.task.model ?? DEFAULT_MODEL,
	};
	const models = await io.models();
	const namedRefs = Object.values(config.models).map((entry): ModelRef => ({ provider: entry.provider, modelId: entry.model }));
	const ollama = await io.withOllama?.(models, [model, ...namedRefs]);
	const gemini = await io.withGemini?.(models, [model, ...namedRefs], io.env);
	if (gemini !== undefined && !gemini.ok) return refuse(`${GEMINI_PROVIDER}: ${gemini.reason}`);
	if (models.getProvider(model.provider) === undefined || models.getModel(model.provider, model.modelId) === undefined) {
		const unreachable = model.provider === OLLAMA_PROVIDER_ID && ollama?.ok === false ? ` (Ollama at ${ollama.baseUrl}: ${ollama.reason})` : "";
		return refuse(`no model "${model.modelId}" on provider "${model.provider}"${unreachable}`);
	}

	// Only now is anything written: the change, its intent, then the database.
	if (given !== undefined && !existsSync(intentPath)) {
		mkdirSync(changeDir, { recursive: true });
		writeFileSync(intentPath, given);
	}
	const intent = readFileSync(intentPath, "utf8");
	const approved = stages.filter((other) => other !== stage && current(other)).flatMap((other) => other.owns.map((path) => path));

	mkdirSync(dirname(db.path), { recursive: true });
	const lock = lockDatabase(db.path);
	try {
		const storage = await openNodeSqliteStorage(db.path);
		const registry = createRegistry();
		for (const extension of specLoopExtensions({ workspace, stages })) registry.install(extension);
		const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
		try {
			let id;
			try {
				id = await startSpecLoop(
					harness,
					{
						change,
						stage,
						intent,
						workspace,
						changesDir,
						approved,
						...(config.task.maxIterations !== undefined ? { budget: { maxIterations: config.task.maxIterations } } : {}),
						...(config.task.escalateTo !== undefined ? { escalateTo: config.task.escalateTo } : {}),
						model,
					},
					BACKGROUND_CONTEXT,
				);
			} catch (error) {
				return refuse(message(error));
			}
			// Before any model call, so a crash still leaves you the ID to resume.
			io.err(`loop ${id} — resume with: ${CMD} resume ${id} --db ${db.label}`);
			const at = now();
			harness.resume();
			let outcome: LoopOutcome<StageOutcome>;
			try {
				outcome = await waitForSpecLoop(harness, id, BACKGROUND_CONTEXT);
			} catch (error) {
				io.err(message(error));
				return 1;
			}
			streamSpecEvents(io.err, Number(id), { change, stage: stage.name, script: stageScriptLabel(stage), at }, outcome);
			if (values.json === true) io.out(JSON.stringify({ loop: id, ...outcome }, null, 2));
			else for (const line of formatSpecOutcome(outcome, { loop: String(id), change, changePath, ...after(outcome, stages, changeDir) })) io.out(line);
			return specExitCode(outcome);
		} finally {
			await harness.close(BACKGROUND_CONTEXT);
		}
	} finally {
		lock.release();
	}
}

/**
 * After an approval: who approved, read from `approvals.json`, the next stage still to run and,
 * for a proposal, the entries of `slices.md`. A `slices.md` with any malformed line lists none.
 */
export function after(
	outcome: LoopOutcome<StageOutcome>,
	stages: readonly SpecStage[],
	changeDir: string,
): Pick<SpecOutcomeContext, "principal" | "nextStage" | "slices"> {
	if (outcome.status !== "converged" || !outcome.result.approved) return {};
	const { approvals } = readApprovals(changeDir);
	const principal = approvals.find((entry) => entry.stage === outcome.result.stage)?.principal;
	const nextStage = stages.find((stage) => currentApproval(approvals, stage, changeDir) === undefined)?.name;
	const slicesPath = join(changeDir, SLICES_FILE);
	const slices = outcome.result.stage === "proposal" && existsSync(slicesPath) ? readSlices(readFileSync(slicesPath, "utf8")) : undefined;
	return {
		...(principal !== undefined ? { principal } : {}),
		...(nextStage !== undefined ? { nextStage } : {}),
		...(slices !== undefined && slices.malformed.length === 0 ? { slices: slices.entries } : {}),
	};
}
