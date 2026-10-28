import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closedPortUrl, startFakeOllama, type FakeOllama } from "./fake-ollama.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(PKG_DIR, "dist", "bin", "agentscript-pi.js");
const TRIAGE = join(PKG_DIR, "examples", "triage.agent");
const TOOLS = join(PKG_DIR, "__tests__", "fixtures", "tools");

/** The `echo` action as a script declares it, under a subagent's `actions:`. */
const ECHO_ACTION = (target: string) => `    actions:
        echo:
            description: "Echo the text"
            inputs:
                text: string
            outputs:
                text: string
            target: "mcpTool://${target}"
`;

/** A deterministic subagent that runs `echo` and sets `out`: no model step. */
const RUN_ECHO = (target = "echo") => `config:
    agent_name: "run-echo"

variables:
    out: mutable string = ""

subagent act:
    description: "Echo without the model"

${ECHO_ACTION(target)}
    reasoning:
        instructions: ->
            run @actions.echo
                with text = "hi"
                set @variables.out = @outputs.text
`;

/** A model step offering `echo` as `say`, whose output sets `out`. */
const OFFER_ECHO = `config:
    agent_name: "offer-echo"

variables:
    out: mutable string = ""

subagent act:
    description: "Echo through the model"

${ECHO_ACTION("echo")}
    reasoning:
        instructions: ->
            | Echo something.
        actions:
            say: @actions.echo
                with text = ...
                set @variables.out = @outputs.text
`;

/** One step, no structured result. */
const HELLO = `config:
    agent_name: "hello"

subagent hello:
    description: "Say hello"

    reasoning:
        instructions: ->
            | Say hello.
`;

let dir: string;
let fakeBin: string;
let argvLog: string;
let hello: string;
let ollama: FakeOllama | undefined;

afterEach(async () => {
	await ollama?.close();
	ollama = undefined;
});

/** The SDK client modules, by absolute path: the fake `claude` runs from a temp dir. */
const requireFromTest = createRequire(import.meta.url);
const SDK_CLIENT = requireFromTest.resolve("@modelcontextprotocol/sdk/client/index.js");
const SDK_HTTP = requireFromTest.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js");

/**
 * A `claude` stand-in: records argv, then prints a `claude -p --output-format json` result.
 * Given `--mcp-config`, it first calls the first allowed tool over MCP and answers with its text.
 */
const FAKE_CLAUDE = (log: string) => `#!${process.execPath}
const fs = require("node:fs");
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + "\\n");
async function callFirstTool() {
	const config = JSON.parse(fs.readFileSync(argv[argv.indexOf("--mcp-config") + 1], "utf8"));
	const { url, headers } = config.mcpServers.agentscript;
	const name = argv[argv.indexOf("--allowedTools") + 1].split(",")[0].replace(/^mcp__agentscript__/, "");
	const { Client } = require(${JSON.stringify(SDK_CLIENT)});
	const { StreamableHTTPClientTransport } = require(${JSON.stringify(SDK_HTTP)});
	const client = new Client({ name: "fake-claude", version: "0.0.0" });
	await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
	try {
		const result = await client.callTool({ name, arguments: { text: "bridged-hello" } });
		return result.content.map((c) => c.text).join("");
	} finally {
		await client.close();
	}
}
process.stdin.resume();
process.stdin.on("end", async () => {
	if (argv.includes("--mcp-config")) {
		const text = await callFirstTool();
		console.log(JSON.stringify({
			type: "result", subtype: "success", is_error: false, num_turns: 2,
			result: text,
			usage: { input_tokens: 10, output_tokens: 5 },
			total_cost_usd: 0.001,
		}));
		return;
	}
	if (process.env.FAKE_CLAUDE_MODE === "error") {
		console.log(JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: 429, result: "rate limited" }));
		return;
	}
	console.log(JSON.stringify({
		type: "result", subtype: "success", is_error: false, num_turns: 1,
		result: "{}",
		structured_output: { severity: "high", summary: "Crashes outside git." },
		usage: { input_tokens: 10, output_tokens: 5 },
		total_cost_usd: 0.001,
	}));
});
`;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "agentscript-pi-cli-"));
	fakeBin = join(dir, "bin");
	argvLog = join(dir, "argv.log");
	mkdirSync(fakeBin);
	const claude = join(fakeBin, "claude");
	writeFileSync(claude, FAKE_CLAUDE(argvLog));
	chmodSync(claude, 0o755);
	hello = join(dir, "hello.agent");
	writeFileSync(hello, HELLO);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

interface Cli {
	code: number | null;
	stdout: string;
	stderr: string;
}

