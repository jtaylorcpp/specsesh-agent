import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage, type Harness, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { RunResult } from "../../src/interpreter/index.js";
import {
	AgentScriptRun,
	agentScriptExtensions,
	createActionRegistry,
	waitForScript,
	type HostAction,
	type RunInput,
} from "../../src/durable/index.js";
import { context, openHarness, setup } from "./helpers.js";
import { contextAction, deterministicScript, durableChecks, hostAction, OFFERING } from "./action-scripts.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_HOOK = join(HERE, "fixtures", "ts-resolve.mjs");
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function withActions(actions: HostAction[], workspace = temp("agentscript-ws-")) {
	const env = setup();
	const installed = agentScriptExtensions({ actions: createActionRegistry(actions), workspace });
	env.registry.install(installed.run);
	env.registry.install(installed.step);
	return { env, installed };
}

/** Create the installed `agentscript.run` task with a whole `RunInput`, so `delegatePreamble` reaches it. */
async function startRun(harness: Harness, run: ReturnType<typeof agentScriptExtensions>["run"], input: RunInput) {
	const task = run.tasks?.find((t) => t.definition.name === AgentScriptRun.definition.name) as typeof AgentScriptRun;
	const root = await harness.root(context);
	return root.commit((tx) => tx.createTask(task, input, { ownership: { kind: "conversation" } }), context);
}

describe("durable/run-task: A run hands its delegate preamble to the actions it runs", () => {
	it("Scenario: A delegate preamble travels inside the task", async () => {
		const workspace = temp("agentscript-ws-");
		const dbPath = join(temp("agentscript-preamble-crash-"), "run.sqlite");
		let out = "";
		let status: number | null = 0;
		try {
			out = execFileSync(process.execPath, ["--import", TS_HOOK, join(HERE, "fixtures", "crash-preamble-child.ts"), dbPath, workspace], {
				encoding: "utf8",
				timeout: 60_000,
			});
		} catch (error) {
			const e = error as { stdout?: string; status?: number | null };
			out = e.stdout ?? "";
			status = e.status ?? null;
		}
		expect(out).toContain("CRASH");
		expect(status).toBe(137);
		const id = Number(/TASK (\d+)/.exec(out)?.[1]) as TaskId<RunResult>;

		// A fresh harness given only the database: the preamble comes from the task's input.
		const checks = durableChecks();
		const shell = hostAction("run_command", async () => ({ ok: true, outputs: { exit_code: 0, output: "" } }));
		const { env } = withActions([checks.action, shell], workspace);
		env.faux.setResponses([fauxAssistantMessage([fauxText("one")])]);
		const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
		harness.resume();
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(checks.startContexts).toHaveLength(1);
		expect(checks.startContexts[0]?.delegatePreamble).toBe("P");
		expect(checks.finishes[0]?.context.delegatePreamble).toBe("P");
	}, 90_000);

	it("Scenario: A step's tool call gets no preamble", async () => {
		const shell = contextAction("run_command", { ok: true, outputs: { exit_code: 0, output: "" } });
		const edit = contextAction("edit_file", { ok: true, outputs: { ok: true } });
		const { env, installed } = withActions([shell.action, edit.action]);
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("shell", { command: "pnpm test" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Done.")]),
		]);
		const harness = await openHarness(new MemoryStorage(), env);
		const id = await startRun(harness, installed.run, { source: OFFERING, model: env.model, delegatePreamble: "P" });
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(shell.contexts).toHaveLength(1);
		expect(shell.contexts[0]).not.toHaveProperty("delegatePreamble");
	});

	it("Scenario: A run without a preamble passes none", async () => {
		const shell = contextAction("run_command", { ok: true, outputs: { exit_code: 0, output: "" } });
		const { env, installed } = withActions([shell.action]);
		const harness = await openHarness(new MemoryStorage(), env);
		const id = await startRun(harness, installed.run, { source: deterministicScript("run_command"), model: env.model });
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(shell.contexts).toHaveLength(1);
		expect(shell.contexts[0]).not.toHaveProperty("delegatePreamble");
	});

	it("hands an executed action called with run the preamble", async () => {
		const shell = contextAction("run_command", { ok: true, outputs: { exit_code: 0, output: "" } });
		const { env, installed } = withActions([shell.action]);
		const harness = await openHarness(new MemoryStorage(), env);
		const id = await startRun(harness, installed.run, { source: deterministicScript("run_command"), model: env.model, delegatePreamble: "P" });
		await waitForScript(harness, id, context);
		await harness.close(context);

		expect(shell.contexts[0]?.delegatePreamble).toBe("P");
	});
});
