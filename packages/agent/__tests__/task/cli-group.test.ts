import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RESULT_TOOL } from "../../src/durable/index.js";
import { cli, events, fauxModels, workdir } from "./cli-helpers.js";
import { GROUP_JUDGE, cleanTemps, tinyChange, toolCall, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

// The group check as the CLI runs it: `node check.mjs <counter>`. It fails its first call, then passes.
// The tasks run only the judge script, so the group is the check's only caller.
const CHECK = `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
const calls = (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0) + 1;
writeFileSync(file, String(calls));
if (calls === 1) {
	console.log("REGRESSION: 1.1 broke 1.2");
	process.exit(1);
}
`;

/** Run group 1 of the tiny change in process, with the given group check and script turns. */
async function runGroup(check: string, responses: Parameters<ReturnType<typeof fauxModels>["faux"]["setResponses"]>[0], extra: string[] = []) {
	const { dir, script, db } = workdir();
	const groupScript = join(dir, "group.agent");
	writeFileSync(groupScript, GROUP_JUDGE);
	const env = fauxModels();
	env.faux.setResponses(responses);
	const r = await cli(
		["run", tinyChange(), "1", "--db", db, "--script", script, "--group-script", groupScript, "--workspace", dir, "--check", check, ...extra, ...env.args],
		env,
	);
	return { ...r, dir };
}

describe("task/headless: A group's stream (through the CLI)", () => {
	it("Scenario: A group's stream", async () => {
		const r = await runGroup("node --version", [verdict(true), verdict(true)]);
		expect(r.code, r.err).toBe(0);
		const stream = events(r.errLines);
		const kinds = stream.map((e) => e.event);

		expect(kinds.indexOf("group-started")).toBe(0);
		expect(stream[0]).toMatchObject({ group: 1, tasks: ["1.1", "1.2"] });
		const started = stream.filter((e) => e.event === "loop-started");
		expect(started.map((e) => e.task)).toEqual(["1.1", "1.2"]);
		for (const e of started) expect(e.group).toBe(1);
		const check = stream.find((e) => e.event === "group-check");
		expect(check).toMatchObject({ passed: true });
		expect((check?.commands as { exitCode: number }[])[0]?.exitCode).toBe(0);
		expect(kinds.lastIndexOf("group-ended")).toBe(kinds.length - 1);
		expect(stream.at(-1)).toMatchObject({ status: "converged" });

		// Order: group-started, task events, group-check, group-ended.
		expect(kinds.indexOf("loop-started")).toBeGreaterThan(kinds.indexOf("group-started"));
		expect(kinds.indexOf("group-check")).toBeGreaterThan(kinds.lastIndexOf("loop-ended"));
		expect(kinds.indexOf("group-ended")).toBeGreaterThan(kinds.indexOf("group-check"));
	});

	it("a rework streams a failed group-check, then a rework event with its reason", async () => {
		const { dir, script, db } = workdir();
		const groupScript = join(dir, "group.agent");
		writeFileSync(groupScript, GROUP_JUDGE);
		writeFileSync(join(dir, "check.mjs"), CHECK);
		const counter = join(dir, "counter");
		const env = fauxModels();
		// 1.1 and 1.2, the failed check and a rework of 1.1, 1.1 again, then the check passes.
		env.faux.setResponses([
			verdict(true),
			verdict(true),
			toolCall(RESULT_TOOL, { next_action: "rework", rework_task: "1.1", feedback: "restore the import", question: "" }),
			verdict(true),
		]);
		const r = await cli(
			["run", tinyChange(), "1", "--db", db, "--script", script, "--group-script", groupScript, "--workspace", dir, "--check", `${process.execPath} ${join(dir, "check.mjs")} ${counter}`, ...env.args],
			env,
		);
		expect(r.code, r.err).toBe(0);
		expect(existsSync(counter) && readFileSync(counter, "utf8")).toBe("2");

		const stream = events(r.errLines);
		const checks = stream.filter((e) => e.event === "group-check");
		expect(checks.map((e) => e.passed)).toEqual([false, true]);
		const rework = stream.find((e) => e.event === "rework");
		expect(rework).toMatchObject({ task: "1.1" });
		expect(String(rework?.reason)).not.toBe("");
		const kinds = stream.map((e) => e.event);
		expect(kinds.indexOf("group-check")).toBeLessThan(kinds.indexOf("rework"));
		expect(stream.at(-1)).toMatchObject({ event: "group-ended", status: "converged", tasks: [{ task: "1.1", runs: 2 }, { task: "1.2", runs: 1 }] });
	});
});
