/**
 * Driving `agentscript-change` in process, on a faux model, in a temp workspace whose
 * config names the changes directory and the database. Also: a change loop blocked on an
 * escalation that may carry an `Amendment`, seeded by a real `build`, and a fake `openspec`
 * that logs every call and answers the amendment's checks as a test stages them.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { main } from "../../src/bin/agentscript-change.js";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { readChangeResult } from "../../src/task/change-api.js";
import { CHANGE_LOOP_TASK } from "../../src/task/change-input.js";
import { DRAFT_LOOP_TASK } from "../../src/task/draft-input.js";
import type { DraftLoopInput } from "../../src/task/draft-loop.js";
import { GROUP_LOOP_NAME } from "../../src/task/group.js";
import { TASK_LOOP } from "../../src/task/index.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { listLoops } from "../../src/task/status.js";
import { commitAll, fauxModels, gitIn, write } from "../task/cli-helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, context, temp, verdict } from "../task/helpers.js";
import { stagedCheck } from "../task/staged-check.js";

export const CHANGE = "add-plan-export";

/** The repo's pinned `openspec` (1.14.1), for PATH and for the fake to pass through to. */
export const OPENSPEC_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "node_modules", ".bin");

/** A workspace with `agentscript.config.json`: changes under `openspec/changes`, the database at `loops.sqlite`. */
export function workspace() {
	const dir = temp("change-cli-");
	writeFileSync(join(dir, "agentscript.config.json"), JSON.stringify({ task: { changesDir: "openspec/changes", db: "loops.sqlite" } }));
	return { dir, changesDir: join(dir, "openspec", "changes"), changeDir: join(dir, "openspec", "changes", CHANGE), db: join(dir, "loops.sqlite") };
}

/** main() in process, on a faux model answering `responses` over `stages` (default `SPEC_STAGES`); it never reads stdin. */
export async function change(argv: string[], cwd: string, responses: FauxResponseStep[] = [], stages?: readonly SpecStage[]) {
	const { faux, models } = fauxModels();
	faux.setResponses(responses);
	const model = faux.getModel();
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(argv, {
		models: () => models,
		out: (line) => out.push(line),
		err: (line) => err.push(line),
		cwd,
		env: { AGENTSCRIPT_PROVIDER: model.provider, AGENTSCRIPT_MODEL: model.id, USER: "jesse" },
		...(stages !== undefined ? { stages } : {}),
	});
	return { code, out: out.join("\n"), err: err.join("\n"), calls: faux.state.callCount };
}

export async function loopsIn(db: string) {
	const storage = await openNodeSqliteStorage(db);
	try {
		return await listLoops(storage, context);
	} finally {
		await storage.close(context);
	}
}

/** Every draft loop run in the database, by ID, with its input. */
export async function draftLoopsIn(db: string) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const page = await storage.scanTasks({ kind: DRAFT_LOOP_TASK }, 100, undefined, context);
		return page.items.map((record) => ({ id: Number(record.id), input: record.input as unknown as DraftLoopInput })).sort((a, b) => a.id - b.id);
	} finally {
		await storage.close(context);
	}
}

// --- A change loop blocked on an amendment -------------------------------------------------

/**
 * The delta every seeded change starts with: five requirements, one scenario each, all claimed
 * by `AMEND_TASKS`. It carries `## Purpose`, so the real trial fold creates its capability clean.
 */
export const AMEND_SPEC = [
	"## Purpose",
	"Plans leave the tool as files another program can read back.",
	"",
	"## ADDED Requirements",
	"",
	"### Requirement: Export writes JSON",
	"`plan export` SHALL write the plan as JSON.",
	"",
	"#### Scenario: Export writes JSON",
	"- **WHEN** `plan export p1` runs",
	"- **THEN** stdout SHALL be the plan as JSON",
	"",
	...[
		["Exports are complete", "An export SHALL hold every step.", "An export holds every step"],
		["Exports use the API", "An export SHALL go through the plan API.", "An export calls the API"],
		["Exports are named", "An export SHALL be named after its plan.", "An export is named"],
		["Exports are listed", "Every export SHALL be listed.", "An export is listed"],
	].flatMap(([name, text, title]) => [`### Requirement: ${name}`, text!, "", `#### Scenario: ${title}`, "- **WHEN** it runs", "- **THEN** it SHALL work", ""]),
].join("\n");

