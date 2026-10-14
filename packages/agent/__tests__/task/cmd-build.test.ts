import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStorage, type Harness, type Storage } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANGE_LOOP_TASK } from "../../src/task/change-input.js";
import { parseBuild, prepareBuild, runBuild, type BuildArgs, type BuildRequest } from "../../src/task/cmd-build.js";
import type { LoadedConfig } from "../../src/task/config.js";
import { changeLoopExtensions } from "../../src/task/index.js";
import { resetOpenspecCache } from "../../src/task/openspec-bin.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { setup } from "../durable/helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, context, loopHarness, temp, verdict } from "./helpers.js";
import { stagedCheck } from "./staged-check.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The repo's pinned `openspec` (1.14.1): the guard validates the change with it. */
const OPENSPEC_BIN = join(HERE, "..", "..", "..", "..", "node_modules", ".bin");

let savedPath: string | undefined;
beforeEach(() => {
	savedPath = process.env.PATH;
	process.env.PATH = `${OPENSPEC_BIN}:${savedPath ?? ""}`;
});
afterEach(() => {
	process.env.PATH = savedPath;
	cleanTemps();
});

const CHANGE = "add-plan-export";
const PROPOSAL = "## Why\nBecause the plan has to be exported, for a reason long enough to pass.\n\n## What Changes\n- Adds the export.\n";
const GROUPS = ["One", "Two", "Three"];

/** A strictly valid change of `groups` groups, one task each; `orphan` adds a requirement with no scenario. */
function writeChange(workspace: string, groups: number, { orphan = false } = {}): string {
	mkdirSync(join(workspace, "openspec", "specs"), { recursive: true });
	const changeDir = join(workspace, "openspec", "changes", CHANGE);
	mkdirSync(join(changeDir, "specs", "plan", "export"), { recursive: true });
	writeFileSync(join(changeDir, "proposal.md"), PROPOSAL);
	const names = GROUPS.slice(0, groups).map((g) => `Group ${g.toLowerCase()} builds`);
	const requirements = names.map((name, i) => `### Requirement: Thing ${i + 1}\nThing ${i + 1} SHALL exist.\n\n#### Scenario: ${name}\n- **WHEN** it runs\n- **THEN** it SHALL work\n`);
	if (orphan) requirements.push("### Requirement: The orphan\nThe orphan SHALL exist.\n");
	// `## Purpose`, so the change check's trial fold creates the capability clean.
	const purpose = "## Purpose\nPlans leave the tool as files another program can read back.\n\n";
	writeFileSync(join(changeDir, "specs", "plan", "export", "spec.md"), `${purpose}## ADDED Requirements\n\n${requirements.join("\n")}`);
	const tasks = names.flatMap((name, i) => [`## ${i + 1}. ${GROUPS[i]}`, "", `- [ ] ${i + 1}.1 \`${i + 1}.txt\`: "${name}"`, ""]);
	writeFileSync(join(changeDir, "tasks.md"), tasks.join("\n"));
	return changeDir;
}

/** A config over `workspace`: the judge scripts outside it, a passing check, and a database outside it too. */
function configFor(workspace: string, check: string, judge = JUDGE_ONLY): LoadedConfig {
	const scripts = temp("cmd-build-scripts-");
	writeFileSync(join(scripts, "judge.agent"), judge);
	writeFileSync(join(scripts, "group.agent"), GROUP_JUDGE);
	return {
		dir: workspace,
		task: { db: join(temp("cmd-build-db-"), "runs.sqlite"), checks: [check], script: join(scripts, "judge.agent"), groupScript: join(scripts, "group.agent") },
		delegates: {},
		models: {},
	};
}

function prepared(argv: readonly string[], config: LoadedConfig): BuildRequest {
	const args = parseBuild(argv);
	if ("kind" in args) throw new Error(`parse: ${args.message}`);
	const request = prepareBuild(args, { config, env: {}, cwd: config.dir });
	if (request.kind !== "request") throw new Error(`prepare: ${request.message}`);
	return request;
}

/** A faux-model harness with the change loop over `request`'s workspace and checks. */
async function harnessFor(request: BuildRequest, storage: Storage = new MemoryStorage()) {
	const env = setup();
	for (const extension of changeLoopExtensions({ workspace: request.workspace, checks: [...request.checks], allow: [] })) env.registry.install(extension);
	return { env, harness: await loopHarness(env, storage), storage };
}

const changeLoops = async (storage: Storage) => (await storage.scanTasks({ kind: CHANGE_LOOP_TASK }, 100, undefined, context)).items;

