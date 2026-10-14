/**
 * change/cli: `close` folds a finished change into `openspec/specs/`. `agentscript-change` in
 * process, in a temp git repository holding `add-plan-export` (a new `plan/export` and a
 * modified `plan/cli`), every stage approved. A change loop, when a test needs one, comes from
 * a real `build` on a faux model, with the test judges as scripts and `true` as both checks.
 * `close` runs the repo's pinned `openspec`, so it goes first on PATH.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatTrialFold, trialFold } from "../../src/task/cmd-close.js";
import { recordApproval } from "../../src/task/spec-approvals.js";
import { SPEC_STAGES } from "../../src/task/spec-stages.js";
import { commitAll, gitIn, write } from "../task/cli-helpers.js";
import { GROUP_JUDGE, JUDGE_ONLY, cleanTemps, temp, verdict } from "../task/helpers.js";
import { CHANGE, change, fakeOpenspec as stagedOpenspec } from "./helpers.js";

/** The repo's pinned `openspec` (1.14.1): `close` validates and archives with it. */
const OPENSPEC_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "node_modules", ".bin");

let savedPath: string | undefined;
beforeEach(() => {
	savedPath = process.env.PATH;
	process.env.PATH = `${OPENSPEC_BIN}:${savedPath ?? ""}`;
});
afterEach(() => {
	process.env.PATH = savedPath;
	cleanTemps();
});

const PROPOSAL = "## Why\nPlans have to leave the tool, for a reason long enough to pass.\n\n## What Changes\n- Exports a plan.\n";
const scenario = (name: string) => `#### Scenario: ${name}\n- **WHEN** it runs\n- **THEN** it SHALL work\n`;
const EXPORT_SPEC = [
	"## Purpose",
	"Plans leave the tool as files another program can read back.",
	"",
	"## ADDED Requirements",
	"", "### Requirement: Plans export", "A plan SHALL export as JSON.", "", scenario("A plan exports")].join("\n");
const CLI_MAIN = [
	"# plan/cli Specification",
	"",
	"## Purpose",
	"The plan command line: what it takes, what it prints and how it exits.",
	"",
	"## Requirements",
	"",
	"### Requirement: Plans list",
	"The CLI SHALL list every plan.",
	"",
	scenario("Plans are listed"),
].join("\n");
const MODIFIED = "The CLI SHALL list every plan, and each plan's export.";
/** Over openspec's 500-character limit: the change validates (MODIFIED text is not measured), the merged spec does not. */
const OVERLONG = `The CLI SHALL list every plan, and each plan's export, ${"with its name, its size and the time it was written, ".repeat(9)}in one table.`;
const cliDelta = (text: string) => ["## MODIFIED Requirements", "", "### Requirement: Plans list", text, "", scenario("Plans are listed")].join("\n");
const TASKS = [
	"## 1. Export",
	"",
	'- [ ] 1.1 `src/export.ts`: "A plan exports"',
	'- [ ] 1.2 `src/export.ts`: "A plan exports"',
	"",
	"## 2. CLI",
	"",
	'- [ ] 2.1 `src/cli.ts`: "Plans are listed"',
	'- [ ] 2.2 `src/cli.ts`: "Plans are listed"',
	'- [ ] 2.3 `src/cli.ts`: "Plans are listed"',
	"",
].join("\n");

/**
 * A git repository with one commit holding the config, `openspec/specs/plan/cli` and
 * `add-plan-export`, every stage approved; the judges and the database live outside it.
 */
