#!/usr/bin/env node
/**
 * agentscript-pi — run an Agent Script file on any pi provider.
 *
 *   agentscript-pi run <file> [--provider anthropic] [--model claude-haiku-4-5]
 *                              [--entry <subagent>]... [--var name=value]...
 *                              [--max-tokens 4096] [--json]
 *                              [--tools <module>]... [--workspace <dir>]
 *   agentscript-pi models [provider]
 *
 * Provider and model also come from AGENTSCRIPT_PROVIDER / AGENTSCRIPT_MODEL.
 * Credentials are pi's: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, ...
 *
 * `--tools` loads host actions from the user's modules (see ./tools.ts); the
 * script's actions are checked against them before any port is created, and
 * they back both `run` statements and tools offered to the model.
 *
 * `--provider claude-code` runs each step through your own `claude` binary on
 * your Claude subscription instead of through pi (see src/claude-code/).
 * `--provider ollama` runs on a local Ollama server (OLLAMA_HOST, default
 * http://localhost:11434); only it makes a network call before the run.
 */

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { run, type VariableValue } from "../interpreter/index.js";
import type { ReasoningPort } from "../interpreter/index.js";
import { ActionBindingError, checkBindings } from "../durable/actions.js";
import { registryHost, type RegistryHost } from "../durable/tool-host.js";
import { loadTools } from "./tools.js";
import type { AssistantMessage, MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { CLAUDE_CODE_PROVIDER, createClaudeCodeReasoningPort } from "../claude-code/index.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, registerOllama, resolveModel } from "../pi/index.js";
import { createPiReasoningPort } from "../pi/index.js";

const OLLAMA_PROVIDER = "ollama";

const USAGE = `usage:
  agentscript-pi run <file> [--provider <id>] [--model <id>] [--entry <subagent>]...
                            [--var name=value]... [--max-tokens <n>] [--json]
                            [--tools <module>]... [--workspace <dir>]
  agentscript-pi models [provider]
providers: any pi provider, claude-code, or ollama (at OLLAMA_HOST, default http://localhost:11434)
tools: under --provider claude-code, a step that offers tools fails invalid_request`;

/** Register the local Ollama server's pulled models; report an unreachable one on stderr. */
async function ensureOllama(models: MutableModels): Promise<boolean> {
	const r = await registerOllama(models);
	if (r.ok) return true;
	console.error(`ollama: not reachable at ${r.baseUrl}: ${r.reason}`);
	return false;
}

export function parseVar(raw: string): [string, VariableValue] {
	const eq = raw.indexOf("=");
	if (eq <= 0) throw new Error(`--var expects name=value, got "${raw}"`);
	const name = raw.slice(0, eq);
	const value = raw.slice(eq + 1);
	if (value === "True") return [name, true];
	if (value === "False") return [name, false];
	if (value !== "" && /^-?\d+(\.\d+)?$/.test(value)) return [name, Number(value)];
	return [name, value];
}

export async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;
	const models = builtinModels();

	if (command === "models") {
		const provider = rest[0] ?? DEFAULT_PROVIDER;
		if (provider === CLAUDE_CODE_PROVIDER) {
			console.log("any id or alias `claude --model` accepts: haiku, sonnet, opus, claude-haiku-4-5, ...");
			return 0;
		}
		if (provider === OLLAMA_PROVIDER && !(await ensureOllama(models))) return 1;
		for (const m of models.getModels(provider)) console.log(`${m.id}\t${m.name}`);
		return 0;
	}
	if (command !== "run") {
		console.error(USAGE);
		return 2;
	}

	const { values, positionals } = parseArgs({
		args: rest,
		allowPositionals: true,
		options: {
			provider: { type: "string" },
			model: { type: "string" },
			entry: { type: "string", multiple: true },
			var: { type: "string", multiple: true },
			"max-tokens": { type: "string" },
			json: { type: "boolean", default: false },
			tools: { type: "string", multiple: true },
			workspace: { type: "string" },
		},
	});
	const file = positionals[0];
	if (file === undefined) {
		console.error(USAGE);
		return 2;
	}
	const source = readFileSync(file, "utf8");

	// Tools are loaded and bound before any provider or port, so a refusal makes no model request.
	let hosts: RegistryHost | undefined;
	if (values.tools !== undefined && values.tools.length > 0) {
		const workspace = resolve(values.workspace ?? ".");
		const loaded = await loadTools(values.tools, { cwd: process.cwd(), workspace });
		if (!loaded.ok) {
			console.error(loaded.message);
			return 2;
		}
		try {
			checkBindings(source, loaded.registry);
		} catch (error) {
			if (!(error instanceof ActionBindingError)) throw error;
			console.error(error.message);
			return 2;
		}
		hosts = registryHost(loaded.registry, { workspace });
	}

	const provider = values.provider ?? process.env.AGENTSCRIPT_PROVIDER ?? DEFAULT_PROVIDER;
	const modelId = values.model ?? process.env.AGENTSCRIPT_MODEL ?? DEFAULT_MODEL;
	const maxTokens = values["max-tokens"] !== undefined ? Number(values["max-tokens"]) : undefined;
	const usage = { in: 0, out: 0, cost: 0 };
	let port: ReasoningPort;

	if (provider === CLAUDE_CODE_PROVIDER) {
		port = createClaudeCodeReasoningPort({
			model: modelId,
			onResult: (r) => {
				usage.in += r.usage?.input_tokens ?? 0;
				usage.out += r.usage?.output_tokens ?? 0;
				usage.cost += r.total_cost_usd ?? 0;
			},
		});
	} else {
		if (provider === OLLAMA_PROVIDER && !(await ensureOllama(models))) return 1;
		const model = resolveModel(models, provider, modelId);
		port = createPiReasoningPort({
			models,
			model,
			...(maxTokens !== undefined ? { maxTokens } : {}),
			...(hosts !== undefined ? { tools: hosts.toolHost } : {}),
			onMessage: (m: AssistantMessage) => {
				usage.in += m.usage.input;
				usage.out += m.usage.output;
				usage.cost += m.usage.cost.total;
			},
		});
	}

	const result = await run(source, {
		port,
		...(hosts !== undefined ? { actionHost: hosts.actionHost } : {}),
		...(values.entry !== undefined ? { entry: values.entry } : {}),
		...(values.var !== undefined ? { variables: Object.fromEntries(values.var.map(parseVar)) } : {}),
	});

	if (values.json) {
		console.log(JSON.stringify({ provider, model: modelId, ...result, usage }, null, 2));
	} else {
		console.log(`# ${provider}/${modelId} — ${result.kind}\n`);
		for (const [i, step] of result.steps.entries()) {
			console.log(`## step ${i + 1}: ${step.subagent} → ${step.outcome.kind}`);
			if (step.outcome.kind === "failed") {
				console.log(`${step.outcome.category}: ${step.outcome.message}\n`);
				continue;
			}
			if (step.outcome.text) console.log(`${step.outcome.text}\n`);
			if (step.outcome.kind === "answered" && step.outcome.structured !== undefined) {
				console.log(`structured: ${JSON.stringify(step.outcome.structured)}\n`);
			}
		}
		console.log("## variables");
		for (const [name, value] of Object.entries(result.variables)) console.log(`${name} = ${JSON.stringify(value)}`);
		const note = provider === CLAUDE_CODE_PROVIDER ? " (notional on a subscription)" : "";
		console.log(`\n${usage.in} in / ${usage.out} out tokens, $${usage.cost.toFixed(5)}${note}`);
	}
	return result.kind === "completed" ? 0 : 1;
}

// Run only as the entry point: through a bin symlink argv[1] is the link, so compare real paths.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error: unknown) => {
			console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
			process.exit(1);
		},
	);
}