async function withBuild(groups: number, body: (h: { harness: Harness; env: ReturnType<typeof setup>; storage: Storage; request: BuildRequest; workspace: string }) => Promise<void>, argv: readonly string[] = [CHANGE]) {
	const workspace = temp("cmd-build-ws-");
	writeChange(workspace, groups);
	const request = prepared(argv, configFor(workspace, stagedCheck([true]).command));
	const { env, harness, storage } = await harnessFor(request);
	try {
		await body({ harness, env, storage, request, workspace });
	} finally {
		await harness.close(context);
	}
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

describe("task/cmd-build: arguments", () => {
	it("reads the change, the answer and each --change-check in order", () => {
		const args = parseBuild([CHANGE, "Use the v2 API", "--change-check", "pnpm spec:check", "--change-check", "pnpm test", "--allow-dirty"]) as BuildArgs;
		expect(args).toMatchObject({ change: CHANGE, answer: "Use the v2 API", changeChecks: ["pnpm spec:check", "pnpm test"], flags: { allowDirty: true } });
	});

	it("reads --amend before or after the change, with no answer", () => {
		expect(parseBuild([CHANGE, "--amend"])).toMatchObject({ change: CHANGE, amend: true });
		expect(parseBuild(["--amend", CHANGE])).toMatchObject({ change: CHANGE, amend: true });
		expect((parseBuild([CHANGE, "--amend"]) as BuildArgs).answer).toBeUndefined();
		const answered = parseBuild([CHANGE, "Use v2"]) as BuildArgs;
		expect(answered).toMatchObject({ change: CHANGE, answer: "Use v2" });
		expect(answered.amend).toBeUndefined();
	});

	it("refuses --amend with an answer", () => {
		const message = '--amend takes no answer: use either --amend or "<answer>"';
		expect(parseBuild([CHANGE, "--amend", "Use v2"])).toEqual({ kind: "refused", message, exitCode: 2 });
		expect(parseBuild([CHANGE, "Use v2", "--amend"])).toEqual({ kind: "refused", message, exitCode: 2 });
	});

	it("refuses --worktree", () => {
		expect(parseBuild([CHANGE, "--worktree"])).toEqual({ kind: "refused", message: "build has no --worktree yet; run it in a clean checkout", exitCode: 2 });
	});

	it("needs a change, a known flag and well-formed numbers", () => {
		expect(parseBuild([])).toMatchObject({ kind: "usage" });
		expect(parseBuild([CHANGE, "--frobnicate"])).toMatchObject({ kind: "usage" });
		expect(parseBuild([CHANGE, "--max-iterations", "0"])).toMatchObject({ kind: "usage", message: '--max-iterations must be a positive integer, got "0"' });
		expect(parseBuild([CHANGE, "an answer", "another"])).toMatchObject({ kind: "usage" });
	});

	it("the change checks default to the checks, and --change-check replaces them", () => {
		const workspace = temp("cmd-build-ws-");
		const config = configFor(workspace, "pnpm check");
		expect(prepared([CHANGE], config).options.changeChecks).toEqual(["pnpm check"]);
		expect(prepared([CHANGE, "--change-check", "pnpm spec:check"], config).options.changeChecks).toEqual(["pnpm spec:check"]);
	});

	it("refuses a change id that is a path", () => {
		const args = parseBuild(["../elsewhere"]) as BuildArgs;
		expect(prepareBuild(args, { config: configFor(temp("cmd-build-ws-"), "pnpm check"), env: {}, cwd: "/" })).toMatchObject({ kind: "refused" });
	});
});

describe.skipIf(process.platform === "win32")("task/cmd-build: the build", () => {
	it("starts a build that runs every group in order", async () => {
		await withBuild(2, async ({ harness, env, request }) => {
			env.faux.setResponses([verdict(true), verdict(true)]);
			const started: number[] = [];
			const result = await runBuild(harness, request, { model: env.model, onLoop: (loop) => started.push(loop) }, context);
			expect(result).toMatchObject({
				kind: "built",
				ran: true,
				exitCode: 0,
				groups: [
					{ group: 1, status: "converged", tasks: 1, reworks: 0 },
					{ group: 2, status: "converged", tasks: 1, reworks: 0 },
				],
				check: { passed: true },
				unclaimed: [],
			});
			expect(started).toHaveLength(1);
		});
	});

	it("a built change starts nothing, and refuses an answer", async () => {
		await withBuild(1, async ({ harness, env, request, storage }) => {
			env.faux.setResponses([verdict(true)]);
			await runBuild(harness, request, { model: env.model }, context);
			const again = await runBuild(harness, request, { model: env.model }, context);
			expect(again).toMatchObject({ kind: "built", ran: false, exitCode: 0, groups: [{ group: 1, status: "converged" }] });
			expect(await runBuild(harness, { ...request, answer: "more" }, { model: env.model }, context)).toMatchObject({ kind: "refused", exitCode: 2 });
			expect(await changeLoops(storage)).toHaveLength(1);
		});
	});

	it("an answer with nothing waiting is refused, and starts nothing", async () => {
		await withBuild(1, async ({ harness, env, request, storage }) => {
			const result = await runBuild(harness, { ...request, answer: "Use the v2 API" }, { model: env.model }, context);
			expect(result).toEqual({ kind: "refused", message: `nothing of ${CHANGE} waits for an answer; run build ${CHANGE} without one`, exitCode: 2 });
			expect(await changeLoops(storage)).toHaveLength(0);
		});
	});

	it("a blocked build is shown again, and an answer continues it", async () => {
		await withBuild(3, async ({ harness, env, request, storage }) => {
			env.faux.setResponses([verdict(true), verdict(false, "which API?", "amend-spec", "Which API?")]);
			const blocked = await runBuild(harness, request, { model: env.model }, context);
			expect(blocked).toMatchObject({ kind: "waiting", ran: true, exitCode: 1, question: "Which API?", to: "principal", group: 2, task: "2.1" });
			expect(blocked).toMatchObject({ groups: [{ group: 1, status: "converged" }, { group: 2, status: "blocked", blockedAt: "2.1" }] });

			const shown = await runBuild(harness, request, { model: env.model }, context);
			expect(shown).toMatchObject({ kind: "waiting", ran: false, exitCode: 1, question: "Which API?" });
			expect(await changeLoops(storage)).toHaveLength(1);

			env.faux.setResponses([verdict(true), verdict(true)]);
			const built = await runBuild(harness, { ...request, answer: "Use the v2 API" }, { model: env.model }, context);
			expect(built).toMatchObject({
				kind: "built",
				exitCode: 0,
				groups: [
					{ group: 1, status: "converged" },
					{ group: 2, status: "converged" },
					{ group: 3, status: "converged" },
				],
			});
		});
	});

	it("a refused guard names the requirement, and no loop exists", async () => {
		const workspace = temp("cmd-build-ws-");
		writeChange(workspace, 1, { orphan: true });
		const request = prepared([CHANGE], configFor(workspace, stagedCheck([true]).command));
		const { env, harness, storage } = await harnessFor(request);
		try {
			const result = await runBuild(harness, request, { model: env.model }, context);
			expect(result).toMatchObject({ kind: "refused", exitCode: 2 });
			expect(result.kind === "refused" ? result.message : "").toContain("The orphan");
			expect(await changeLoops(storage)).toHaveLength(0);
		} finally {
			await harness.close(context);
		}
	});

	describe("--amend runs the openspec resolved for the repository", () => {
		const DELTA = "specs/plan/export/spec.md";
		/** JUDGE_ONLY that also reads `amend_path` and `amend_text` back, so an `amend-spec` verdict carries an amendment. */
		const JUDGE_AMENDING = JUDGE_ONLY.replace(
			"            set @variables.question = @outputs.question\n",
			"            set @variables.question = @outputs.question\n" +
				"            set @variables.amend_path = @outputs.amend_path\n" +
				"            set @variables.amend_text = @outputs.amend_text\n",
		);

		beforeEach(() => resetOpenspecCache());
		afterEach(() => resetOpenspecCache());

		/** A one-group build blocked on an amendment of `DELTA`, the specs stage approved; then `body`. */
		async function blockedOnAmendment(body: (h: { harness: Harness; env: ReturnType<typeof setup>; request: BuildRequest; workspace: string; deltaPath: string; amended: string }) => Promise<void>) {
			const workspace = temp("cmd-build-ws-");
			const changeDir = writeChange(workspace, 1);
			const deltaPath = join(changeDir, DELTA);
			const amended = readFileSync(deltaPath, "utf8").replace("Thing 1 SHALL exist.", "Thing 1 SHALL exist, and be amended.");
			const request = prepared([CHANGE], configFor(workspace, stagedCheck([true]).command, JUDGE_AMENDING));
			const { env, harness } = await harnessFor(request);
			try {
				env.faux.setResponses([verdict(false, "the delta is wrong", "amend-spec", "Amend it?", { amend_path: DELTA, amend_text: amended })]);
				const blocked = await runBuild(harness, request, { model: env.model }, context);
				expect(blocked).toMatchObject({ kind: "waiting", to: "principal", amendment: { delta: DELTA } });
				const specs = SPEC_STAGES.find((stage) => stage.name === "specs")!;
				recordApproval(changeDir, specs, { principal: "jesse", notes: "", at: new Date().toISOString() }, SPEC_STAGES);
				// The guard above ran PATH's openspec; what --amend resolves is looked up afresh.
				resetOpenspecCache();
				await body({ harness, env, request: { ...request, amend: true }, workspace, deltaPath, amended });
			} finally {
				await harness.close(context);
			}
		}

		/** `<dir>/openspec`: logs its args, cwd and `OPENSPEC_TELEMETRY` to `log`, then runs the pinned openspec with them. */
		function loggingOpenspec(dir: string, log: string) {
			mkdirSync(dir, { recursive: true });
			const script = [
				`#!${process.execPath}`,
				'const { appendFileSync } = require("node:fs");',
				'const { spawnSync } = require("node:child_process");',
				"const args = process.argv.slice(2);",
				`appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), telemetry: process.env.OPENSPEC_TELEMETRY ?? null }) + "\\n");`,
				`const ran = spawnSync(${JSON.stringify(join(OPENSPEC_BIN, "openspec"))}, args, { stdio: "inherit" });`,
				"process.exit(ran.status ?? 1);",
				"",
			].join("\n");
			writeFileSync(join(dir, "openspec"), script, { mode: 0o755 });
		}
		const calls = (log: string) =>
			existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; cwd: string; telemetry: string | null }) : [];

		it("validates and trial-folds with the project's copy, the temporary copy included, without telemetry", async () => {
			await blockedOnAmendment(async ({ harness, env, request, workspace, deltaPath, amended }) => {
				const log = join(temp("cmd-build-log-"), "calls.jsonl");
				loggingOpenspec(join(workspace, "node_modules", ".bin"), log);
				env.faux.setResponses([verdict(true)]);
				const result = await runBuild(harness, request, { model: env.model, principal: "jesse" }, context);
				expect(result).toMatchObject({ kind: "built", exitCode: 0, amended: { delta: DELTA, principal: "jesse" } });
				expect(readFileSync(deltaPath, "utf8")).toBe(amended);

				const ran = calls(log);
				for (const call of ran) expect(call.telemetry).toBe("0");
				const amendCalls = ran.filter((call) => call.args[0] !== "--version").slice(0, 3);
				expect(amendCalls.map((call) => call.args.join(" "))).toEqual(["validate --all --strict", `archive ${CHANGE} --yes`, "validate --specs --strict --json"]);
				const repo = realpathSync(workspace);
				expect(realpathSync(amendCalls[0]!.cwd)).toBe(repo);
				expect(amendCalls[1]!.cwd).toBe(amendCalls[2]!.cwd);
				// The fold's copy is gone by now, so its path is compared as logged.
				expect(amendCalls[1]!.cwd.startsWith(repo)).toBe(false);
				// Resolved once for the repository, never for the temporary copy.
				expect(ran.filter((call) => call.args[0] === "--version")).toHaveLength(1);
			});
		}, 120_000);

		it("fails the validation, not on a version, when no openspec is found", async () => {
			await blockedOnAmendment(async ({ harness, env, request, deltaPath }) => {
				const before = readFileSync(deltaPath, "utf8");
				process.env.PATH = temp("cmd-build-empty-path-");
				const result = await runBuild(harness, request, { model: env.model, principal: "jesse" }, context);
				expect(result).toMatchObject({ kind: "amend-failed", exitCode: 2, path: `openspec/changes/${CHANGE}/${DELTA}` });
				const output = result.kind === "amend-failed" ? result.output : "";
				expect(output).toContain("(openspec not found)");
				expect(output).not.toContain("below the minimum");
				expect(readFileSync(deltaPath, "utf8")).toBe(before);
			});
		}, 120_000);
	});

	it("a dirty tree is refused naming --allow-dirty, and --allow-dirty builds over it", async () => {
		const workspace = temp("cmd-build-git-");
		git(workspace, "init", "-q");
		writeChange(workspace, 1);
		const config = configFor(workspace, stagedCheck([true]).command);
		const dirty = prepared([CHANGE], config);
		const { env, harness, storage } = await harnessFor(dirty);
		try {
			const refused = await runBuild(harness, dirty, { model: env.model }, context);
			expect(refused).toMatchObject({ kind: "refused", exitCode: 2 });
			expect(refused.kind === "refused" ? refused.message : "").toContain("--allow-dirty");
			expect(await changeLoops(storage)).toHaveLength(0);

			env.faux.setResponses([verdict(true)]);
			const allowed = await runBuild(harness, prepared([CHANGE, "--allow-dirty"], config), { model: env.model }, context);
			expect(allowed).toMatchObject({ kind: "built", exitCode: 0 });
		} finally {
			await harness.close(context);
		}
	});
});
