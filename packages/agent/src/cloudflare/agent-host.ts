/**
 * `defineAgentHost(config)`: a Durable Object class built from the same `AgentConfig`
 * a Node host uses, serving `AgentScriptHost`'s routes. Its harness is
 * `createAgentHarness(config, …)` inside `PiHarness`, so a run's actions and delegates
 * are the ones the config grants, over the config's workspace.
 *
 *   export class Host extends defineAgentHost<Env>({
 *     models: { default: (env) => workersAI(env.AI, "@cf/meta/llama-4-scout") },
 *     workspace: () => memoryWorkspace(),
 *   }) {}
 *
 * A `POST` body may name `model`, a key of `config.models` (`default` when absent).
 * Runners default to `{ agent: agentRunner() }`: there is no process runner here, so a
 * `claude-code` grant refuses the harness with `DelegateGrantError`.
 */

import type { ModelRef } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { DurableObject } from "cloudflare:workers";
import { createAgentHarness, type AgentConfig, type ModelFactory } from "../durable/index.js";
import { handleRunRoutes, RouteError } from "./routes.js";
import { defaultCloudflareRunners } from "./runners.js";

export interface AgentHost<Env extends object> extends DurableObject<Env> {
	readonly harness: PiHarness;
	readonly lifecycle: Lifecycle<Env>;
	onRequest(request: Request): Promise<Response>;
}

export type AgentHostClass<Env extends object> = new (ctx: DurableObjectState, env: Env) => AgentHost<Env>;

export function defineAgentHost<Env extends object>(config: AgentConfig<Env>): AgentHostClass<Env> {
	return class extends DurableObject<Env> implements AgentHost<Env> {
		readonly #models: ReadonlyMap<string, ModelRef>;
		readonly harness: PiHarness;
		readonly lifecycle: Lifecycle<Env>;

		constructor(ctx: DurableObjectState, env: Env) {
			super(ctx, env);
			// Each factory once, here, before pi resumes any unfinished work, as
			// `AgentScriptHost.createModel()` does. The harness gets the same results back.
			const built = Object.keys(config.models).map((name) => [name, config.models[name]!(env)] as const);
			this.#models = new Map(built.map(([name, choice]) => [name, choice.model]));
			const models = Object.fromEntries(
				built.map(([name, choice]): [string, ModelFactory<Env>] => [name, () => choice]),
			) as AgentConfig<Env>["models"];
			const effective: AgentConfig<Env> = { ...config, models, runners: config.runners ?? defaultCloudflareRunners() };

			this.harness = new PiHarness({
				harness: async ({ storage, context }) => (await createAgentHarness(effective, { storage, env, context })).harness,
			});
			this.lifecycle = Lifecycle.install(this).use(this.harness);
		}

		async onRequest(request: Request): Promise<Response> {
			const pi = await this.harness.pi();
			return handleRunRoutes(request, {
				pi,
				model: (body) => {
					const name = body.model ?? "default";
					const model = this.#models.get(name);
					if (model === undefined) {
						throw new RouteError(400, `unknown model "${name}"; models: ${[...this.#models.keys()].join(", ")}`);
					}
					return model;
				},
			});
		}
	};
}
