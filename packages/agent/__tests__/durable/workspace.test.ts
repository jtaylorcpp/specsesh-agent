import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionResult } from "../../src/interpreter/index.js";
import {
	WorkspaceError,
	diffSnapshots,
	runChecks,
	workspaceActions,
	type ExecOptions,
	type ExecResult,
	type ExecutedHostAction,
	type Workspace,
} from "../../src/durable/index.js";
import { localWorkspace } from "../../src/node/index.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-workspace-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function gitIn(dir: string, ...args: string[]): void {
	execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: dir, stdio: "ignore" });
}

type Call = { op: "read" | "write"; path: string } | { op: "exec"; argv: readonly string[]; options: ExecOptions };

/** An in-memory workspace recording its calls. `exec` answers from `answer`, or exits 0 echoing its argv. */
function memory(options: { exec?: boolean; answer?: (argv: readonly string[]) => ExecResult } = {}) {
	const files = new Map<string, string>();
	const calls: Call[] = [];
	const workspace: Workspace = {
		root: "memory",
		async read(path) {
			calls.push({ op: "read", path });
			if (path.startsWith("/") || path.split("/").includes("..")) throw new WorkspaceError("outside the workspace", path);
			const content = files.get(path);
			if (content === undefined) throw new WorkspaceError("no such file", path);
			return content;
		},
		async write(path, content) {
			calls.push({ op: "write", path });
			if (path.startsWith("/") || path.split("/").includes("..")) throw new WorkspaceError("outside the workspace", path);
			files.set(path, content);
		},
		...(options.exec === false
			? {}
			: {
					async exec(argv: readonly string[], execOptions: ExecOptions): Promise<ExecResult> {
						calls.push({ op: "exec", argv, options: execOptions });
						return options.answer?.(argv) ?? { kind: "exited", code: 0, stdout: `ran ${argv.join(" ")}`, stderr: "" };
					},
				}),
	};
	return { workspace, files, calls };
}

function byName(actions: ExecutedHostAction[]): Record<string, ExecutedHostAction> {
	return Object.fromEntries(actions.map((action) => [action.name, action]));
}

function run(action: ExecutedHostAction | undefined, inputs: Record<string, string>): Promise<ActionResult> {
	if (action === undefined) throw new Error("no such action");
	return action.execute(inputs, { workspace: "memory" });
}

describe("actions/workspace: The durable entry exports the workspace interface", () => {
	it("Scenario: The interface loads without Node built-ins", () => {
		const seen = new Set<string>();
		const pending = [join(SRC, "durable", "workspace.ts")];
		while (pending.length > 0) {
			const file = pending.pop() as string;
			if (seen.has(file)) continue;
			seen.add(file);
			const code = readFileSync(file, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "");
			for (const [, a, b] of code.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
				const spec = (a ?? b) as string;
				expect(spec, `${file} imports ${spec}`).not.toMatch(/^node:/);
				if (spec.startsWith(".")) {
					const target = resolve(dirname(file), spec.replace(/\.js$/, ".ts"));
					pending.push(existsSync(target) ? target : join(resolve(dirname(file), spec), "index.ts"));
				}
			}
		}
		expect(seen.size).toBeGreaterThan(1);
	});
});

describe("actions/workspace: A workspace reads and writes confined paths", () => {
	it("Scenario: A write then a read round-trips", async () => {
		// `src/` does not exist yet: the write creates it.
		const workspace = localWorkspace(tempDir());
		await workspace.write("src/a.ts", "hello");
		await expect(workspace.read("src/a.ts")).resolves.toBe("hello");
	});

	it("names the reason and the path in a WorkspaceError", () => {
		const error = new WorkspaceError("outside the workspace", "../etc/passwd");
		expect(error.reason).toBe("outside the workspace");
		expect(error.message).toContain("outside the workspace");
		expect(error.message).toContain("../etc/passwd");
		expect(new WorkspaceError("no such file", "src/gone.ts").message).toMatch(/no such file.*src\/gone\.ts/);
	});
});

