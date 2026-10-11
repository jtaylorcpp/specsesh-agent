import { describe, expect, it } from "vitest";
import { analyze } from "../../src/authoring/document.js";
import {
	EmptyPromptError,
	InvalidChoicesError,
	NoEntrySubagentError,
	RunStateError,
	SourceMismatchError,
	UndeclaredOverrideError,
	UnknownSubagentError,
	UnparsedDocumentError,
	UnreadableDocumentError,
	UnsupportedConstructError,
	apply,
	hashSource,
	next,
	run,
	start,
	type RunState,
	type StepOutcome,
} from "../../src/interpreter/index.js";
import {
	IN_SUBSET,
	NO_SUBAGENT,
	STRUCTURED_WITHOUT_PROMPT,
	UNDECLARED_REFERENCE,
	UNSUPPORTED_BLOCK,
	UNTERMINATED_STRING,
} from "./helpers/fixtures.js";
import { recordingPort } from "./helpers/recording-port.js";

/**
 * Two model steps with deterministic logic between them, so a run has a real
 * middle to crash in: `classify` writes `severity` from a structured result,
 * `gate` is logic only, and `respond`'s prompt depends on what `gate` decided.
 */
const PIPELINE = `config:
    agent_name: "pipeline"

system:
    instructions: |
        You triage bug reports.

variables:
    report: mutable string = "it crashes"
    severity: mutable string = ""
    urgent: mutable boolean = False

subagent classify:
    description: "Classify the report"

    reasoning:
        instructions: ->
            | Classify: {!@variables.report}
            set @variables.severity = @outputs.severity

subagent gate:
    description: "Decide urgency without the model"

    reasoning:
        instructions: ->
            if @variables.severity == "high":
                set @variables.urgent = True

subagent respond:
    description: "Write the reply"

    reasoning:
        instructions: ->
            if @variables.urgent:
                | Write an urgent reply about: {!@variables.report}
            else:
                | Write a routine reply about: {!@variables.report}
`;

const ENTRIES = ["classify", "gate", "respond"];
const structured = (severity: string): StepOutcome => ({ kind: "answered", text: "", structured: { severity } });
const answered = (text: string): StepOutcome => ({ kind: "answered", text });

/** Round-trip through JSON, as a durable host's storage would. */
const persist = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Drive the machine by hand, persisting the state between every call. */
function drive(source: string, answers: StepOutcome[], options: Parameters<typeof start>[1] = {}) {
	let state = persist(start(source, options));
	const prompts: string[] = [];
	for (let i = 0; ; i += 1) {
		const step = next(source, state);
		if (step.type === "done") return { result: step.result, prompts };
		if (step.type !== "request") throw new Error("this fixture runs no actions");
		prompts.push(step.request.prompt);
		state = persist(apply(source, persist(step.state), answers[i] ?? answered("ok")));
	}
}

describe("the pipeline fixture", () => {
	it("lints clean, so the tests below exercise the runner and not a parse recovery", () => {
		const errors = (analyze(PIPELINE).diagnostics as unknown as { severity?: number }[]).filter((d) => d.severity === 1);
		expect(errors).toEqual([]);
	});
});

describe("the step machine", () => {
	it("gives the same result as run(), with the state persisted between every call", async () => {
		const answers = [structured("high"), answered("On it.")];
		const { port } = recordingPort(...answers);
		const viaRun = await run(PIPELINE, { port, entry: ENTRIES });
		const { result } = drive(PIPELINE, answers, { entry: ENTRIES });
		expect(result).toEqual(viaRun);
		expect(result.kind).toBe("completed");
		expect(result.variables).toEqual({ report: "it crashes", severity: "high", urgent: true });
	});

	it("runs a logic-only subagent between model steps without a request", () => {
		const { prompts, result } = drive(PIPELINE, [structured("high"), answered("ok")], { entry: ENTRIES });
		expect(prompts).toEqual(["Classify: it crashes", "Write an urgent reply about: it crashes"]);
		expect(result.steps.map((s) => s.subagent)).toEqual(["classify", "respond"]);
	});

	it("follows the other branch when the logic decides differently", () => {
		const { prompts, result } = drive(PIPELINE, [structured("low"), answered("ok")], { entry: ENTRIES });
		expect(prompts[1]).toBe("Write a routine reply about: it crashes");
		expect(result.variables.urgent).toBe(false);
	});

	it("starts with no step awaiting and the authored values", () => {
		const state = start(PIPELINE, { entry: ENTRIES });
		expect(state.awaiting).toBeUndefined();
		expect(state.cursor).toBe(0);
		expect(state.variables).toEqual({ report: "it crashes", severity: "", urgent: false });
	});

	it("takes starting overrides at start", () => {
		const { prompts } = drive(PIPELINE, [structured("low")], { entry: ENTRIES, variables: { report: "slow" } });
		expect(prompts[0]).toBe("Classify: slow");
	});
});