function repo(cliText = MODIFIED) {
	const dir = temp("change-close-repo-");
	const changeDir = join(dir, "openspec", "changes", CHANGE);
	write(dir, {
		"agentscript.config.json": JSON.stringify({ task: { changesDir: "openspec/changes" } }),
		"README.md": "# plans\n",
		[join("openspec", "specs", "plan", "cli", "spec.md")]: CLI_MAIN,
		[join("openspec", "changes", CHANGE, "proposal.md")]: PROPOSAL,
		[join("openspec", "changes", CHANGE, "design.md")]: "## Context\nA design.\n",
		[join("openspec", "changes", CHANGE, "specs", "plan", "export", "spec.md")]: EXPORT_SPEC,
		[join("openspec", "changes", CHANGE, "specs", "plan", "cli", "spec.md")]: cliDelta(cliText),
		[join("openspec", "changes", CHANGE, "tasks.md")]: TASKS,
	});
	for (const stage of SPEC_STAGES) recordApproval(changeDir, stage, { principal: "jesse", notes: "", at: "2026-10-13T00:00:00.000Z" }, SPEC_STAGES);
	gitIn(dir, "init", "-q", "-b", "main");
	commitAll(dir, "init");

	const outside = temp("change-close-");
	const script = join(outside, "judge.agent");
	const groupScript = join(outside, "group.agent");
	writeFileSync(script, JUDGE_ONLY);
	writeFileSync(groupScript, GROUP_JUDGE);
	const db = join(outside, "loops.sqlite");
	const buildArgs = ["--db", db, "--script", script, "--group-script", groupScript, "--check", "true", "--change-check", "true"];
	return { dir, changeDir, db, buildArgs };
}

/** Tick every task in tasks.md except `except`, as a principal who did them by hand. */
function tick(changeDir: string, except: readonly string[] = []) {
	const path = join(changeDir, "tasks.md");
	const ticked = readFileSync(path, "utf8").replace(/^- \[ \] (\d+\.\d+) /gm, (line, id: string) => (except.includes(id) ? line : `- [x] ${id} `));
	writeFileSync(path, ticked);
}

/** Every file under `openspec/`, by path relative to it, in path order. */
function snapshot(dir: string): Record<string, string> {
	const root = join(dir, "openspec");
	const files: Record<string, string> = {};
	for (const path of readdirSync(root, { recursive: true, encoding: "utf8" }).sort()) {
		const full = join(root, path);
		if (statSync(full).isFile()) files[relative(root, full)] = readFileSync(full, "utf8");
	}
	return files;
}

/** `openspec validate <change> --strict` in `dir`: the exit code. */
function validateChange(dir: string): number {
	try {
		execFileSync("openspec", ["validate", CHANGE, "--strict"], { cwd: dir, env: { ...process.env, OPENSPEC_TELEMETRY: "0" }, stdio: "pipe" });
		return 0;
	} catch (error) {
		return (error as { status?: number }).status ?? 1;
	}
}

/** Group 1 converges, then 2.1 asks the principal `Which format?`; the build ends blocked, exit 1. */
const blocking = () => [verdict(true), verdict(true), verdict(false, "two formats", "ask", "Which format?")];

