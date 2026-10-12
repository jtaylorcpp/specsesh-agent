// The config's `delegates`: refused when wrong, carried to the loop when right, and
// withdrawn by `--no-delegates`. In process on a faux model, or the built bin on a fake `claude`.

import { chmodSync, cpSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findConfig, loadConfig } from "../../src/task/config.js";
import { cli, cliActions, fauxModels, gitRepo, spawnBin, storedLoops, write } from "./cli-helpers.js";
import { cleanTemps, plan, temp, text, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const CLAUDE_CODE = { runner: "claude-code", model: "opus" };

/** A root holding `agentscript.config.json` as given, `openspec/changes/fixture-live-task` and `packages/agent`. */
function configured(config: unknown) {
	const root = realpathSync(temp("task-delegates-"));
	const path = join(root, "agentscript.config.json");
	writeFileSync(path, JSON.stringify(config));
	cpSync(tinyChange(), join(root, "openspec", "changes", "fixture-live-task"), { recursive: true });
	write(root, { "packages/agent/.keep": "" });
	return { root, path, sub: join(root, "packages", "agent") };
}

/**
 * A fake `claude` that writes no file. A step (`--json-schema`) gets a plan or a met verdict;
 * the delegate gets an ok result. Each call appends its argv, cwd, stdin and whether
 * `ANTHROPIC_API_KEY` and `CLAUDECODE` reached it to `log`.
 */
function loggingClaude(log: string): string {
	const bin = temp("task-fake-bin-");
	const path = join(bin, "claude");
	writeFileSync(
		path,
		`#!${process.execPath}
const fs = require("node:fs");
const argv = process.argv.slice(2);
let stdin = "";
try { stdin = fs.readFileSync(0, "utf8"); } catch {}
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({
	argv, cwd: process.cwd(), stdin,
	apiKey: "ANTHROPIC_API_KEY" in process.env, claudeCode: "CLAUDECODE" in process.env,
}) + "\\n");
const schemaAt = argv.indexOf("--json-schema");
let out;
if (schemaAt >= 0) {
	const schema = JSON.parse(argv[schemaAt + 1]);
	const structured = "next_action" in (schema.properties || {})
		? { met: true, unmet: "", next_action: "retry", question: "" }
		: { plan: "nothing to change" };
	out = { type: "result", is_error: false, result: "", structured_output: structured };
} else out = { type: "result", is_error: false, result: "Changed nothing." };
process.stdout.write(JSON.stringify(out));
`,
	);
	chmodSync(path, 0o755);
	return bin;
}

interface ClaudeCall {
	readonly argv: string[];
	readonly cwd: string;
	readonly stdin: string;
	readonly apiKey: boolean;
	readonly claudeCode: boolean;
}

const calls = (log: string): ClaudeCall[] =>
	existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as ClaudeCall) : [];

/** A committed repo whose config runs `task-delegate` on the fake `claude`, granting `claude_code` with `grant`. */
function delegatingRepo(grant: Record<string, unknown>) {
	const config = {
		task: { provider: "claude-code", model: "claude-haiku-4-5", script: "task-delegate", checks: ["node --version"], allow: ["node"], db: ".agentscript/task-loops.sqlite" },
		delegates: { claude_code: { runner: "claude-code", ...grant } },
	};
	const root = realpathSync(
		gitRepo({
			"agentscript.config.json": JSON.stringify(config),
			"CLAUDE.md": "# fixture\n",
			"packages/agent/.keep": "",
			"openspec/changes/fixture-live-task/proposal.md": readFileSync(join(tinyChange(), "proposal.md"), "utf8"),
			"openspec/changes/fixture-live-task/tasks.md": readFileSync(join(tinyChange(), "tasks.md"), "utf8"),
			"openspec/changes/fixture-live-task/specs/value/file/spec.md": readFileSync(join(tinyChange(), "specs", "value", "file", "spec.md"), "utf8"),
		}),
	);
	const log = join(temp("task-claude-log-"), "calls.jsonl");
	return { root, sub: join(root, "packages", "agent"), log, bin: loggingClaude(log), db: join(root, ".agentscript", "task-loops.sqlite") };
}

describe("task/headless: The delegates config is a map of grants checked whole", () => {
	it("Scenario: A misspelled grant key is refused", async () => {
		const { sub, path, root } = configured({ task: { db: "loops.sqlite" }, delegates: { claude_code: { runner: "claude-code", modle: "opus" } } });
		const r = await cli(["run", "fixture-live-task", "1.1"], fauxModels(), { cwd: sub });
		expect(r.code).toBe(2);
		for (const needle of ["claude_code", "modle", path]) expect(r.err).toContain(needle);
		expect(existsSync(join(root, "loops.sqlite"))).toBe(false);
	});

	it("an unknown runner is refused from the CLI, naming the runners there are", async () => {
		const { sub, root } = configured({ task: { db: "loops.sqlite" }, delegates: { claude_code: { runner: "codex" } } });
		const r = await cli(["run", "fixture-live-task", "1.1"], fauxModels(), { cwd: sub });
		expect(r.code).toBe(2);
		expect(r.err).toContain("codex");
		expect(r.err).toContain("claude-code");
		expect(existsSync(join(root, "loops.sqlite"))).toBe(false);
	});

	it("Scenario: Grants reach the loop", async () => {
		const repo = delegatingRepo({ model: "opus" });
		const r = await spawnBin(["run", "fixture-live-task", "1.1", "--max-iterations", "1"], { cwd: repo.root, bin: repo.bin });
		expect(r.stderr).toContain("loop-started");
		const { inputs } = await storedLoops(repo.db);
		expect(inputs).toHaveLength(1);
		expect(inputs[0]?.delegates?.["claude_code"]?.["model"]).toBe("opus");
	});
});

