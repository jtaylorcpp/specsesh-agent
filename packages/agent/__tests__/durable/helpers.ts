import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxProvider, type Context as PiContext, type Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage, type ModelRef, type Storage } from "@earendil-works/pi-durable";
import { AgentScript, AgentScriptStepExtension } from "../../src/durable/index.js";

export const context = BACKGROUND_CONTEXT;

/** Two model steps with deterministic logic between them. */
export const PIPELINE = `config:
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

/** One model step that writes a string variable, the kind a caller gives `choices`. */
export const JUDGE = `config:
    agent_name: "judge"

system:
    instructions: "You decide."

variables:
    next_action: mutable string = "retry"

subagent judge:
    description: "Decide what happens next"

    reasoning:
        instructions: ->
            | Decide.
            set @variables.next_action = @outputs.next_action
`;

export const JUDGE_CHOICES = { next_action: ["retry", "ask"] };

export const ENTRIES =["classify", "gate", "respond"];

/** A faux provider and a registry with the Agent Script extensions installed. */
export function setup() {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(AgentScript);
	registry.install(AgentScriptStepExtension);
	const fauxModel = faux.getModel();
	const model: ModelRef = { provider: fauxModel.provider, modelId: fauxModel.id };
	const requests: PiContext[] = [];
	return { faux, models: recording(models, requests), registry, model, requests };
}

export async function openHarness(
	storage: Storage,
	env: ReturnType<typeof setup>,
	hooks: { onRequest?: (count: number) => void } = {},
) {
	const models = hooks.onRequest === undefined ? env.models : counting(env.models, hooks.onRequest);
	return Harness.open(storage, { models, registry: env.registry }, context);
}

/** Calls `onRequest` with the running count before each model request. */
function counting(models: Models, onRequest: (count: number) => void): Models {
	let count = 0;
	return new Proxy(models, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if ((prop === "stream" || prop === "streamSimple") && typeof value === "function") {
				return (...args: unknown[]) => {
					count += 1;
					onRequest(count);
					return (value as (...a: unknown[]) => unknown).apply(target, args);
				};
			}
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

export function memoryHarness() {
	const env = setup();
	return { env, harness: openHarness(new MemoryStorage(), env) };
}

/** The same Models collection, recording the context of every model request pi-durable makes. */
function recording(models: Models, requests: PiContext[]): Models {
	return new Proxy(models, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if ((prop === "stream" || prop === "streamSimple" || prop === "complete" || prop === "completeSimple") && typeof value === "function") {
				return (model: unknown, ctx: PiContext, ...rest: unknown[]) => {
					requests.push(structuredClone(ctx));
					return (value as (...args: unknown[]) => unknown).call(target, model, ctx, ...rest);
				};
			}
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
