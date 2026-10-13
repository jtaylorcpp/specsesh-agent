/**
 * The spec loop as one pi-durable task, `agentscript.spec-loop`: a stage script
 * drafts one artifact of a change, once per iteration as an `agentscript.run`
 * child, and the stage's gate checks it with no model.
 *
 *   iterate  read the owned files now (`current`), seed the contract, create the
 *            child with `next_action` choices `review` and `ask`; wait on it, in one commit
 *   await    read the settled child back (by its ID, so a resumed loop waits for
 *            the same run and starts no other)
 *   write    write the bundle's owned sections into the change directory, the rest
 *            becoming issues; `ask` ends the loop blocked here, before the gate
 *   gate     write issues plus the stage's gate: none at ERROR or WARNING blocks
 *            for the principal's review, else the issues carry into the next
 *            iteration or the budget is exhausted
 *
 * A stage's `seed` and `gate` are functions, which no checkpoint can hold: the
 * durable input keeps the stage's name and owned paths, and the task resolves
 * the rest by name (`specLoopTask(resolve)`, or the stages `registerSpecStage`
 * registered in this process).
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RunResult, VariableValue } from "../interpreter/index.js";
import {
	defineExtension,
	defineTask,
	type Extension,
	type JsonObject,
	type ModelRef,
	type Task,
	type TaskDefinition,
	type TaskId,
} from "@earendil-works/pi-durable";
import { AgentScriptRun, type RunInput, type Workspace } from "../durable/index.js";
import { localWorkspace } from "../node/index.js";
import {
	LoopOutcome,
	check,
	explain,
	strictlyValid,
	type Escalation,
	type Feedback,
	type Iteration,
	type Recipient,
	type Target,
	type ValidationEvidence,
} from "../openspec/index.js";
import { closed } from "../openspec/schema.js";
import { CHECK_TIMEOUT_MS, SPAWN_FAILED_EXIT_CODE, type CheckRun } from "./checks.js";
import { subagentsOf } from "./loop.js";
import { readBundle } from "./spec-bundle.js";
import { SPEC_NEXT_ACTIONS, type SpecStage, type StageContext, type StageIssue } from "./spec-stage.js";

export const SPEC_LOOP = "agentscript.spec-loop";

/** What a stage's loop hands back: the files to review, and whether the principal approved them. */
export interface StageOutcome {
	change: string;
	stage: string;
	files: string[];
	approved: boolean;
}

/**
 * The ontology has no `StageOutcome` schema, so the outcome is checked with its result left
 * out (optional in every status this loop ends in): the iterations and the escalation.
 */
const SpecLoopShape = LoopOutcome(closed({}));

/** The durable input of `agentscript.spec-loop`: the script already read into text, the stage by name. */
export interface SpecLoopInput {
	readonly change: string;
	/** What a checkpoint can hold of the stage; `seed` and `gate` are resolved by `name`. */
	readonly stage: { readonly name: string; readonly owns: readonly string[] };
	readonly script: string;
	readonly intent: string;
	/** Absolute: the repo root, where `openspec/` lives. */
	readonly workspace: string;
	/** The owned paths of the stages already approved, seeded as `approved`. */
	readonly approved: readonly string[];
	readonly budget: { readonly maxIterations: number };
	/** Who a stage's question goes to. A review always goes to the principal. */
	readonly escalateTo: Recipient;
	readonly model?: ModelRef;
}

/** What `await` reads from a settled child run, small enough for a checkpoint. */
export type StageRead =
	| { readonly ok: true; readonly files: string; readonly summary: string; readonly nextAction: string; readonly question: string }
	| { readonly ok: false; readonly message: string };

export type SpecLoopCheckpoint =
	| { readonly phase: "iterate"; readonly iterations: Iteration[]; readonly carried: string }
	| { readonly phase: "await"; readonly iterations: Iteration[]; readonly carried: string; readonly child: TaskId }
	| { readonly phase: "write"; readonly iterations: Iteration[]; readonly carried: string; readonly child: TaskId; readonly read: StageRead }
	| {
			readonly phase: "gate";
			readonly iterations: Iteration[];
			readonly carried: string;
			readonly child: TaskId;
			readonly read: StageRead;
			/** The paths this round wrote, relative to the change directory. */
			readonly written: string[];
			readonly writeIssues: StageIssue[];
	  };

