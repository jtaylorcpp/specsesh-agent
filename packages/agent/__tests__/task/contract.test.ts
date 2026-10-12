import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { analyze } from "../../src/authoring/index.js";
import { ActionBindingError } from "../../src/durable/index.js";
import { scanDocument } from "../../src/interpreter/index.js";
import { readDeclarations } from "../../src/interpreter/compose.js";
import { BUNDLED_SCRIPTS, contractProblems, prepareTaskLoop, startTaskLoop } from "../../src/task/index.js";
import {
	DELTA,
	JUDGE_ONLY,
	SCRIPTS,
	baselineCopy,
	cleanTemps,
	context,
	judgeOnlyWith,
	loopEnv,
	loopHarness,
	runLoop,
	runTasks,
	tinyChange,
	verdict,
} from "./helpers.js";

afterEach(cleanTemps);

describe("task/agent: Deltas reach the script as one string with capability prefixes", () => {
	it("Scenario: Two deltas are concatenated in order", () => {
		const dir = tinyChange({ capabilities: ["durable/host", "durable/cli"] });
		const input = prepareTaskLoop({ change: { dir }, task: "1.1", script: { text: JUDGE_ONLY }, workspace: dir });
		const delta = (capability: string) => DELTA.replace("two", capability);
		expect(input.deltas).toBe(`## durable/cli\n${delta("durable/cli")}\n## durable/host\n${delta("durable/host")}`);
		expect(input.deltas.indexOf("## durable/cli")).toBeLessThan(input.deltas.indexOf("## durable/host"));
	});

	it("names text deltas by position and path deltas by their capability", () => {
		const dir = tinyChange({ capabilities: ["value/file"] });
		const input = prepareTaskLoop({
			change: {
				proposal: { text: "p" },
				deltas: [{ text: "first" }, { path: join(dir, "specs", "value", "file", "spec.md") }],
				tasks: { text: "- [ ] 1.1 t\n" },
			},
			task: "1.1",
			script: { text: JUDGE_ONLY },
			workspace: dir,
		});
		expect(input.deltas).toBe(`## delta 1\nfirst\n\n## value/file\n${DELTA.replace("two", "value/file")}`);
	});
});

describe("task/agent: The script declares the variables the loop seeds", () => {
	it("Scenario: The first iteration is seeded", async () => {
		const r = await runLoop([verdict(true)], { change: { dir: baselineCopy() }, task: "2.4" });
		const [run] = await runTasks(r.storage);
		await r.harness.close(context);
		const variables = (run?.input as { options: { variables: Record<string, unknown> } }).options.variables;
		expect(variables).toMatchObject({ task_id: "2.4", iteration: 1, carried: "" });
		expect(Object.keys(variables).sort()).toEqual(["carried", "deltas", "design", "iteration", "proposal", "task_id", "task_text"]);
	});

	it("runs every subagent, in source order", async () => {
		const r = await runLoop([verdict(true)]);
		const [run] = await runTasks(r.storage);
		await r.harness.close(context);
		expect((run?.input as { options: { entry: string[] } }).options.entry).toEqual(["judge"]);
	});
});

describe("task/agent: The script declares the variables the loop reads back", () => {
	it("Scenario: A met verdict is read back", async () => {
		const r = await runLoop([verdict(true)]);
		await r.harness.close(context);
		expect(r.outcome.iterations[0]?.verdict.met).toBe(true);
		expect(r.outcome.status).toBe("converged");
	});
});

/** Start a loop of `script`, expecting a refusal; returns its message, the model requests and the tasks created. */
async function refused(script: string) {
	const { env, workspace } = loopEnv();
	const storage = new MemoryStorage();
	const harness = await loopHarness(env, storage);
	let error: unknown;
	try {
		await startTaskLoop(harness, { change: { dir: tinyChange() }, task: "1.1", script: { text: script }, workspace }, context);
	} catch (e) {
		error = e;
	}
	harness.resume();
	const tasks = (await storage.scanTasks({}, 10, undefined, context)).items;
	await harness.close(context);
	return { error: error as Error | undefined, requests: env.requests, tasks };
}

