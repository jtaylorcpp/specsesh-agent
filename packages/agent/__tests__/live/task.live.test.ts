/**
 * `pnpm test:live`: the task runner, headless, on a copy of this repo, on your
 * Claude subscription. The only test that makes real model calls; never part of
 * `pnpm test` (vitest.config.ts excludes `__tests__/live/`).
 *
 * The copy is this working tree without `.git` and `node_modules` (each
 * `node_modules` is symlinked back, and excluded from git), committed in a fresh
 * repository with a fixture change, `fixture-live-task`, whose one task replaces a
 * stale comment. The run uses the repo config, with `--check` narrowed to the
 * fixture's own vitest file so a run costs one small task, not the whole suite.
 * Each run has a limit below the test timeout and never outlives its test: see
 * spawn.ts. A last run drafts the proposal of a new change, `fixture-live-spec`,
 * with `spec`, and checks it against the proposal stage's own gate.
 *
 * It needs `claude` installed and logged in, and skips saying why otherwise. Login
 * is asked of `claude auth status`; set AGENTSCRIPT_LIVE_FORCE=1 to skip that
 * question if your claude has no such command.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { proposalStage } from "../../src/task/index.js";
import { issueLine } from "../../src/task/spec-loop.js";
import { claudeReady } from "./ready.js";
import { killRunning, RUN_LIMIT_MS, startDetached, type Run } from "./spawn.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CHANGE = "fixture-live-task";
const GROUP = "fixture-live-group";
const SPEC = "fixture-live-spec";
const GROUP_CHECK ="node packages/agent/__tests__/live-fixture/greet-check.mjs";
const TARGET = "packages/agent/__tests__/live-fixture/target.ts";
const STALE = "// STALE: this comment describes the old regex parser.";
const FRESH = "// Parsed by the agentforce dialect.";
const CHECK = "pnpm --filter @specsesh/agent exec vitest run --config __tests__/live-fixture/vitest.config.ts";

const ready = claudeReady();
if (!ready.ok) console.warn(`pnpm test:live skipped: ${ready.reason}`);

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", ["-c", "user.email=live@example.com", "-c", "user.name=live", ...args], { cwd, encoding: "utf8" });

/** Every `node_modules` directory of the workspace, outside other `node_modules`. */
function nodeModulesDirs(dir: string, depth = 0): string[] {
	if (depth > 3) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (!entry.isDirectory() || entry.name === ".git") return [];
		const path = join(dir, entry.name);
		return entry.name === "node_modules" ? [path] : nodeModulesDirs(path, depth + 1);
	});
}

let tmp = "";
let copy = "";

