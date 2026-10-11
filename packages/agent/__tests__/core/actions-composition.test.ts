import { describe, expect, it } from "vitest";
import { next, run, start, type StepOutcome } from "../../src/interpreter/index.js";
import { BOOLEAN_COMPARISON, STRUCTURED } from "./helpers/fixtures.js";
import { CHECK, OFFERS, recordingHost, subagentDocument } from "./helpers/actions.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

const withCalls = (...toolCalls: NonNullable<Extract<StepOutcome, { kind: "answered" }>["toolCalls"]>): StepOutcome => ({
	kind: "answered",
	text: "done",
	toolCalls,
});

describe("core/composition: Run inputs are evaluated when the run is reached", () => {
	it("Scenario: An input reads an earlier set", () => {
		// CHECK starts with task_id "" and its run reads @variables.task_id.
		const source = CHECK.replace('set @variables.stage = "checking"', 'set @variables.task_id = "2.4"');
		const step = next(source, start(source));
		if (step.type !== "action") throw new Error(`expected an action call, got ${step.type}`);
		expect(step.call.inputs).toEqual({ task_id: "2.4" });
	});

	it("Scenario: A wrongly typed input never reaches the host", async () => {
		const source = subagentDocument({
			variables: 'label: mutable string = "three"\ntotal: mutable number = 0',
			actions: `    actions:
        count_things:
            description: "Count"
            inputs:
                count: number
            outputs:
                total: number
            target: "mcpTool://count_things"
`,
			instructions: "run @actions.count_things\n    with count = @variables.label\n    set @variables.total = @outputs.total",
		});
		const { host, calls } = recordingHost({ ok: true, outputs: { total: 3 } });
		const { port, requests } = recordingPort(answered());
		const result = await run(source, { port, actionHost: host });
		expect(result.kind).toBe("failed");
		expect(calls).toHaveLength(0);
		expect(requests).toHaveLength(0);
		const last = result.actions.at(-1);
		expect(last?.result.ok).toBe(false);
		expect(last?.result.ok === false ? last.result.message : "").toContain("count");
	});
});

describe("core/composition: Run outputs are applied together", () => {
	it("Scenario: Two outputs land together", async () => {
		const { host } = recordingHost({ ok: true, outputs: { passed: true, output: "12 passed" } });
		const result = await run(CHECK, { port: recordingPort(answered()).port, actionHost: host });
		expect(result.kind).toBe("completed");
		expect(result.variables).toMatchObject({ checks_passed: true, check_output: "12 passed" });
	});

	it("Scenario: A missing output field sets nothing", async () => {
		const { host } = recordingHost({ ok: true, outputs: { passed: true } });
		const result = await run(CHECK, { port: recordingPort(answered()).port, actionHost: host });
		expect(result.kind).toBe("failed");
		const last = result.actions.at(-1);
		expect(last?.result.ok === false ? last.result.message : "").toContain('"output"');
		// passed was present, but nothing is set from a failed call.
		expect(result.variables["checks_passed"]).toBe(false);
	});
});

describe("core/composition: A reasoning action becomes a tool offer", () => {
	it("Scenario: Model-filled and bound inputs are split", () => {
		const step = next(OFFERS, start(OFFERS));
		if (step.type !== "request") throw new Error("expected a request");
		const tools = step.request.tools ?? [];
		expect(tools.map((t) => t.name)).toEqual(["shell", "note", "edit"]);
		const [shell, note] = tools;
		expect(shell?.inputSchema["properties"]).toEqual({ command: { type: "string" } });
		expect(shell?.bound).toEqual({});
		expect(shell?.action).toBe("run_command");
		expect(shell?.description).toBe("Run an allowed command");
		expect(shell?.inputSchema).toMatchObject({ type: "object", required: ["command"], additionalProperties: false });
		expect(note?.inputSchema["required"]).toEqual(["content"]);
		expect(note?.bound).toEqual({ path: "NOTES.md" });
		expect(note?.action).toBe("edit_file");
	});
});

describe("core/composition: A reasoning action's set takes the last call's outputs", () => {
	it("Scenario: The last call wins", async () => {
		const { port } = recordingPort(
			withCalls(
				{ name: "shell", inputs: { command: "pnpm test" }, outputs: { exit_code: 1, output: "1 failed" } },
				{ name: "shell", inputs: { command: "pnpm test" }, outputs: { exit_code: 0, output: "ok" } },
			),
		);
		const result = await run(OFFERS, { port });
		expect(result.kind).toBe("completed");
		expect(result.variables["last_exit"]).toBe(0);
	});

	it("Scenario: A tool never called sets nothing", async () => {
		const { port } = recordingPort(answered("nothing to do"));
		const result = await run(OFFERS, { port });
		expect(result.kind).toBe("completed");
		expect(result.steps[0]?.outcome.kind).toBe("answered");
		expect(result.variables["last_exit"]).toBe(99);
	});
});

describe("core/composition: Logic lines are decided by the program, never the model", () => {
	it("Scenario: Logic never consults the model", async () => {
		const source = `variables:
    name: mutable string = "World"
    excited: mutable boolean = False

subagent greet:
    description: "Greet"

    reasoning:
        instructions: ->
            if @variables.name == "World":
                set @variables.excited = True
`;
		const { port, requests } = recordingPort(answered());
		const result = await run(source, { port });
		expect(requests).toHaveLength(0);
		expect(result.kind).toBe("completed");
		expect(result.variables["excited"]).toBe(true);
	});

	it("Scenario: A boolean literal in a comparison is evaluated as a value", async () => {
		const first = recordingPort(answered());
		const blocked = await run(BOOLEAN_COMPARISON, { port: first.port });
		const second = recordingPort(answered());
		const specs = await run(BOOLEAN_COMPARISON, { port: second.port, variables: { approved: true } });
		expect(blocked.variables["stage"]).toBe("blocked");
		expect(specs.variables["stage"]).toBe("specs");
		expect(first.requests).toHaveLength(0);
		expect(second.requests).toHaveLength(0);
	});

	it("Scenario: A run statement makes no request", async () => {
		const { port, requests } = recordingPort(answered());
		const { host, calls } = recordingHost({ ok: true, outputs: { passed: true, output: "ok" } });
		const result = await run(CHECK, { port, actionHost: host });
		expect(requests).toHaveLength(0);
		expect(calls).toHaveLength(1);
		expect(result.kind).toBe("completed");
	});
});

describe("core/composition: Only the structured result writes a variable from the model", () => {
	it("Scenario: A structured update applies only that result", async () => {
		const { port } = recordingPort({ kind: "answered", text: "verdict: rejected", structured: { verdict: "approved" } });
		const result = await run(STRUCTURED, { port });
		expect(result.variables["verdict"]).toBe("approved");
	});

	it("Scenario: Prose is not parsed for state", async () => {
		const { port } = recordingPort({ kind: "answered", text: '{"verdict":"approved"}' });
		const result = await run(STRUCTURED, { port });
		expect(result.variables["verdict"]).not.toBe("approved");
		expect(result.variables["verdict"]).toBe("undecided");
	});

	it("Scenario: A tool call's arguments are not its outputs", async () => {
		const { port } = recordingPort(
			withCalls({ name: "edit", inputs: { path: "a.ts", content: "x", ok: true }, outputs: { ok: false } }),
		);
		const result = await run(OFFERS, { port });
		expect(result.kind).toBe("completed");
		expect(result.variables["edited"]).toBe(false);
	});
});
