import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { ReasoningPort, StepOutcome } from "../../src/interpreter/index.js";
import { testPattern as ontologyTestPattern } from "../../src/openspec/index.js";
import { RESULT_TOOL } from "../../src/pi/index.js";
import { pickTests, testPattern, type PickTestsInput } from "../../src/task/index.js";
import { recordingPort } from "../core/helpers/recording-port.js";
import { cli, fauxModels } from "./cli-helpers.js";
import { temp } from "./helpers.js";

/** A step answering `pick` with this value, JSON-encoded unless it is already a string. */
const picks = (pick: unknown): StepOutcome => ({
	kind: "answered",
	text: "",
	structured: { pick: typeof pick === "string" ? pick : JSON.stringify(pick) },
});

const INPUT: PickTestsInput = {
	task_id: "2.1",
	task_text: "Add retries",
	scenarios: "Retries back off",
	changed_files: "src/net.ts",
	test_files: "src/a.test.ts\nsrc/b.test.ts",
};

const ONE = { tests: ["src/b.test.ts"], names: ["retries"], reasons: [{ test: "src/b.test.ts", why: "imports b" }] };

describe("task/test-pick: the bundled script", () => {
	it("Scenario: The picker script shows the task and reads back one pick", async () => {
		const { port, requests } = recordingPort(picks(ONE));
		const result = await pickTests({ ...INPUT, test_files: "src/a.test.ts" }, { port });
		expect(requests).toHaveLength(1);
		const [request] = requests;
		expect(request!.prompt).toContain("Add retries");
		expect(request!.prompt).toContain("Retries back off");
		expect(request!.prompt).toContain("src/a.test.ts");
		expect(Object.keys((request!.outputSchema as { properties: object }).properties)).toEqual(["pick"]);
		// src/b.test.ts is not among this run's test files, so the pick held only a name.
		expect(result).toEqual({ ok: true, pick: { tests: [], names: ["retries"], reasons: [] } });
	});

	it("Scenario: The diff is shown only when given", async () => {
		const withDiff = recordingPort(picks(ONE));
		await pickTests({ ...INPUT, diff: "+retry()" }, { port: withDiff.port });
		expect(withDiff.requests[0]!.prompt).toContain("+retry()");
		const without = recordingPort(picks(ONE));
		await pickTests(INPUT, { port: without.port });
		expect(without.requests[0]!.prompt).not.toContain("Diff");
	});
});

describe("task/test-pick: a pick drawn only from the test files", () => {
	it("Scenario: A valid pick is returned", async () => {
		const { port } = recordingPort(picks(ONE));
		expect(await pickTests(INPUT, { port })).toEqual({ ok: true, pick: ONE });
	});

	it("Scenario: An invented test path is dropped", async () => {
		const { port } = recordingPort(
			picks({
				tests: ["src/a.test.ts", "src/made-up.test.ts"],
				names: [],
				reasons: [
					{ test: "src/a.test.ts", why: "covers a" },
					{ test: "src/made-up.test.ts", why: "invented" },
				],
			}),
		);
		const result = await pickTests({ ...INPUT, test_files: "src/a.test.ts" }, { port });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.pick.tests).toEqual(["src/a.test.ts"]);
		expect(result.pick.reasons.map((reason) => reason.test)).not.toContain("src/made-up.test.ts");
		expect(result.pick.reasons).toEqual([{ test: "src/a.test.ts", why: "covers a" }]);
	});

	it("Scenario: Duplicate tests and names are removed", async () => {
		const { port } = recordingPort(picks({ tests: ["./src/a.test.ts", "src/a.test.ts"], names: ["retries", "retries"], reasons: [] }));
		const result = await pickTests(INPUT, { port });
		expect(result).toEqual({ ok: true, pick: { tests: ["src/a.test.ts"], names: ["retries"], reasons: [] } });
	});
});

describe("task/test-pick: the sibling pre-filter", () => {
	it("Scenario: Sibling tests are added by the pre-filter", async () => {
		const { port, requests } = recordingPort(picks({ tests: [], names: ["x"], reasons: [] }));
		const result = await pickTests(
			{
				...INPUT,
				changed_files: "src/a.ts\npkg/foo.go\nlib/mod.py",
				test_files: "src/other.test.ts\nlib/test_mod.py\npkg/foo_test.go\nsrc/a.test.ts",
			},
			{ port },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.pick.tests).toEqual(["src/a.test.ts", "pkg/foo_test.go", "lib/test_mod.py"]);
		expect(result.pick.reasons.map((reason) => reason.why)).toEqual([
			"sits beside the changed file src/a.ts",
			"sits beside the changed file pkg/foo.go",
			"sits beside the changed file lib/mod.py",
		]);
		const prompt = requests[0]!.prompt;
		const listed = prompt.slice(prompt.indexOf("Already picked"));
		for (const test of result.pick.tests) expect(listed).toContain(test);
		expect(listed).not.toContain("src/other.test.ts\n");
	});

	it("Scenario: A changed test file is picked", async () => {
		const { port } = recordingPort(picks({ tests: [], names: ["x"], reasons: [] }));
		const result = await pickTests({ ...INPUT, changed_files: "src/b.test.ts" }, { port });
		expect(result.ok && result.pick.tests).toContain("src/b.test.ts");
	});

	it("matches __tests__ and tests subdirectories and .spec files, but not another stem", async () => {
		const { port } = recordingPort(picks({ tests: [], names: ["x"], reasons: [] }));
		const result = await pickTests(
			{
				...INPUT,
				changed_files: "src/net.ts",
				test_files: "src/__tests__/net.test.ts\nsrc/tests/net.spec.tsx\nsrc/network.test.ts\nother/net.test.ts",
			},
			{ port },
		);
		expect(result.ok && result.pick.tests).toEqual(["src/__tests__/net.test.ts", "src/tests/net.spec.tsx"]);
	});
});

