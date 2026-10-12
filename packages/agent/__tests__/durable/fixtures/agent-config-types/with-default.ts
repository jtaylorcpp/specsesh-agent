// The control for no-default.ts: the same config with `default` type-checks.
import type { AgentConfig, ModelFactory, Workspace } from "../../../../src/durable/index.js";

declare const main: ModelFactory<{}>;
declare const reviewer: ModelFactory<{}>;
declare const workspace: Workspace;

export const config: AgentConfig<{}> = { models: { default: main, reviewer }, workspace: () => workspace };
