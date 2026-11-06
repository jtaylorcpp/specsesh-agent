// A task loop's `context` (#43): files about the repository, read once at start, seeded into a
// script that declares `context`, put in every delegate's preamble, carried from a group to its
// tasks, and set from `task.context` in agentscript.config.json.

import { cpSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { contractProblems } from "../../src/task/contract.js";
import { ConfigError, loadConfig, resolveRunSettings } from "../../src/task/config.js";
import { taskLoopInputFor, validateGroupStart } from "../../src/task/group.js";
import { BUNDLED_SCRIPTS, TaskLoopStartError, prepareTaskLoop, taskPreamble } from "../../src/task/index.js";
import { seededVariables } from "../../src/task/loop.js";
import { cli, fauxModels, gitRepo, storedLoops } from "./cli-helpers.js";
import { COUNT_CHECK, JUDGE_ONLY, cleanTemps, context, plan, prompts, runLoop, temp, text, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const TASK_SCRIPT = fileURLToPath(BUNDLED_SCRIPTS.task);
const CONVENTIONS = "# Conventions\n\nUse tabs. Name tests after their scenario.\n";

/** JUDGE_ONLY, also declaring `context` as `type`. */
const declaring = (type: "string" | "number") =>
	JUDGE_ONLY.replace("variables:\n", `variables:\n    context: mutable ${type} = ${type === "string" ? '""' : "0"}\n`);

/** A file holding CONVENTIONS, and its path. */
function conventionsFile(): string {
	const path = join(temp("task-context-"), "CLAUDE.md");
	writeFileSync(path, CONVENTIONS);
	return path;
}

describe("task/agent: A loop reads its context once, at start", () => {
	it("stores a file under its path and a text as it is, in order", () => {
		const path = conventionsFile();
		const dir = tinyChange();
		const input = prepareTaskLoop({ change: { dir }, task: "1.1", workspace: dir, context: [{ path }, { text: "Prefer small commits." }] });
		expect(input.context).toBe(`# ${path}\n\n${CONVENTIONS.trimEnd()}\n\nPrefer small commits.`);
	});

	it("stores nothing without context", () => {
		const dir = tinyChange();
		expect(prepareTaskLoop({ change: { dir }, task: "1.1", workspace: dir }).context).toBeUndefined();
	});

	it("refuses a context file it cannot read, naming it", () => {
		const dir = tinyChange();
		const missing = join(temp("task-context-"), "MISSING.md");
		expect(() => prepareTaskLoop({ change: { dir }, task: "1.1", workspace: dir, context: [{ path: missing }] })).toThrow(TaskLoopStartError);
		expect(() => prepareTaskLoop({ change: { dir }, task: "1.1", workspace: dir, context: [{ path: missing }] })).toThrow(missing);
	});
});

describe("task/agent: context is seeded only into a script that declares it", () => {
	it("seeds the stored text into a declaring script, and nothing into one that does not", () => {
		const dir = tinyChange();
		const options = { change: { dir }, task: "1.1", workspace: dir, context: [{ text: "Use tabs." }] };
		const declared = prepareTaskLoop({ ...options, script: { text: declaring("string") } });
		expect(seededVariables(declared, 1, "")).toMatchObject({ context: "Use tabs." });
		const plain = prepareTaskLoop({ ...options, script: { text: JUDGE_ONLY } });
		expect(seededVariables(plain, 1, "")).not.toHaveProperty("context");
	});

	it("seeds an empty string when the loop has no context", () => {
		const dir = tinyChange();
		const input = prepareTaskLoop({ change: { dir }, task: "1.1", workspace: dir, script: { text: declaring("string") } });
		expect(seededVariables(input, 1, "")).toMatchObject({ context: "" });
	});

	it("refuses a script that declares context as anything but a string", () => {
		expect(contractProblems(declaring("number")).join("\n")).toContain("context");
	});
});

describe("task/agent: every delegate's preamble carries the context", () => {
	const base = { task: "1.1", taskText: "do it", proposal: "P", design: "", deltas: "D" };

	it("adds a Project context block after the rules", () => {
		const preamble = taskPreamble({ ...base, context: "Use tabs." });
		expect(preamble).toContain("# Project context\n\nUse tabs.");
		expect(preamble.indexOf("Rules:")).toBeLessThan(preamble.indexOf("# Project context"));
		expect(preamble.indexOf("# Project context")).toBeLessThan(preamble.indexOf("# proposal.md"));
	});

	it("adds nothing without context", () => {
		expect(taskPreamble(base)).not.toContain("Project context");
	});
});

describe("task/agent: task.agent shows the context to its orient and act steps", () => {
	const run = (extra: { context?: { text: string }[] }) =>
		runLoop([plan("Edit src/a.ts"), text("Done."), verdict(true)], {
			script: { path: TASK_SCRIPT },
			workspace: gitRepo(),
			checks: [COUNT_CHECK],
			allow: ["pnpm", "node"],
			...extra,
		});

	it("shows it when the loop has context", async () => {
		const r = await run({ context: [{ text: "Use tabs." }] });
		await r.harness.close(context);
		expect(r.outcome.status).toBe("converged");
		const all = prompts(r.env.requests);
		for (const role of ["orient", "act"]) {
			const step = all.filter((p) => p.startsWith(`You are the ${role} step`));
			expect(step, role).toHaveLength(1);
			expect(step[0], role).toContain("Project context (the repository's own conventions");
			expect(step[0], role).toContain("Use tabs.");
		}
	});

	it("shows nothing without context", async () => {
		const r = await run({});
		await r.harness.close(context);
		expect(prompts(r.env.requests).some((p) => p.includes("Project context"))).toBe(false);
	});
});

describe("task/agent: a group hands its context to every task", () => {
	it("reads it once and puts it in each task loop's input", () => {
		const dir = tinyChange();
		const input = validateGroupStart({ change: { dir }, group: 1, workspace: dir, checks: ["node --version"], context: [{ text: "Use tabs." }] });
		expect(input.context).toBe("Use tabs.");
		expect(taskLoopInputFor(input, "1.1", "").context).toBe("Use tabs.");
		expect(taskLoopInputFor(input, "1.2", "").context).toBe("Use tabs.");
	});
});

describe("task/headless: task.context in agentscript.config.json", () => {
	/** A root holding `agentscript.config.json` with `task` as given and the tiny change as `tiny`. */
	function configured(task: Record<string, unknown>) {
		const root = realpathSync(temp("task-context-root-"));
		writeFileSync(join(root, "agentscript.config.json"), JSON.stringify({ task }));
		cpSync(tinyChange(), join(root, "openspec", "changes", "tiny"), { recursive: true });
		return root;
	}

	it("resolves each path against the config file", () => {
		const root = configured({ context: ["CLAUDE.md", "docs/STYLE.md"] });
		const settings = resolveRunSettings({}, {}, loadConfig(root), root);
		expect(settings.context).toEqual([join(root, "CLAUDE.md"), join(root, "docs", "STYLE.md")]);
		expect(resolveRunSettings({}, {}, loadConfig(configured({})), root).context).toEqual([]);
	});

	it("must be an array of strings", () => {
		const root = configured({ context: "CLAUDE.md" });
		expect(() => loadConfig(root)).toThrow(ConfigError);
		expect(() => loadConfig(root)).toThrow("task.context must be an array of strings");
	});

	it("reaches the stored loop", async () => {
		const root = configured({ checks: ["node --version"], allow: ["node"], context: ["CLAUDE.md"] });
		writeFileSync(join(root, "CLAUDE.md"), CONVENTIONS);
		const env = fauxModels();
		env.faux.setResponses([plan("nothing"), text("done"), verdict(true)]);
		const r = await cli(["run", "tiny", "1.1", "--db", "loops.sqlite", "--script", "task", ...env.args], env, { cwd: root });
		expect(r.code, r.err).toBe(0);
		const { inputs } = await storedLoops(join(root, "loops.sqlite"));
		expect(inputs[0]?.context).toBe(`# ${join(root, "CLAUDE.md")}\n\n${CONVENTIONS.trimEnd()}`);
	});

	it("refuses a run whose context file is missing, naming it", async () => {
		const root = configured({ checks: ["node --version"], allow: ["node"], context: ["MISSING.md"] });
		const env = fauxModels();
		const r = await cli(["run", "tiny", "1.1", "--db", "loops.sqlite", "--script", "task", ...env.args], env, { cwd: root });
		expect(r.code).toBe(2);
		expect(r.err).toContain(join(root, "MISSING.md"));
		expect((await storedLoops(join(root, "loops.sqlite"))).loops).toHaveLength(0);
	});
});
