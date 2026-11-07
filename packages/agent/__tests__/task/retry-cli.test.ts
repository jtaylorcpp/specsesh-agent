// `specsesh task retry <loop-id>` (#47): a new run of a loop that ended failed or exhausted, on this
// process's turn limits, which its resume hint repeats. Anything else to retry is refused, exit 2.

import { cpSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { cli, fauxModels } from "./cli-helpers.js";
import { cleanTemps, plan, temp, text, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const stepFails = () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "claude stopped at its turn limit" });

function configured() {
	const root = realpathSync(temp("task-retry-root-"));
	writeFileSync(join(root, "agentscript.config.json"), JSON.stringify({ task: { checks: ["node --version"], allow: ["node"] } }));
	cpSync(tinyChange(), join(root, "openspec", "changes", "tiny"), { recursive: true });
	return root;
}

/** A task loop whose act step fails, in a fresh root; its id. */
async function failedLoop() {
	const root = configured();
	const env = fauxModels();
	env.faux.setResponses([plan("a plan"), stepFails()]);
	const r = await cli(["run", "tiny", "1.1", "--db", "loops.sqlite", "--script", "task", ...env.args], env, { cwd: root });
	expect(r.code, r.err).toBe(1);
	const id = /^loop (\d+) — resume with/.exec(r.errLines[0] ?? "")?.[1];
	expect(id, r.err).toBeDefined();
	return { root, id: id! };
}

describe("task/cli: retry", () => {
	it("starts a failed loop again on this process's turn limits, and the hint repeats them", async () => {
		const { root, id } = await failedLoop();
		const env = fauxModels();
		env.faux.setResponses([plan("a plan"), text("done"), verdict(true)]);
		const r = await cli(["retry", id, "--db", "loops.sqlite", "--max-turns", "60", "--turn-timeout", "600000"], env, { cwd: root });
		expect(r.code, r.err).toBe(0);
		expect(env.modelOptions).toEqual([{ maxTurns: 60, turnTimeoutMs: 600_000 }]);
		const next = /^loop (\d+) — resume with: specsesh task resume \1 --db loops\.sqlite --max-turns 60 --turn-timeout 600000$/.exec(r.errLines[0] ?? "")?.[1];
		expect(next, r.err).toBeDefined();
		expect(next).not.toBe(id);
		expect(r.out).toContain("converged");

		// The failed loop is as it ended; the retry is its own loop.
		const status = await cli(["status", "--db", "loops.sqlite"], fauxModels(), { cwd: root });
		expect(status.out).toMatch(new RegExp(`^loop ${id}\\s.*failed`, "m"));
		expect(status.out).toMatch(new RegExp(`^loop ${next}\\s.*converged`, "m"));
	});

	it("refuses a loop that converged, exit 2, starting nothing", async () => {
		const root = configured();
		const env = fauxModels();
		env.faux.setResponses([plan("a plan"), text("done"), verdict(true)]);
		const ran = await cli(["run", "tiny", "1.1", "--db", "loops.sqlite", "--script", "task", ...env.args], env, { cwd: root });
		expect(ran.code, ran.err).toBe(0);
		const id = /^loop (\d+) — resume with/.exec(ran.errLines[0] ?? "")?.[1];
		const r = await cli(["retry", id!, "--db", "loops.sqlite"], fauxModels(), { cwd: root });
		expect(r.code).toBe(2);
		expect(r.err).toContain(`task loop ${id} ended converged, not failed or exhausted, so there is nothing to retry`);
	});

	it("refuses an unknown loop, and a bad --max-turns", async () => {
		const { root } = await failedLoop();
		const unknown = await cli(["retry", "99", "--db", "loops.sqlite"], fauxModels(), { cwd: root });
		expect(unknown.code).toBe(2);
		expect(unknown.err).toContain("no loop 99");
		const bad = await cli(["retry", "7", "--db", "loops.sqlite", "--max-turns", "0"], fauxModels(), { cwd: root });
		expect(bad.code).toBe(2);
		expect(bad.err).toContain('--max-turns must be a positive integer, got "0"');
	});
});
