// A Worker's host, as a consumer writes it, against the built declarations.
import { defineAgentHost, workersAI } from "@specsesh/agent/cloudflare";
import { memoryWorkspace } from "@specsesh/agent/durable";

interface Env {
	AI: Ai;
}

export class Host extends defineAgentHost<Env>({
	models: { default: (env) => workersAI(env.AI, "@cf/meta/llama-4-scout") },
	workspace: () => memoryWorkspace(),
}) {}

// The control: a model that is not a factory does not type-check.
export const Bad = defineAgentHost<Env>({
	// @ts-expect-error a model must be a factory
	models: { default: 42 },
	workspace: () => memoryWorkspace(),
});
