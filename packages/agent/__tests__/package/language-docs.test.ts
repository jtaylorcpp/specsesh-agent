/**
 * package/language-docs: the topic files under `docs/language/` ship in the tarball, and
 * `specsesh agent language` shows each one's first line as its summary. Every example, every
 * `agent` block in the topics and every tour step passes `specsesh agent check`, and runs to
 * `completed` on a stub model.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkSource, formatProblem } from "../../src/cli/explain.js";
import { main } from "../../src/cli/index.js";
import { type ReasoningPort, type RunOptions, declaredActions, run } from "../../src/interpreter/index.js";
import { readSubagents } from "../../src/interpreter/compose.js";
import { analyze } from "../../src/authoring/document.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = join(PKG_DIR, "..", "..");
const DOCS = join(PKG_DIR, "docs", "language");
const TOUR = join(ROOT, "guides", "00-language-tour.md");

const TOPICS = ["overview", "config", "system", "variables", "subagents", "prompts", "interpolation", "logic", "outputs", "actions", "run", "refused"];

/** One fenced `agent` block: `line` is the 1-based line of its opening fence. */
interface AgentBlock {
	readonly line: number;
	readonly source: string;
}

function agentBlocks(markdown: string): AgentBlock[] {
	const lines = markdown.split("\n");
	const blocks: AgentBlock[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		if (lines[i] !== "```agent") continue;
		const end = lines.findIndex((l, j) => j > i && l.startsWith("```"));
		blocks.push({ line: i + 1, source: lines.slice(i + 1, end).join("\n") + "\n" });
		i = end;
	}
	return blocks;
}

/** The `agent` block under each `## Step <n>` heading of the tour. */
function tourSteps(markdown: string): (AgentBlock & { step: number })[] {
	const lines = markdown.split("\n");
	return agentBlocks(markdown).map((block) => {
		const heading = lines
			.slice(0, block.line - 1)
			.reverse()
			.find((l) => l.startsWith("## "));
		const step = Number(/^## Step (\d+)/.exec(heading ?? "")?.[1]);
		return { ...block, step };
	});
}

/** Every problem `check` finds in a Markdown file's `agent` blocks, at its line in that file. */
function docProblems(file: string, markdown: string): string[] {
	return agentBlocks(markdown).flatMap((block) =>
		checkSource(file, block.source).map((p) =>
			formatProblem(p.line === undefined ? { ...p, line: block.line, col: 1 } : { ...p, line: block.line + p.line }) +
				` (in the block at ${file}:${block.line})`,
		),
	);
}

/** Every `.agent` file under the repo's `examples/`, skipping installed and generated directories. */
function exampleFiles(dir = join(ROOT, "examples")): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return ["node_modules", ".wrangler", "dist"].includes(entry.name) ? [] : exampleFiles(path);
		return entry.name.endsWith(".agent") ? [path] : [];
	});
}