beforeAll(() => {
	if (!ready.ok) return;
	tmp = mkdtempSync(join(tmpdir(), "agentscript-live-"));
	copy = join(tmp, basename(REPO));
	const skip = new Set(["node_modules", ".git", ".agentscript", ".wrangler"]);
	cpSync(REPO, copy, { recursive: true, filter: (src) => !skip.has(basename(src)) });
	for (const modules of nodeModulesDirs(REPO)) symlinkSync(modules, join(copy, relative(REPO, modules)));

	const fixture = join(copy, "packages/agent/__tests__/live-fixture");
	mkdirSync(fixture, { recursive: true });
	writeFileSync(join(copy, TARGET), `${STALE}\nexport const fixture = 1;\n`);
	writeFileSync(
		join(fixture, "target.test.ts"),
		`import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("fixture-live-task", () => {
	it("the comment is current", () => {
		const text = readFileSync(new URL("./target.ts", import.meta.url), "utf8");
		expect(text.split("\\n")[0]).toBe(${JSON.stringify(FRESH)});
		expect(text).not.toContain("STALE");
	});
});
`,
	);
	writeFileSync(
		join(fixture, "vitest.config.ts"),
		`import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["__tests__/live-fixture/target.test.ts"] } });\n`,
	);
	const change = join(copy, "openspec/changes", CHANGE);
	mkdirSync(join(change, "specs/live/fixture"), { recursive: true });
	writeFileSync(join(change, "proposal.md"), "## Why\n\nA stale comment in the live fixture misleads readers.\n\n## What Changes\n\n- Replace it with the current one.\n");
	writeFileSync(
		join(change, "specs/live/fixture/spec.md"),
		`## ADDED Requirements\n\n### Requirement: The fixture comment is current\n\`${TARGET}\` SHALL begin with the line \`${FRESH}\`.\n\n#### Scenario: The comment is current\n- **WHEN** \`${TARGET}\` is read\n- **THEN** its first line SHALL be \`${FRESH}\`\n`,
	);
	writeFileSync(
		join(change, "tasks.md"),
		`## 1. Fixture\n\n- [ ] 1.1 In \`${TARGET}\`, replace the line \`${STALE}\` with exactly \`${FRESH}\`. Change nothing else.\n`,
	);

	// A second change, a two-task group: 1.2 builds on what 1.1 wrote.
	writeFileSync(
		join(fixture, "greet-check.mjs"),
		`import { readFileSync } from "node:fs";
const lines = readFileSync("greet.txt", "utf8").trimEnd().split("\\n");
if (lines.join("|") !== "hello|world") {
	console.error("greet.txt must be the lines hello and world, got " + JSON.stringify(lines));
	process.exit(1);
}
`,
	);
	const group = join(copy, "openspec/changes", GROUP);
	mkdirSync(join(group, "specs/live/greeting"), { recursive: true });
	writeFileSync(join(group, "proposal.md"), "## Why\n\nThe live run needs a group of two small tasks.\n\n## What Changes\n\n- Add a greeting file in two steps.\n");
	writeFileSync(
		join(group, "specs/live/greeting/spec.md"),
		"## ADDED Requirements\n\n### Requirement: The greeting file is written\n`greet.txt` SHALL hold the line `hello`, then the line `world`.\n\n#### Scenario: The first line\n- **WHEN** `greet.txt` is read\n- **THEN** its first line SHALL be `hello`\n\n#### Scenario: The second line\n- **WHEN** `greet.txt` is read\n- **THEN** its second line SHALL be `world`\n",
	);
	writeFileSync(
		join(group, "tasks.md"),
		"## 1. Greeting\n\n- [ ] 1.1 Create `greet.txt` at the repository root holding exactly one line, `hello`.\n- [ ] 1.2 Append a second line, `world`, to `greet.txt`. Keep the `hello` line first.\n",
	);

	git(copy, "init", "-q", "-b", "main");
	appendFileSync(join(copy, ".git/info/exclude"), "node_modules\n");
	git(copy, "add", "-A");
	git(copy, "commit", "-q", "-m", "live copy");
}, 600_000);

// No run outlives its test: whatever ended the test, its runner's process group goes too.
afterEach(killRunning);

afterAll(() => {
	killRunning();
	if (tmp !== "") rmSync(tmp, { recursive: true, force: true });
});

/**
 * The copy's built bin, headless: stdin closed, no AGENTSCRIPT_* overrides, so the
 * repo config decides. In its own process group, killed with its `claude` children
 * at RUN_LIMIT_MS, which fails the test saying so.
 */
function runTask(args: string[]): Promise<Run> {
	const env = { ...process.env };
	delete env.AGENTSCRIPT_PROVIDER;
	delete env.AGENTSCRIPT_MODEL;
	return startDetached(process.execPath, [join(copy, "packages/agent/dist/bin/agentscript-task.js"), ...args], {
		cwd: copy,
		env,
		limitMs: RUN_LIMIT_MS,
		echo: true,
	}).done;
}