describe("replay after a crash", () => {
	it("next is pure: the same state gives the same request and state", () => {
		const state = start(PIPELINE, { entry: ENTRIES });
		expect(next(PIPELINE, state)).toEqual(next(PIPELINE, persist(state)));
	});

	it("a host that crashed after next and before apply re-dispatches the same step", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const saved = persist(first.state);

		// The process dies here. A new one reloads `saved` and asks again.
		const again = next(PIPELINE, saved);
		if (again.type !== "request") throw new Error("expected a request");
		expect(again.request).toEqual(first.request);
		expect(again.state).toEqual(saved);
	});

	it("a host that crashed after apply carries on from the next step", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const afterClassify = persist(apply(PIPELINE, first.state, structured("high")));

		const resumed = next(PIPELINE, afterClassify);
		if (resumed.type !== "request") throw new Error("expected a request");
		expect(resumed.request.prompt).toBe("Write an urgent reply about: it crashes");
	});
});

describe("refusals", () => {
	it("refuses a state against a different source", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const edited = PIPELINE.replace("it crashes", "it hangs");
		expect(() => next(edited, first.state)).toThrow(SourceMismatchError);
		expect(() => apply(edited, first.state, structured("high"))).toThrow(SourceMismatchError);
	});

	it("refuses apply with no step awaiting", () => {
		expect(() => apply(PIPELINE, start(PIPELINE, { entry: ENTRIES }), answered("x"))).toThrow(RunStateError);
	});

	it("refuses an unknown entry at start, before anything is composed", () => {
		expect(() => start(PIPELINE, { entry: ["classify", "nope"] })).toThrow(/no subagent named "nope"/);
	});

	it("refuses a state from an unknown version", () => {
		const state = { ...start(PIPELINE, { entry: ENTRIES }), version: 2 } as unknown as RunState;
		expect(() => next(PIPELINE, state)).toThrow(SourceMismatchError);
	});
});

describe("a step that does not answer", () => {
	it("stops the run, keeps the failure, and commits nothing from that step", () => {
		const failed: StepOutcome = { kind: "failed", category: "rate_limit", message: "slow down" };
		const { result, prompts } = drive(PIPELINE, [failed], { entry: ENTRIES });
		expect(result.kind).toBe("failed");
		expect(prompts).toHaveLength(1);
		expect(result.variables.severity).toBe("");
		expect(result.steps[0]?.outcome).toEqual(failed);
	});

	it("does not commit a step's logic-line effects when the step fails", () => {
		// IN_SUBSET's `draft` sets stage = "specs" by logic, in the same step as its prompt.
		const failed: StepOutcome = { kind: "failed", category: "unknown", message: "boom" };
		const { result } = drive(IN_SUBSET, [failed]);
		expect(result.kind).toBe("failed");
		expect(result.variables.stage).toBe("proposal");
	});

	it("keeps the effects of a logic-only subagent that finished before the failing step", () => {
		// `gate` sets urgent = True by logic and finishes; `respond` then fails.
		const failed: StepOutcome = { kind: "failed", category: "unknown", message: "boom" };
		const { result } = drive(PIPELINE, [structured("high"), failed], { entry: ENTRIES });
		expect(result.kind).toBe("failed");
		expect(result.variables).toEqual({ report: "it crashes", severity: "high", urgent: true });
	});

	it("matches run() on that, too", async () => {
		const { port } = recordingPort({ kind: "failed", category: "unknown", message: "boom" });
		const viaRun = await run(IN_SUBSET, { port });
		expect(viaRun.variables.stage).toBe("proposal");
	});

	it("reports cut-short as the run's kind", () => {
		const { result } = drive(PIPELINE, [{ kind: "cut-short", text: "half", turns: 9 }], { entry: ENTRIES });
		expect(result.kind).toBe("cut-short");
	});

	it("keeps answering done once stopped", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const stopped = apply(PIPELINE, first.state, { kind: "failed", category: "unknown", message: "x" });
		expect(next(PIPELINE, stopped).type).toBe("done");
		expect(next(PIPELINE, persist(stopped)).type).toBe("done");
	});
});

