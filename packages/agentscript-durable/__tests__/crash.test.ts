import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { RunResult } from "@coopcli/agentscript/interpreter";
import type { TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { RESULT_TOOL, waitForScript } from "../src/index.js";
import { context, openHarness, setup } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX = createRequire(import.meta.url).resolve("tsx/cli");
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Run the crashing child to completion (it exits non-zero by design) and return what it printed. */
function crashChild(dbPath: string, crashAt = 2): { out: string; status: number | null } {
	try {
		const out = execFileSync(process.execPath, [TSX, join(HERE, "fixtures", "crash-child.ts"), dbPath, String(crashAt)], {
			encoding: "utf8",
			timeout: 60_000,
		});
		return { out, status: 0 };
	} catch (error) {
		const e = error as { stdout?: string; status?: number | null };
		return { out: e.stdout ?? "", status: e.status ?? null };
	}
}

describe("a run that survives its process dying", () => {
	it("resumes from SQLite after a crash mid-run, without re-running the finished step", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agentscript-crash-"));
		dirs.push(dir);
		const dbPath = join(dir, "run.sqlite");

		const child = crashChild(dbPath);
		expect(child.out).toContain("CRASH");
		expect(child.status).toBe(137);
		// Task IDs are numbers; the string from stdout must be converted back.
		const id = Number(/TASK (\d+)/.exec(child.out)?.[1]) as TaskId<RunResult>;
		expect(Number.isInteger(id)).toBe(true);

		// A fresh process: same file, new harness, and only step 2's answer queued.
		const env = setup();
		env.faux.setResponses([fauxAssistantMessage([fauxText("Escalated.")])]);
		const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
		harness.resume();
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables).toEqual({ report: "it crashes", severity: "high", urgent: true });
		expect(result.steps.map((s) => s.subagent)).toEqual(["classify", "respond"]);
		expect(result.steps[0]?.outcome).toMatchObject({ kind: "answered", structured: { severity: "high" } });
		expect(result.steps[1]?.outcome).toEqual({ kind: "answered", text: "Escalated." });
		// Only step 2 reached the model in the resumed process.
		expect(env.requests).toHaveLength(1);
		expect(JSON.stringify(env.requests[0])).toContain("Write an urgent reply about: it crashes");
	}, 90_000);

	it("resumes a run that died on its very first model request, and runs every step", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agentscript-crash-"));
		dirs.push(dir);
		const dbPath = join(dir, "run.sqlite");

		const child = crashChild(dbPath, 1);
		expect(child.status).toBe(137);
		const id = Number(/TASK (\d+)/.exec(child.out)?.[1]) as TaskId<RunResult>;
		expect(Number.isInteger(id)).toBe(true);

		const env = setup();
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "low" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Queued.")]),
		]);
		const harness = await openHarness(await openNodeSqliteStorage(dbPath), env);
		harness.resume();
		const result = await waitForScript(harness, id, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(result.variables).toEqual({ report: "it crashes", severity: "low", urgent: false });
		expect(env.requests).toHaveLength(2);
	}, 90_000);
});