describe("task/headless: An opt-in live run proves it works on this repo", () => {
	it("Scenario: The live run converges and ticks the task", async (ctx) => {
		if (!ready.ok) return ctx.skip(ready.reason);
		const r = await runTask(["run", CHANGE, "1.1", "--check", CHECK]);
		expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
		expect(r.events.at(-1)).toMatchObject({ event: "loop-ended", status: "converged", ticked: true, changed: [TARGET] });
		expect(readFileSync(join(copy, "openspec/changes", CHANGE, "tasks.md"), "utf8")).toContain("- [x] 1.1 ");
		expect(readFileSync(join(copy, TARGET), "utf8").split("\n")[0]).toBe(FRESH);
	});

	it("and again in a worktree, leaving the main copy's HEAD and files as they were", async (ctx) => {
		if (!ready.ok) return ctx.skip(ready.reason);
		const head = git(copy, "rev-parse", "HEAD").trim();
		const status = git(copy, "status", "--porcelain");
		const target = readFileSync(join(copy, TARGET), "utf8");
		const r = await runTask(["run", CHANGE, "1.1", "--worktree", "--db", ".agentscript/live-worktree.sqlite", "--check", CHECK]);
		expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
		const worktree = join(tmp, `${basename(copy)}-worktrees`, `${CHANGE}-1.1`);
		expect(existsSync(worktree)).toBe(true);
		expect(git(worktree, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(`task/${CHANGE}/1.1`);
		expect(readFileSync(join(worktree, TARGET), "utf8").split("\n")[0]).toBe(FRESH);
		expect(readFileSync(join(worktree, "openspec/changes", CHANGE, "tasks.md"), "utf8")).toContain("- [x] 1.1 ");
		expect(git(copy, "rev-parse", "HEAD").trim()).toBe(head);
		expect(git(copy, "status", "--porcelain")).toBe(status);
		expect(readFileSync(join(copy, TARGET), "utf8")).toBe(target);
		expect(r.stdout).toContain(`git worktree remove ${worktree}`);
	});

	it("Scenario: A live group converges", async (ctx) => {
		if (!ready.ok) return ctx.skip(ready.reason);
		// The runs above leave edits behind and the runner refuses a dirty tree: commit them.
		if (git(copy, "status", "--porcelain").trim() !== "") {
			git(copy, "add", "-A");
			git(copy, "commit", "-q", "-m", "after the task runs");
		}
		// A bare integer is a group; the repo config supplies provider, models and database.
		// Only the group check is narrowed, as the task run's is, to keep the run small.
		const r = await runTask(["run", GROUP, "1", "--check", GROUP_CHECK]);
		expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
		const started = r.events.findIndex((e) => e.event === "group-started");
		const ended = r.events.filter((e) => e.event === "group-ended");
		expect(started, r.stderr).toBe(0);
		expect(ended).toHaveLength(1);
		expect(ended[0]).toMatchObject({ status: "converged" });
		const tasks = (ended[0]!.tasks as { task: string; status: string }[]).map(({ task, status }) => ({ task, status }));
		expect(tasks).toEqual([
			{ task: "1.1", status: "converged" },
			{ task: "1.2", status: "converged" },
		]);
		const ticked = readFileSync(join(copy, "openspec/changes", GROUP, "tasks.md"), "utf8");
		expect(ticked).toMatch(/^- \[x\] 1\.1 /m);
		expect(ticked).toMatch(/^- \[x\] 1\.2 /m);
	});

	it("Scenario: The live proposal reaches review clean", async (ctx) => {
		if (!ready.ok) return ctx.skip(ready.reason);
		// spec never checks the tree is clean, and the gate is shape and facts, not quality.
		const r = await runTask(["spec", SPEC, "--intent", "Add a --quiet flag to agentscript-task status that prints only loop ids"]);
		expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
		const review = r.events.find((e) => e.event === "stage-review");
		expect(review, r.stderr).toBeDefined();
		const files = review!.files as string[];
		expect(files).toContain("proposal.md");
		const changeDir = join(copy, "openspec/changes", SPEC);
		const proposal = join(changeDir, "proposal.md");
		expect(existsSync(proposal)).toBe(true);
		const issues = await proposalStage.gate({
			changeId: SPEC,
			workspace: copy,
			changeDir,
			files: { "proposal.md": readFileSync(proposal, "utf8") },
			run: async () => {
				throw new Error("the proposal gate runs no command");
			},
		});
		const blocking = issues.filter((issue) => issue.level === "ERROR" || issue.level === "WARNING");
		expect(blocking, blocking.map(issueLine).join("\n")).toEqual([]);
	});
});