describe("task/agent: The contract is checked before anything runs", () => {
	it("Scenario: A script missing next_action is refused", async () => {
		// The declaration goes; the judge still sets it, which the lint alone would call an undeclared reference.
		const { error, requests, tasks } = await refused(judgeOnlyWith(['    next_action: mutable string = "retry"\n', ""]));
		expect(error?.message).toContain("next_action");
		expect(error?.message).toContain("string");
		expect(requests).toHaveLength(0);
		expect(tasks).toEqual([]);
	});

	it("Scenario: A mistyped variable is refused", async () => {
		const { error, tasks } = await refused(judgeOnlyWith(["    iteration: mutable number = 1\n", '    iteration: mutable string = ""\n']));
		expect(error?.message).toMatch(/iteration is declared string; the contract needs number/);
		expect(tasks).toEqual([]);
	});

	it("Scenario: A default outside the values is refused", async () => {
		const { error, requests, tasks } = await refused(
			judgeOnlyWith(['    next_action: mutable string = "retry"\n', '    next_action: mutable string = "proceed"\n']),
		);
		expect(error?.message).toContain("next_action");
		expect(error?.message).toContain('"proceed"');
		expect(error?.message).toContain('"retry", "amend-spec", "ask"');
		expect(requests).toHaveLength(0);
		expect(tasks).toEqual([]);
	});

	it("accepts the bundled task script's default", () => {
		expect(contractProblems(readFileSync(join(SCRIPTS, "task.agent"), "utf8"))).toEqual([]);
	});

	it("names every broken variable at once", () => {
		const problems = contractProblems(
			judgeOnlyWith(["    met: mutable boolean = False\n", '    met: mutable string = ""\n']).replace("    question: mutable string = \"\"\n", ""),
		);
		expect(problems).toEqual(["met is declared string; the contract needs boolean", "question is not declared; declare it as string"]);
	});

	it("checks the script's actions against the host's built-ins before anything runs", async () => {
		const unbound = `${JUDGE_ONLY}
subagent extra:
    description: "Calls a tool no host has"

    actions:
        nope:
            description: "Nothing"
            inputs:
                x: string
            outputs:
                y: string
            target: "mcpTool://nope"

    reasoning:
        instructions: ->
            run @actions.nope
                with x = "a"
`;
		const { error, requests, tasks } = await refused(unbound);
		expect(error).toBeInstanceOf(ActionBindingError);
		expect(error?.message).toContain("mcpTool://nope is not registered on this host");
		expect(requests).toHaveLength(0);
		expect(tasks).toEqual([]);
	});
});

describe("task/agent: The bundled scripts are the default and the subscription variant", () => {
	it("Scenario: The bundled scripts lint clean", () => {
		for (const name of ["task.agent", "task-delegate.agent"]) {
			const source = readFileSync(join(SCRIPTS, name), "utf8");
			expect(analyze(source).diagnostics, name).toEqual([]);
			expect(contractProblems(source), name).toEqual([]);
			// And each passes the whole start check: contract, document, actions against the built-ins.
			const dir = tinyChange();
			expect(() => prepareTaskLoop({ change: { dir }, task: "1.1", script: { text: source }, workspace: dir }), name).not.toThrow();
		}
		expect(readFileSync(BUNDLED_SCRIPTS.task, "utf8")).toBe(readFileSync(join(SCRIPTS, "task.agent"), "utf8"));
		expect(readFileSync(BUNDLED_SCRIPTS.delegate, "utf8")).toBe(readFileSync(join(SCRIPTS, "task-delegate.agent"), "utf8"));
	});

	it("Scenario: The bundled judge script is clean", () => {
		const source = readFileSync(join(SCRIPTS, "group.agent"), "utf8");
		const analysis = analyze(source);
		expect(analysis.diagnostics).toEqual([]);
		expect(scanDocument(analysis.parsed)).toEqual([]);
		// No action anywhere: the judge changes nothing itself.
		expect(source).not.toMatch(/^\s*actions:/m);
		expect(source).not.toContain("@actions");
		expect(source.match(/^subagent /gm)).toHaveLength(1);
		expect(readFileSync(BUNDLED_SCRIPTS.group, "utf8")).toBe(source);

		// Declared variables only; the full startGroupLoop contract check comes with the group loop.
		const declarations = readDeclarations(analysis.parsed);
		const expected = {
			group_number: "number",
			group_title: "string",
			tasks: "string",
			proposal: "string",
			deltas: "string",
			check_output: "string",
			rework_count: "number",
			next_action: "string",
			rework_task: "string",
			feedback: "string",
			question: "string",
		};
		for (const [name, type] of Object.entries(expected)) expect(declarations.get(name)?.type, name).toBe(type);
	});
});
