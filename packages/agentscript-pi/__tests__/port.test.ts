import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "@coopcli/agentscript/interpreter";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	type AssistantMessage,
	type Context,
	type Models,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { categoryFromStatus } from "../src/categories.js";
import { parseVar } from "../src/cli.js";
import { resolveModel } from "../src/models.js";
import { createPiReasoningPort, forceTool, RESULT_TOOL, toOutcome } from "../src/port.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRIAGE = readFileSync(join(PKG_DIR, "examples", "triage.agent"), "utf8");

const TEXT_ONLY = `config:
    agent_name: "echo"

system:
    instructions: |
        You are terse.

variables:
    topic: mutable string = "pi"

subagent say:
    description: "Say something"

    reasoning:
        instructions: ->
            | Say one word about {!@variables.topic}.
`;

/** A faux-backed collection that also records every request it is sent. */
function harness() {
	const faux = fauxProvider();
	const real = createModels();
	real.setProvider(faux.provider);
	const sent: { context: Context; options: Record<string, unknown> | undefined }[] = [];
	const models = {
		complete: (model, context, options) => {
			sent.push({ context, options: options as Record<string, unknown> | undefined });
			return real.complete(model, context, options);
		},
	} as Pick<Models, "complete"> as Models;
	return { faux, models, model: faux.getModel(), sent };
}

describe("a run through the pi port", () => {
	it("answers a text-only step and completes", async () => {
		const h = harness();
		h.faux.setResponses([fauxAssistantMessage([fauxText("Tiny.")])]);
		const result = await run(TEXT_ONLY, { port: createPiReasoningPort(h) });
		expect(result.kind).toBe("completed");
		expect(result.steps[0]?.outcome).toEqual({ kind: "answered", text: "Tiny." });
	});

	it("sends system instructions as the system prompt, not inside the user message", async () => {
		const h = harness();
		h.faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
		await run(TEXT_ONLY, { port: createPiReasoningPort(h) });
		const { context } = h.sent[0]!;
		expect(context.systemPrompt).toContain("You are terse.");
		const user = context.messages[0];
		expect(user?.role).toBe("user");
		expect(String(user?.role === "user" ? user.content : "")).not.toContain("You are terse.");
		expect(String(user?.role === "user" ? user.content : "")).toContain("Say one word about pi.");
		expect(context.tools).toBeUndefined();
	});

	it("sets variables from the result tool's arguments", async () => {
		const h = harness();
		h.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "medium", summary: "Crashes outside git." })], {
				stopReason: "toolUse",
			}),
		]);
		const result = await run(TRIAGE, { port: createPiReasoningPort(h) });
		expect(result.kind).toBe("completed");
		expect(result.variables.severity).toBe("medium");
		expect(result.variables.summary).toBe("Crashes outside git.");

		const tool = h.sent[0]!.context.tools?.[0];
		expect(tool?.name).toBe(RESULT_TOOL);
		expect(JSON.stringify(tool?.parameters)).toContain("severity");
	});

	it("fails the run when a structured step comes back as text only", async () => {
		const h = harness();
		h.faux.setResponses([fauxAssistantMessage([fauxText("severity: medium")])]);
		const result = await run(TRIAGE, { port: createPiReasoningPort(h) });
		expect(result.kind).toBe("failed");
		expect(result.variables.severity).toBe("");
	});

	it("passes the output cap through", async () => {
		const h = harness();
		h.faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
		await run(TEXT_ONLY, { port: createPiReasoningPort({ ...h, maxTokens: 123 }) });
		expect(h.sent[0]!.options?.maxTokens).toBe(123);
	});

	it("reports a provider error as a failed step", async () => {
		const h = harness();
		h.faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: "boom" })]);
		const result = await run(TEXT_ONLY, { port: createPiReasoningPort(h) });
		expect(result.kind).toBe("failed");
		expect(result.steps[0]?.outcome).toEqual({ kind: "failed", category: "unknown", message: "boom" });
	});
});

