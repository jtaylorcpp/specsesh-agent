/**
 * The caller, the faux models and the harness for the agent-runner call
 * scenarios, shared by the tests and their crash fixture.
 */

import { fauxProvider, type AssistantMessage, type FauxResponseFactory } from "@earendil-works/pi-ai";
import type { Storage, TaskId } from "@earendil-works/pi-durable";
import { agentRunner, createAgentHarness, type DelegateGrants } from "../../src/durable/index.js";
import type { RunResult } from "../../src/interpreter/index.js";
import { localWorkspace } from "../../src/node/index.js";
import { delegateDefinition } from "./delegation-scripts.js";
import { context } from "./helpers.js";

/** One deterministic `run @actions.review` on `delegate/reviewer`, copying its outputs into variables. */
export const CALLER = `config:
    agent_name: "caller"

variables:
    instructions: mutable string = ""
    ok: mutable boolean = False
    summary: mutable string = ""
    files_changed: mutable number = 0

subagent call:
    description: "Ask the reviewer"

    actions:
${delegateDefinition("reviewer").replace("        delegate:", "        review:")}
    reasoning:
        instructions: ->
            run @actions.review
                with instructions = @variables.instructions
                set @variables.ok = @outputs.ok
                set @variables.summary = @outputs.summary
                set @variables.files_changed = @outputs.files_changed
`;

export type ModelName = "default" | "opus";
type Asked = Parameters<FauxResponseFactory>[0];

/**
 * Two faux providers, `default` and `opus`, each with its own queue. `script`
 * sets a model's responses; `asked` holds every request each model was sent.
 */
export function fauxModels() {
	const fauxes = {
		default: fauxProvider({ provider: "faux-default", api: "faux-default", models: [{ id: "small" }] }),
		opus: fauxProvider({ provider: "faux-opus", api: "faux-opus", models: [{ id: "big" }] }),
	};
	const asked: Record<ModelName, Asked[]> = { default: [], opus: [] };
	const script = (name: ModelName, responses: readonly (AssistantMessage | FauxResponseFactory)[]) =>
		fauxes[name].setResponses(
			responses.map(
				(response): FauxResponseFactory =>
					(ctx, options, state, model) => {
						asked[name].push(structuredClone(ctx));
						return typeof response === "function" ? response(ctx, options, state, model) : response;
					},
			),
		);
	const factory = (name: ModelName) => () => {
		const model = fauxes[name].getModel();
		return { provider: fauxes[name].provider, model: { provider: model.provider, modelId: model.id } };
	};
	return { models: { default: factory("default"), opus: factory("opus") }, asked, script };
}

/** `createAgentHarness` over `storage`, a local workspace on `dir`, the faux models and `delegates`. */
export function agentHarness(storage: Storage, dir: string, models: ReturnType<typeof fauxModels>["models"], delegates: DelegateGrants) {
	return createAgentHarness(
		{ models, workspace: () => localWorkspace(dir), delegates, runners: { agent: agentRunner() } },
		{ storage, env: {}, context },
	);
}

/** The `agentscript.run` tasks `parent` owns, by id. */
export async function childRuns(storage: Storage, parent: TaskId<RunResult>): Promise<number[]> {
	const page = await storage.scanTasks({ kind: "agentscript.run" }, 1000, undefined, context);
	return page.items.filter((task) => task.owner === parent).map((task) => Number(task.id));
}