/** What `start` threw, so a test can inspect the value and not only match it. */
function refusal(fn: () => unknown): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	throw new Error("expected a refusal, but nothing was thrown");
}

/** Freeze a value and everything under it, so any write to it throws in strict mode. */
function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const inner of Object.values(value)) deepFreeze(inner);
	}
	return value;
}

describe("platform-agentscript-step-machine: Every Error Names Itself", () => {
	it("Scenario: A refusal is identifiable by class and name", () => {
		const error = refusal(() => start(PIPELINE, { entry: "nope" }));
		expect(error).toBeInstanceOf(UnknownSubagentError);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).name).toBe("UnknownSubagentError");
	});

	it("Scenario: Every step-machine error sets name to its own class name", () => {
		const started = start(PIPELINE, { entry: ENTRIES });
		const refused: [string, unknown][] = [
			["SourceMismatchError", refusal(() => next(PIPELINE.replace("it crashes", "it hangs"), started))],
			["RunStateError", refusal(() => apply(PIPELINE, started, answered("x")))],
			["UnparsedDocumentError", refusal(() => start(UNTERMINATED_STRING))],
			["UnreadableDocumentError", new UnreadableDocumentError()],
			["NoEntrySubagentError", refusal(() => start(NO_SUBAGENT))],
			["UnknownSubagentError", refusal(() => start(PIPELINE, { entry: "nope" }))],
			["UndeclaredOverrideError", refusal(() => start(PIPELINE, { variables: { nope: 1 } }))],
			["EmptyPromptError", refusal(() => next(STRUCTURED_WITHOUT_PROMPT, start(STRUCTURED_WITHOUT_PROMPT)))],
			["InvalidChoicesError", new InvalidChoicesError("x")],
		];
		expect(refused).toHaveLength(9);
		for (const [name, error] of refused) {
			expect(error, name).toBeInstanceOf(Error);
			expect((error as Error).name).toBe(name);
			expect((error as Error).constructor.name).toBe(name);
		}
	});
});

describe("platform-agentscript-step-machine: Start Checks The Whole Document Before Anything Else", () => {
	it("Scenario: A hard syntax error is refused, not run on the recovered tree", () => {
		const error = refusal(() => start(UNTERMINATED_STRING));
		expect(error).toBeInstanceOf(UnparsedDocumentError);
		expect((error as Error).name).toBe("UnparsedDocumentError");
	});

	it("Scenario: A warning alone does not stop a run", () => {
		// An unused variable is reported at a severity below error, and the document still starts.
		const source = IN_SUBSET.replace("approved: mutable boolean = False", "approved: mutable boolean = False\n    spare: mutable string = \"x\"");
		const severities = (analyze(source).diagnostics as unknown as { severity?: number }[]).map((d) => d.severity);
		expect(severities.length, "the fixture reports no diagnostic at all").toBeGreaterThan(0);
		expect(severities).not.toContain(1);
		const state = start(source);
		expect(state.variables).toEqual({ stage: "proposal", approved: false, spare: "x" });
	});

	it("Scenario: Error diagnostics win over unsupported constructs", () => {
		// An unsupported block, plus a string on a logic line that is never closed.
		const both = UNSUPPORTED_BLOCK.replace(
			"            | Read the current artifact.\n",
			'            | Read the current artifact.\n            set @variables.stage = "unterminated\n',
		);
		expect(both).not.toBe(UNSUPPORTED_BLOCK);
		const diagnostics = analyze(both).diagnostics as unknown as { severity?: number }[];
		expect(diagnostics.some((d) => d.severity === 1), "no error diagnostic in the fixture").toBe(true);
		// And on its own, the unsupported block is what the scan refuses.
		expect(() => start(UNSUPPORTED_BLOCK)).toThrow(UnsupportedConstructError);

		const error = refusal(() => start(both));
		expect(error).toBeInstanceOf(UnparsedDocumentError);
		expect(error).not.toBeInstanceOf(UnsupportedConstructError);
	});

	it("Scenario: An undeclared reference the dialect itself reports is refused as a diagnostic", () => {
		const error = refusal(() => start(UNDECLARED_REFERENCE));
		expect(error).toBeInstanceOf(UnparsedDocumentError);
		expect((error as UnparsedDocumentError).diagnostics.map((d) => d.message)).toContain(
			"'approved' is not defined in variables",
		);
	});
});