describe.skipIf(process.platform === "win32")("change/cli close", () => {
	describe("close refuses an unfinished change", () => {
		it("Scenario: An unticked task refuses close", async () => {
			const { dir, changeDir, db } = repo();
			tick(changeDir, ["2.3"]);
			const before = snapshot(dir);

			const run = await change(["close", CHANGE, "--db", db], dir);
			expect(run.code).toBe(2);
			expect(`${run.out}\n${run.err}`).toContain("2.3");
			expect(snapshot(dir)).toEqual(before);
		}, 60_000);

		it("Scenario: A waiting build refuses close", async () => {
			const { dir, changeDir, db, buildArgs } = repo();
			expect((await change(["build", CHANGE, ...buildArgs], dir, blocking())).code).toBe(1);
			tick(changeDir);
			const before = snapshot(dir);

			const run = await change(["close", CHANGE, "--db", db], dir);
			expect(run.code).toBe(2);
			expect(`${run.out}\n${run.err}`).toMatch(/waiting for an answer/i);
			expect(snapshot(dir)).toEqual(before);
		}, 120_000);
	});

	describe("close folds the change through a trial first", () => {
		it("Scenario: A finished change is folded", async () => {
			const { dir, db, buildArgs } = repo();
			// The older change loop blocked; the newest, answering it, converged: the newest decides.
			expect((await change(["build", CHANGE, ...buildArgs], dir, blocking())).code).toBe(1);
			expect((await change(["build", CHANGE, "JSON only", ...buildArgs], dir, [verdict(true), verdict(true), verdict(true)])).code).toBe(0);
			const head = gitIn(dir, "rev-parse", "HEAD");

			const run = await change(["close", CHANGE, "--db", db], dir);
			expect(run.err).toBe("");
			expect(run.code).toBe(0);

			const specs = join(dir, "openspec", "specs");
			expect(readFileSync(join(specs, "plan", "export", "spec.md"), "utf8")).toContain("### Requirement: Plans export");
			expect(readFileSync(join(specs, "plan", "cli", "spec.md"), "utf8")).toContain(MODIFIED);
			expect(existsSync(join(dir, "openspec", "changes", CHANGE))).toBe(false);
			const archived = readdirSync(join(dir, "openspec", "changes", "archive")).filter((name) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${CHANGE}$`).test(name));
			expect(archived).toHaveLength(1);

			expect(run.out).toContain("plan/export");
			expect(run.out).toContain("plan/cli");
			expect(run.out).toContain(`openspec/changes/archive/${archived[0]}/`);
			expect(run.out.trim()).toMatch(/git add -A openspec && git commit$/);
			// It never commits.
			expect(gitIn(dir, "rev-parse", "HEAD")).toBe(head);
		}, 120_000);

		it("Scenario: A fold that breaks the specs is refused", async () => {
			expect(OVERLONG.length).toBeGreaterThan(500);
			const { dir, changeDir, db } = repo(OVERLONG);
			tick(changeDir);
			expect(validateChange(dir)).toBe(0);
			const before = snapshot(dir);

			const run = await change(["close", CHANGE, "--db", db], dir);
			expect(run.code).toBe(2);
			// Refused by the merged length limit, not by anything else in the fixture.
			expect(run.err).toContain("Requirement text is very long");
			expect(snapshot(dir)).toEqual(before);
			expect(existsSync(join(dir, "openspec", "changes", CHANGE))).toBe(true);
			expect(existsSync(join(dir, "openspec", "changes", "archive"))).toBe(false);
		}, 60_000);
	});

	describe("trialFold folds into a temporary copy only", () => {
		/**
		 * `trialFold` with `tmpdir()` pointed at an empty directory, then: the repository's
		 * `openspec/` is as it was, the change unarchived, and the temporary copy gone.
		 */
		async function fold(change: string, dir: string) {
			const before = snapshot(dir);
			const tmp = temp("trial-fold-tmp-");
			const savedTmp = process.env.TMPDIR;
			process.env.TMPDIR = tmp;
			try {
				return await trialFold(dir, change);
			} finally {
				if (savedTmp === undefined) delete process.env.TMPDIR;
				else process.env.TMPDIR = savedTmp;
				expect(snapshot(dir)).toEqual(before);
				expect(existsSync(join(dir, "openspec", "changes", CHANGE))).toBe(true);
				expect(existsSync(join(dir, "openspec", "changes", "archive"))).toBe(false);
				expect(readdirSync(tmp)).toEqual([]);
			}
		}

		it("passes a change that folds cleanly", async () => {
			const { dir } = repo();
			const result = await fold(CHANGE, dir);
			expect(result).toEqual({ ok: true, command: "openspec validate --specs --strict --json", exit: 0, issues: [] });
		}, 60_000);

		it("fails when validate --specs fails, with openspec's issues", async () => {
			const { dir } = repo(OVERLONG);
			const result = await fold(CHANGE, dir);
			expect(result).toMatchObject({ ok: false, exit: 1, issues: [{ level: "WARNING", spec: "plan/cli" }] });
			expect(result.issues).toHaveLength(1);
			expect(result.issues[0]?.message).toContain("Requirement text is very long");
			expect(result.failure).toBeUndefined();
		}, 60_000);

		it("fails when archive fails, with openspec's output", async () => {
			const { dir } = repo();
			const result = await fold("no-such-change", dir);
			expect(result).toMatchObject({ ok: false, exit: null, issues: [] });
			expect(result.failure).toContain("openspec archive no-such-change --yes failed");
			expect(result.failure).toContain("no-such-change");
		}, 60_000);

		it("removes the copy when a step throws", async () => {
			const dir = temp("trial-fold-no-openspec-");
			const tmp = temp("trial-fold-tmp-");
			const savedTmp = process.env.TMPDIR;
			process.env.TMPDIR = tmp;
			try {
				// No openspec/ to copy: the copy step throws.
				await expect(trialFold(dir, CHANGE)).rejects.toThrow();
			} finally {
				if (savedTmp === undefined) delete process.env.TMPDIR;
				else process.env.TMPDIR = savedTmp;
			}
			expect(readdirSync(tmp)).toEqual([]);
		});
	});

	describe("trialFold reads openspec's JSON report", () => {
		/**
		 * A fake `openspec` first on PATH: `archive` exits 0, `validate` prints `stdout` and
		 * `stderr` and exits `exit`. Returns its argv log, one line per call.
		 */
		function fakeOpenspec(stdout: string, exit: number, stderr = "") {
			const bin = temp("fake-openspec-");
			const log = join(bin, "calls.log");
			writeFileSync(
				join(bin, "openspec"),
				[
					"#!/usr/bin/env node",
					"const { appendFileSync } = require('node:fs');",
					`appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), telemetry: process.env.OPENSPEC_TELEMETRY }) + '\\n');`,
					"if (process.argv[2] !== 'validate') process.exit(0);",
					`process.stdout.write(${JSON.stringify(stdout)});`,
					`process.stderr.write(${JSON.stringify(stderr)});`,
					`process.exitCode = ${exit};`,
				].join("\n"),
				{ mode: 0o755 },
			);
			process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
			return () => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { argv: string[]; telemetry: string });
		}

		const report = (items: unknown[]) => JSON.stringify({ items, summary: {}, version: "1.0" });

		/** `trialFold` with `tmpdir()` pointed at an empty directory, which it must leave empty. */
		async function foldInEmptyTmp(dir: string) {
			const tmp = temp("trial-fold-tmp-");
			const savedTmp = process.env.TMPDIR;
			process.env.TMPDIR = tmp;
			try {
				return await trialFold(dir, CHANGE);
			} finally {
				if (savedTmp === undefined) delete process.env.TMPDIR;
				else process.env.TMPDIR = savedTmp;
				expect(readdirSync(tmp)).toEqual([]);
			}
		}

		it("adds no issue for a report holding only INFO", async () => {
			fakeOpenspec(report([{ id: "core/subset", type: "spec", valid: true, issues: [{ level: "INFO", path: "requirements[0]", message: "consider a scenario" }] }]), 0);
			const { dir } = repo();
			expect(await foldInEmptyTmp(dir)).toEqual({ ok: true, command: "openspec validate --specs --strict --json", exit: 0, issues: [] });
		}, 60_000);

		it("sets failure with stdout and stderr when the output is `not json`", async () => {
			fakeOpenspec("not json", 1, "boom");
			const { dir } = repo();
			const result = await foldInEmptyTmp(dir);
			expect(result).toMatchObject({ ok: false, exit: 1, issues: [] });
			expect(result.failure).toBe("no parseable JSON\nstdout:\nnot json\nstderr:\nboom");
		}, 60_000);

		it("keeps ERROR and WARNING issues of spec items with the spec id, and drops INFO", async () => {
			const calls = fakeOpenspec(
				report([
					{ id: "task/change", type: "spec", valid: false, issues: [
						{ level: "ERROR", path: "requirements[0]", message: "too long" },
						{ level: "INFO", path: "requirements[1]", message: "just so you know" },
					] },
					{ id: "spec/judge", type: "spec", valid: false, issues: [{ level: "WARNING", path: "requirements[2]", message: "very long" }] },
					{ id: "add-thing", type: "change", valid: false, issues: [{ level: "ERROR", path: "x", message: "not a spec" }] },
				]),
				1,
			);
			const { dir } = repo();
			const result = await foldInEmptyTmp(dir);
			expect(result).toEqual({
				ok: false,
				command: "openspec validate --specs --strict --json",
				exit: 1,
				issues: [
					{ level: "ERROR", spec: "task/change", message: "too long" },
					{ level: "WARNING", spec: "spec/judge", message: "very long" },
				],
			});
			expect(calls()).toEqual([
				{ argv: ["archive", CHANGE, "--yes"], telemetry: "0" },
				{ argv: ["validate", "--specs", "--strict", "--json"], telemetry: "0" },
			]);
		}, 60_000);

		it("fails on an ERROR even when validate exits 0", async () => {
			fakeOpenspec(report([{ id: "task/change", type: "spec", valid: false, issues: [
				{ level: "ERROR", path: "requirements[0]", message: "too long" },
				{ level: "INFO", path: "requirements[1]", message: "just so you know" },
			] }]), 0);
			const { dir } = repo();
			expect(await trialFold(dir, CHANGE)).toEqual({
				ok: false,
				command: "openspec validate --specs --strict --json",
				exit: 0,
				issues: [{ level: "ERROR", spec: "task/change", message: "too long" }],
			});
		}, 60_000);

		it("passes on exit 0 with an empty report", async () => {
			fakeOpenspec(report([]), 0);
			const { dir } = repo();
			expect(await trialFold(dir, CHANGE)).toEqual({ ok: true, command: "openspec validate --specs --strict --json", exit: 0, issues: [] });
		}, 60_000);

		it("sets failure when stdout is not JSON", async () => {
			fakeOpenspec("Totals: 0 passed, 1 failed\n", 1, "boom\n");
			const { dir } = repo();
			const result = await trialFold(dir, CHANGE);
			expect(result).toMatchObject({ ok: false, exit: 1, issues: [] });
			expect(result.failure).toMatch(/^no parseable JSON/);
			expect(result.failure).toContain("Totals: 0 passed, 1 failed");
			expect(result.failure).toContain("boom");
		}, 60_000);

		it("sets failure when the report has no items array", async () => {
			fakeOpenspec(JSON.stringify({ version: "2.0", results: [] }), 0);
			const { dir } = repo();
			const result = await trialFold(dir, CHANGE);
			expect(result.ok).toBe(false);
			expect(result.failure).toMatch(/^no parseable JSON/);
		}, 60_000);

		it("Scenario: openspec cannot be spawned", async () => {
			const { dir } = repo();
			process.env.PATH = temp("empty-path-");
			const result = await foldInEmptyTmp(dir);
			expect(result).toMatchObject({ ok: false, exit: null, issues: [] });
			expect(result.failure).toContain("spawn openspec ENOENT");
		}, 60_000);
	});

	describe("formatTrialFold", () => {
		const base = { command: "openspec validate --specs --strict --json", issues: [] } as const;

		it("prints a failure with its exit, or as could not run", () => {
			expect(formatTrialFold({ ...base, ok: false, exit: 1, failure: "no parseable JSON\nstdout:\nx\nstderr:\n" })).toBe(
				"folded into a copy of openspec/, openspec validate --specs --strict failed (exit 1):\nno parseable JSON\nstdout:\nx\nstderr:\nopenspec/ is unchanged",
			);
			expect(formatTrialFold({ ...base, ok: false, exit: null, failure: "spawn openspec ENOENT" })).toBe(
				"folded into a copy of openspec/, openspec validate --specs --strict could not run:\nspawn openspec ENOENT\nopenspec/ is unchanged",
			);
		});

		it("prints a pass in one line", () => {
			expect(formatTrialFold({ ...base, ok: true, exit: 0 })).toBe("folded into a copy of openspec/, openspec validate --specs --strict passed");
		});
	});

	it("close prints the golden text on a failing fold", async () => {
		const { dir, changeDir, db } = repo(OVERLONG);
		tick(changeDir);
		const run = await change(["close", CHANGE, "--db", db], dir);
		expect(run.code).toBe(2);
		expect(run.out).toBe("");
		// Before add-trial-fold-check, the middle lines were openspec's own text report
		// (`Totals: …`, `Details: …`, `✗ spec/plan/cli`, `  ⚠ [WARNING] requirements[0]: …`);
		// the first line, the message and the last line are unchanged.
		expect(run.err).toBe(
			[
				"folded into a copy of openspec/, openspec validate --specs --strict failed (exit 1):",
				"✗ [WARNING] plan/cli: Requirement text is very long (>500 characters). Move examples and edge cases into scenarios, or split it into separate requirements that each state one behavior.",
				"openspec/ is unchanged",
			].join("\n"),
		);
	}, 60_000);

	/** `validate --specs --strict --json` as openspec 1.14.1 shapes it: an ERROR, a WARNING on another spec, and an INFO. */
	const FAILING_REPORT = {
		exit: 1,
		stdout: JSON.stringify({
			items: [
				{ id: "spec/judge", type: "spec", valid: false, issues: [
					{ level: "ERROR", path: "requirements[0]", message: 'Requirement "The judge scores each draft" text exceeds 500 characters (612)' },
					{ level: "INFO", path: "requirements[1]", message: "consider a scenario" },
				] },
				{ id: "core/subset", type: "spec", valid: true, issues: [{ level: "WARNING", path: "purpose", message: "Purpose section is too brief" }] },
			],
			summary: {},
			version: "1.0",
		}),
	};

	/** The trial copy each validate call ran in, as the fake logged it. */
	const validateCwds = (fake: ReturnType<typeof stagedOpenspec>) => fake.calls().filter((call) => call.args.join(" ") === "validate --specs --strict --json").map((call) => call.cwd);

	it("close prints formatTrialFold's text for openspec's JSON report, as the build does", async () => {
		const { dir, changeDir, db } = repo();
		tick(changeDir);
		// The guard and the trial archive run the real openspec.
		const fake = stagedOpenspec({ replies: { validateSpecs: FAILING_REPORT } });
		const before = snapshot(dir);

		const run = await change(["close", CHANGE, "--db", db], dir);
		expect(run.code).toBe(2);
		expect(run.out).toBe("");
		// A literal, never computed with formatTrialFold.
		const golden = [
			"folded into a copy of openspec/, openspec validate --specs --strict failed (exit 1):",
			'✗ [ERROR] spec/judge: Requirement "The judge scores each draft" text exceeds 500 characters (612)',
			"✗ [WARNING] core/subset: Purpose section is too brief",
			"openspec/ is unchanged",
		].join("\n");
		expect(run.err).toBe(golden);
		expect(snapshot(dir)).toEqual(before);
		expect(existsSync(join(dir, "openspec", "changes", "archive"))).toBe(false);
		expect(fake.calls().filter((call) => call.args.join(" ") === "validate --specs --strict --json").map((call) => call.telemetry)).toEqual(["0"]);

		expect(formatTrialFold(await trialFold(dir, CHANGE))).toBe(golden);
	}, 60_000);

	it("Scenario: INFO issues are dropped", async () => {
		const { dir } = repo();
		const tooLong = 'Requirement "The change loop folds" text exceeds 500 characters (612)';
		const fake = stagedOpenspec({
			replies: {
				validateSpecs: {
					exit: 1,
					stdout: JSON.stringify({
						items: [{ id: "task/change", type: "spec", valid: false, issues: [
							{ level: "ERROR", path: "requirements[0]", message: tooLong },
							{ level: "INFO", path: "requirements[1]", message: "consider a scenario" },
						] }],
						summary: {},
						version: "1.0",
					}),
				},
			},
		});

		const result = await trialFold(dir, CHANGE);
		expect(result).toEqual({
			ok: false,
			command: "openspec validate --specs --strict --json",
			exit: 1,
			issues: [{ level: "ERROR", spec: "task/change", message: tooLong }],
		});
		const validates = fake.calls().filter((call) => call.args[0] === "validate" && call.args.includes("--specs"));
		expect(validates.map((call) => ({ args: call.args, telemetry: call.telemetry }))).toEqual([{ args: ["validate", "--specs", "--strict", "--json"], telemetry: "0" }]);
		expect(existsSync(validates[0]!.cwd)).toBe(false);
	}, 60_000);

	it("Scenario: A fold with no parseable JSON", async () => {
		const { dir } = repo();
		const fake = stagedOpenspec({ replies: { validateSpecs: { exit: 1, stdout: "Totals: 0 passed, 1 failed\n", stderr: "openspec: boom\n" } } });
		const before = snapshot(dir);

		const result = await trialFold(dir, CHANGE);
		expect(snapshot(dir)).toEqual(before);
		expect(result).toMatchObject({ ok: false, exit: 1, issues: [] });
		expect(result.failure).toMatch(/no parseable JSON/);
		expect(result.failure).toContain("Totals: 0 passed, 1 failed");
		expect(result.failure).toContain("openspec: boom");
		const cwds = validateCwds(fake);
		expect(cwds).toHaveLength(1);
		expect(existsSync(cwds[0]!)).toBe(false);
	}, 60_000);
});