/** Three groups: 1 (1.1, 1.2), 2 (2.1, 2.2), 3 (3.1). */
export const AMEND_TASKS = [
	"## 1. Export",
	"",
	'- [ ] 1.1 `src/export.ts`: "Export writes JSON"',
	'- [ ] 1.2 `src/export.ts`: "An export holds every step"',
	"",
	"## 2. API",
	"",
	'- [ ] 2.1 `src/api.ts`: "An export calls the API"',
	'- [ ] 2.2 `src/name.ts`: "An export is named"',
	"",
	"## 3. Listing",
	"",
	'- [ ] 3.1 `src/list.ts`: "An export is listed"',
	"",
].join("\n");

const GROUPS: readonly (readonly string[])[] = [["1.1", "1.2"], ["2.1", "2.2"], ["3.1"]];

/** Who escalated: a task loop, or a group's judge after its group check failed. */
export type AmendAsker = { readonly kind: "task"; readonly task: string } | { readonly kind: "group"; readonly group: number };

export interface BlockedOnAmendmentOptions {
	readonly change: string;
	/** The change's one delta, `<area>/<name>`, holding `committed`. */
	readonly capability: string;
	readonly asker: AmendAsker;
	/** Default `Amend the spec?`. */
	readonly question?: string;
	/** What the escalation carries; none makes it a plain `ask`. `delta` need not be one of the change's deltas. */
	readonly amendment?: { readonly delta: string; readonly text: string };
	/** The capability's delta as committed. Default `AMEND_SPEC`. */
	readonly committed?: string;
	/** After seeding, left uncommitted: the amendment's delta as it then is on disk, approved as such; `null` deletes it. Default: left as is. */
	readonly onDisk?: string | null;
}

/** Where a decision landed: a group run answering a blocked one, or a task loop rerun with what it carries. */
export interface LoopAnswer {
	readonly kind: "group" | "task";
	readonly loop: number;
	readonly group?: number;
	readonly task?: string;
	/** The loop this run answers, when the input names one. */
	readonly answers?: number;
	/** The group checkpoint's `decision` (judge) or `carried` (task); the task loop's `carried`. */
	readonly decision: string;
}

/** JUDGE_ONLY, or GROUP_JUDGE, that sets `amend_path` to `delta` itself and reads `amend_text` back, so any delta, even `tasks.md`, can be seeded. */
function amendingJudge(script: string, delta: string): string {
	const line = "            set @variables.question = @outputs.question\n";
	return script.replace(line, `${line}            set @variables.amend_path = ${JSON.stringify(delta)}\n            set @variables.amend_text = @outputs.amend_text\n`);
}

const judgeSays = (vars: Record<string, string>) =>
	fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { next_action: "", rework_task: "", feedback: "", question: "", amend_path: "", amend_text: "", ...vars })], {
		stopReason: "toolUse",
	});

/**
 * A git repository with one commit holding the config and `change` (every stage approved),
 * then a real `build` on a faux model that ends blocked on `asker`'s escalation: the tasks before
 * it converge, and `true` is every check but the staged group check a judge needs. The judges and
 * the database live outside the repository. Needs the real `openspec` on PATH: the start guard
 * validates the change.
 */