describe("Each topic has a shipped reference file", () => {
	it("Scenario: Every topic is present", async () => {
		const report = JSON.parse(
			execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: PKG_DIR, encoding: "utf8" }),
		) as { files: { path: string }[] }[];
		const paths = report[0]!.files.map((file) => file.path);
		for (const topic of TOPICS) expect(paths, `docs/language/${topic}.md is not packed`).toContain(`docs/language/${topic}.md`);

		const out: string[] = [];
		expect(await main(["agent", "language", "--json"], { out: (line) => out.push(line), err: () => {} })).toBe(0);
		const contents = JSON.parse(out.join("\n")) as { name: string; summary: string }[];
		for (const topic of TOPICS) {
			const text = readFileSync(join(PKG_DIR, "docs", "language", `${topic}.md`), "utf8");
			const summary = text.split("\n", 1)[0]!.replace(/^#+\s*/, "").trim();
			expect(summary, `${topic}.md has no summary line`).not.toBe("");
			expect(text, `${topic}.md has no agent example block`).toMatch(/^```agent$/m);
			expect(contents.find((t) => t.name === topic)?.summary, topic).toBe(summary);
		}
	});
});

describe("Examples and reference blocks pass check", () => {
	it("Scenario: Examples check clean", async () => {
		const files = exampleFiles();
		const agents = files.filter((f) => relative(ROOT, f).startsWith("examples/agents/"));
		expect(agents.length).toBeGreaterThanOrEqual(6);

		// `specsesh agent check` itself, over examples/agents/*.agent and then every other example.
		for (const batch of [agents, files.filter((f) => !agents.includes(f))]) {
			const out: string[] = [];
			const code = await main(["agent", "check", ...batch], { out: (line) => out.push(line), err: (line) => out.push(line) });
			expect(out).toEqual([]);
			expect(code).toBe(0);
		}

		// And every `agent` block of every topic, by the same check.
		const topics = readdirSync(DOCS).filter((f) => f.endsWith(".md"));
		let blocks = 0;
		for (const topic of topics) {
			const markdown = readFileSync(join(DOCS, topic), "utf8");
			blocks += agentBlocks(markdown).length;
			expect(docProblems(topic, markdown)).toEqual([]);
		}
		expect(blocks).toBeGreaterThanOrEqual(TOPICS.length);
	});

	it("Scenario: A broken doc example fails the build", () => {
		const markdown = readFileSync(join(DOCS, "logic.md"), "utf8");
		expect(docProblems("logic.md", markdown)).toEqual([]);

		// Nest an `if` inside the first block's first `if`: the dialect has no nested `if`.
		const [block] = agentBlocks(markdown);
		const target = "                set @variables.stage = \"review\"\n";
		expect(block!.source).toContain(target);
		const broken = markdown.replace(
			target,
			`                if @variables.attempts > 3:\n    ${target}`,
		);
		const problems = docProblems("logic.md", broken);
		expect(problems.length).toBeGreaterThan(0);
		expect(problems.join("\n")).toContain(`logic.md:${block!.line}`);
		// The problem's own position is a line inside that block.
		const at = Number(/^logic\.md:(\d+)/.exec(problems[0]!)?.[1]);
		const blockEnd = block!.line + block!.source.split("\n").length;
		expect(at).toBeGreaterThan(block!.line);
		expect(at).toBeLessThanOrEqual(blockEnd);
	});
});

describe("The tour builds one script step by step", () => {
	it("Scenario: Each tour step checks", () => {
		const steps = tourSteps(readFileSync(TOUR, "utf8"));
		expect(steps.length).toBeGreaterThanOrEqual(6);
		expect(steps.map((s) => s.step)).toEqual(steps.map((_, i) => i + 1));
		for (const step of steps) {
			const problems = checkSource(`00-language-tour.md step ${step.step}`, step.source).map(
				(p) => `${formatProblem(p)} (block at 00-language-tour.md:${step.line})`,
			);
			expect(problems).toEqual([]);
		}
	});
});

/** A value of the JSON Schema's type: the first `enum` value, `"x"`, `0`, `false`, or built recursively. */
function fromSchema(schema: unknown): unknown {
	const s = (schema ?? {}) as { type?: string; enum?: unknown[]; properties?: Record<string, unknown>; items?: unknown };
	if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
	switch (s.type) {
		case "string":
			return "x";
		case "number":
		case "integer":
			return 0;
		case "boolean":
			return false;
		case "array":
			return [fromSchema(s.items)];
		default:
			return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, fromSchema(v)]));
	}
}

const valueOf = (type: string) => fromSchema({ type }) as string | number | boolean;

/**
 * A port that answers every structured schema, calls every offered tool once (reporting the
 * host's outputs as the declared types), and an action host that succeeds for every call.
 */
function stubs(source: string): Required<Pick<RunOptions, "port" | "actionHost">> {
	const declared = declaredActions(source);
	const outputsOf = (match: (d: (typeof declared)[number]) => boolean) =>
		Object.fromEntries(
			declared.filter(match).flatMap((d) => Object.entries(d.outputs).map(([name, type]) => [name, valueOf(type)])),
		);
	let requests = 0;
	const port: ReasoningPort = {
		async reason(request) {
			requests += 1;
			if (requests > 50) return { kind: "failed", category: "unknown", message: "stub: more than 50 requests" };
			return {
				kind: "answered",
				text: "ok",
				...(request.outputSchema !== undefined ? { structured: fromSchema(request.outputSchema) } : {}),
				...(request.tools !== undefined
					? {
							toolCalls: request.tools.map((tool) => ({
								name: tool.name,
								inputs: fromSchema(tool.inputSchema) as Record<string, unknown>,
								ok: true,
								outputs: outputsOf((d) => d.tool === tool.action),
							})),
						}
					: {}),
			};
		},
	};
	return {
		port,
		actionHost: (call) => ({ ok: true, outputs: outputsOf((d) => d.subagent === call.subagent && d.action === call.action) }),
	};
}

describe("Examples run on a stub model", () => {
	// Task-only (add-agent-language-docs 3.1): no scenario of package/language-docs covers it.
	it("runs every example and tour step, each subagent as entry, to completed", async () => {
		const scripts = [
			...exampleFiles().map((f) => ({ name: relative(ROOT, f), source: readFileSync(f, "utf8") })),
			...tourSteps(readFileSync(TOUR, "utf8")).map((s) => ({ name: `tour step ${s.step}`, source: s.source })),
		];
		expect(scripts.length).toBeGreaterThanOrEqual(12);
		for (const { name, source } of scripts) {
			const subagents = [...readSubagents(analyze(source).parsed).keys()];
			expect(subagents.length, name).toBeGreaterThan(0);
			for (const entry of subagents) {
				const result = await run(source, { entry, ...stubs(source) });
				const failed = result.steps.find((s) => s.outcome.kind !== "answered")?.outcome;
				const failedAction = result.actions.find((a) => !a.result.ok)?.result;
				expect(result.kind, `${name}, entry ${entry}: ${JSON.stringify(failed ?? failedAction)}`).toBe("completed");
			}
		}
	});
});