describe("actions/workspace: Snapshots diff into DiffEvidence", () => {
	it("Scenario: A created and an edited file", async () => {
		const dir = tempDir();
		mkdirSync(join(dir, "src"));
		writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
		gitIn(dir, "init", "--quiet");
		gitIn(dir, "add", "src/a.ts");
		gitIn(dir, "commit", "--quiet", "-m", "a");
		const workspace = localWorkspace(dir);
		const before = await workspace.snapshot?.();
		await workspace.write("src/new.ts", "export const n = 1;\n");
		await workspace.write("src/a.ts", "export const a = 2;\n");
		const after = await workspace.snapshot?.();
		expect(before).toEqual(new Map());
		expect(diffSnapshots(before ?? new Map(), after ?? new Map())).toEqual([
			{ path: "src/a.ts", change: "modified" },
			{ path: "src/new.ts", change: "added" },
		]);
	});

	it("diffs git-shaped snapshots of a created and an edited file", () => {
		// Git snapshots: a clean tracked `src/a.ts` is not listed until it is edited.
		const before = new Map([["src/b.ts", " M:bbb"]]);
		const after = new Map([
			["src/new.ts", "??:nnn"],
			["src/a.ts", " M:aaa"],
			["src/b.ts", " M:bbb"],
		]);
		expect(diffSnapshots(before, after)).toEqual([
			{ path: "src/a.ts", change: "modified" },
			{ path: "src/new.ts", change: "added" },
		]);
		// Without porcelain codes, a path absent before is added.
		expect(diffSnapshots(new Map(), new Map([["src/x.ts", "hash"]]))).toEqual([{ path: "src/x.ts", change: "added" }]);
	});

	it("diffs synthetic snapshots into sorted added, deleted and modified paths", () => {
		const before = new Map([
			["src/a.ts", " M:aaa"],
			["src/gone.ts", " M:ggg"],
			["src/removed.ts", " M:rrr"],
			["src/same.ts", "??:sss"],
		]);
		const after = new Map([
			["src/new.ts", "??:nnn"],
			["src/a.ts", " M:bbb"],
			["src/removed.ts", " D:-"],
			["src/same.ts", "??:sss"],
		]);
		expect(diffSnapshots(before, after)).toEqual([
			{ path: "src/a.ts", change: "modified" },
			{ path: "src/gone.ts", change: "deleted" },
			{ path: "src/new.ts", change: "added" },
			{ path: "src/removed.ts", change: "deleted" },
		]);
		expect(diffSnapshots(before, before)).toEqual([]);
	});
});