export async function seedBlockedOnAmendment(options: BlockedOnAmendmentOptions) {
	const { change: id, capability, asker, amendment } = options;
	const question = options.question ?? "Amend the spec?";
	const dir = temp("change-amend-repo-");
	const changeDir = join(dir, "openspec", "changes", id);
	write(dir, {
		"agentscript.config.json": JSON.stringify({ task: { changesDir: "openspec/changes" } }),
		"README.md": "# plans\n",
		[join("openspec", "specs", ".gitkeep")]: "",
		[join("openspec", "changes", id, "proposal.md")]: "## Why\nPlans have to leave the tool, for a reason long enough to pass.\n\n## What Changes\n- Exports a plan.\n",
		[join("openspec", "changes", id, "design.md")]: "## Context\nA design.\n",
		[join("openspec", "changes", id, "specs", capability, "spec.md")]: options.committed ?? AMEND_SPEC,
		[join("openspec", "changes", id, "tasks.md")]: AMEND_TASKS,
	});
	for (const stage of SPEC_STAGES) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
	gitIn(dir, "init", "-q", "-b", "main");
	commitAll(dir, "init");

	const outside = temp("change-amend-");
	const script = join(outside, "judge.agent");
	const groupScript = join(outside, "group.agent");
	const delta = amendment?.delta ?? `specs/${capability}/spec.md`;
	writeFileSync(script, asker.kind === "task" && amendment !== undefined ? amendingJudge(JUDGE_ONLY, delta) : JUDGE_ONLY);
	writeFileSync(groupScript, asker.kind === "group" && amendment !== undefined ? amendingJudge(GROUP_JUDGE, delta) : GROUP_JUDGE);
	const db = join(outside, "loops.sqlite");

	const nextAction = amendment !== undefined ? "amend-spec" : "ask";
	const amendText = amendment?.text ?? "";
	let check = "true";
	let responses: FauxResponseStep[];
	if (asker.kind === "task") {
		const before = GROUPS.flat().indexOf(asker.task);
		if (before === -1) throw new Error(`no task ${asker.task} in AMEND_TASKS`);
		responses = [...Array.from({ length: before }, () => verdict(true)), verdict(false, "the spec cannot pass as written", nextAction, question, { amend_text: amendText })];
	} else {
		const upTo = GROUPS.slice(0, asker.group);
		if (upTo.length !== asker.group) throw new Error(`no group ${asker.group} in AMEND_TASKS`);
		// Each task's gate passes, each earlier group check passes, this group's fails once; after that, all pass.
		const passes = upTo.flatMap((tasks, i) => [...tasks.map(() => true), i < asker.group - 1]);
		check = stagedCheck([...passes, true]).command;
		responses = [...upTo.flat().map(() => verdict(true)), judgeSays({ next_action: nextAction, question, amend_text: amendText })];
	}
	const args = ["--db", db, "--script", script, "--group-script", groupScript, "--check", check, "--change-check", "true"];
	const blocked = await change(["build", id, ...args], dir, responses);
	if (blocked.code !== 1) throw new Error(`seeding ${id} did not block (exit ${blocked.code}):\n${blocked.out}\n${blocked.err}`);

	const deltaPath = join(changeDir, delta);
	if (options.onDisk === null) rmSync(deltaPath, { force: true });
	else if (options.onDisk !== undefined) {
		mkdirSync(dirname(deltaPath), { recursive: true });
		writeFileSync(deltaPath, options.onDisk);
		// Approved as it now is, so only the tree is dirty; approving a stage drops the ones after it, so those go again too.
		const owner = SPEC_STAGES.findIndex((stage) => stage.owns.some((path) => (path.endsWith("/") ? delta.startsWith(path) : delta === path)));
		for (const stage of SPEC_STAGES.slice(Math.max(owner, 0))) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
	}

	return {
		dir,
		change: id,
		changeDir,
		db,
		args,
		blocked,
		question,
		/** Relative to the change directory. */
		delta,
		deltaPath,
		/** `openspec/changes/<change>/<delta>`, as the output names it. */
		deltaShown: `openspec/changes/${id}/${delta}`,
		/** `build <change> [...extra]` with the seeding flags, the faux model answering `answers`. */
		build: (extra: readonly string[] = [], answers: FauxResponseStep[] = []) => change(["build", id, ...extra, ...args], dir, answers),
		/** The delta's bytes now, or `null` when it does not exist. */
		readDelta: (): Buffer | null => (existsSync(deltaPath) ? readFileSync(deltaPath) : null),
		/** How the newest change loop ended, and how many change loops there are. */
		changeLoops: () => changeLoopsIn(db),
		/** Every run that took a decision, oldest first. */
		answers: () => answersIn(db),
	};
}

/** add-plan-export, blocked on task 2.2 with the design's "Export writes JSON" amendment. */
export const planExportTask22 = (over: Partial<BlockedOnAmendmentOptions> = {}) =>
	seedBlockedOnAmendment({
		change: "add-plan-export",
		capability: "plan/export",
		asker: { kind: "task", task: "2.2" },
		question: 'Scenario "Export writes JSON" cannot pass: the output is not stable. Amend the spec?',
		amendment: { delta: "specs/plan/export/spec.md", text: AMEND_SPEC.replace("stdout SHALL be the plan as JSON", "stdout SHALL be the plan as JSON, with keys sorted") },
		...over,
	});