/** Runs the real bin. No network: every credential and AGENTSCRIPT_* variable is stripped first. */
function cli(args: string[], env: Record<string, string> = {}, fakeClaude = false): Promise<Cli> {
	const base: Record<string, string | undefined> = { ...process.env };
	for (const key of Object.keys(base)) {
		if (/_API_KEY$|_TOKEN$/.test(key) || key.startsWith("AGENTSCRIPT_") || key === "CLAUDECODE") delete base[key];
	}
	const childEnv = {
		...base,
		...(fakeClaude ? { PATH: `${fakeBin}:${process.env.PATH ?? ""}` } : {}),
		...env,
	};
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [BIN, ...args], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
		child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

const argvCalls = (): string[][] =>
	readFileSync(argvLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe("The CLI has two commands and prints usage otherwise", () => {
	it("Scenario: An unknown command prints usage", async () => {
		const r = await cli(["frobnicate"]);
		expect(r.stderr).toContain("usage:");
		expect(r.code).toBe(2);
	});

	it("Scenario: No command prints usage", async () => {
		const r = await cli([]);
		expect(r.stderr).toContain("usage:");
		expect(r.code).toBe(2);
	});
});

describe("The bin is the compiled CLI", () => {
	it("Scenario: Arguments and exit code pass through", async () => {
		const r = await cli(["frobnicate"]);
		expect(r.code).toBe(2);
		expect(r.stderr).toMatch(/^usage:/);
		expect(r.stderr).toContain("agentscript-pi models [provider]");
	});
});

describe("models lists a provider's models", () => {
	it("Scenario: The default provider is Anthropic", async () => {
		const r = await cli(["models"]);
		expect(r.code).toBe(0);
		expect(r.stdout.split("\n")).toEqual(expect.arrayContaining([expect.stringMatching(/^claude-haiku-4-5\t.+/)]));
	});

	it("Scenario: claude-code describes its ids", async () => {
		const r = await cli(["models", "claude-code"]);
		expect(r.code).toBe(0);
		expect(r.stdout.startsWith("any id or alias")).toBe(true);
	});

	it("Scenario: An unknown provider prints nothing", async () => {
		const r = await cli(["models", "nowhere"]);
		expect(r.stdout).toBe("");
		expect(r.code).toBe(0);
	});

	it("Scenario: ollama lists the pulled models", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"] });
		const r = await cli(["models", "ollama"], { OLLAMA_HOST: ollama.url });
		expect(r.stdout.trimEnd()).toBe("qwen3:8b\tqwen3:8b (Ollama)");
		expect(r.code).toBe(0);
	});

	it("Scenario: An unreachable ollama is reported", async () => {
		const url = await closedPortUrl();
		const r = await cli(["models", "ollama"], { OLLAMA_HOST: url });
		expect(r.stderr.startsWith(`ollama: not reachable at ${url}`)).toBe(true);
		expect(r.stdout).toBe("");
		expect(r.code).toBe(1);
	});
});

describe("run takes a file and its options", () => {
	it("Scenario: run without a file prints usage", async () => {
		const r = await cli(["run"]);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("usage:");
	});

	it("Scenario: An unreadable file is an error, not usage", async () => {
		const r = await cli(["run", join(dir, "missing.agent")]);
		expect(r.stderr).toContain("ENOENT");
		expect(r.stderr).not.toContain("usage:");
		expect(r.code).toBe(1);
	});
});

describe("Provider and model come from the flag, then the environment, then the defaults", () => {
	it("Scenario: An unknown model fails by name", async () => {
		const r = await cli(["run", TRIAGE, "--model", "claude-nope"]);
		expect(r.stderr).toContain('UnknownModelError: no model "claude-nope"');
		expect(r.code).toBe(1);
	});

	it("Scenario: The environment picks the provider and model", async () => {
		const r = await cli(["run", TRIAGE], { AGENTSCRIPT_PROVIDER: "claude-code", AGENTSCRIPT_MODEL: "haiku" }, true);
		expect(r.code).toBe(0);
		expect(r.stdout.startsWith("# claude-code/haiku — completed")).toBe(true);
		expect(flag(argvCalls().at(-1)!, "--model")).toBe("haiku");
	});

	it("a flag beats the environment, and the environment model reaches resolveModel", async () => {
		const flagWins = await cli(
			["run", TRIAGE, "--provider", "claude-code", "--model", "opus"],
			{ AGENTSCRIPT_PROVIDER: "nowhere", AGENTSCRIPT_MODEL: "haiku" },
			true,
		);
		expect(flagWins.stdout.startsWith("# claude-code/opus — completed")).toBe(true);

		const env = await cli(["run", TRIAGE], { AGENTSCRIPT_MODEL: "claude-from-env" });
		expect(env.stderr).toContain('no model "claude-from-env" on provider "anthropic"');
		expect(env.code).toBe(1);

		const envProvider = await cli(["run", TRIAGE], { AGENTSCRIPT_PROVIDER: "nowhere" });
		expect(envProvider.stderr).toContain('"nowhere" is not a registered provider.');
	});

	it("Scenario: A model ollama has not pulled fails by name", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "hello" } });
		const r = await cli(["run", TRIAGE, "--provider", "ollama", "--model", "nope:1b"], { OLLAMA_HOST: ollama.url });
		expect(r.stderr).toContain('UnknownModelError: no model "nope:1b" on provider "ollama"');
		expect(r.stderr).toContain("qwen3:8b");
		expect(r.code).toBe(1);
		expect(ollama.requests.filter((q) => q.path === "/v1/chat/completions")).toEqual([]);
	});

	it("Scenario: An unreachable ollama stops run before any request", async () => {
		const url = await closedPortUrl();
		const r = await cli(["run", TRIAGE, "--provider", "ollama", "--model", "qwen3:8b"], { OLLAMA_HOST: url });
		expect(r.stderr.startsWith(`ollama: not reachable at ${url}`)).toBe(true);
		expect(r.stdout).toBe("");
		expect(r.code).toBe(1);
	});
});

