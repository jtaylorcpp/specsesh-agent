import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { builtinActions, delegateArgs, type HostAction } from "../../../src/durable/index.js";

const dirs: string[] = [];
const savedPath = process.env.PATH;
let workspace: string;
let log: string;

function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

/** Only a fake `claude` on PATH, which logs its argv and answers a JSON result. */
beforeEach(() => {
	workspace = temp("delegate-ws-");
	const bin = temp("delegate-bin-");
	log = join(bin, "log.jsonl");
	writeFileSync(
		join(bin, "claude"),
		`#!${process.execPath}
const fs = require("node:fs");
try { fs.readFileSync(0, "utf8"); } catch {}
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "done" }));
`,
	);
	chmodSync(join(bin, "claude"), 0o755);
	process.env.PATH = bin;
});
afterEach(() => {
	process.env.PATH = savedPath;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const delegate = (options: Partial<Parameters<typeof builtinActions>[0]> = {}) =>
	builtinActions({ workspace, ...options }).find((a) => a.name === "delegate_claude_code") as HostAction;

const calls = (): { argv: string[]; cwd: string }[] =>
	existsSync(log)
		? readFileSync(log, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line))
		: [];

/** The values after a variadic flag, up to the next flag. */
function after(argv: readonly string[], flag: string): string[] {
	const at = argv.indexOf(flag);
	if (at < 0) return [];
	const rest = argv.slice(at + 1);
	const end = rest.findIndex((arg) => arg.startsWith("--"));
	return end < 0 ? rest : rest.slice(0, end);
}

describe("actions/registry: The delegate never prompts", () => {
	it("Scenario: The allowlist becomes Bash patterns", async () => {
		const result = await delegate({ allow: ["pnpm", "node"] }).execute({ instructions: "go" }, { workspace });
		expect(result).toMatchObject({ ok: true, outputs: { ok: true, summary: "done" } });
		const [call] = calls();
		const argv = call?.argv ?? [];
		expect(after(argv, "--allowedTools")).toEqual(["Read", "Edit", "Write", "Glob", "Grep", "Bash(pnpm:*)", "Bash(node:*)"]);
		expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("dontAsk");
		expect(argv[argv.indexOf("--tools") + 1]).toBe("Read,Edit,Write,Glob,Grep,Bash");
		expect(argv[argv.indexOf("--output-format") + 1]).toBe("json");
		expect(argv).toContain("--no-session-persistence");
		expect(argv).not.toContain("acceptEdits");
	});

	it("Scenario: An empty allowlist allows no shell", () => {
		const argv = delegateArgs({ allow: [] });
		expect(after(argv, "--allowedTools")).toEqual(["Read", "Edit", "Write", "Glob", "Grep"]);
		expect(argv.join(" ")).not.toContain("Bash(");
	});
});

describe("actions/registry: The delegate's model and context are configurable", () => {
	it("Scenario: Context files reach the delegate", async () => {
		writeFileSync(join(workspace, "CLAUDE.md"), "# conventions\n");
		const result = await delegate({ delegateContext: ["CLAUDE.md"], delegateModel: "sonnet" }).execute({ instructions: "go" }, { workspace });
		expect(result.ok).toBe(true);
		const argv = calls()[0]?.argv ?? [];
		expect(argv[argv.indexOf("--model") + 1]).toBe("sonnet");
		expect(argv[argv.indexOf("--append-system-prompt-file") + 1]).toBe(join(workspace, "CLAUDE.md"));
		expect(argv.slice(0, 2)).toEqual(["-p", "--safe-mode"]);
		expect(argv).not.toContain("--bare");
	});

	it("passes one --append-system-prompt-file per file, in order, and no --model when none is set", () => {
		const argv = delegateArgs({ allow: ["pnpm"], context: ["/a.md", "/b.md"] });
		const files = argv.flatMap((arg, i) => (arg === "--append-system-prompt-file" ? [argv[i + 1]] : []));
		expect(files).toEqual(["/a.md", "/b.md"]);
		expect(argv).not.toContain("--model");
	});

	it("Scenario: A missing context file fails the action", async () => {
		const result = await delegate({ delegateContext: ["MISSING.md"] }).execute({ instructions: "go" }, { workspace });
		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.message).toContain("MISSING.md");
		expect(calls()).toEqual([]);
	});
});
