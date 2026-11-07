// The task CLI's turn limit for claude-code tool steps (#37): `--max-turns`, else `task.maxTurns`
// in agentscript.config.json, handed to the model collection. Not stored with a loop, so `resume`
// and `answer` read it again and every resume hint repeats the flag.

import { cpSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBuild, prepareBuild } from "../../src/task/cmd-build.js";
import { ConfigError, loadConfig, resolveRunSettings, runFlagsOf } from "../../src/task/config.js";
import { cli, fauxModels } from "./cli-helpers.js";
import { cleanTemps, plan, temp, text, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

/** A root holding `agentscript.config.json` with `task` as given and the tiny change as `tiny`. */
function configured(task: Record<string, unknown>) {
	const root = realpathSync(temp("task-turns-root-"));
	writeFileSync(join(root, "agentscript.config.json"), JSON.stringify({ task: { checks: ["node --version"], allow: ["node"], ...task } }));
	cpSync(tinyChange(), join(root, "openspec", "changes", "tiny"), { recursive: true });
	return root;
}

async function run(root: string, extra: string[] = []) {
	const env = fauxModels();
	env.faux.setResponses([plan("nothing"), text("done"), verdict(true)]);
	const r = await cli(["run", "tiny", "1.1", "--db", "loops.sqlite", "--script", "task", ...extra, ...env.args], env, { cwd: root });
	return { ...r, seen: env.modelOptions };
}

describe("task/headless: task.maxTurns in agentscript.config.json", () => {
	it("must be a positive integer", () => {
		for (const bad of [0, -2, 1.5, "20"]) {
			const root = configured({ maxTurns: bad });
			expect(() => loadConfig(root), String(bad)).toThrow(ConfigError);
			expect(() => loadConfig(root), String(bad)).toThrow("task.maxTurns must be a positive integer");
		}
	});

	it("resolves flag, then config, then unset (the provider's default)", () => {
		const root = configured({ maxTurns: 40 });
		const config = loadConfig(root);
		expect(resolveRunSettings({ maxTurns: 25 }, {}, config, root).maxTurns).toBe(25);
		expect(resolveRunSettings({}, {}, config, root).maxTurns).toBe(40);
		expect(resolveRunSettings({}, {}, loadConfig(configured({})), root).maxTurns).toBeUndefined();
	});

	it("--max-turns must be a positive integer", () => {
		expect(runFlagsOf({ "max-turns": "30" })).toMatchObject({ maxTurns: 30 });
		for (const bad of ["0", "ten", "2.5"]) expect(runFlagsOf({ "max-turns": bad }), bad).toBe(`--max-turns must be a positive integer, got "${bad}"`);
	});
});

describe("task/cli: run hands the turn limit to the model collection", () => {
	it("from the config", async () => {
		const r = await run(configured({ maxTurns: 40 }));
		expect(r.code, r.err).toBe(0);
		expect(r.seen).toEqual([{ maxTurns: 40 }]);
		// Read again from the config on resume, so the hint needn't repeat it.
		expect(r.errLines[0]).toMatch(/^loop \d+ — resume with: specsesh task resume \d+ --db loops\.sqlite$/);
	});

	it("from --max-turns over the config, and the resume hint repeats it", async () => {
		const r = await run(configured({ maxTurns: 40 }), ["--max-turns", "60"]);
		expect(r.code, r.err).toBe(0);
		expect(r.seen).toEqual([{ maxTurns: 60 }]);
		expect(r.errLines[0]).toMatch(/^loop \d+ — resume with: specsesh task resume \d+ --db loops\.sqlite --max-turns 60$/);
	});

	it("none without either", async () => {
		const r = await run(configured({}));
		expect(r.code, r.err).toBe(0);
		expect(r.seen).toEqual([{}]);
	});

	it("refuses a bad --max-turns before any model is touched", async () => {
		const r = await run(configured({}), ["--max-turns", "0"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain('--max-turns must be a positive integer, got "0"');
		expect(r.seen).toEqual([]);
	});
});

describe("task/cli: resume and answer read the turn limit again", () => {
	it("resume takes --max-turns, else the config's", async () => {
		const root = configured({ maxTurns: 40 });
		expect((await run(root)).code).toBe(0);
		const env = fauxModels();
		const flagged = await cli(["resume", "1", "--db", "loops.sqlite", "--max-turns", "70"], env, { cwd: root });
		expect(env.modelOptions, flagged.err).toEqual([{ maxTurns: 70 }]);
		const plain = fauxModels();
		await cli(["resume", "1", "--db", "loops.sqlite"], plain, { cwd: root });
		expect(plain.modelOptions).toEqual([{ maxTurns: 40 }]);
	});

	it("answer takes --max-turns", async () => {
		const root = configured({});
		expect((await run(root)).code).toBe(0);
		const env = fauxModels();
		await cli(["answer", "1", "--db", "loops.sqlite", "--by", "principal", "--decision", "go", "--max-turns", "15"], env, { cwd: root });
		expect(env.modelOptions).toEqual([{ maxTurns: 15 }]);
	});
});

describe("task/cli: change build resolves the turn limit as a run does", () => {
	it("carries --max-turns, else task.maxTurns, on its request", () => {
		const root = configured({ maxTurns: 40, db: "loops.sqlite" });
		const config = loadConfig(root);
		const request = (argv: string[]) => {
			const args = parseBuild(["tiny", ...argv]);
			if (!("flags" in args)) throw new Error(`not parsed: ${JSON.stringify(args)}`);
			const prepared = prepareBuild(args, { config, env: {}, cwd: root });
			if (prepared.kind !== "request") throw new Error(`refused: ${JSON.stringify(prepared)}`);
			return prepared;
		};
		expect(request([]).maxTurns).toBe(40);
		expect(request(["--max-turns", "90"]).maxTurns).toBe(90);
	});
});