describe("claude-code runs steps through the claude binary instead of pi", () => {
	it("Scenario: Any claude alias is accepted", async () => {
		const r = await cli(["run", TRIAGE, "--provider", "claude-code", "--model", "sonnet"], {}, true);
		expect(r.code).toBe(0);
		const call = argvCalls().at(-1)!;
		expect(flag(call, "--model")).toBe("sonnet");
		expect(call).toContain("--safe-mode");
	});

	it("Scenario: A claude-code run calls a --tools tool through the bridge", async () => {
		const { script } = scriptAndWorkspace("claude-offer-echo", OFFER_ECHO);
		const r = await cli(["run", script, "--provider", "claude-code", "--tools", join(TOOLS, "echo.mjs")], {}, true);
		expect(r.stderr).toBe("");
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("bridged-hello");
		const call = argvCalls().at(-1)!;
		expect(call).not.toContain("--safe-mode");
		expect(call).toContain("--mcp-config");
		expect(flag(call, "--allowedTools")).toBe("mcp__agentscript__say");
	});

	it("Scenario: A script runs on a pulled ollama model", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "hello" } });
		const r = await cli(["run", hello, "--provider", "ollama", "--model", "qwen3:8b"], { OLLAMA_HOST: ollama.url });
		expect(r.stdout.startsWith("# ollama/qwen3:8b — completed")).toBe(true);
		expect(r.code).toBe(0);
		const chats = ollama.requests.filter((q) => q.method === "POST" && q.path === "/v1/chat/completions");
		expect(chats).toHaveLength(1);
		expect((chats[0]!.body as { model?: string }).model).toBe("qwen3:8b");
	});
});

describe("Text output lists steps, variables and usage", () => {
	it("Scenario: A completed run prints its steps and usage", async () => {
		const r = await cli(["run", TRIAGE, "--provider", "claude-code", "--model", "haiku"], {}, true);
		expect(r.code).toBe(0);
		const lines = r.stdout.split("\n");
		expect(lines[0]).toBe("# claude-code/haiku — completed");
		expect(lines[1]).toBe("");
		expect(r.stdout).toContain("## step 1: triage → answered");
		expect(r.stdout).toContain('structured: {"severity":"high","summary":"Crashes outside git."}');
		expect(r.stdout).toContain("## variables");
		expect(r.stdout).toContain('severity = "high"');
		expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("10 in / 5 out tokens, $0.00100 (notional on a subscription)");
	});
});

describe("JSON output is the run result with provider, model and usage", () => {
	it("Scenario: JSON output carries usage", async () => {
		const r = await cli(["run", TRIAGE, "--provider", "claude-code", "--model", "haiku", "--json"], {}, true);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout) as Record<string, unknown>;
		expect(Object.keys(out)).toEqual(expect.arrayContaining(["provider", "model", "kind", "steps", "variables", "usage"]));
		expect(out).toMatchObject({
			provider: "claude-code",
			model: "haiku",
			kind: "completed",
			variables: { severity: "high", summary: "Crashes outside git." },
			usage: { in: 10, out: 5, cost: 0.001 },
		});
		expect((out.steps as unknown[]).length).toBe(1);
	});
});

