import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The real bin and the real claude-code provider (no vi.mock): only `claude` is faked, on PATH.
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(HERE, "..", "..");
const BIN = join(PKG_DIR, "dist", "bin", "agentscript-durable.js");
const ECHO_MODULE = join(HERE, "..", "fixtures", "tools", "echo.mjs");

/** A model step offering `echo` under its own name, whose output sets `out`. */
const OFFER_ECHO = `config:
    agent_name: "offer-echo"

variables:
    out: mutable string = ""

subagent act:
    description: "Echo through the model"

    actions:
        echo:
            description: "Echo the text"
            inputs:
                text: string
            outputs:
                text: string
            target: "mcpTool://echo"

    reasoning:
        instructions: ->
            | Echo something.
        actions:
            echo: @actions.echo
                with text = ...
                set @variables.out = @outputs.text
`;

/** The SDK client modules, by absolute path: the fake `claude` runs from a temp dir. */
const requireFromTest = createRequire(import.meta.url);
const SDK_CLIENT = requireFromTest.resolve("@modelcontextprotocol/sdk/client/index.js");
const SDK_HTTP = requireFromTest.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js");

/** A `claude` stand-in that calls the first allowed tool over MCP with `{ text: "hi" }` and answers with its text. */
const FAKE_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const argv = process.argv.slice(2);
async function callFirstTool() {
	const config = JSON.parse(fs.readFileSync(argv[argv.indexOf("--mcp-config") + 1], "utf8"));
	const { url, headers } = config.mcpServers.agentscript;
	const name = argv[argv.indexOf("--allowedTools") + 1].split(",")[0].replace(/^mcp__agentscript__/, "");
	const { Client } = require(${JSON.stringify(SDK_CLIENT)});
	const { StreamableHTTPClientTransport } = require(${JSON.stringify(SDK_HTTP)});
	const client = new Client({ name: "fake-claude", version: "0.0.0" });
	await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
	try {
		const result = await client.callTool({ name, arguments: { text: "hi" } });
		return result.content.map((c) => c.text).join("");
	} finally {
		await client.close();
	}
}
process.stdin.resume();
process.stdin.on("end", async () => {
	const text = argv.includes("--mcp-config") ? await callFirstTool() : "no tools";
	console.log(JSON.stringify({
		type: "result", subtype: "success", is_error: false, num_turns: 2,
		result: text,
		usage: { input_tokens: 10, output_tokens: 5 },
		total_cost_usd: 0.001,
	}));
});
`;

let dir: string;
let fakeBin: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "agentscript-durable-cc-tools-"));
	fakeBin = join(dir, "bin");
	mkdirSync(fakeBin);
	const claude = join(fakeBin, "claude");
	writeFileSync(claude, FAKE_CLAUDE);
	chmodSync(claude, 0o755);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

interface Cli {
	code: number | null;
	stdout: string;
	stderr: string;
}

/** Runs the built bin with the fake `claude` first on PATH; every credential and AGENTSCRIPT_* variable is stripped. */
function cli(args: string[]): Promise<Cli> {
	const env: Record<string, string | undefined> = { ...process.env };
	for (const key of Object.keys(env)) {
		if (/_API_KEY$|_TOKEN$/.test(key) || key.startsWith("AGENTSCRIPT_") || key === "CLAUDECODE") delete env[key];
	}
	env.PATH = `${fakeBin}:${process.env.PATH ?? ""}`;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [BIN, ...args], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
		child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

describe("claude-code durable runs offer tools through the bridge", () => {
	it("Scenario: A durable claude-code run calls a --tools tool", async () => {
		const script = join(dir, "offer-echo.agent");
		writeFileSync(script, OFFER_ECHO);
		const db = join(dir, "runs.sqlite");

		const r = await cli(["run", script, "--db", db, "--provider", "claude-code", "--tools", ECHO_MODULE, "--json"]);

		expect(r.stdout, r.stderr).not.toBe("");
		expect(r.code).toBe(0);
		const result = JSON.parse(r.stdout) as {
			kind: string;
			steps: { outcome: { toolCalls?: { name: string; inputs: unknown }[] } }[];
		};
		expect(result.kind).toBe("completed");
		// the step's recorded actions, read back from its step-actions doc
		const calls = result.steps.flatMap((step) => step.outcome.toolCalls ?? []);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ name: "echo", inputs: { text: "hi" } });
	}, 30_000);

	it("Scenario: The usage no longer refuses claude-code tools", async () => {
		const r = await cli([]);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("usage:");
		expect(r.stderr).not.toContain("a step that offers tools fails");
	}, 30_000);
});