describe("platform-agentscript-step-machine: An Unparsed Document Refusal Lists Its Diagnostics With Positions", () => {
	it("Scenario: Each error diagnostic is listed with a 1-based position", () => {
		const error = refusal(() => start(UNTERMINATED_STRING)) as UnparsedDocumentError;
		const errors = (analyze(UNTERMINATED_STRING).diagnostics as unknown as {
			severity?: number;
			message: string;
			range?: { start: { line: number; character: number } };
		}[]).filter((d) => d.severity === 1);
		expect(errors).toHaveLength(1);
		// The 0-based range start becomes a 1-based `line:character` in the message.
		const start0 = errors[0]?.range?.start;
		if (start0 === undefined) throw new Error("the diagnostic has no range");
		const at = ` at ${start0.line + 1}:${start0.character + 1}`;

		expect(error.diagnostics).toHaveLength(1);
		expect(error.message).toContain("the document has 1 error(s) and was not run");
		expect(error.message.startsWith("the document has 1 error(s) and was not run. Nothing was dispatched:\n")).toBe(true);
		expect(error.message).toContain(`  - Missing "${at}`);
		// The fixture's unterminated string is on source line 10.
		expect(start0.line + 1).toBe(10);
	});

	it("Scenario: Warnings are not listed", () => {
		// The unterminated-string document, plus an unused variable that adds a non-error diagnostic.
		const source = UNTERMINATED_STRING.replace(
			'    stage: mutable string = "proposal"\n',
			'    stage: mutable string = "proposal"\n    spare: mutable string = "x"\n',
		);
		const all = analyze(source).diagnostics as unknown as { severity?: number }[];
		expect(all.some((d) => d.severity !== 1), "the fixture has no non-error diagnostic").toBe(true);
		const error = refusal(() => start(source)) as UnparsedDocumentError;
		expect(error).toBeInstanceOf(UnparsedDocumentError);
		expect(error.diagnostics.length).toBe(all.filter((d) => d.severity === 1).length);
		expect(error.diagnostics.map((d) => (d as { severity?: number }).severity)).toEqual(
			error.diagnostics.map(() => 1),
		);
		expect(error.message).toContain(`the document has ${error.diagnostics.length} error(s)`);
		expect(error.message).not.toContain("spare");
	});
});

describe("platform-agentscript-step-machine: An Unreadable Document Is Refused", () => {
	it("UnreadableDocumentError is a named Error with its refusal message (Scenario: No root means a refusal is not reachable from source text)", () => {
		// Not reachable from any source text the parser accepts: empty, comment-only and
		// garbage inputs all yield a root or an error diagnostic. Only the class is pinned.
		const error = new UnreadableDocumentError();
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("UnreadableDocumentError");
		expect(error.message.startsWith("the document could not be parsed into anything runnable. Nothing was dispatched.")).toBe(
			true,
		);
	});
});

