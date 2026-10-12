import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_SCRIPTS, DEFAULT_MAX_ITERATIONS } from "../../src/task/index.js";
import { ConfigError, loadConfig, resolveGroupScript, resolveRunSettings, validateTaskConfig } from "../../src/task/config.js";
import { cli, fauxModels, storedLoops, workdir } from "./cli-helpers.js";
import { cleanTemps, fakePnpm, temp, tinyChange, verdict } from "./helpers.js";

// A met verdict with checks goes to the gate, which runs `pnpm`: a fake one that exits 0 keeps these tests offline.
let restorePath: (() => void) | undefined;
beforeEach(() => {
	restorePath = fakePnpm();
});
afterEach(() => {
	restorePath?.();
	cleanTemps();
});

/** A root with `agentscript.config.json` holding `{ task }`, and `packages/agent` beneath it. */
function configured(task: unknown) {
	const root = temp("task-config-");
	writeFileSync(join(root, "agentscript.config.json"), JSON.stringify({ task }));
	const sub = join(root, "packages", "agent");
	mkdirSync(sub, { recursive: true });
	return { root, sub, path: join(root, "agentscript.config.json") };
}

describe("task/headless: The repo config is found by walking up", () => {
	it("Scenario: A config in a parent directory is found", async () => {
		const { root, sub } = configured({ db: "loops.sqlite", checks: ["pnpm test"], escalateTo: "agent" });
		const { script } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--script", script, ...env.args], env, { cwd: sub });
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(join(root, "loops.sqlite"));
		expect(inputs[0]).toMatchObject({ checks: ["pnpm test"], escalateTo: "agent" });
		expect(loadConfig(sub).path).toBe(join(root, "agentscript.config.json"));
	});

	it("Scenario: No config means defaults", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const cwd = temp("task-cwd-");
		expect(loadConfig(cwd)).toEqual({ dir: cwd, task: {}, delegates: {}, models: {} });
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env, { cwd });
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(db);
		expect(inputs[0]).toMatchObject({ checks: [], allow: [], budget: { maxIterations: 8 }, escalateTo: "principal", workspace: cwd });
	});

	it("Scenario: The iteration budget defaults to eight", async () => {
		const { script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const cwd = temp("task-cwd-");
		expect(DEFAULT_MAX_ITERATIONS).toBe(8);
		expect(resolveRunSettings({}, {}, loadConfig(cwd), cwd).maxIterations).toBe(DEFAULT_MAX_ITERATIONS);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, ...env.args], env, { cwd });
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(db);
		expect(inputs[0]).toMatchObject({ budget: { maxIterations: DEFAULT_MAX_ITERATIONS } });
	});

	it("only the task and delegates objects are read; other top-level keys are ignored", () => {
		const root = temp("task-config-");
		writeFileSync(join(root, "agentscript.config.json"), JSON.stringify({ other: { anything: 1 }, task: { model: "m" } }));
		expect(loadConfig(root)).toMatchObject({ task: { model: "m" }, delegates: {} });
	});
});

describe("task/headless: The task config has a fixed set of typed fields", () => {
	it("Scenario: An empty task object is valid", () => {
		const { sub } = configured({});
		const config = loadConfig(sub);
		expect(config.task).toEqual({});
		const settings = resolveRunSettings({}, {}, config, sub);
		expect(settings).toMatchObject({
			provider: "anthropic",
			model: "claude-haiku-4-5",
			checks: [],
			allow: [],
			maxIterations: 8,
			escalateTo: "principal",
			requireCleanTree: true,
			worktree: false,
			worktreeSetup: [],
			changesDir: join(config.dir, "openspec", "changes"),
			workspace: sub,
		});
		expect(settings.db).toBeUndefined();
		expect(settings.script.path).toBe(fileURLToPath(BUNDLED_SCRIPTS.task));
	});

	it("accepts every field at its type", () => {
		const all = {
			changesDir: "c",
			db: "d",
			provider: "p",
			model: "m",
			script: "task",
			groupScript: "g.agent",
			checks: ["a"],
			allow: ["b"],
			maxIterations: 2,
			maxReworks: 3,
			escalateTo: "agent",
			requireCleanTree: false,
			worktree: true,
			worktreeDir: "w",
			worktreeSetup: ["x"],
		};
		expect(validateTaskConfig(all, "f")).toEqual(all);
	});
});

