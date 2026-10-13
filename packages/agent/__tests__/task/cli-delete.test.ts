// The `deleteFiles` grant through the task CLI: `run` takes it from the config (or `false`),
// `resume` and `answer` from the loop's stored input, whatever the config says now.

import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Harness, MemoryStorage, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it } from "vitest";
import { buildHarness } from "../../src/bin/agentscript-task.js";
import { startTaskLoop, taskLoopExtensions, type TaskLoopInput } from "../../src/task/index.js";
import { cli, fauxModels, storedLoops } from "./cli-helpers.js";
import { JUDGE_ONLY, cleanTemps, context, temp, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

/** JUDGE_ONLY with a subagent before the judge that deletes `src/old.ts` without the model. */
const DELETING = JUDGE_ONLY.replace(
	"subagent judge:",
	`subagent retire:
    description: "Delete the retired file"

    actions:
        delete_file:
            description: "Delete a file in the workspace"
            inputs:
                path: string
            outputs:
                ok: boolean
            target: "mcpTool://delete_file"

    reasoning:
        instructions: ->
            run @actions.delete_file
                with path = "src/old.ts"

subagent judge:`,
);

/** A root (the workspace) holding `src/old.ts`, the deleting script and `agentscript.config.json` with `task`. */
function configured(task: Record<string, unknown>) {
	const root = realpathSync(temp("task-delete-"));
	const script = join(root, "deleting.agent");
	writeFileSync(script, DELETING);
	mkdirSync(join(root, "src"));
	plant(root);
	configure(root, task);
	return { root, script, db: join(root, "loops.sqlite"), old: join(root, "src", "old.ts") };
}

function plant(root: string): void {
	writeFileSync(join(root, "src", "old.ts"), "export {};\n");
}

function configure(root: string, task: Record<string, unknown>): void {
	writeFileSync(join(root, "agentscript.config.json"), JSON.stringify({ task: { db: "loops.sqlite", ...task } }));
}

/** The action names of the CLI's harness over a stored loop's input, as `resume` and `answer` build it. */
async function storedActions(input: TaskLoopInput): Promise<string[]> {
	const { faux } = fauxModels();
	const model = faux.getModel();
	const built = await buildHarness(new MemoryStorage(), { provider: faux.provider, model: { provider: model.provider, modelId: model.id } }, input);
	await built.harness.close(context);
	return [...built.actions.keys()];
}

describe("task/headless: The task config has a fixed set of typed fields", () => {
	it("Scenario: A config without the grant binds no delete", async () => {
		const { root, db } = configured({});
		// A script that calls no delete: how an ungranted call is answered is the optional-target rule's.
		const script = join(root, "judge.agent");
		writeFileSync(script, JUDGE_ONLY);
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--script", script, ...env.args], env, { cwd: root });
		expect(r.code, r.err).toBe(0);

		const { inputs } = await storedLoops(db);
		expect(inputs).toHaveLength(1);
		expect(inputs[0]?.deleteFiles).toBe(false);
		expect(await storedActions(inputs[0]!)).not.toContain("delete_file");
		// A loop stored before the grant existed has no field, and binds no delete either.
		const { deleteFiles: _, ...older } = inputs[0]!;
		expect(await storedActions(older as TaskLoopInput)).not.toContain("delete_file");
	});

	it("Scenario: Resume keeps the grant the loop started with", async () => {
		const { root, db, old } = configured({ deleteFiles: true });
		const env = fauxModels();
		// Started granted by a process that never ran it; the starter binds no delete itself.
		const registry = createRegistry();
		for (const extension of taskLoopExtensions({ workspace: root })) registry.install(extension);
		const harness = await Harness.open(await openNodeSqliteStorage(db), { models: env.models, registry }, context);
		const model = env.models.getModel(env.args[1]!, env.args[3]!)!;
		const id = await startTaskLoop(
			harness,
			{ change: { dir: tinyChange() }, task: "1.1", script: { text: DELETING }, workspace: root, model: { provider: model.provider, modelId: model.id }, deleteFiles: true },
			context,
		);
		await harness.close(context);
		expect(existsSync(old)).toBe(true);
		configure(root, {});

		env.faux.setResponses([verdict(true)]);
		const r = await cli(["resume", String(id), "--db", db], env, { cwd: root });
		expect(r.code, r.err).toBe(0);
		expect(existsSync(old)).toBe(false);
		const { inputs } = await storedLoops(db);
		expect(await storedActions(inputs[0]!)).toContain("delete_file");
	});
});

describe("task/agent: A harness binds the loop's actions to one workspace", () => {
	it("run passes a granted config's deleteFiles to the loop and the harness", async () => {
		const { root, script, db, old } = configured({ deleteFiles: true });
		const env = fauxModels();
		env.faux.setResponses([verdict(true)]);
		const r = await cli(["run", tinyChange(), "1.1", "--script", script, ...env.args], env, { cwd: root });
		expect(r.code, r.err).toBe(0);
		expect((await storedLoops(db)).inputs[0]?.deleteFiles).toBe(true);
		expect(existsSync(old)).toBe(false);
	});

	it("answer keeps the grant the loop started with", async () => {
		const { root, script, db, old } = configured({ deleteFiles: true });
		const env = fauxModels();
		env.faux.setResponses([verdict(false, "two ways", "ask", "Which way?")]);
		const blocked = await cli(["run", tinyChange(), "1.1", "--script", script, ...env.args], env, { cwd: root });
		expect(blocked.code, blocked.err).toBe(1);
		const id = (await storedLoops(db)).loops[0]!.id;
		plant(root);
		configure(root, {});

		env.faux.setResponses([verdict(true)]);
		const r = await cli(["answer", String(id), "--db", db, "--by", "principal", "--decision", "The first way"], env, { cwd: root });
		expect(r.code, r.err).toBe(0);
		expect(existsSync(old)).toBe(false);
	});
});