/** A script file in `dir`, and a fresh workspace directory beside it. */
function scriptAndWorkspace(name: string, source: string): { script: string; workspace: string } {
	const script = join(dir, `${name}.agent`);
	writeFileSync(script, source);
	return { script, workspace: mkdtempSync(join(dir, `${name}-ws-`)) };
}

const jsonLines = (path: string): unknown[] =>
	readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as unknown);

const chats = (o: FakeOllama) => o.requests.filter((q) => q.method === "POST" && q.path === "/v1/chat/completions");

describe("run loads tools from --tools modules", () => {
	it("Scenario: A script calls a tool from a module", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "unused" } });
		const { script } = scriptAndWorkspace("run-echo", RUN_ECHO());
		const r = await cli(
			["run", script, "--provider", "ollama", "--model", "qwen3:8b", "--tools", join(TOOLS, "echo.mjs"), "--json"],
			{ OLLAMA_HOST: ollama.url },
		);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout) as { kind: string; variables: Record<string, unknown> };
		expect(out.kind).toBe("completed");
		expect(out.variables.out).toBe("hi");
		expect(chats(ollama)).toEqual([]);
	});

	it("Scenario: The model calls an offered tool from a module", async () => {
		ollama = await startFakeOllama({
			models: ["qwen3:8b"],
			reply: (body) => {
				const messages = (body as { messages?: { role: string }[] }).messages ?? [];
				return messages.some((m) => m.role === "tool")
					? { text: "Echoed." }
					: { toolCall: { name: "say", arguments: { text: "from the model" } } };
			},
		});
		const { script, workspace } = scriptAndWorkspace("offer-echo", OFFER_ECHO);
		const r = await cli(
			[
				"run", script, "--provider", "ollama", "--model", "qwen3:8b",
				"--tools", join(TOOLS, "recording.mjs"), "--workspace", workspace, "--json",
			],
			{ OLLAMA_HOST: ollama.url },
		);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout) as { kind: string; variables: Record<string, unknown> };
		expect(out.kind).toBe("completed");
		expect(jsonLines(join(workspace, "echo-calls.jsonl"))).toEqual([{ text: "from the model" }]);
		expect(out.variables.out).toBe("from the model");
		const offered = (chats(ollama)[0]!.body as { tools?: { function: { name: string } }[] }).tools ?? [];
		expect(offered.map((t) => t.function.name)).toEqual(["say"]);
	});

	it("Scenario: A function export gets the workspace", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "unused" } });
		const { script, workspace } = scriptAndWorkspace("fn-workspace", RUN_ECHO());
		// An unnormalised path: the module must see it resolved.
		const r = await cli(
			[
				"run", script, "--provider", "ollama", "--model", "qwen3:8b",
				"--tools", join(TOOLS, "recording.mjs"), "--workspace", `${workspace}/sub/..`,
			],
			{ OLLAMA_HOST: ollama.url },
		);
		expect(r.code).toBe(0);
		expect(jsonLines(join(workspace, "tools-calls.jsonl"))).toEqual([{ workspace }]);
	});
});

describe("A bad tools module or binding is refused before any model call", () => {
	it("Scenario: An entry without execute is refused", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "never" } });
		const module = join(TOOLS, "no-execute.mjs");
		const r = await cli(["run", hello, "--provider", "ollama", "--model", "qwen3:8b", "--tools", module], {
			OLLAMA_HOST: ollama.url,
		});
		expect(r.stderr).toContain("--tools");
		expect(r.stderr).toContain(module);
		expect(r.stderr).toContain("execute");
		expect(r.code).toBe(2);
		expect(r.stdout).toBe("");
		expect(ollama.requests).toEqual([]);
	});

	it("Scenario: A script naming a missing tool is refused", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "never" } });
		const { script } = scriptAndWorkspace("run-nowhere", RUN_ECHO("nowhere"));
		const r = await cli(
			["run", script, "--provider", "ollama", "--model", "qwen3:8b", "--tools", join(TOOLS, "echo.mjs")],
			{ OLLAMA_HOST: ollama.url },
		);
		expect(r.stderr).toContain("mcpTool://nowhere is not registered on this host");
		expect(r.code).toBe(2);
		expect(ollama.requests).toEqual([]);
	});

	it("Scenario: Without --tools nothing changes", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "hello" } });
		const r = await cli(["run", hello, "--provider", "ollama", "--model", "qwen3:8b"], { OLLAMA_HOST: ollama.url });
		expect(r.code).toBe(0);
		expect(r.stdout.startsWith("# ollama/qwen3:8b — completed")).toBe(true);
		const sent = chats(ollama);
		expect(sent).toHaveLength(1);
		expect((sent[0]!.body as { tools?: unknown[] }).tools ?? []).toEqual([]);
	});

	it("without --tools, a script that runs an action still fails as before", async () => {
		const { script } = scriptAndWorkspace("run-no-tools", RUN_ECHO());
		const r = await cli(["run", script]);
		expect(r.stderr).toContain("NoActionHostError");
		expect(r.code).toBe(1);
	});
});