export interface SpecLoopResult extends JsonObject {
	outcome: LoopOutcome<StageOutcome> & JsonObject;
}

/** Finds a stage's functions by name, for a loop started or resumed in this process. */
export type StageResolver = (name: string) => SpecStage | undefined;

const registered = new Map<string, SpecStage>();

/** Makes `stage` resolvable by name for `SpecLoopTask`; a later registration of the same name replaces it. */
export function registerSpecStage(stage: SpecStage): void {
	registered.set(stage.name, stage);
}

const registeredStage: StageResolver = (name) => registered.get(name);

/** The single target every verdict of a stage's loop judges. */
export const stageTarget = (stage: string): Target => ({ check: `${stage} gate` });

export const changeDirOf = (input: Pick<SpecLoopInput, "workspace" | "change">): string =>
	join(input.workspace, "openspec", "changes", input.change);

/**
 * The files under `changeDir` that `owns` names, by path relative to it, in path order:
 * each owned file, and every file under an owned entry ending in "/". Missing ones are skipped.
 */
export function readOwnedFiles(changeDir: string, owns: readonly string[]): Record<string, string> {
	const found: Record<string, string> = {};
	const walk = (relative: string) => {
		const absolute = join(changeDir, relative);
		let stat;
		try {
			stat = statSync(absolute);
		} catch {
			return;
		}
		if (stat.isDirectory()) {
			for (const entry of readdirSync(absolute)) walk(relative === "" ? entry : `${relative}/${entry}`);
		} else if (stat.isFile()) found[relative] = readFileSync(absolute, "utf8");
	};
	for (const entry of owns) walk(entry.endsWith("/") ? entry.slice(0, -1) : entry);
	return Object.fromEntries(Object.entries(found).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Files as one bundle string, each section opened by `=== <path>` and ending in a newline. */
export function toBundle(files: Readonly<Record<string, string>>): string {
	return Object.entries(files)
		.map(([path, text]) => `=== ${path}\n${text.endsWith("\n") || text === "" ? text : `${text}\n`}`)
		.join("");
}

/** One carried line per issue: `<level> <path>: <message>`. */
export const issueLine = (issue: StageIssue): string => `${issue.level} ${issue.path}: ${issue.message}`;

function stageOf(resolve: StageResolver, input: SpecLoopInput): SpecStage {
	const stage = resolve(input.stage.name);
	if (stage === undefined) {
		throw new Error(`${SPEC_LOOP} has no stage named "${input.stage.name}" in this process: register it before starting or resuming the loop`);
	}
	return stage;
}

function stageContext(input: SpecLoopInput, files: Record<string, string>, workspace: Workspace): StageContext {
	return {
		changeId: input.change,
		workspace: input.workspace,
		changeDir: changeDirOf(input),
		files,
		run: async (argv): Promise<CheckRun> => {
			const command = argv.join(" ");
			if (workspace.exec === undefined) return { command, exitCode: SPAWN_FAILED_EXIT_CODE, output: "this workspace cannot run commands" };
			const ran = await workspace.exec(argv, { timeoutMs: CHECK_TIMEOUT_MS });
			if (ran.kind === "exited") return { command, exitCode: ran.code, output: ran.stdout + ran.stderr };
			if (ran.kind === "timed-out") return { command, exitCode: -1, output: `${ran.stdout}${ran.stderr}\n(timed out after ${CHECK_TIMEOUT_MS}ms)` };
			return { command, exitCode: SPAWN_FAILED_EXIT_CODE, output: `(could not start: ${ran.message})` };
		},
	};
}

function readStage(settled: { status: string; result?: RunResult; error?: { message: string }; reason?: string }): StageRead {
	if (settled.status !== "completed" || settled.result === undefined) {
		return { ok: false, message: `the run ended ${settled.status}: ${settled.error?.message ?? settled.reason ?? ""}` };
	}
	const result = settled.result;
	if (result.kind !== "completed") {
		const step = result.steps.at(-1)?.outcome;
		return { ok: false, message: `the run ended ${result.kind}${step?.kind === "failed" ? `: ${step.category}: ${step.message}` : ""}` };
	}
	const v = result.variables;
	return {
		ok: true,
		files: String(v["files"] ?? ""),
		summary: String(v["summary"] ?? ""),
		nextAction: String(v["next_action"] ?? ""),
		question: String(v["question"] ?? ""),
	};
}

/** The iteration `n` of a stage's loop: its gate report as evidence, one `retry` per blocking issue when unmet. */
export function recordStageRound(n: number, stage: string, plan: string, written: readonly string[], issues: readonly StageIssue[]): Iteration {
	const target = stageTarget(stage);
	const evidence: ValidationEvidence = { kind: "validation", report: { valid: strictlyValid([...issues]), issues: [...issues] } };
	const actions = written.length === 0 ? [] : [{ kind: "edit" as const, summary: `wrote ${written.join(", ")}`, refs: [...written] }];
	const base = { n, plan, actions, evidence: [evidence] };
	const blocking = issues.filter((issue) => issue.level !== "INFO");
	if (blocking.length === 0) return { ...base, verdict: { met: true, satisfied: [target], unmet: [] }, feedback: [] };
	const feedback: Feedback[] = blocking.map((issue) => ({
		from: { kind: "spec-defect", target, evidence: [evidence], message: issueLine(issue) },
		action: "retry",
	}));
	const reason = `${blocking.length} issue${blocking.length === 1 ? "" : "s"} at ERROR or WARNING`;
	return { ...base, verdict: { met: false, satisfied: [], unmet: [{ target, reason }] }, feedback };
}

function result(outcome: SpecLoopResult["outcome"]): SpecLoopResult {
	const { result: _result, ...shape } = outcome;
	if (!check(SpecLoopShape, shape)) {
		throw new Error(`the spec loop built an outcome the ontology refuses: ${explain(SpecLoopShape, shape).join("; ")}`);
	}
	return { outcome };
}

type SpecPhases = TaskDefinition<SpecLoopInput, SpecLoopCheckpoint, SpecLoopResult, object>["phases"];

function phases(resolve: StageResolver, bound?: Workspace): SpecPhases {
	const workspaceFor = (input: SpecLoopInput) => bound ?? localWorkspace(input.workspace);
	return {
		iterate: async (task, runtime, context) => {
			const { iterations, carried } = task.state.checkpoint;
			const input = task.input;
			const runTask = runtime.registry.task(AgentScriptRun.definition.name) as typeof AgentScriptRun | undefined;
			if (runTask === undefined) {
				throw new Error(`${SPEC_LOOP} needs ${AgentScriptRun.definition.name} installed: install specLoopExtensions(...)`);
			}
			const changeDir = changeDirOf(input);
			const current = readOwnedFiles(changeDir, input.stage.owns);
			const seeded = await stageOf(resolve, input).seed?.(stageContext(input, current, workspaceFor(input)));
			const variables: Record<string, VariableValue> = {
				change_id: input.change,
				stage: input.stage.name,
				intent: input.intent,
				approved: toBundle(readOwnedFiles(changeDir, input.approved)),
				current: toBundle(current),
				base: seeded?.base ?? "",
				iteration: iterations.length + 1,
				carried,
			};
			const runInput: RunInput = {
				source: input.script,
				options: { entry: subagentsOf(input.script), variables, choices: { next_action: [...SPEC_NEXT_ACTIONS] } },
				...(input.model !== undefined ? { model: input.model } : {}),
			};
			await runtime.commit(async (tx) => {
				const child = await tx.createTask(runTask, runInput, { ownership: { kind: "task", taskId: runtime.taskId } });
				return { status: "waiting", checkpoint: { phase: "await", iterations, carried, child }, on: [child], policy: "allSettled" };
			}, context);
		},
		await: async (task, runtime, context) => {
			const { iterations, carried, child } = task.state.checkpoint;
			const settled = await runtime.waitForTask(child as TaskId<RunResult>, context);
			const read = readStage(settled.state.outcome as Parameters<typeof readStage>[0]);
			await runtime.commit(() => ({ status: "running", checkpoint: { phase: "write", iterations, carried, child, read } }), context);
		},
		// Rerunnable: the same bundle writes the same text to the same files.
		write: async (task, runtime, context) => {
			const { iterations, carried, child, read } = task.state.checkpoint;
			const input = task.input;
			const written: string[] = [];
			const writeIssues: StageIssue[] = [];
			if (read.ok) {
				const bundle = readBundle(read.files, input.stage);
				writeIssues.push(...bundle.issues);
				const changeDir = changeDirOf(input);
				for (const [path, text] of Object.entries(bundle.files)) {
					const absolute = join(changeDir, path);
					mkdirSync(dirname(absolute), { recursive: true });
					writeFileSync(absolute, text);
					written.push(path);
				}
			} else writeIssues.push({ level: "ERROR", path: "files", message: read.message });

			if (read.ok && read.nextAction === "ask") {
				const escalation: Escalation = {
					level: "change",
					to: input.escalateTo,
					reason: "question",
					question: read.question || `The ${input.stage.name} stage asked without saying what.`,
				};
				const outcome = { status: "blocked", iterations, escalation, result: stageResult(input, written) };
				const done = result(outcome as SpecLoopResult["outcome"]);
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
				return;
			}
			await runtime.commit(
				() => ({ status: "running", checkpoint: { phase: "gate", iterations, carried, child, read, written, writeIssues } }),
				context,
			);
		},
		// Reruns the gate after a crash; a gate only reads.
		gate: async (task, runtime, context) => {
			const { iterations, read, written, writeIssues } = task.state.checkpoint;
			const input = task.input;
			const files = readOwnedFiles(changeDirOf(input), input.stage.owns);
			const gated = await stageOf(resolve, input).gate(stageContext(input, files, workspaceFor(input)));
			const issues = [...writeIssues, ...gated];
			const iteration = recordStageRound(iterations.length + 1, input.stage.name, read.ok ? read.summary : read.message, written, issues);
			const all = [...iterations, iteration];

			if (iteration.verdict.met) {
				const reviewed = Object.keys(files);
				const escalation: Escalation = {
					level: "change",
					to: "principal",
					reason: "review",
					question: `Review ${reviewed.join(", ")} for the ${input.stage.name} stage of ${input.change}. Answer approve, or say what to change.`,
				};
				const done = result({ status: "blocked", iterations: all, escalation, result: stageResult(input, reviewed) } as SpecLoopResult["outcome"]);
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
				return;
			}
			if (all.length >= input.budget.maxIterations) {
				const done = result({ status: "exhausted", iterations: all } as SpecLoopResult["outcome"]);
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: done } }), context);
				return;
			}
			const carried = issues.filter((issue) => issue.level !== "INFO").map(issueLine).join("\n");
			await runtime.commit(() => ({ status: "running", checkpoint: { phase: "iterate", iterations: all, carried } }), context);
		},
	};
}

function stageResult(input: SpecLoopInput, files: readonly string[]): StageOutcome {
	return { change: input.change, stage: input.stage.name, files: [...files], approved: false };
}

/**
 * The spec loop task resolving stages with `resolve`, its gate's and seed's commands run in
 * `bound` when given, else in a `localWorkspace` over the input's workspace.
 */
export function specLoopTask(
	resolve: StageResolver = registeredStage,
	bound?: Workspace,
): Task<SpecLoopInput, SpecLoopCheckpoint, SpecLoopResult, object> {
	return defineTask<SpecLoopInput, SpecLoopCheckpoint, SpecLoopResult>({
		name: SPEC_LOOP,
		version: 1,
		initial: () => ({ phase: "iterate", iterations: [], carried: "" }),
		phases: phases(resolve, bound),
		abort: async (_task, runtime, context) => {
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "aborted" } }), context);
		},
	});
}

/** The spec loop task over the stages `registerSpecStage` registered. */
export const SpecLoopTask = specLoopTask();

/** Brings the `agentscript.spec-loop` task. Installed beside the run and step extensions. */
export const SpecLoop: Extension = defineExtension({ name: SPEC_LOOP, tasks: [SpecLoopTask] });
