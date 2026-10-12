/**
 * `createAgentHarness`: an `AgentConfig` to an open pi-durable harness with the
 * Agent Script run and step extensions over the config's action registry.
 * Runtime-neutral: the env reaches the config's closures unchanged, and nothing
 * here reads the process environment.
 */

import { createModels, type Provider } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type ModelRef } from "@earendil-works/pi-durable";
import { createActionRegistry } from "./actions.js";
import type { AgentConfig, AgentHarness, AgentHarnessOptions } from "./agent-config.js";
import { delegationActions } from "./delegation.js";
import { agentScriptExtensions } from "./extension.js";
import { searchActions, workspaceActions } from "./workspace.js";

export async function createAgentHarness<Env>(config: AgentConfig<Env>, options: AgentHarnessOptions<Env>): Promise<AgentHarness> {
	// Each factory once, in key order; each distinct provider once, keyed by id as pi keys it.
	const models: Record<string, ModelRef> = {};
	const providers = new Map<string, { provider: Provider; firstKey: string }>();
	for (const key of Object.keys(config.models)) {
		const { provider, model } = config.models[key]!(options.env);
		models[key] = model;
		const seen = providers.get(provider.id);
		if (seen === undefined) providers.set(provider.id, { provider, firstKey: key });
		else if (seen.provider !== provider) {
			throw new Error(`models "${seen.firstKey}" and "${key}" both use provider "${provider.id}" with different provider objects`);
		}
	}
	const registered = createModels();
	for (const { provider } of providers.values()) registered.setProvider(provider);

	const workspace = await config.workspace(options.env);
	// Search actions only when the workspace can both list and search.
	const canSearch = typeof workspace.list === "function" && typeof workspace.search === "function";
	const firstPass = [
		...workspaceActions(workspace, {
			...(config.allow !== undefined ? { allow: config.allow } : {}),
			...(config.checks !== undefined ? { checks: config.checks } : {}),
			...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
		}),
		...(canSearch ? searchActions(workspace) : []),
		...(config.actions?.(options.env, workspace) ?? []),
		...delegationActions(config.delegates ?? {}, { workspace, runners: config.runners ?? {} }),
	];
	const actions = createActionRegistry(firstPass);

	const installed = agentScriptExtensions({
		actions,
		workspace: workspace.root,
		...(workspace.snapshot !== undefined ? { snapshot: () => workspace.snapshot!() } : {}),
	});
	const registry = createRegistry();
	for (const extension of [installed.run, installed.step, ...(options.extensions ?? [])]) registry.install(extension);
	const harness = await Harness.open(options.storage, { models: registered, registry }, options.context);
	return { harness, models, actions, workspace };
}
