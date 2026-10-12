import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ALLOWED_GIT, git } from "../../src/task/git.js";
import { FAKE_CLAUDE_CONFIG, cli, events, fakeClaude, fauxModels, gitIn, gitRepo, spawnBin, storedLoops, workdir, write } from "./cli-helpers.js";
import { cleanTemps, temp, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** Run tiny 1.1 in `repo` on the faux model with JUDGE_ONLY, the database outside the repo unless given. */
async function runIn(repo: string, extra: string[] = [], db?: string) {
	const { script, db: outside } = workdir();
	const env = fauxModels();
	env.faux.setResponses([verdict(true)]);
	const r = await cli(["run", "tiny", "1.1", "--db", db ?? outside, "--script", script, ...env.args, ...extra], env, { cwd: repo });
	return { ...r, db: db ?? outside };
}

describe("task/headless: A dirty working tree refuses the run", () => {
	it("Scenario: An uncommitted change refuses the run", async () => {
		const repo = gitRepo({ "README.md": "# hi\n" });
		writeFileSync(join(repo, "README.md"), "# changed\n");
		const r = await runIn(repo);
		expect(r.code).toBe(2);
		expect(r.err).toContain("README.md");
		expect(r.err).toContain("--allow-dirty");
		expect(existsSync(r.db)).toBe(false);
	});

	it("Scenario: More than 20 paths are truncated", async () => {
		const repo = gitRepo();
		write(repo, Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`new-${String(i).padStart(2, "0")}.txt`, "x"])));
		const r = await runIn(repo);
		expect(r.code).toBe(2);
		const listed = r.errLines.filter((line) => /new-\d\d\.txt/.test(line));
		expect(listed).toHaveLength(20);
		expect(r.err).toContain("5 more");
	});

	it("Scenario: --allow-dirty overrides the guard", async () => {
		const repo = gitRepo();
		writeFileSync(join(repo, "src", "a.ts"), "export const a = 3;\n");
		const r = await runIn(repo, ["--allow-dirty"]);
		expect(r.code, r.err).toBe(0);
		expect((await storedLoops(r.db)).loops).toHaveLength(1);
	});

	it("requireCleanTree: false in the config overrides the guard too", async () => {
		const repo = gitRepo({ "agentscript.config.json": JSON.stringify({ task: { requireCleanTree: false } }) });
		writeFileSync(join(repo, "src", "a.ts"), "export const a = 3;\n");
		const r = await runIn(repo);
		expect(r.code, r.err).toBe(0);
	});

	it("Scenario: The database under an ignored directory does not trip the guard", async () => {
		const repo = gitRepo();
		const db = join(repo, ".agentscript", "task-loops.sqlite");
		const first = await runIn(repo, [], db);
		expect(first.code, first.err).toBe(0);
		expect(existsSync(db)).toBe(true);
		// The first run ticked tiny's 1.1; put the tree back so only the database differs from HEAD.
		gitIn(repo, "checkout", "--", ".");
		const second = await runIn(repo, [], db);
		expect(second.code, second.err).toBe(0);
		expect((await storedLoops(db)).loops).toHaveLength(2);
	});
});

describe("task/headless: Outside git the guard is skipped with a warning", () => {
	it("Scenario: A plain directory runs with a warning", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env);
		expect(r.code, r.err).toBe(0);
		const parsed = events(r.errLines);
		const warning = parsed.find((e) => e["event"] === "warning");
		expect(String(warning?.["message"])).toContain("clean-tree guard was skipped");
		expect(parsed.find((e) => e["event"] === "loop-ended")).toMatchObject({ changed: [] });
	});
});

describe("task/headless: The runner never commits", () => {
	it("Scenario: A converged loop leaves its work uncommitted", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const head = gitIn(repo, "rev-parse", "HEAD").trim();
		const r = await spawnBin(["run", "tiny", "1.1"], { cwd: repo, bin: fakeClaude() });
		expect(r.code, r.stderr).toBe(0);
		expect(gitIn(repo, "rev-parse", "HEAD").trim()).toBe(head);
		expect(gitIn(repo, "log", "--oneline").trim().split("\n")).toHaveLength(1);
		const status = gitIn(repo, "status", "--porcelain");
		expect(status).toContain(" M src/a.ts");
		expect(status).toContain(" M openspec/changes/tiny/tasks.md");
		expect(gitIn(repo, "diff", "--cached", "--name-only").trim()).toBe("");
		expect(readFileSync(join(repo, "src", "a.ts"), "utf8")).toContain("// edited");
	});

	it("git() refuses every subcommand but status, rev-parse, worktree add and worktree list", () => {
		const dir = temp("task-git-");
		for (const args of [["commit", "-m", "x"], ["add", "."], ["stash"], ["checkout", "main"], ["worktree", "remove", "x"], ["reset"], []]) {
			expect(() => git(args, dir), args.join(" ")).toThrow(/never runs/);
		}
		expect(ALLOWED_GIT).toEqual(["status", "rev-parse", "worktree add", "worktree list"]);
	});

	it("only src/task/git.ts spawns git, and every git() call in the runner is an allowed one", () => {
		const files = [
			...readdirSync(join(SRC, "task")).filter((f) => f.endsWith(".ts")).map((f) => join(SRC, "task", f)),
			join(SRC, "bin", "agentscript-task.ts"),
			join(SRC, "node", "builtins.ts"),
		];
		const calls: string[] = [];
		for (const file of files) {
			const code = readFileSync(file, "utf8");
			if (!file.endsWith(join("task", "git.ts"))) {
				expect(code, file).not.toMatch(/(spawn|spawnSync|exec|execFile|execFileSync|execSync)\(\s*["'`]git["'`]/);
			}
			for (const m of code.matchAll(/\bgit\(\s*\[\s*"([a-z-]+)"(?:\s*,\s*"([a-z-]+)")?/g)) {
				calls.push(m[1] === "worktree" ? `worktree ${m[2]}` : (m[1] as string));
			}
		}
		// Proves the scan read the calls: the runner does use git.
		expect(calls.length).toBeGreaterThanOrEqual(5);
		for (const call of calls) expect(ALLOWED_GIT as readonly string[], call).toContain(call);
	});
});