describe("task/headless: An unknown or mistyped config value refuses the run", () => {
	it("Scenario: A misspelled key is refused", async () => {
		const { sub, path, root } = configured({ maxIteration: 3, db: "loops.sqlite" });
		const r = await cli(["run", tinyChange(), "1.1"], fauxModels(), { cwd: sub });
		expect(r.code).toBe(2);
		expect(r.err).toContain("maxIteration");
		expect(r.err).toContain(path);
		expect(existsSync(join(root, "loops.sqlite"))).toBe(false);
	});

	it("Scenario: A wrong type is refused", async () => {
		const { sub, path } = configured({ checks: "pnpm test" });
		const r = await cli(["run", tinyChange(), "1.1", "--db", join(sub, "x.sqlite")], fauxModels(), { cwd: sub });
		expect(r.code).toBe(2);
		expect(r.err).toContain("checks");
		expect(r.err).toContain(path);
		expect(existsSync(join(sub, "x.sqlite"))).toBe(false);
	});

	it("refuses each mistyped field and bad JSON, naming them", () => {
		const cases: [string, unknown][] = [
			["maxIterations", 0],
			["maxIterations", 1.5],
			["escalateTo", "nobody"],
			["requireCleanTree", "yes"],
			["worktreeSetup", [1]],
			["model", 4],
		];
		for (const [key, value] of cases) {
			expect(() => validateTaskConfig({ [key]: value }, "cfg.json"), key).toThrow(new RegExp(`cfg\\.json.*task\\.${key}`));
		}
		const root = temp("task-config-");
		writeFileSync(join(root, "agentscript.config.json"), "{ not json");
		expect(() => loadConfig(root)).toThrow(ConfigError);
		writeFileSync(join(root, "agentscript.config.json"), JSON.stringify({ task: [] }));
		expect(() => loadConfig(root)).toThrow(/"task" must be an object/);
	});

	it("refuses a bad config for resume, answer and status too", async () => {
		const { sub } = configured({ nope: true });
		for (const argv of [["resume", "1", "--db", "x"], ["status"], ["answer", "1", "--by", "principal", "--decision", "d"]]) {
			const r = await cli(argv, fauxModels(), { cwd: sub });
			expect(r.code, argv[0]).toBe(2);
			expect(r.err).toContain('unknown key "task.nope"');
		}
	});
});

describe("task/headless: Values resolve flag, then environment, then config, then default", () => {
	it("Scenario: The environment beats the config", () => {
		const { sub } = configured({ model: "claude-haiku-4-5", provider: "from-config" });
		const config = loadConfig(sub);
		const settings = resolveRunSettings({}, { AGENTSCRIPT_MODEL: "sonnet" }, config, sub);
		expect(settings.model).toBe("sonnet");
		expect(settings.provider).toBe("from-config");
		expect(resolveRunSettings({ model: "opus" }, { AGENTSCRIPT_MODEL: "sonnet" }, config, sub).model).toBe("opus");
		expect(resolveRunSettings({}, { AGENTSCRIPT_PROVIDER: "env" }, config, sub).provider).toBe("env");
	});

	it("Scenario: Unset fields fall through independently", async () => {
		const { sub, root } = configured({ checks: ["pnpm test"], db: "loops.sqlite" });
		const { script } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--script", script, "--max-iterations", "5", ...env.args], env, { cwd: sub });
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(join(root, "loops.sqlite"));
		expect(inputs[0]).toMatchObject({ checks: ["pnpm test"], budget: { maxIterations: 5 }, escalateTo: "principal" });
	});

	it("the config's delegates reach the loop, each context entry anchored at the config", async () => {
		const { sub, root } = configured({ db: "loops.sqlite" });
		writeFileSync(
			join(root, "agentscript.config.json"),
			JSON.stringify({ task: { db: "loops.sqlite" }, delegates: { claude_code: { runner: "claude-code", model: "sonnet", context: ["CLAUDE.md"] } } }),
		);
		writeFileSync(join(root, "CLAUDE.md"), "# repo\n");
		// As written, without the runner's defaults filled in.
		expect(loadConfig(sub).delegates).toEqual({ claude_code: { runner: "claude-code", model: "sonnet", context: [join(root, "CLAUDE.md")] } });
		const { script } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--script", script, ...env.args], env, { cwd: sub });
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(join(root, "loops.sqlite"));
		expect(inputs[0]).toMatchObject({
			delegates: { claude_code: { runner: "claude-code", model: "sonnet", context: [join(root, "CLAUDE.md")] } },
		});
	});
});