describe("platform-agentscript-step-machine: The Opening Variables Are The Authored Values, Then The Overrides", () => {
	it("Scenario: An override for an undeclared name is refused", () => {
		const error = refusal(() => start(PIPELINE, { variables: { nope: 1 } }));
		expect(error).toBeInstanceOf(UndeclaredOverrideError);
		const message = (error as Error).message;
		expect(message).toContain('the run was given a starting value for "nope", which the document does not declare');
		for (const name of ["report", "severity", "urgent"]) expect(message).toContain(name);
	});

	it("Scenario: An override is stored as given, without type coercion", () => {
		const state = start(PIPELINE, { entry: ENTRIES, variables: { urgent: "yes" as unknown as boolean } });
		expect(state.variables).toEqual({ report: "it crashes", severity: "", urgent: "yes" });
	});
});

describe("platform-agentscript-step-machine: Entries Resolve From The Option, Or Default To The First Subagent", () => {
	it("Scenario: The default entry is the first declared subagent only", () => {
		expect(start(PIPELINE).entries).toEqual(["classify"]);
	});

	it("Scenario: A string entry becomes a one-element list", () => {
		expect(start(PIPELINE, { entry: "gate" }).entries).toEqual(["gate"]);
	});

	it("Scenario: An array entry keeps its order", () => {
		expect(start(PIPELINE, { entry: ["respond", "classify"] }).entries).toEqual(["respond", "classify"]);
	});

	it("Scenario: An array entry keeps duplicates", () => {
		expect(start(PIPELINE, { entry: ["gate", "gate"] }).entries).toEqual(["gate", "gate"]);
	});

	it("Scenario: A document with no subagent is refused", () => {
		const error = refusal(() => start(NO_SUBAGENT));
		expect(error).toBeInstanceOf(NoEntrySubagentError);
		expect((error as Error).message).toContain("(none)");
		expect((error as Error).message).toContain("would enter no subagent");
	});

	it("Scenario: An explicitly empty entry list is refused", () => {
		const error = refusal(() => start(PIPELINE, { entry: [] }));
		expect(error).toBeInstanceOf(NoEntrySubagentError);
		expect((error as Error).message).toContain("would enter no subagent");
	});

	it("Scenario: An unknown entry anywhere in the list is refused before anything is composed", () => {
		const error = refusal(() => start(PIPELINE, { entry: ["classify", "nope"] }));
		expect(error).toBeInstanceOf(UnknownSubagentError);
		expect((error as Error).message).toContain('the document declares no subagent named "nope"');
	});
});

describe("platform-agentscript-step-machine: A Fresh Run State Has An Exact Shape And Is Plain JSON", () => {
	it("Scenario: The initial state has no step awaiting", () => {
		const state = start(PIPELINE, { entry: ENTRIES });
		expect(Object.keys(state).sort()).toEqual(["actions", "cursor", "entries", "sourceHash", "steps", "variables", "version"]);
		expect(state.version).toBe(1);
		expect(state.cursor).toBe(0);
		expect(state.steps).toEqual([]);
		expect(state.actions).toEqual([]);
		expect(state.awaiting).toBeUndefined();
		expect(state.stopped).toBeUndefined();
		expect(state.sourceHash).toBe(hashSource(PIPELINE));
		expect(persist(state)).toEqual(state);
	});
});

describe("platform-agentscript-step-machine: Next Runs Logic-Only Subagents Without A Request", () => {
	it("Scenario: An empty prompt that still asks for a structured result is refused", () => {
		const error = refusal(() => next(STRUCTURED_WITHOUT_PROMPT, start(STRUCTURED_WITHOUT_PROMPT)));
		expect(error).toBeInstanceOf(EmptyPromptError);
		expect((error as Error).message).toContain("judge");
		expect((error as Error).message).toContain("verdict");
		expect((error as Error).message).toContain("Nothing was dispatched");
	});
});