/** add-csv-import, blocked on group 1's judge with an amendment to `specs/plan/import/spec.md`. */
export const csvImportGroup1 = (over: Partial<BlockedOnAmendmentOptions> = {}) =>
	seedBlockedOnAmendment({
		change: "add-csv-import",
		capability: "plan/import",
		asker: { kind: "group", group: 1 },
		amendment: { delta: "specs/plan/import/spec.md", text: AMEND_SPEC.replace("An export SHALL hold every step.", "An export SHALL hold every step, in order.") },
		...over,
	});

/** add-bad-path, blocked on task 2.2 with an amendment whose delta is `tasks.md`. */
export const badPath = (over: Partial<BlockedOnAmendmentOptions> = {}) =>
	seedBlockedOnAmendment({
		change: "add-bad-path",
		capability: "plan/export",
		asker: { kind: "task", task: "2.2" },
		amendment: { delta: "tasks.md", text: "## 1. Everything\n\n- [x] 1.1 done\n" },
		...over,
	});

/** add-other-thing, blocked on task 2.2 asking `Which API?`, with no amendment. */
export const noAmendment = (over: Partial<BlockedOnAmendmentOptions> = {}) => {
	const { amendment: _none, ...rest } = over;
	return seedBlockedOnAmendment({ change: "add-other-thing", capability: "plan/other", asker: { kind: "task", task: "2.2" }, question: "Which API?", ...rest });
};

/** The change loops in `db`, oldest first: each one's ID and how it ended (`running` until it has). */
export async function changeLoopsIn(db: string) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const page = await storage.scanTasks({ kind: CHANGE_LOOP_TASK }, 100, undefined, context);
		return page.items
			.map((record) => {
				const state = record.state as unknown as { status: string; outcome?: { status: string; result?: unknown } };
				const done = state.status === "terminal" && state.outcome?.status === "completed";
				return { id: Number(record.id), status: done ? readChangeResult(state.outcome!.result as never, record.id).outcome.status : state.status };
			})
			.sort((a, b) => a.id - b.id);
	} finally {
		await storage.close(context);
	}
}

/**
 * Every run in `db` that took a decision, oldest first: group runs answering a blocked group
 * (a judge's decision, or what a blocked task reruns with), and task loops carrying text.
 */
export async function answersIn(db: string): Promise<LoopAnswer[]> {
	const storage = await openNodeSqliteStorage(db);
	try {
		const scan = async (kind: string) => (await storage.scanTasks({ kind }, 100, undefined, context)).items;
		const answers: LoopAnswer[] = [];
		for (const record of await scan(GROUP_LOOP_NAME)) {
			const input = record.input as unknown as { group: number; resume?: { answers: number; checkpoint: { decision?: string; carried?: string } } };
			if (input.resume === undefined) continue;
			const { checkpoint } = input.resume;
			answers.push({ kind: "group", loop: Number(record.id), group: input.group, answers: input.resume.answers, decision: checkpoint.decision ?? checkpoint.carried ?? "" });
		}
		for (const record of await scan(TASK_LOOP)) {
			const input = record.input as unknown as { task: string; carried: string; answers?: number };
			if (input.carried === "" && input.answers === undefined) continue;
			answers.push({ kind: "task", loop: Number(record.id), task: input.task, ...(input.answers !== undefined ? { answers: input.answers } : {}), decision: input.carried });
		}
		return answers.sort((a, b) => a.loop - b.loop);
	} finally {
		await storage.close(context);
	}
}

// --- A fake openspec --------------------------------------------------------------------------

/** What a staged `openspec` command prints and exits with. */
export interface OpenspecReply {
	readonly exit: number;
	readonly stdout?: string;
	readonly stderr?: string;
}

/** The three commands `--amend` runs: `validate --all --strict`, then, in the trial copy, `archive <change> --yes` and `validate --specs --strict`. */
export type AmendCommand = "validateAll" | "archive" | "validateSpecs";