describe("task/headless: group fields", () => {
	it("accepts groupScript and maxReworks", () => {
		const task = { groupScript: "x.agent", maxReworks: 3 };
		expect(validateTaskConfig(task, "f")).toEqual(task);
	});

	it("refuses a bad maxReworks or groupScript", () => {
		for (const [key, value] of [["maxReworks", 0], ["maxReworks", -1], ["maxReworks", 1.5], ["maxReworks", "2"], ["groupScript", 4]] as const) {
			expect(() => validateTaskConfig({ [key]: value }, "cfg.json"), key).toThrow(new RegExp(`cfg\\.json.*task\\.${key}`));
		}
	});

	it("defaults to the bundled group script and 2 reworks; the flag beats the config", () => {
		const { sub, root } = configured({ groupScript: "g.agent", maxReworks: 3 });
		const defaults = resolveRunSettings({}, {}, { dir: sub, task: {} }, sub);
		expect(defaults.groupScript.value).toBe("group");
		expect(defaults.maxReworks).toBe(2);
		const config = loadConfig(sub);
		const fromConfig = resolveRunSettings({}, {}, config, sub);
		expect(fromConfig).toMatchObject({ groupScript: { value: "g.agent", base: root }, maxReworks: 3 });
		const flagged = resolveRunSettings({ groupScript: "f.agent", maxReworks: 1 }, {}, config, sub);
		expect(flagged).toMatchObject({ groupScript: { value: "f.agent", base: sub }, maxReworks: 1 });
	});

	it("Scenario: A missing group script is refused", () => {
		const { sub } = configured({});
		expect(resolveGroupScript("group", sub).path).toBe(fileURLToPath(BUNDLED_SCRIPTS.group));
		expect(() => resolveGroupScript("./nope.agent", sub)).toThrow(/\.\/nope\.agent/);
	});
});

describe("task/headless: Config paths are relative to the config file", () => {
	it("Scenario: The database path is anchored at the config", async () => {
		const { sub, root } = configured({ db: ".agentscript/task-loops.sqlite", changesDir: "changes" });
		const { script } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		expect(existsSync(join(root, ".agentscript"))).toBe(false);
		const r = await cli(["run", tinyChange(), "1.1", "--script", script, ...env.args], env, { cwd: sub });
		expect(r.code, r.err).toBe(0);
		expect(existsSync(join(root, ".agentscript", "task-loops.sqlite"))).toBe(true);
		expect(existsSync(join(sub, ".agentscript"))).toBe(false);
		expect(resolveRunSettings({}, {}, loadConfig(sub), sub).changesDir).toBe(join(root, "changes"));
	});
});

describe("task/headless: script names a bundled script or a file", () => {
	it("Scenario: A bundled name selects the bundled script", () => {
		const { sub } = configured({ script: "task-delegate" });
		const settings = resolveRunSettings({}, {}, loadConfig(sub), sub);
		expect(settings.script).toEqual({ label: "task-delegate", path: fileURLToPath(BUNDLED_SCRIPTS.delegate) });
		expect(readFileSync(settings.script.path, "utf8")).toContain('agent_name: "task-agent-delegate"');
	});

	it("Scenario: A missing script file is refused", async () => {
		const { db, dir } = workdir();
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", "./nope.agent"], fauxModels(), { cwd: dir });
		expect(r.code).toBe(2);
		expect(r.err).toContain("./nope.agent");
		expect(existsSync(db)).toBe(false);
	});

	it("a config script path is relative to the config", () => {
		const { sub, root } = configured({ script: "scripts/mine.agent" });
		mkdirSync(join(root, "scripts"));
		writeFileSync(join(root, "scripts", "mine.agent"), "x");
		expect(resolveRunSettings({}, {}, loadConfig(sub), sub).script.path).toBe(join(root, "scripts", "mine.agent"));
	});
});

describe("task/cli: run maps its flags onto the task loop options", () => {
	it("Scenario: A flag overrides the config", async () => {
		const { sub, root } = configured({ checks: ["pnpm test"], db: "loops.sqlite" });
		const { script } = workdir();
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--script", script, "--check", "pnpm check", ...env.args], env, { cwd: sub });
		expect(r.code, r.err).toBe(0);
		expect((await storedLoops(join(root, "loops.sqlite"))).inputs[0]?.checks).toEqual(["pnpm check"]);
	});
});

describe("task/cli: run resolves provider and model like agentscript-durable", () => {
	it("Scenario: The config supplies the provider", async () => {
		const { sub, root } = configured({ provider: "claude-code", model: "claude-haiku-4-5", db: "loops.sqlite" });
		const { script } = workdir();
		const env = fauxModels("claude-code", "claude-haiku-4-5");
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--script", script], env, { cwd: sub });
		expect(r.code, r.err).toBe(0);
		const { runs } = await storedLoops(join(root, "loops.sqlite"));
		expect(runs.map((run) => (run.input as { model?: unknown }).model)).toEqual([{ provider: "claude-code", modelId: "claude-haiku-4-5" }]);
		expect(env.faux.state.callCount).toBe(1);
	});
});
