// The `actions/agent-runner` grant scenarios: the node defaults, what an agent grant takes by default,
// what createAgentHarness refuses when it is built, and what a run refuses at start. Faux provider only,
// over an in-memory workspace that can list and search; no child run and no process starts.

import { describe, expect, it } from "vitest";
import { fauxProvider } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { analyze } from "../../src/authoring/index.js";
import { scanDocument } from "../../src/interpreter/index.js";
import {
	ActionBindingError,
	DelegateGrantError,
	EDIT_AGENT,
	READ_AGENT,
	agentRunner,
	createAgentHarness,
	delegateContractProblems,
	startScript,
	type DelegateGrants,
	type DurableHostAction,
	type ModelFactory,
	type Workspace,
} from "../../src/durable/index.js";
import { defaultRunners } from "../../src/node/index.js";
import { delegateDefinition } from "./delegation-scripts.js";
import { context } from "./helpers.js";

/** Files in a Map, listed and searched in memory; `exec` and `snapshot` do nothing. */
function memWorkspace(): Workspace {
	const files = new Map<string, string>();
	return {
		root: "mem",
		async read(path) {
			const content = files.get(path);
			if (content === undefined) throw new Error(`no such file: ${path}`);
			return content;
		},
		async write(path, content) {
			files.set(path, content);
		},
		exec: async () => ({ kind: "exited", code: 0, stdout: "", stderr: "" }),
		snapshot: async () => new Map(),
		list: async () => [...files.keys()],
		search: async () => [],
	};
}

/** One faux model per name, all on one provider. */
function fauxModels(names: readonly string[]): Record<string, ModelFactory<{}>> {
	const faux = fauxProvider({ models: names.map((name) => ({ id: `faux-${name}` })) });
	return Object.fromEntries(
		names.map((name) => {
			const model = faux.getModel(`faux-${name}`)!;
			return [name, () => ({ provider: faux.provider, model: { provider: model.provider, modelId: model.id } })];
		}),
	);
}

function build(delegates: DelegateGrants, names: readonly string[] = ["default"]) {
	return createAgentHarness(
		{ models: fauxModels(names) as never, workspace: () => memWorkspace(), delegates, runners: defaultRunners },
		{ storage: new MemoryStorage(), env: {}, context },
	);
}

async function refusal(delegates: DelegateGrants, names?: readonly string[]): Promise<string> {
	const error = await build(delegates, names).then(
		async ({ harness }) => {
			await harness.close(context);
			return undefined;
		},
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(DelegateGrantError);
	return (error as Error).message;
}

/** A clean delegate script that declares `instructions` and `ok`, but not `summary`. */
const NO_SUMMARY = `config:
    agent_name: "no-summary"

system:
    instructions: "You are a delegate."

variables:
    instructions: mutable string = ""
    ok: mutable boolean = False

subagent work:
    description: "Do the work"

    actions:
        read_file:
            description: "Read a file in the workspace"
            inputs:
                path: string
            outputs:
                content: string
            target: "mcpTool://read_file"

    reasoning:
        instructions: ->
            | {!@variables.instructions}
            set @variables.ok = @outputs.ok
        actions:
            read_file: @actions.read_file
                with path = ...
`;

/** A model step offering `delegate/reviewer` as the tool `review`. */
const OFFERS_REVIEW = `config:
    agent_name: "offers-review"

system:
    instructions: "You hand work off."

subagent offer:
    description: "Let the model ask for a review"

    actions:
${delegateDefinition("reviewer").replace("        delegate:", "        review:")}
    reasoning:
        instructions: ->
            | Ask for a review.
        actions:
            review: @actions.review
                with instructions = ...
`;

describe("actions/agent-runner", () => {
	it("Scenario: The node defaults hold both runners", () => {
		expect(defaultRunners["claude-code"]?.kind).toBe("process");
		expect(defaultRunners["agent"]?.kind).toBe("agent");
		const agent = agentRunner();
		expect(Object.keys((defaultRunners["agent"] as typeof agent).grantKeys)).toEqual(Object.keys(agent.grantKeys));
	});

	it("Scenario: A minimal agent grant takes the defaults", async () => {
		const { harness, actions } = await build({ reviewer: { runner: "agent", model: "default", script: READ_AGENT } });
		await harness.close(context);
		const reviewer = actions.get("delegate/reviewer") as DurableHostAction;
		const input = await reviewer.durable.start({ instructions: "x" }, { workspace: "mem" });
		expect(input).toMatchObject({ scope: ["read_file", "list_files", "search_files"], maxSteps: 20 });
	});

	it("Scenario: An unknown model is refused, listing the models", async () => {
		const message = await refusal({ reviewer: { runner: "agent", model: "haiku", script: READ_AGENT } }, ["default", "opus"]);
		for (const word of ["reviewer", "haiku", "default", "opus"]) expect(message).toContain(word);
	});

	it("Scenario: A delegate cannot be given a delegate", async () => {
		const message = await refusal({
			claude_code: { runner: "claude-code" },
			reviewer: { runner: "agent", model: "default", script: READ_AGENT, tools: ["read_file", "delegate/claude_code"] },
		});
		expect(message).toContain("reviewer");
		expect(message).toContain("delegate/claude_code");
	});

	it("Scenario: A script that uses a tool it was not granted is refused", async () => {
		const message = await refusal({ reviewer: { runner: "agent", model: "default", script: EDIT_AGENT, tools: ["read_file"] } });
		expect(message).toContain("reviewer");
		expect(message).toContain("edit_file");
	});

	it("Scenario: A script without summary is refused", async () => {
		expect(analyze(NO_SUMMARY).diagnostics).toEqual([]);
		const message = await refusal({ reviewer: { runner: "agent", model: "default", script: NO_SUMMARY, tools: ["read_file"] } });
		expect(message).toContain("reviewer");
		expect(message).toMatch(/summary.*string/);
	});

	it("Scenario: A reasoning-offered agent delegate is refused", async () => {
		const { harness, models } = await build({ reviewer: { runner: "agent", model: "default", script: READ_AGENT } });
		const error = await startScript(harness, OFFERS_REVIEW, { model: models.default }, context).catch((e: unknown) => e);
		await harness.close(context);
		expect(error).toBeInstanceOf(ActionBindingError);
		expect((error as Error).message).toContain("delegate/reviewer");
		expect((error as Error).message).toContain("call it with run");
	});

	it("Scenario: The bundled delegate scripts are clean", () => {
		for (const source of [READ_AGENT, EDIT_AGENT]) {
			const analysis = analyze(source);
			expect(analysis.diagnostics).toEqual([]);
			expect(scanDocument(analysis.parsed)).toEqual([]);
			expect(delegateContractProblems(source)).toEqual([]);
		}
	});
});
