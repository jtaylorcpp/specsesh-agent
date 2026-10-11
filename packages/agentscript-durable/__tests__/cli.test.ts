import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { main, parseVar } from "../src/cli.js";
import { RESULT_TOOL } from "../src/index.js";
import { PIPELINE, setup } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX = createRequire(import.meta.url).resolve("tsx/cli");
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workdir() {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-cli-"));
	dirs.push(dir);
	const script = join(dir, "pipeline.agent");
	writeFileSync(script, PIPELINE);
	return { dir, script, db: join(dir, "runs.sqlite") };
}

/** Run main() in-process against the faux provider, capturing its output. */
async function cli(argv: string[], env = setup()) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(argv, { models: () => env.models, out: (l) => out.push(l), err: (l) => err.push(l) });
	return { code, out: out.join("\n"), err: err.join("\n"), env };
}

const fauxArgs = (env: ReturnType<typeof setup>) => ["--provider", env.model.provider, "--model", env.model.modelId];

describe("agentscript-durable run", () => {
	it("runs a script to completion on a SQLite database and prints the task ID first", async () => {
		const { script, db } = workdir();
		const env = setup();
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "high" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("On it.")]),
		]);
		const r = await cli(["run", script, "--db", db, ...fauxArgs(env), "--entry", "classify", "--entry", "gate", "--entry", "respond"], env);
		expect(r.code).toBe(0);
		expect(r.err).toMatch(/^task \d+ — resume with: agentscript-durable resume \d+ --db /);
		expect(r.out).toContain("— completed");
		expect(r.out).toContain('urgent = true');
		expect(r.out).toContain("On it.");
	});

	it("takes --var overrides and prints JSON with --json", async () => {
		const { script, db } = workdir();
		const env = setup();
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "low" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("ok")]),
		]);
		const entries = ["--entry", "classify", "--entry", "gate", "--entry", "respond"];
		const r = await cli(["run", script, "--db", db, ...fauxArgs(env), ...entries, "--var", "report=slow", "--json"], env);
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.out);
		expect(parsed.kind).toBe("completed");
		expect(parsed.variables.report).toBe("slow");
		expect(parsed.steps[0].request.prompt).toBe("Classify: slow");
	});

	it("exits 1 when the run ends failed", async () => {
		const { script, db } = workdir();
		const env = setup();
		env.faux.setResponses([fauxAssistantMessage([fauxText("no tool call")])]);
		const r = await cli(["run", script, "--db", db, ...fauxArgs(env)], env);
		expect(r.code).toBe(1);
		expect(r.out).toContain("— failed");
	});

	it("refuses an unknown model before creating anything", async () => {
		const { script, db } = workdir();
		const r = await cli(["run", script, "--db", db, "--provider", "faux", "--model", "nope"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain('no model "nope" on provider "faux"');
	});

	it("prints usage without --db or a command", async () => {
		expect((await cli(["run", "x.agent"])).code).toBe(2);
		expect((await cli(["frobnicate"])).err).toContain("usage:");
	});
});

describe("agentscript-durable resume", () => {
	it("finishes a run whose process crashed, from the same database", async () => {
		const { db } = workdir();
		let id = "";
		try {
			execFileSync(process.execPath, [TSX, join(HERE, "fixtures", "crash-child.ts"), db, "2"], { encoding: "utf8" });
		} catch (error) {
			id = /TASK (\d+)/.exec((error as { stdout: string }).stdout)?.[1] ?? "";
		}
		expect(id).toMatch(/^\d+$/);

		const env = setup();
		env.faux.setResponses([fauxAssistantMessage([fauxText("Escalated.")])]);
		const r = await cli(["resume", id, "--db", db], env);
		expect(r.code).toBe(0);
		expect(r.out).toContain(`# task ${id} — completed`);
		expect(r.out).toContain("Escalated.");
		expect(r.out).toContain("urgent = true");
		expect(r.env.requests).toHaveLength(1);
	}, 90_000);

	it("refuses a task ID that is not in the database", async () => {
		const { db } = workdir();
		const r = await cli(["resume", "999", "--db", db]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("no task 999");
	});
});

describe("parseVar", () => {
	it.each([
		["a=b", ["a", "b"]],
		["n=2", ["n", 2]],
		["t=True", ["t", true]],
		["f=False", ["f", false]],
	])("%s", (raw, expected) => expect(parseVar(raw)).toEqual(expected));
});
