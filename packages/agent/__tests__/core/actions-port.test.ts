import { describe, expect, it } from "vitest";
import { run } from "../../src/interpreter/index.js";
import { IN_SUBSET, STRUCTURED, TWO_STEPS } from "./helpers/fixtures.js";
import { CHECK, OFFERS, recordingHost, taskAgentFile } from "./helpers/actions.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

const ALLOWED_KEYS = ["systemInstructions", "prompt", "outputSchema", "tools"];

describe("core/reasoning-port: A tool offer declares, and never executes", () => {
	it("Scenario: An unoffered tool call fails the step", async () => {
		const source = OFFERS.replace(/            shell:[\s\S]*?(?=            edit:)/, "");
		const { port, requests } = recordingPort({
			kind: "answered",
			text: "",
			toolCalls: [{ name: "delete", inputs: { path: "src" }, ok: true, outputs: { ok: true } }],
		});
		const result = await run(source, { port });
		expect(requests[0]?.tools?.map((t) => t.name)).toEqual(["edit"]);
		expect(result.kind).toBe("failed");
		const outcome = result.steps[0]?.outcome;
		expect(outcome).toMatchObject({ kind: "failed", category: "unknown" });
		expect(outcome?.kind === "failed" ? outcome.message : "").toContain('"delete"');
		expect(result.variables["edited"]).toBe(true);
	});
});

describe("core/reasoning-port: A request has exactly three fields", () => {
	it("Scenario: Only the three fields cross the boundary", async () => {
		const plain = recordingPort(answered());
		await run(IN_SUBSET, { port: plain.port });
		const structured = recordingPort({ kind: "answered", text: "", structured: { verdict: "ok" } });
		await run(STRUCTURED, { port: structured.port });
		const all = [...plain.requests, ...structured.requests];
		expect(all).toHaveLength(2);
		for (const request of all) {
			for (const key of Object.keys(request)) expect(ALLOWED_KEYS).toContain(key);
			expect("tools" in request).toBe(false);
		}
		expect("outputSchema" in (plain.requests[0] ?? {})).toBe(false);
		expect(structured.requests[0]?.outputSchema).toBeDefined();
	});

	it("Scenario: A step with reasoning actions offers tools", async () => {
		const { port, requests } = recordingPort(answered("done"));
		await run(taskAgentFile("task.agent"), { port, entry: "act" });
		expect(requests).toHaveLength(1);
		expect(requests[0]?.tools?.map((t) => t.name)).toEqual(["read", "edit", "shell", "delete"]);
		expect("outputSchema" in (requests[0] ?? {})).toBe(false);
	});
});

describe("core/reasoning-port: A step ends answered, cut short, or failed", () => {
	it("Scenario: The implementation reports a step stopped at its bound", async () => {
		const { port } = recordingPort({ kind: "cut-short", text: "partial", turns: 7 });
		const result = await run(IN_SUBSET, { port });
		expect(result.steps[0]?.outcome).toEqual({ kind: "cut-short", text: "partial", turns: 7 });
		expect(result.kind).toBe("cut-short");
	});

	it("Scenario: An answer records the tools it called", async () => {
		const calls = [
			{ name: "shell", inputs: { command: "pnpm check" }, ok: true, outputs: { exit_code: 0, output: "ok" } },
			{ name: "shell", inputs: { command: "pnpm test" }, ok: true, outputs: { exit_code: 1, output: "1 failed" } },
		];
		const { port } = recordingPort({ kind: "answered", text: "done", toolCalls: calls });
		const result = await run(OFFERS, { port });
		const outcome = result.steps[0]?.outcome;
		expect(outcome?.kind).toBe("answered");
		const recorded = outcome?.kind === "answered" ? outcome.toolCalls : undefined;
		expect(recorded?.map((c) => c.name)).toEqual(["shell", "shell"]);
		expect(recorded).toEqual(calls);
	});
});

describe("core/reasoning-port: An answer records its tool calls", () => {
	it("Scenario: A refused call is recorded as not ok", async () => {
		const calls = [{ name: "shell", inputs: { command: "rm -rf src" }, ok: false, outputs: {} }];
		const { port } = recordingPort({ kind: "answered", text: "the command was refused", toolCalls: calls });
		const result = await run(OFFERS, { port });
		const outcome = result.steps[0]?.outcome;
		expect(outcome?.kind).toBe("answered");
		const recorded = outcome?.kind === "answered" ? outcome.toolCalls : undefined;
		expect(recorded).toEqual([{ name: "shell", inputs: { command: "rm -rf src" }, ok: false, outputs: {} }]);
	});
});

describe("core/reasoning-port: A run's kind comes from its last step", () => {
	it("Scenario: The interpreter imposes no bound of its own", async () => {
		const { port, requests } = recordingPort(answered());
		await run(TWO_STEPS, { port, entry: ["first", "second"] });
		expect(requests).toHaveLength(2);
		for (const request of requests) {
			for (const key of Object.keys(request)) {
				expect(key).not.toMatch(/turn|round|limit|max/i);
				expect(ALLOWED_KEYS).toContain(key);
			}
		}
	});

	it("Scenario: A failed action call ends the run", async () => {
		const source = `${CHECK}
subagent after:
    description: "Never reached"

    reasoning:
        instructions: ->
            | Report.
`;
		const { port, requests } = recordingPort(answered());
		const { host, calls } = recordingHost({ ok: false, message: "checks could not run" });
		const result = await run(source, { port, actionHost: host, entry: ["check", "after"] });
		expect(result.kind).toBe("failed");
		expect(calls).toHaveLength(1);
		expect(requests).toHaveLength(0);
		expect(result.steps).toEqual([]);
	});
});