describe("task/test-pick: never throws", () => {
	it("Scenario: Invalid JSON answers ok false", async () => {
		const { port } = recordingPort(picks("not json"));
		const result = await pickTests(INPUT, { port });
		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toContain("JSON");
	});

	it("accepts a pick wrapped in one code fence", async () => {
		const { port } = recordingPort(picks("```json\n" + JSON.stringify(ONE) + "\n```"));
		expect(await pickTests(INPUT, { port })).toEqual({ ok: true, pick: ONE });
	});

	it("Scenario: A pick that fails the TestPick schema answers ok false", async () => {
		const { port } = recordingPort(picks({ tests: "src/a.test.ts" }));
		const result = await pickTests(INPUT, { port });
		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toContain("TestPick");
	});

	it("Scenario: A timeout answers ok false", async () => {
		const port: ReasoningPort = { reason: () => new Promise<StepOutcome>(() => {}) };
		const result = await pickTests(INPUT, { port, timeoutMs: 20 });
		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toContain("timed out");
	});

	it("Scenario: A provider failure answers ok false", async () => {
		const failing = recordingPort({ kind: "failed", category: "rate_limit", message: "slow down" });
		const failed = await pickTests(INPUT, { port: failing.port });
		expect(failed.ok).toBe(false);
		expect(!failed.ok && failed.reason).toContain("rate_limit");
		const throwing: ReasoningPort = {
			reason: async () => {
				throw new Error("socket hang up");
			},
		};
		const thrown = await pickTests(INPUT, { port: throwing });
		expect(thrown.ok).toBe(false);
		expect(!thrown.ok && thrown.reason).toContain("socket hang up");
		// An unknown provider fails before any step, and still answers rather than throwing.
		const unknown = await pickTests(INPUT, { provider: "faux-nowhere", model: "m", models: fauxModels().models });
		expect(unknown.ok).toBe(false);
	});

	it("Scenario: No test files answers ok false without a model call", async () => {
		const { port, requests } = recordingPort(picks(ONE));
		const result = await pickTests({ ...INPUT, test_files: "" }, { port });
		expect(result.ok).toBe(false);
		expect(requests).toHaveLength(0);
	});

	it("answers ok false when the pick names no test and no name", async () => {
		const { port } = recordingPort(picks({ tests: ["src/made-up.test.ts"], names: [], reasons: [] }));
		const result = await pickTests(INPUT, { port });
		expect(result.ok).toBe(false);
	});
});

describe("task/test-pick: testPattern", () => {
	it("Scenario: Names are escaped and joined", () => {
		const pattern = testPattern(["retries (backoff)", "a.b|c"]);
		expect(pattern).toBe("retries \\(backoff\\)|a\\.b\\|c");
		expect(new RegExp(`^(${pattern})$`).test("a.b|c")).toBe(true);
		expect(new RegExp(`^(${pattern})$`).test("aXb|c")).toBe(false);
		expect(new RegExp(`^(${pattern})$`).test("retries (backoff)")).toBe(true);
		// ./task re-exports the ontology's function.
		expect(testPattern).toBe(ontologyTestPattern);
	});

	it("Scenario: No names give an empty pattern", () => {
		expect(testPattern([])).toBe("");
	});
});

describe("task/test-pick: agentscript-task pick-tests", () => {
	it("Scenario: pick-tests prints the pick as JSON", async () => {
		const dir = temp("pick-tests-");
		const file = join(dir, "input.json");
		writeFileSync(file, JSON.stringify({ ...INPUT, test_files: "src/a.test.ts" }));
		const env = fauxModels();
		const pick = { tests: ["src/a.test.ts"], names: ["retries"], reasons: [{ test: "src/a.test.ts", why: "covers retries" }] };
		env.faux.setResponses([fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { pick: JSON.stringify(pick) })], { stopReason: "toolUse" })]);
		const r = await cli(["pick-tests", "--input", file, ...env.args], env, { cwd: dir });
		expect(r.code).toBe(0);
		const printed = JSON.parse(r.out) as { ok: boolean; pick: { tests: string[] }; pattern: string };
		expect(printed.ok).toBe(true);
		expect(printed.pick.tests).toEqual(["src/a.test.ts"]);
		expect(printed.pattern).toBe("retries");
	});

	it("prints ok false and exits 1 when the pick fails", async () => {
		const dir = temp("pick-tests-");
		const file = join(dir, "input.json");
		writeFileSync(file, JSON.stringify({ ...INPUT, test_files: "" }));
		const env = fauxModels();
		const r = await cli(["pick-tests", "--input", file, ...env.args], env, { cwd: dir });
		expect(r.code).toBe(1);
		expect(JSON.parse(r.out)).toMatchObject({ ok: false });
		expect(env.faux.state.callCount).toBe(0);
	});

	it("Scenario: pick-tests without --input prints usage", async () => {
		const r = await cli(["pick-tests"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
		expect(r.err).toContain("specsesh task pick-tests --input <file.json>");
	});

	it("exits 2 on an unreadable input file", async () => {
		const dir = temp("pick-tests-");
		const r = await cli(["pick-tests", "--input", join(dir, "missing.json")], fauxModels(), { cwd: dir });
		expect(r.code).toBe(2);
		expect(r.err).toContain("could not read");
	});
});
