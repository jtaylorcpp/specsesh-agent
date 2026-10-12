/**
 * One typed config builds an agent host: named model closures over the
 * runtime's environment, a workspace factory, the host's own actions, and
 * granted delegates. A Node host and a Cloudflare host differ only in the
 * closures they pass. `createAgentHarness` (in `./harness.ts`) builds from it.
 *
 * Types only, and no `node:` import.
 */

import type { Context } from "@earendil-works/chord";
import type { Provider } from "@earendil-works/pi-ai";
import type { Extension, Harness, ModelRef, Storage } from "@earendil-works/pi-durable";
import type { ActionRegistry, HostAction } from "./actions.js";
import type { DelegateGrants, Runners } from "./delegation.js";
import type { Workspace } from "./workspace.js";

/** A model and the provider that serves it, built from the runtime's environment. */
export type ModelFactory<Env> = (env: Env) => { provider: Provider; model: ModelRef };

export interface AgentConfig<Env> {
	/** `default` is required; every other key names another model a host may use. */
	readonly models: { readonly default: ModelFactory<Env> } & Readonly<Record<string, ModelFactory<Env>>>;
	readonly workspace: (env: Env) => Workspace | Promise<Workspace>;
	/** First words `run_command` may run. */
	readonly allow?: readonly string[];
	/** Commands `run_checks` runs, in order. */
	readonly checks?: readonly string[];
	/** Per command before it is killed. */
	readonly timeoutMs?: number;
	/** The host's own actions, registered after the built-ins. */
	readonly actions?: (env: Env, workspace: Workspace) => HostAction[];
	readonly delegates?: DelegateGrants;
	readonly runners?: Runners;
}

export interface AgentHarnessOptions<Env> {
	readonly storage: Storage;
	/** Passed unchanged to every closure in the config. */
	readonly env: Env;
	/** Installed after the run and step extensions, in order. */
	readonly extensions?: readonly Extension[];
	readonly context: Context;
}

export interface AgentHarness {
	readonly harness: Harness;
	/** Each config model key to its `ModelRef`. */
	readonly models: Readonly<Record<string, ModelRef>>;
	readonly actions: ActionRegistry;
	readonly workspace: Workspace;
}
