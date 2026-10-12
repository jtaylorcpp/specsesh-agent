// Must not type-check: `models` lacks `default`. Excluded from the package's tsconfig;
// agent-config.test.ts compiles it with ./tsconfig.json and expects the error.
import type { AgentConfig, ModelFactory, Workspace } from "../../../../src/durable/index.js";

declare const reviewer: ModelFactory<{}>;
declare const workspace: Workspace;

export const config: AgentConfig<{}> = { models: { reviewer }, workspace: () => workspace };
