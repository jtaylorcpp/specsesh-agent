#!/usr/bin/env node
/**
 * agentscript-pi — run an Agent Script file on any pi provider.
 *
 *   agentscript-pi run <file> [--provider anthropic] [--model claude-haiku-4-5]
 *                              [--entry <subagent>]... [--var name=value]...
 *                              [--max-tokens 4096] [--json]
 *   agentscript-pi models [provider]
 *
 * Provider and model also come from AGENTSCRIPT_PROVIDER / AGENTSCRIPT_MODEL.
 * Credentials are pi's: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, ...
 *
 * `--provider claude-code` runs each step through your own `claude` binary on
 * your Claude subscription instead of through pi (see src/claude-code/).
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { run, type VariableValue } from "../interpreter/index.js";
import type { ReasoningPort } from "../interpreter/index.js";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { CLAUDE_CODE_PROVIDER, createClaudeCodeReasoningPort } from "../claude-code/index.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, resolveModel } from "../pi/index.js";
import { createPiReasoningPort } from "../pi/index.js";

const USAGE = `usage:
  agentscript-pi run <file> [--provider <id>] [--model <id>] [--entry <subagent>]...
                            [--var name=value]... [--max-tokens <n>] [--json]
  agentscript-pi models [provider]`;

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

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;
	const models = builtinModels();

	if (command === "models") {
		const provider = rest[0] ?? DEFAULT_PROVIDER;
		if (provider === CLAUDE_CODE_PROVIDER) {
			console.log("any id or alias `claude --model` accepts: haiku, sonnet, opus, claude-haiku-4-5, ...");
			return 0;
		}
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
		},
	});
	const file = positionals[0];
	if (file === undefined) {
		console.error(USAGE);
		return 2;
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
		const model = resolveModel(models, provider, modelId);
		port = createPiReasoningPort({
			models,
			model,
			...(maxTokens !== undefined ? { maxTokens } : {}),
			onMessage: (m: AssistantMessage) => {
				usage.in += m.usage.input;
				usage.out += m.usage.output;
				usage.cost += m.usage.cost.total;
			},
		});
	}

	const result = await run(readFileSync(file, "utf8"), {
		port,
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