describe("actions/workspace: The built-ins are defined over a workspace", () => {
	it("Scenario: The built-ins use the workspace they were given", async () => {
		const { workspace, calls } = memory();
		const actions = byName(workspaceActions(workspace, { allow: ["pnpm"] }));
		expect((await run(actions["edit_file"], { path: "src/a.ts", content: "export {};" })).ok).toBe(true);
		expect((await run(actions["run_command"], { command: "pnpm test" })).ok).toBe(true);
		const writes = calls.filter((c) => c.op === "write");
		const execs = calls.filter((c) => c.op === "exec");
		expect(writes).toEqual([{ op: "write", path: "src/a.ts" }]);
		expect(execs.map((c) => c.argv)).toEqual([["pnpm", "test"]]);
	});

	it("Scenario: Commands need exec", async () => {
		const { workspace } = memory({ exec: false });
		const actions = byName(workspaceActions(workspace, { allow: ["pnpm"], checks: ["pnpm test"] }));
		const checks = await run(actions["run_checks"], { task_id: "1.1" });
		expect(checks).toMatchObject({ ok: false });
		expect(checks.ok === false && checks.message).toContain("this workspace cannot run commands");
		const command = await run(actions["run_command"], { command: "pnpm test" });
		expect(command.ok === false && command.message).toContain("this workspace cannot run commands");
	});

	it("returns exactly the four built-ins, no delegate", () => {
		const names = workspaceActions(memory().workspace).map((action) => action.name);
		expect(names).toEqual(["read_file", "edit_file", "run_command", "run_checks"]);
	});

	it("refuses a command off the allowlist without calling exec", async () => {
		const { workspace, calls } = memory();
		const result = await run(byName(workspaceActions(workspace, { allow: ["pnpm"] }))["run_command"], { command: "rm -rf src" });
		expect(result.ok === false && result.message).toContain("rm is not on the allowlist");
		expect(calls).toEqual([]);
	});

	it("records an edit's diff, added then modified, and nothing for a read", async () => {
		const actions = byName(workspaceActions(memory().workspace));
		const created = await run(actions["edit_file"], { path: "src/new.ts", content: "export {};" });
		expect(created.record).toMatchObject({
			action: { kind: "edit", refs: ["src/new.ts"] },
			evidence: [{ kind: "diff", files: [{ path: "src/new.ts", change: "added" }] }],
		});
		const edited = await run(actions["edit_file"], { path: "src/new.ts", content: "export const x = 1;" });
		expect(edited.record).toMatchObject({ evidence: [{ kind: "diff", files: [{ path: "src/new.ts", change: "modified" }] }] });
		const read = await run(actions["read_file"], { path: "src/new.ts" });
		expect(read).toMatchObject({ ok: true, outputs: { content: "export const x = 1;" } });
		expect(read.record).toBeUndefined();
	});

	it("answers an escape or a missing file with the WorkspaceError, writing nothing", async () => {
		const { workspace, files } = memory();
		const actions = byName(workspaceActions(workspace));
		const escape = await run(actions["edit_file"], { path: "../x.ts", content: "x" });
		expect(escape.ok === false && escape.message).toContain("outside the workspace");
		expect(files.size).toBe(0);
		const missing = await run(actions["read_file"], { path: "src/none.ts" });
		expect(missing.ok === false && missing.message).toContain("no such file");
	});

	it("records run_checks as one command Action with a CheckEvidence per check", async () => {
		const { workspace } = memory({ answer: (argv) => ({ kind: "exited", code: argv[1] === "lint" ? 1 : 0, stdout: "", stderr: "bad" }) });
		const result = await run(byName(workspaceActions(workspace, { checks: ["pnpm test", "pnpm lint"] }))["run_checks"], { task_id: "1.1" });
		expect(result).toMatchObject({ ok: true, outputs: { passed: false } });
		expect(result.record).toMatchObject({
			action: { kind: "command", refs: ["pnpm test", "pnpm lint"] },
			evidence: [
				{ kind: "check", command: "pnpm test", exitCode: 0 },
				{ kind: "check", command: "pnpm lint", exitCode: 1, output: "bad" },
			],
		});
	});
});

describe("runChecks", () => {
	it("fails without exec, and for no checks, rather than passing", async () => {
		const without = await runChecks(memory({ exec: false }).workspace, ["pnpm test"], 1000);
		expect(without).toEqual({ passed: false, evidence: [], output: "this workspace cannot run commands" });
		expect((await runChecks(memory().workspace, [], 1000)).passed).toBe(false);
	});

	it("runs each check in order as an argv with the time limit, none skipped after a failure", async () => {
		const { workspace, calls } = memory({
			answer: (argv) =>
				argv[0] === "slow"
					? { kind: "timed-out", stdout: "partial", stderr: "" }
					: argv[0] === "missing"
						? { kind: "spawn-error", message: "ENOENT" }
						: { kind: "exited", code: 0, stdout: "ok", stderr: "" },
		});
		const ran = await runChecks(workspace, ["pnpm  test --run", "slow", "missing x", "pnpm check"], 500);
		expect(calls.map((c) => (c.op === "exec" ? [c.argv, c.options.timeoutMs] : c.op))).toEqual([
			[["pnpm", "test", "--run"], 500],
			[["slow"], 500],
			[["missing", "x"], 500],
			[["pnpm", "check"], 500],
		]);
		expect(ran.passed).toBe(false);
		expect(ran.evidence.map((e) => e.exitCode)).toEqual([0, -1, 127, 0]);
		expect(ran.evidence[1]?.output).toContain("timed out after 500ms");
		expect(ran.output).toContain("$ pnpm check\nok\n(exit 0)");
	});
});