/** One call the fake took. */
export interface OpenspecCall {
	readonly args: readonly string[];
	readonly cwd: string;
	/** `OPENSPEC_TELEMETRY` as the call saw it, `null` when unset. */
	readonly telemetry: string | null;
	/** The watched file's text at the time of the call, `null` when it did not exist; absent with no `watch`. */
	readonly watched?: string | null;
}

/** `validate --all --strict` reporting the 534-character requirement as an error. */
export const errorTooLong = (change: string): OpenspecReply => ({
	exit: 1,
	stdout: `✗ change/${change}\n  [ERROR] requirement "Export writes JSON" is 534 characters (max 500)\n`,
});

/** `validate --specs --strict` that exits 0 but warns about the 534-character requirement. */
export const warningOnly: OpenspecReply = {
	exit: 0,
	stdout: '✓ spec/plan/export\n  [WARNING] requirement "Export writes JSON" is 534 characters; keep it under 500\n',
};

/**
 * An `openspec` first on PATH (until `restore()`). Every call appends one line to its log;
 * a command given a reply in `replies` (or later, `reply`) prints it and exits with it, and
 * anything else, the start guard's `validate <change> --strict --json` included, runs the
 * pinned `openspec`. With `watch`, each call records that file's text as it was then.
 */
export function fakeOpenspec(options: { replies?: Partial<Record<AmendCommand, OpenspecReply>>; watch?: string } = {}) {
	const bin = temp("fake-openspec-");
	const log = join(bin, "calls.jsonl");
	const config = join(bin, "config.json");
	const replies: Partial<Record<AmendCommand, OpenspecReply>> = { ...options.replies };
	const save = () => writeFileSync(config, JSON.stringify({ log, real: join(OPENSPEC_BIN, "openspec"), watch: options.watch ?? null, replies }));
	save();
	writeFileSync(
		join(bin, "openspec"),
		[
			`#!${process.execPath}`,
			'const fs = require("node:fs");',
			'const { spawnSync } = require("node:child_process");',
			`const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(config)}, "utf8"));`,
			"const args = process.argv.slice(2);",
			"const call = { args, cwd: process.cwd(), telemetry: process.env.OPENSPEC_TELEMETRY ?? null };",
			'if (cfg.watch !== null) { try { call.watched = fs.readFileSync(cfg.watch, "utf8"); } catch { call.watched = null; } }',
			'fs.appendFileSync(cfg.log, JSON.stringify(call) + "\\n");',
			'const key = args.join(" ");',
			'const command = key === "validate --all --strict" ? "validateAll" : key === "validate --specs --strict" ? "validateSpecs" : args[0] === "archive" ? "archive" : undefined;',
			"const reply = command === undefined ? undefined : cfg.replies[command];",
			"if (reply !== undefined) {",
			'\tprocess.stdout.write(reply.stdout ?? "");',
			'\tprocess.stderr.write(reply.stderr ?? "");',
			"\tprocess.exit(reply.exit);",
			"}",
			'const real = spawnSync(cfg.real, args, { stdio: "inherit" });',
			"process.exit(real.status ?? 1);",
			"",
		].join("\n"),
		{ mode: 0o755 },
	);
	const saved = process.env.PATH;
	process.env.PATH = `${bin}:${saved ?? ""}`;
	return {
		bin,
		/** Stage a command's reply from now on; `undefined` passes it through again. */
		reply(command: AmendCommand, value: OpenspecReply | undefined) {
			if (value === undefined) delete replies[command];
			else replies[command] = value;
			save();
		},
		/** Every call so far, in order. */
		calls: (): OpenspecCall[] => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as OpenspecCall) : []),
		/** The calls since the `n`th, as `openspec` argument strings. */
		commands(since = 0): string[] {
			return this.calls().slice(since).map((call) => call.args.join(" "));
		},
		restore() {
			process.env.PATH = saved;
		},
	};
}

/** Every file under `<root>/openspec/`, by path relative to it, as a sha256 of its bytes. */
export function snapshotOpenspec(root: string): Record<string, string> {
	const base = join(root, "openspec");
	const files: Record<string, string> = {};
	for (const path of readdirSync(base, { recursive: true, encoding: "utf8" }).sort()) {
		const full = join(base, path);
		if (statSync(full).isFile()) files[relative(base, full)] = createHash("sha256").update(readFileSync(full)).digest("hex");
	}
	return files;
}
