import { describe, expect, it } from "vitest";
import {
	NoEntrySubagentError,
	run,
	streamRun,
	type ReasoningPort,
	type ReasoningRequest,
	type RunEvent,
	type StepOutcome,
} from "../../src/interpreter/index.js";
import { recordingHost, subagentDocument } from "./helpers/actions.js";
import { NO_SUBAGENT } from "./helpers/fixtures.js";
import { answered } from "./helpers/recording-port.js";

const TWO_STEPS = `config:
    agent_name: "two-steps"

subagent first:
    description: "First"

    reasoning:
        instructions: ->
            | Say hello.

subagent second:
    description: "Second"

    reasoning:
        instructions: ->
            | Say goodbye.
`;
const TWO_ENTRIES = ["first", "second"];

const ECHO = subagentDocument({
	name: "echoer",
	variables: `said: mutable string = ""`,
	actions: `    actions:
        echo:
            description: "Echo the text back"
            inputs:
                text: string
            outputs:
                text: string
            target: "mcpTool://echo"
`,
	instructions: `run @actions.echo
    with text = "hi"
    set @variables.said = @outputs.text`,
});

/**
 * A port that records each call's arguments and reports `deltas` through the
 * stream, before it resolves or, with `late`, after.
 */
function deltaPort(options: { deltas?: readonly string[]; answer?: StepOutcome; late?: boolean } = {}) {
	const calls: unknown[][] = [];
	const port: ReasoningPort = {
		async reason(...args: Parameters<ReasoningPort["reason"]>): Promise<StepOutcome> {
			calls.push(args);
			const [, stream] = args;
			const report = () => {
				for (const delta of options.deltas ?? []) stream?.onDelta({ type: "text_delta", delta });
			};
			if (options.late === true) setTimeout(report, 0);
			else report();
			return options.answer ?? answered();
		},
	};
	return { port, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function collect() {
	const events: RunEvent[] = [];
	return { events, onEvent: (event: RunEvent) => void events.push(event) };
}

const stepOf = (event: RunEvent) => ("step" in event ? event.step : undefined);

describe("core/step-machine: run reports its progress as RunEvents to onEvent", () => {
	it("Scenario: A two-step run reports its steps in order", async () => {
		const { events, onEvent } = collect();
		const result = await run(TWO_STEPS, { port: deltaPort().port, entry: TWO_ENTRIES, onEvent });
		expect(events.map((e) => e.type)).toEqual(["step_start", "step_end", "step_start", "step_end", "run_end"]);
		expect(events.slice(0, 4).map(stepOf)).toEqual([0, 0, 1, 1]);
		expect(events.slice(0, 4).map((e) => ("subagent" in e ? e.subagent : undefined))).toEqual([
			"first",
			"first",
			"second",
			"second",
		]);
		const end = events.at(-1);
		expect(end?.type === "run_end" ? end.result : undefined).toBe(result);
		expect(JSON.parse(JSON.stringify(events))).toEqual(events);
	});

	it("Scenario: Deltas sit between their step's boundaries", async () => {
		const { events, onEvent } = collect();
		const { port } = deltaPort({ deltas: ["Hel", "lo."], answer: answered("Hello.") });
		await run(TWO_STEPS, { port, entry: "first", onEvent });
		expect(events.map((e) => e.type)).toEqual(["step_start", "text_delta", "text_delta", "step_end", "run_end"]);
		expect(events.slice(1, 3)).toEqual([
			{ type: "text_delta", delta: "Hel", step: 0, subagent: "first" },
			{ type: "text_delta", delta: "lo.", step: 0, subagent: "first" },
		]);
		const end = events[3];
		expect(end?.type === "step_end" ? end.outcome : undefined).toEqual(answered("Hello."));
		expect(JSON.parse(JSON.stringify(events))).toEqual(events);
	});

	it("Scenario: A run statement reports its action", async () => {
		const { events, onEvent } = collect();
		const { host } = recordingHost({ ok: true, outputs: { text: "hi" } });
		const result = await run(ECHO, { port: deltaPort().port, actionHost: host, onEvent });
		expect(result.kind).toBe("completed");
		expect(events.map((e) => e.type)).toEqual(["action_start", "action_end", "run_end"]);
		expect(events[0]).toEqual({ type: "action_start", step: 0, subagent: "echoer", action: "echo", tool: "echo", inputs: { text: "hi" } });
		expect(events[1]).toEqual({
			type: "action_end",
			step: 0,
			subagent: "echoer",
			action: "echo",
			tool: "echo",
			ok: true,
			outputs: { text: "hi" },
		});
		expect(JSON.parse(JSON.stringify(events))).toEqual(events);
	});

	it("Scenario: A throwing listener changes nothing", async () => {
		const options = { port: deltaPort({ deltas: ["a", "b"], answer: answered("ab") }).port, entry: TWO_ENTRIES };
		let calls = 0;
		const thrown = await run(TWO_STEPS, {
			...options,
			onEvent: () => {
				calls += 1;
				throw new Error("listener");
			},
		});
		const plain = await run(TWO_STEPS, options);
		expect(thrown).toEqual(plain);
		// Every event was still delivered: two steps of start, two deltas, end, then run_end.
		expect(calls).toBe(9);
	});
});

describe("core/step-machine: streamRun yields a run's events and its result", () => {
	it("Scenario: for await sees every event, then the result", async () => {
		const stream = streamRun(TWO_STEPS, { port: deltaPort().port, entry: TWO_ENTRIES });
		const events: RunEvent[] = [];
		for await (const event of stream) {
			events.push(event);
			await tick();
		}
		expect(events.map((e) => e.type)).toEqual(["step_start", "step_end", "step_start", "step_end", "run_end"]);
		expect(events.slice(0, 4).map(stepOf)).toEqual([0, 0, 1, 1]);
		const result = await stream.result;
		expect(result).toEqual(await run(TWO_STEPS, { port: deltaPort().port, entry: TWO_ENTRIES }));
		const end = events.at(-1);
		expect(end?.type === "run_end" ? end.result : undefined).toBe(result);
	});

	it("Scenario: A refused start rejects the iterator and the result", async () => {
		const stream = streamRun(NO_SUBAGENT, { port: deltaPort().port });
		let thrown: unknown;
		try {
			for await (const _event of stream) {
				// A refused start reports nothing.
			}
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(NoEntrySubagentError);
		await expect(stream.result).rejects.toBe(thrown);
	});

	it("Scenario: A stream iterates once", async () => {
		const stream = streamRun(TWO_STEPS, { port: deltaPort().port, entry: TWO_ENTRIES });
		const types: string[] = [];
		for await (const event of stream) types.push(event.type);
		expect(types.at(-1)).toBe("run_end");

		const again = async () => {
			for await (const _event of stream) {
				// Never reached.
			}
		};
		await expect(again()).rejects.toThrow("streamRun: a stream can be iterated only once");
		expect(() => stream[Symbol.asyncIterator]()).toThrow("streamRun: a stream can be iterated only once");
	});
});

describe("core/reasoning-port: One reasoning step leaves through one injected port", () => {
	it("Scenario: A port that ignores the stream still runs", async () => {
		const port: ReasoningPort = {
			async reason(request: ReasoningRequest): Promise<StepOutcome> {
				expect(request.prompt).not.toBe("");
				return answered("Hi.");
			},
		};
		expect(port.reason.length).toBe(1);
		const stream = streamRun(TWO_STEPS, { port, entry: "first" });
		const events: RunEvent[] = [];
		for await (const event of stream) events.push(event);
		expect(events.map((e) => e.type)).toEqual(["step_start", "step_end", "run_end"]);
		expect((await stream.result).kind).toBe("completed");
	});
});

describe("core/reasoning-port: The stream argument is passed only to a listening run", () => {
	it("Scenario: An unlistened run passes one argument", async () => {
		const { port, calls } = deltaPort({ deltas: ["x"] });
		await run(TWO_STEPS, { port, entry: TWO_ENTRIES });
		expect(calls).toHaveLength(2);
		for (const args of calls) expect(args).toHaveLength(1);

		const listened = deltaPort();
		await run(TWO_STEPS, { port: listened.port, entry: TWO_ENTRIES, onEvent: () => {} });
		for (const args of listened.calls) expect(args).toHaveLength(2);
	});

	it("Scenario: A late delta is dropped", async () => {
		const { events, onEvent } = collect();
		const { port } = deltaPort({ deltas: ["late"], late: true });
		await run(TWO_STEPS, { port, entry: "first", onEvent });
		await tick();
		expect(events.map((e) => e.type)).toEqual(["step_start", "step_end", "run_end"]);
		expect(events.some((e) => e.type === "text_delta")).toBe(false);
	});
});
