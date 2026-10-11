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
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { run, type VariableValue } from "@coopcli/agentscript/interpreter";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, resolveModel } from "./models.js";
import { createPiReasoningPort } from "./port.js";

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
	const model = resolveModel(models, provider, values.model ?? process.env.AGENTSCRIPT_MODEL ?? DEFAULT_MODEL);
	const messages: AssistantMessage[] = [];
	const port = createPiReasoningPort({
		models,
		model,
		...(values["max-tokens"] !== undefined ? { maxTokens: Number(values["max-tokens"]) } : {}),
		onMessage: (m) => messages.push(m),
	});

	const result = await run(readFileSync(file, "utf8"), {
		port,
		...(values.entry !== undefined ? { entry: values.entry } : {}),
		...(values.var !== undefined ? { variables: Object.fromEntries(values.var.map(parseVar)) } : {}),
	});

	const cost = messages.reduce((sum, m) => sum + m.usage.cost.total, 0);
	const tokens = messages.reduce((sum, m) => ({ in: sum.in + m.usage.input, out: sum.out + m.usage.output }), { in: 0, out: 0 });

	if (values.json) {
		console.log(JSON.stringify({ provider, model: model.id, ...result, usage: { ...tokens, cost } }, null, 2));
	} else {
		console.log(`# ${provider}/${model.id} — ${result.kind}\n`);
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
		console.log(`\n${tokens.in} in / ${tokens.out} out tokens, $${cost.toFixed(5)}`);
	}
	return result.kind === "completed" ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error: unknown) => {
			console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
			process.exit(1);
		},
	);
}