const MCP_FIXTURE = join(PKG_DIR, "__tests__", "fixtures", "mcp", "server.mjs");
const MCP_PID = join(PKG_DIR, "__tests__", "fixtures", "mcp", "pid.mjs");

/** An `--mcp` file in `dir` holding `content` as JSON. */
function mcpFile(name: string, content: unknown): string {
	const path = join(dir, `${name}.mcp.json`);
	writeFileSync(path, JSON.stringify(content));
	return path;
}

/** The stdio fixture as an `mcpServers` entry, writing its pid to `pidFile`. */
const fixtureServer = (pidFile: string, env: Record<string, string> = {}) => ({
	command: process.execPath,
	args: ["--import", pathToFileURL(MCP_PID).href, MCP_FIXTURE],
	env: { PID_FILE: pidFile, ...env },
});

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Whether `pid` exits within a short grace period. */
async function exited(pid: number): Promise<boolean> {
	for (const deadline = Date.now() + 2000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 20))) {
		if (!alive(pid)) return true;
	}
	return !alive(pid);
}

describe("run loads MCP servers from --mcp files", () => {
	it("Scenario: A script calls an MCP tool", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "unused" } });
		const { script, workspace } = scriptAndWorkspace("run-mcp-echo", RUN_ECHO("fx/echo"));
		const pidFile = join(workspace, "fx.pid");
		const mcp = mcpFile("fx", { mcpServers: { fx: fixtureServer(pidFile) } });
		const r = await cli(["run", script, "--provider", "ollama", "--model", "qwen3:8b", "--mcp", mcp, "--json"], {
			OLLAMA_HOST: ollama.url,
		});
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout) as { kind: string; variables: Record<string, unknown> };
		expect(out.kind).toBe("completed");
		expect(out.variables.out).toBe("hi");
		expect(r.stderr).toContain("mcp: skipped fx/tags: required parameter tags is array");
		expect(await exited(Number(readFileSync(pidFile, "utf8")))).toBe(true);
	});
});

describe("A bad --mcp file or server is refused before any model call", () => {
	it("Scenario: A file without mcpServers is refused", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "never" } });
		const r = await cli(["run", hello, "--provider", "ollama", "--model", "qwen3:8b", "--mcp", mcpFile("empty", {})], {
			OLLAMA_HOST: ollama.url,
		});
		expect(r.stderr).toContain("--mcp");
		expect(r.stderr).toContain("mcpServers");
		expect(r.code).toBe(2);
		expect(ollama.requests).toEqual([]);
	});

	it("Scenario: A server that will not start is refused", async () => {
		ollama = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "never" } });
		const pidFile = join(dir, "bad.pid");
		const mcp = mcpFile("bad", { mcpServers: { bad: fixtureServer(pidFile, { CRASH: "1" }) } });
		const r = await cli(["run", hello, "--provider", "ollama", "--model", "qwen3:8b", "--mcp", mcp], {
			OLLAMA_HOST: ollama.url,
		});
		expect(r.stderr).toContain('mcp server "bad"');
		expect(r.code).toBe(2);
		expect(r.stdout).toBe("");
		expect(ollama.requests).toEqual([]);
	});

	it("a server name repeated across files is refused", async () => {
		const first = mcpFile("dup-a", { mcpServers: { fx: { command: "never-run" } } });
		const second = mcpFile("dup-b", { mcpServers: { fx: { command: "never-run" } } });
		const r = await cli(["run", hello, "--mcp", first, "--mcp", second]);
		expect(r.stderr).toContain(`--mcp ${second}: server "fx" is already defined in ${first}`);
		expect(r.code).toBe(2);
	});
});

describe("The exit code is the run's kind", () => {
	it("Scenario: A failed run exits 1", async () => {
		const r = await cli(["run", TRIAGE, "--provider", "claude-code"], { FAKE_CLAUDE_MODE: "error" }, true);
		expect(r.stdout.startsWith("# claude-code/claude-haiku-4-5 — failed")).toBe(true);
		expect(r.stdout).toContain("rate_limit: rate limited");
		expect(r.code).toBe(1);
	});
});