describe("platform-agentscript-step-machine: The Returned State Carries An Awaiting Step", () => {
	it("Scenario: The awaiting step separates its own effects from earlier ones", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const afterClassify = apply(PIPELINE, first.state, structured("high"));
		const second = next(PIPELINE, afterClassify);
		if (second.type !== "request") throw new Error("expected a request");

		expect(second.state.cursor).toBe(2);
		expect(second.state.awaiting?.subagent).toBe("respond");
		expect(second.state.awaiting?.before.urgent).toBe(true);
		// The top level is unchanged by `next`: the logic-only `gate` has not been committed.
		expect(second.state.variables.urgent).toBe(false);
		expect(second.state.variables).toEqual(afterClassify.variables);
		expect(second.state.steps).toEqual(afterClassify.steps);
	});

	it("Scenario: before excludes the step's own logic lines and variables includes them", () => {
		// IN_SUBSET's `draft` sets stage = "specs" by logic in the same step as its prompt.
		const step = next(IN_SUBSET, start(IN_SUBSET));
		if (step.type !== "request") throw new Error("expected a request");
		expect(step.state.awaiting?.before.stage).toBe("proposal");
		expect(step.state.awaiting?.variables.stage).toBe("specs");
		expect(step.state.variables.stage).toBe("proposal");
		expect(step.state.awaiting && "pending" in step.state.awaiting ? step.state.awaiting.pending : undefined).toEqual([]);
	});
});

describe("platform-agentscript-step-machine: Next Finishes With The Run's Result", () => {
	it("Scenario: A trailing logic-only subagent's effects reach the result", () => {
		const { result, prompts } = drive(PIPELINE, [structured("high")], { entry: ["classify", "gate"] });
		expect(prompts).toEqual(["Classify: it crashes"]);
		expect(result.kind).toBe("completed");
		expect(result.variables.urgent).toBe(true);
		expect(result.variables.severity).toBe("high");
		expect(result.steps.map((s) => s.subagent)).toEqual(["classify"]);
		expect("updatedSource" in result).toBe(false);
	});
});

describe("platform-agentscript-step-machine: Next Is Pure", () => {
	it("Scenario: next does not mutate the state it is given", () => {
		const fresh = deepFreeze(start(PIPELINE, { entry: ENTRIES }));
		const before = structuredClone(fresh);
		const step = next(PIPELINE, fresh);
		expect(fresh).toEqual(before);
		if (step.type !== "request") throw new Error("expected a request");

		// Also over a state with a logic-only entry ahead of the next request.
		const afterClassify = deepFreeze(apply(PIPELINE, step.state, structured("high")));
		const clone = structuredClone(afterClassify);
		const second = next(PIPELINE, afterClassify);
		expect(afterClassify).toEqual(clone);
		expect(second.type).toBe("request");
		expect(second).toEqual(next(PIPELINE, persist(clone)));
	});
});

describe("platform-agentscript-step-machine: Apply Folds One Answer Into The State", () => {
	it("Scenario: apply does not mutate its input, answered or failed", () => {
		const first = next(PIPELINE, start(PIPELINE, { entry: ENTRIES }));
		if (first.type !== "request") throw new Error("expected a request");
		const awaiting = deepFreeze(first.state);
		const before = structuredClone(awaiting);

		const answeredState = apply(PIPELINE, awaiting, structured("high"));
		expect(awaiting).toEqual(before);
		expect(answeredState).not.toBe(awaiting);
		expect(answeredState.awaiting).toBeUndefined();
		expect(answeredState.cursor).toBe(awaiting.cursor + 1);
		expect(answeredState.variables.severity).toBe("high");
		expect(answeredState.steps.at(-1)?.subagent).toBe("classify");

		const failed: StepOutcome = { kind: "failed", category: "rate_limit", message: "slow down" };
		const failedState = apply(PIPELINE, awaiting, failed);
		expect(awaiting).toEqual(before);
		expect(failedState.stopped).toBe("failed");
		expect(failedState.cursor).toBe(awaiting.cursor);
		expect(failedState.variables.severity).toBe("");
		expect(failedState.steps.at(-1)?.outcome).toEqual(failed);
	});
});

describe("platform-agentscript-step-machine: The Source Fingerprint Is A Fixed FNV-1a Format", () => {
	it("Scenario: Known values", () => {
		expect(hashSource("")).toBe("0-811c9dc5");
		expect(hashSource("a")).toBe("1-e40c292c");
		expect(hashSource("x".repeat(300))).toBe("12c-970138f5");
	});

	it("Scenario: Length counts UTF-16 code units", () => {
		expect("\u{1F600}".length).toBe(2);
		expect(hashSource("\u{1F600}").startsWith("2-")).toBe(true);
		expect(hashSource("\u{1F600}")).toMatch(/^2-[0-9a-f]{8}$/);
	});
});