describe("toOutcome", () => {
	const base = (over: Partial<AssistantMessage>): AssistantMessage =>
		({ ...fauxAssistantMessage([fauxText("partial")]), ...over }) as AssistantMessage;

	it("maps a length stop to max_output_tokens, never to answered", () => {
		expect(toOutcome(base({ stopReason: "length" }), false)).toMatchObject({
			kind: "failed",
			category: "max_output_tokens",
		});
	});

	it("takes the category from the HTTP status, not the message", () => {
		const message = base({
			stopReason: "error",
			errorMessage: "billing problem, probably",
			diagnostics: [{ type: "request", timestamp: 0, error: { message: "x", code: 429 } }],
		});
		expect(toOutcome(message, false)).toEqual({
			kind: "failed",
			category: "rate_limit",
			message: "billing problem, probably",
		});
	});

	it("reports unknown when no status was carried", () => {
		expect(toOutcome(base({ stopReason: "error", errorMessage: "429 rate limited" }), false)).toMatchObject({
			category: "unknown",
		});
	});

	it("reports an abort as unrecognised, message kept", () => {
		expect(toOutcome(base({ stopReason: "aborted" }), false)).toEqual({
			kind: "failed",
			category: "unrecognised",
			message: "the request was aborted",
		});
	});

	it("never reports cut-short, because this port has no round bound", () => {
		for (const stopReason of ["stop", "toolUse", "length", "error", "aborted"] as const) {
			expect(toOutcome(base({ stopReason }), true).kind).not.toBe("cut-short");
		}
	});
});

describe("categoryFromStatus", () => {
	it.each([
		[401, "authentication_failed"],
		[403, "authentication_failed"],
		[402, "billing_error"],
		[404, "model_not_found"],
		[429, "rate_limit"],
		[529, "overloaded"],
		[503, "overloaded"],
		[400, "invalid_request"],
		[500, "server_error"],
		["502", "server_error"],
	])("%s → %s", (code, category) => {
		expect(categoryFromStatus(code)).toBe(category);
	});

	it.each([undefined, 200, 418, "ECONNRESET", ""])("%s → no category", (code) => {
		expect(categoryFromStatus(code)).toBeUndefined();
	});
});

describe("forceTool", () => {
	it("forces the result tool on Anthropic", () => {
		const haiku = resolveModel(builtinModels(), "anthropic", "claude-haiku-4-5");
		expect(forceTool(haiku)).toEqual({ toolChoice: { type: "tool", name: RESULT_TOOL } });
	});

	it("forces the named function on OpenAI chat completions", () => {
		expect(forceTool({ api: "openai-completions" } as never)).toEqual({
			toolChoice: { type: "function", function: { name: RESULT_TOOL } },
		});
	});

	it("leaves an unlisted API at its default", () => {
		expect(forceTool({ api: "pi-messages" } as never)).toEqual({});
	});
});

describe("resolveModel", () => {
	it("finds the default testing model", () => {
		const model = resolveModel(builtinModels(), "anthropic", "claude-haiku-4-5");
		expect(model.api).toBe("anthropic-messages");
	});

	it("fails by name on an unknown model, listing real ones", () => {
		expect(() => resolveModel(builtinModels(), "anthropic", "claude-nope")).toThrow(/claude-nope.*Known anthropic models/);
	});

	it("fails by name on an unknown provider", () => {
		expect(() => resolveModel(builtinModels(), "nowhere", "x")).toThrow(/"nowhere" is not a registered provider/);
	});
});

describe("parseVar", () => {
	it.each([
		["report=hello", ["report", "hello"]],
		["n=3", ["n", 3]],
		["ok=True", ["ok", true]],
		["ok=False", ["ok", false]],
		["s=", ["s", ""]],
		["s=a=b", ["s", "a=b"]],
	])("%s", (raw, expected) => {
		expect(parseVar(raw)).toEqual(expected);
	});

	it("rejects a value with no name", () => {
		expect(() => parseVar("=x")).toThrow(/name=value/);
	});
});