describe("task/headless: The retired delegate fields are refused, saying where they moved", () => {
	it("Scenario: An old config is refused with directions", async () => {
		for (const [key, value] of [["delegateModel", "sonnet"], ["delegateContext", ["CLAUDE.md"]]] as const) {
			const { sub, root } = configured({ task: { [key]: value, db: "loops.sqlite" } });
			const r = await cli(["run", "fixture-live-task", "1.1"], fauxModels(), { cwd: sub });
			expect(r.code, key).toBe(2);
			expect(r.err, key).toContain(key);
			expect(r.err, key).toContain('grant a delegate under "delegates" instead');
			expect(existsSync(join(root, "loops.sqlite")), key).toBe(false);
		}
	});
});

describe("task/headless: The repo config is found by walking up", () => {
	it("Scenario: No config grants nothing", async () => {
		// Nothing above the temp directory may hold a config, or this would test that one.
		expect(findConfig(tmpdir())).toBeUndefined();
		const cwd = temp("task-cwd-");
		const db = join(cwd, "loops.sqlite");
		const env = fauxModels();
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", "task-delegate", ...env.args], env, { cwd });
		expect(r.code).toBe(2);
		expect(r.err).toContain("delegate/claude_code");
		expect(r.err).toContain("no delegates are granted");
		expect((await storedLoops(db)).loops).toHaveLength(0);
	});
});

describe("task/headless: Config paths are relative to the config file", () => {
	it("Scenario: A grant's context is anchored at the config", async () => {
		const repo = delegatingRepo({ model: "opus", context: ["CLAUDE.md"] });
		const r = await spawnBin(["run", "fixture-live-task", "1.1", "--max-iterations", "1"], {
			cwd: repo.sub,
			bin: repo.bin,
			env: { ANTHROPIC_API_KEY: "sk-test-not-a-key", CLAUDECODE: "1" },
		});
		expect(r.code, r.stderr).toBe(0);
		const delegate = calls(repo.log).filter((call) => call.argv.includes("--permission-mode"));
		expect(delegate).toHaveLength(1);
		const call = delegate[0]!;
		const at = call.argv.indexOf("--append-system-prompt-file");
		expect(call.argv[at + 1]).toBe(join(repo.root, "CLAUDE.md"));
		expect(call.cwd).toBe(repo.sub);
		expect(call.apiKey).toBe(false);
		expect(call.claudeCode).toBe(false);
		expect(call.stdin).toContain("Your terms for this delegation");
	});
});

describe("task/cli: --no-delegates withdraws every grant for one run", () => {
	it("Scenario: A delegating script is refused without grants", async () => {
		const { root } = configured({ task: { script: "task-delegate" }, delegates: { claude_code: CLAUDE_CODE } });
		const env = fauxModels();
		const r = await cli(["run", "fixture-live-task", "1.1", "--db", "loops.sqlite", "--no-delegates", ...env.args], env, { cwd: root });
		expect(r.code).toBe(2);
		expect(r.err).toContain("delegate/claude_code");
		expect((await storedLoops(join(root, "loops.sqlite"))).loops).toHaveLength(0);
		expect(env.faux.state.callCount).toBe(0);
	});

	it("Scenario: A delegate-free script still runs", async () => {
		// One passing check: the bundled script's check step counts an empty set as unmet.
		const { root } = configured({ task: { script: "task-delegate", checks: ["node --version"], allow: ["node"] }, delegates: { claude_code: CLAUDE_CODE } });
		const env = fauxModels();
		env.faux.setResponses([plan("nothing"), text("done"), verdict(true)]);
		const r = await cli(["run", "fixture-live-task", "1.1", "--db", "loops.sqlite", "--no-delegates", "--script", "task", ...env.args], env, { cwd: root });
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(join(root, "loops.sqlite"));
		expect(inputs).toHaveLength(1);
		expect(Object.keys(inputs[0]?.delegates ?? {})).toEqual([]);
	});
});

describe("host/agent-config: The task CLI builds its harness from a config", () => {
	it("Scenario: A granted delegate reaches the CLI's registry", async () => {
		const { root } = configured({ delegates: { claude_code: CLAUDE_CODE } });
		const actions = await cliActions(root, loadConfig(root).delegates);
		expect(actions).toContain("delegate/claude_code");
		expect(actions).not.toContain("delegate_claude_code");
	});
});
