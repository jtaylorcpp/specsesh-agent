import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	FAKE_CLAUDE_CONFIG,
	cli,
	events,
	fakeClaude,
	fakeClaudeWriting,
	fauxModels,
	gitIn,
	gitRepo,
	spawnBin,
	storedGroupLoops,
	storedLoops,
	workdir,
	write,
} from "./cli-helpers.js";
import { checkWorktree, createWorktree, planWorktree, runSetup, worktreeBranch, worktreeSlug } from "../../src/task/worktree.js";
import { PROPOSAL, DELTA, TASKS, cleanTemps, temp, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

/** Where worktree mode puts tiny's task by default: `../<repo-dir-name>-worktrees/tiny-<task>`. */
const worktreeOf = (repo: string, task: string) => join(dirname(repo), "repo-worktrees", `tiny-${task}`);

const lines = (stderr: string) => stderr.trimEnd().split("\n");

/** Run tiny `task` in worktree mode in process, on the faux model with JUDGE_ONLY. */
async function runWorktree(repo: string, task = "1.1", extra: string[] = []) {
	const { script, db } = workdir();
	const env = fauxModels();
	env.faux.setResponses([verdict(true)]);
	const r = await cli(["run", "tiny", task, "--worktree", "--db", db, "--script", script, ...env.args, ...extra], env, { cwd: repo });
	return { ...r, db };
}

describe("task/headless: --worktree runs the loop in a new git worktree", () => {
	it("Scenario: A task runs in its own worktree", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const head = gitIn(repo, "rev-parse", "HEAD").trim();
		const r = await spawnBin(["run", "tiny", "1.1", "--worktree", "--db", ".agentscript/task-1.1.sqlite"], { cwd: repo, bin: fakeClaude() });
		expect(r.code, r.stderr).toBe(0);
		const worktree = worktreeOf(repo, "1.1");
		expect(existsSync(worktree)).toBe(true);
		expect(gitIn(worktree, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("task/tiny/1.1");
		expect(readFileSync(join(worktree, "src", "a.ts"), "utf8")).toContain("// edited");
		expect(readFileSync(join(worktree, "openspec/changes/tiny/tasks.md"), "utf8")).toContain("- [x] 1.1 ");
		// The main tree: same HEAD, no edit, no tick (its database sits in the ignored .agentscript/).
		expect(gitIn(repo, "rev-parse", "HEAD").trim()).toBe(head);
		expect(gitIn(repo, "status", "--porcelain")).toBe("");
		expect(readFileSync(join(repo, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
		expect(readFileSync(join(repo, "openspec/changes/tiny/tasks.md"), "utf8")).toContain("- [ ] 1.1 ");
		const ended = events(lines(r.stderr)).find((e) => e["event"] === "loop-ended");
		expect(ended).toMatchObject({ status: "converged", ticked: true, changed: ["src/a.ts"] });
	});

	it("rebases the workspace, the change and the config's paths into the worktree", async () => {
		const repo = gitRepo({
			"CLAUDE.md": "# main\n",
			"agentscript.config.json": JSON.stringify({ delegates: { claude_code: { runner: "claude-code", context: ["CLAUDE.md", "/elsewhere/NOTES.md"] } } }),
		});
		const r = await runWorktree(repo);
		expect(r.code, r.err).toBe(0);
		const worktree = worktreeOf(repo, "1.1");
		const [input] = (await storedLoops(r.db)).inputs;
		expect(input).toMatchObject({
			workspace: worktree,
			tasksPath: join(worktree, "openspec/changes/tiny/tasks.md"),
			delegates: { claude_code: { context: [join(worktree, "CLAUDE.md"), "/elsewhere/NOTES.md"] } },
			worktree: { path: worktree, branch: "task/tiny/1.1" },
		});
	});

	it("refuses outside a git repository", async () => {
		const { dir } = workdir();
		write(dir, { "openspec/changes/tiny/proposal.md": PROPOSAL, "openspec/changes/tiny/specs/v/spec.md": DELTA, "openspec/changes/tiny/tasks.md": TASKS });
		const r = await runWorktree(dir);
		expect(r.code).toBe(2);
		expect(r.err).toContain("needs a git repository");
	});
});

describe("task/headless: A worktree is never reused or clobbered by run", () => {
	it("Scenario: An existing branch refuses the run", async () => {
		const repo = gitRepo();
		gitIn(repo, "branch", "task/tiny/1.1");
		const r = await runWorktree(repo);
		expect(r.code).toBe(2);
		expect(r.err).toContain("task/tiny/1.1");
		expect(existsSync(worktreeOf(repo, "1.1"))).toBe(false);
		expect(existsSync(r.db)).toBe(false);
	});

	it("an existing worktree path refuses the run", async () => {
		const repo = gitRepo();
		mkdirSync(worktreeOf(repo, "1.1"), { recursive: true });
		writeFileSync(join(worktreeOf(repo, "1.1"), "keep.txt"), "mine");
		const r = await runWorktree(repo);
		expect(r.code).toBe(2);
		expect(r.err).toContain(worktreeOf(repo, "1.1"));
		expect(readFileSync(join(worktreeOf(repo, "1.1"), "keep.txt"), "utf8")).toBe("mine");
		expect(gitIn(repo, "branch", "--list", "task/*").trim()).toBe("");
	});

	it("Scenario: An uncommitted change refuses worktree mode", async () => {
		const repo = gitRepo();
		write(repo, { "openspec/changes/fresh/proposal.md": PROPOSAL, "openspec/changes/fresh/specs/v/spec.md": DELTA, "openspec/changes/fresh/tasks.md": TASKS });
		const { script, db } = workdir();
		const r = await cli(["run", "fresh", "1.1", "--worktree", "--db", db, "--script", script, ...fauxModels().args], fauxModels(), { cwd: repo });
		expect(r.code).toBe(2);
		expect(r.err).toContain("not committed at HEAD");
		expect(existsSync(join(dirname(repo), "repo-worktrees", "fresh-1.1"))).toBe(false);
	});
});

describe("task/headless: Worktree setup runs before the loop", () => {
	it("Scenario: A failing setup command leaves the worktree", async () => {
		const repo = gitRepo({ "agentscript.config.json": JSON.stringify({ task: { worktreeSetup: ["pnpm install --frozen-lockfile --offline"] } }) });
		const bin = fakeClaude({ pnpmExit: 1 });
		const saved = process.env.PATH;
		process.env.PATH = `${bin}:${saved ?? ""}`;
		try {
			const r = await runWorktree(repo);
			expect(r.code).toBe(1);
			expect(r.err).toContain("pnpm install --frozen-lockfile --offline");
			expect(r.err).toContain("fake pnpm install --frozen-lockfile --offline");
			expect(existsSync(worktreeOf(repo, "1.1"))).toBe(true);
			expect(existsSync(r.db)).toBe(false);
		} finally {
			process.env.PATH = saved;
		}
	});

	it("runs each setup command in the worktree, in order, before the loop", async () => {
		const repo = gitRepo({
			"agentscript.config.json": JSON.stringify({
				task: { worktreeSetup: ["node -e require('fs').writeFileSync('.agentscript-setup','1')", "node -e require('fs').appendFileSync('.agentscript-setup','2')"] },
			}),
			".gitignore": ".agentscript/\n.agentscript-setup\n",
		});
		const r = await runWorktree(repo);
		expect(r.code, r.err).toBe(0);
		expect(readFileSync(join(worktreeOf(repo, "1.1"), ".agentscript-setup"), "utf8")).toBe("12");
		expect(existsSync(join(repo, ".agentscript-setup"))).toBe(false);
	});
});

describe("task/headless: In worktree mode the main tree may be dirty", () => {
	it("Scenario: Working in the main tree while a task runs", async () => {
		const repo = gitRepo({ "README.md": "# hi\n" });
		writeFileSync(join(repo, "README.md"), "# being edited\n");
		const r = await runWorktree(repo);
		expect(r.code, r.err).toBe(0);
		expect((await storedLoops(r.db)).loops).toHaveLength(1);
		const warning = events(r.errLines).find((e) => e["event"] === "warning");
		expect(String(warning?.["message"])).toContain("1 uncommitted change is in the main tree and not in the worktree");
		expect(readFileSync(join(worktreeOf(repo, "1.1"), "README.md"), "utf8")).toBe("# hi\n");
	});
});

describe("task/headless: Worktree mode requires an explicit database", () => {
	it("Scenario: A worktree run without --db is refused", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const r = await cli(["run", "tiny", "1.1", "--worktree"], fauxModels(), { cwd: repo });
		expect(r.code).toBe(2);
		expect(r.err).toContain("worktree mode needs --db");
		expect(existsSync(worktreeOf(repo, "1.1"))).toBe(false);
		expect(existsSync(join(repo, ".agentscript"))).toBe(false);
	});

	it("worktree: true in the config needs --db too", async () => {
		const repo = gitRepo({ "agentscript.config.json": JSON.stringify({ task: { worktree: true, db: "x.sqlite" } }) });
		const r = await cli(["run", "tiny", "1.1"], fauxModels(), { cwd: repo });
		expect(r.code).toBe(2);
		expect(r.err).toContain("worktree mode needs --db");
	});
});

describe("task/headless: Worktree tasks can run in parallel", () => {
	it("Scenario: Two tasks run at once", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const bin = fakeClaude();
		const env = { FAKE_CLAUDE_SLEEP_MS: "300" };
		const closed: Record<string, number> = {};
		const run = (task: string, db: string) =>
			spawnBin(["run", "tiny", task, "--worktree", "--db", db], { cwd: repo, bin, env }).then((r) => {
				closed[task] = Date.now();
				return r;
			});
		const [a, b] = await Promise.all([run("1.1", ".agentscript/a.sqlite"), run("1.2", ".agentscript/b.sqlite")]);
		expect(a.code, a.stderr).toBe(0);
		expect(b.code, b.stderr).toBe(0);
		const startedAt = (r: typeof a) => Date.parse(String(events(lines(r.stderr)).find((e) => e["event"] === "loop-started")?.["at"]));
		// Each started before the other finished: they ran at the same time.
		expect(startedAt(a)).toBeLessThan(closed["1.2"] as number);
		expect(startedAt(b)).toBeLessThan(closed["1.1"] as number);
		expect(gitIn(worktreeOf(repo, "1.1"), "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("task/tiny/1.1");
		expect(gitIn(worktreeOf(repo, "1.2"), "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("task/tiny/1.2");
		expect(readFileSync(join(worktreeOf(repo, "1.1"), "openspec/changes/tiny/tasks.md"), "utf8")).toMatch(/- \[x\] 1\.1 [\s\S]*- \[ \] 1\.2 /);
		expect(readFileSync(join(worktreeOf(repo, "1.2"), "openspec/changes/tiny/tasks.md"), "utf8")).toMatch(/- \[ \] 1\.1 [\s\S]*- \[x\] 1\.2 /);
		expect((await storedLoops(join(repo, ".agentscript/a.sqlite"))).inputs.map((i) => i.task)).toEqual(["1.1"]);
		expect((await storedLoops(join(repo, ".agentscript/b.sqlite"))).inputs.map((i) => i.task)).toEqual(["1.2"]);
	});
});

/** Where worktree mode puts tiny's group by default: `../<repo-dir-name>-worktrees/tiny-<group>`. */
const groupWorktreeOf = (repo: string, group: number) => join(dirname(repo), "repo-worktrees", `tiny-${group}`);

/** `run tiny <group> --worktree` in process, on the faux model; the refusals under test come before any model turn. */
async function runGroupWorktree(repo: string, group = 1, extra: string[] = []) {
	const { db } = workdir();
	const env = fauxModels();
	const r = await cli(["run", "tiny", String(group), "--worktree", "--db", db, ...env.args, ...extra], env, { cwd: repo });
	return { ...r, db };
}

describe("task/headless: A group runs in one worktree", () => {
	it("names a group's worktree and branch after the change and the group", () => {
		expect(worktreeSlug("add-group-loop", { kind: "group", group: 2 })).toBe("add-group-loop-2");
		expect(worktreeBranch("add-group-loop", { kind: "group", group: 2 })).toBe("task/add-group-loop/2");
	});

	it("keeps a task's worktree and branch names", () => {
		expect(worktreeSlug("tiny", { kind: "task", task: "1.1" })).toBe("tiny-1.1");
		expect(worktreeBranch("tiny", { kind: "task", task: "1.1" })).toBe("task/tiny/1.1");
	});

	it("Scenario: A group runs in its own worktree (plan, create and setup)", () => {
		const repo = gitRepo();
		const head = gitIn(repo, "rev-parse", "HEAD").trim();
		const plan = planWorktree({ cwd: repo, changeId: "tiny", target: { kind: "group", group: 1 } });
		expect(plan.path).toBe(groupWorktreeOf(repo, 1));
		expect(plan.branch).toBe("task/tiny/1");
		checkWorktree(plan, join(repo, "openspec/changes/tiny"));
		createWorktree(plan);
		expect(gitIn(plan.path, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("task/tiny/1");
		expect(runSetup(["git status"], plan.path)).toEqual({ ok: true });
		expect(gitIn(repo, "rev-parse", "HEAD").trim()).toBe(head);
		expect(gitIn(repo, "status", "--porcelain")).toBe("");
	});

	it("an existing branch or path for the group refuses and is left alone", () => {
		const repo = gitRepo();
		const change = join(repo, "openspec/changes/tiny");
		gitIn(repo, "branch", "task/tiny/1");
		const plan = planWorktree({ cwd: repo, changeId: "tiny", target: { kind: "group", group: 1 } });
		expect(() => checkWorktree(plan, change)).toThrow(/task\/tiny\/1/);
		gitIn(repo, "branch", "-D", "task/tiny/1");
		mkdirSync(plan.path, { recursive: true });
		writeFileSync(join(plan.path, "keep.txt"), "mine");
		expect(() => checkWorktree(plan, change)).toThrow(plan.path);
		expect(readFileSync(join(plan.path, "keep.txt"), "utf8")).toBe("mine");
		expect(gitIn(repo, "branch", "--list", "task/*").trim()).toBe("");
	});

	it("an uncommitted change refuses worktree mode for a group", () => {
		const repo = gitRepo();
		write(repo, { "openspec/changes/fresh/proposal.md": PROPOSAL, "openspec/changes/fresh/specs/v/spec.md": DELTA, "openspec/changes/fresh/tasks.md": TASKS });
		const plan = planWorktree({ cwd: repo, changeId: "fresh", target: { kind: "group", group: 1 } });
		expect(() => checkWorktree(plan, join(repo, "openspec/changes/fresh"))).toThrow(/not committed at HEAD/);
		expect(existsSync(plan.path)).toBe(false);
	});

	it("a group worktree run without --db is refused", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const r = await cli(["run", "tiny", "1", "--worktree"], fauxModels(), { cwd: repo });
		expect(r.code).toBe(2);
		expect(r.err).toContain("worktree mode needs --db");
		expect(existsSync(groupWorktreeOf(repo, 1))).toBe(false);
	});

	it("an existing group branch refuses the run before anything is created", async () => {
		const repo = gitRepo();
		gitIn(repo, "branch", "task/tiny/1");
		const r = await runGroupWorktree(repo);
		expect(r.code).toBe(2);
		expect(r.err).toContain("task/tiny/1");
		expect(existsSync(groupWorktreeOf(repo, 1))).toBe(false);
		expect(existsSync(r.db)).toBe(false);
	});
});

describe("task/headless: The loop remembers its worktree", () => {
	it("Scenario: Resume finds the worktree", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const db = ".agentscript/w.sqlite";
		const killed = await spawnBin(["run", "tiny", "1.1", "--worktree", "--db", db], {
			cwd: repo,
			bin: fakeClaude(),
			env: { FAKE_CLAUDE_SLEEP_MS: "5000" },
			onStderr: (text, kill) => {
				if (text.includes('"event":"loop-started"')) kill();
			},
		});
		expect(killed.code).not.toBe(0);
		const id = /^loop (\d+)/.exec(killed.stderr)?.[1];
		expect(id).toBeDefined();
		const worktree = worktreeOf(repo, "1.1");
		expect(readFileSync(join(worktree, "src", "a.ts"), "utf8")).not.toContain("// edited");

		const resumed = await spawnBin(["resume", String(id), "--db", db], { cwd: repo, bin: fakeClaude() });
		expect(resumed.code, resumed.stderr).toBe(0);
		expect(readFileSync(join(worktree, "src", "a.ts"), "utf8")).toContain("// edited");
		expect(readFileSync(join(worktree, "openspec/changes/tiny/tasks.md"), "utf8")).toContain("- [x] 1.1 ");
		expect(readFileSync(join(repo, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
		const parsed = events(["", ...lines(resumed.stderr)]);
		expect(parsed.some((e) => e["event"] === "warning" && String(e["message"]).includes("stale lock"))).toBe(true);
		expect(parsed.at(-1)).toMatchObject({ event: "loop-ended", status: "converged", changed: ["src/a.ts"] });
		expect(resumed.stdout).toContain(`worktree: ${worktree}`);
	});

	it("Scenario: The output says how to review and remove", async () => {
		const repo = gitRepo();
		const r = await runWorktree(repo);
		expect(r.code, r.err).toBe(0);
		const worktree = worktreeOf(repo, "1.1");
		expect(r.out).toContain(worktree);
		expect(r.out).toContain("task/tiny/1.1");
		expect(r.out).toContain(`git -C ${worktree} diff`);
		expect(r.out).toContain(`git worktree remove ${worktree}`);
		const status = await cli(["status", "--db", r.db]);
		expect(status.out).toMatch(/^loop \d+ {2}tiny {2}1\.1 {2}converged {2}1 iteration {2}task\/tiny\/1\.1$/);
	});
});

const GROUP_TASKS = "## 1. Setup\n\n- [x] 1.1 done already\n\n## 2. Build\n\n- [ ] 2.1 write `a.txt`\n- [ ] 2.2 write `b.txt`\n";

/**
 * `add-group-loop`, committed in a repo named `agentscript` so the default worktree
 * directory is the sibling `agentscript-worktrees`; group 2 run with `--worktree`
 * on a fake `claude` whose delegate writes `a.txt`, then `b.txt`.
 */
async function runGroupTwo() {
	const repo = gitRepo(
		{
			"agentscript.config.json": JSON.stringify({
				task: { provider: "claude-code", model: "claude-haiku-4-5", script: "task-delegate", checks: ["true"], allow: ["true"] },
				delegates: { claude_code: { runner: "claude-code", model: "sonnet", allow: ["true"] } },
			}),
			"openspec/changes/add-group-loop/proposal.md": PROPOSAL,
			"openspec/changes/add-group-loop/specs/value/file/spec.md": DELTA,
			"openspec/changes/add-group-loop/tasks.md": GROUP_TASKS,
		},
		{ name: "agentscript" },
	);
	const db = join(temp("group-db-"), "group-2.sqlite");
	const bin = fakeClaudeWriting(["a.txt", "b.txt"]);
	const args = ["run", "add-group-loop", "2", "--worktree", "--db", db];
	const r = await spawnBin(args, { cwd: repo, bin });
	const worktree = join(dirname(repo), "agentscript-worktrees", "add-group-loop-2");
	return { repo, db, bin, args, r, worktree };
}

describe("task/headless: A group runs in its own worktree", () => {
	it("Scenario: A group runs in its own worktree", async () => {
		const { repo, r, worktree } = await runGroupTwo();
		expect(r.code, r.stderr).toBe(0);
		expect(existsSync(worktree)).toBe(true);
		expect(gitIn(worktree, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("task/add-group-loop/2");
		expect(existsSync(join(worktree, "a.txt"))).toBe(true);
		expect(existsSync(join(worktree, "b.txt"))).toBe(true);
		const ticked = readFileSync(join(worktree, "openspec/changes/add-group-loop/tasks.md"), "utf8");
		expect(ticked).toContain("- [x] 2.1 ");
		expect(ticked).toContain("- [x] 2.2 ");
		// The main tree: no edit, no tick.
		expect(existsSync(join(repo, "a.txt"))).toBe(false);
		expect(existsSync(join(repo, "b.txt"))).toBe(false);
		expect(readFileSync(join(repo, "openspec/changes/add-group-loop/tasks.md"), "utf8")).toBe(GROUP_TASKS);
		expect(gitIn(repo, "status", "--porcelain")).toBe("");
	});

	it("a second run with the same group is refused and leaves the worktree untouched", async () => {
		const { repo, db, args, r, worktree } = await runGroupTwo();
		expect(r.code, r.stderr).toBe(0);
		const before = readFileSync(join(worktree, "openspec/changes/add-group-loop/tasks.md"), "utf8");
		const again = await spawnBin(args, { cwd: repo, bin: fakeClaudeWriting(["c.txt", "d.txt"]) });
		expect(again.code).toBe(2);
		expect(again.stderr).toContain("task/add-group-loop/2");
		expect(gitIn(worktree, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("task/add-group-loop/2");
		expect(readFileSync(join(worktree, "openspec/changes/add-group-loop/tasks.md"), "utf8")).toBe(before);
		expect(existsSync(join(worktree, "c.txt"))).toBe(false);
		expect(existsSync(join(worktree, "d.txt"))).toBe(false);
		expect((await storedGroupLoops(db)).groups).toHaveLength(1);
	});
});

describe("task/headless: A group loop remembers its worktree", () => {
	it("stores the worktree on the group loop and on each child task loop", async () => {
		const { db, r, worktree } = await runGroupTwo();
		expect(r.code, r.stderr).toBe(0);
		const stored = await storedGroupLoops(db);
		const expected = { path: worktree, branch: "task/add-group-loop/2" };
		expect(stored.groups).toHaveLength(1);
		expect(stored.groups[0]?.worktree).toEqual(expected);
		expect(stored.groups[0]?.workspace).toBe(worktree);
		expect(stored.tasks.map((t) => t.task).sort()).toEqual(["2.1", "2.2"]);
		for (const child of stored.tasks) {
			expect(child.worktree).toEqual(expected);
			expect(child.workspace).toBe(worktree);
			expect(child.tasksPath).toBe(join(worktree, "openspec/changes/add-group-loop/tasks.md"));
		}
	});
});
