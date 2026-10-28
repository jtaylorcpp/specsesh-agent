import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, main, parseVar } from "../../src/bin/agentscript-durable.js";
import { RESULT_TOOL, startScript, waitForScript } from "../../src/durable/index.js";
import { closedPortUrl, type FakeOllama, startFakeOllama } from "../pi/fake-ollama.js";
import { ENTRIES, HELLO, HELLO_ENTRIES, openHarness, PIPELINE, setup } from "./helpers.js";

// The real claude-code provider spawns the user's `claude` binary. Stand in a faux provider under
// its id, so the default model collection can be exercised without one.
const claudeCode = vi.hoisted(() => ({ faux: undefined as undefined | { state: { callCount: number } }, built: 0 }));
vi.mock("../../src/claude-code/index.js", async () => {
	const { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } = await import("@earendil-works/pi-ai");
	return {
		claudeCodeProvider: () => {
			claudeCode.built += 1;
			const faux = fauxProvider({ provider: "claude-code", models: [{ id: "claude-haiku-4-5" }, { id: "haiku" }] });
			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("submit_result", { severity: "high" })], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxText("Via claude-code.")]),
			]);
			claudeCode.faux = faux;
			return faux.provider;
		},
	};
});

const HERE = dirname(fileURLToPath(import.meta.url));
// Plain Node runs the TypeScript fixtures; this hook maps their `.js` imports to `.ts`.
const TS_HOOK = join(HERE, "fixtures", "ts-resolve.mjs");
const dirs: string[] = [];
const savedEnv = { provider: process.env.AGENTSCRIPT_PROVIDER, model: process.env.AGENTSCRIPT_MODEL };
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
	for (const [key, value] of [["AGENTSCRIPT_PROVIDER", savedEnv.provider], ["AGENTSCRIPT_MODEL", savedEnv.model]] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

function workdir() {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-cli-"));
	dirs.push(dir);
	const script = join(dir, "pipeline.agent");
	writeFileSync(script, PIPELINE);
	return { dir, script, db: join(dir, "runs.sqlite") };
}

/** Run main() in-process against the faux provider, capturing its output. */
async function cli(argv: string[], env = setup()) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(argv, { models: () => env.models, out: (l) => out.push(l), err: (l) => err.push(l) });
	return { code, out: out.join("\n"), err: err.join("\n"), env };
}

const fauxArgs = (env: ReturnType<typeof setup>) => ["--provider", env.model.provider, "--model", env.model.modelId];

const TOOLS = join(HERE, "..", "fixtures", "tools");

/** A deterministic subagent that runs `echo` (from `fixtures/tools/echo.mjs`) and sets `out`: no model step. */
const RUN_ECHO = `config:
    agent_name: "run-echo"

variables:
    out: mutable string = ""

subagent act:
    description: "Echo without the model"

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
            run @actions.echo
                with text = "hi"
                set @variables.out = @outputs.text
`;

function echoWorkdir() {
	const w = workdir();
	const script = join(w.dir, "run-echo.agent");
	writeFileSync(script, RUN_ECHO);
	return { ...w, script };
}

describe("agentscript-durable run", () => {
	it("runs a script to completion on a SQLite database and prints the task ID first", async () => {
		const { script, db } = workdir();
		const env = setup();
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "high" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("On it.")]),
		]);
		const r = await cli(["run", script, "--db", db, ...fauxArgs(env), "--entry", "classify", "--entry", "gate", "--entry", "respond"], env);
		expect(r.code).toBe(0);
		expect(r.err).toMatch(/^task \d+ — resume with: agentscript-durable resume \d+ --db /);
		expect(r.out).toContain("— completed");
		expect(r.out).toContain('urgent = true');
		expect(r.out).toContain("On it.");
	});

	it("takes --var overrides and prints JSON with --json", async () => {
		const { script, db } = workdir();
		const env = setup();
		env.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "low" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("ok")]),
		]);
		const entries = ["--entry", "classify", "--entry", "gate", "--entry", "respond"];
		const r = await cli(["run", script, "--db", db, ...fauxArgs(env), ...entries, "--var", "report=slow", "--json"], env);
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.out);
		expect(parsed.kind).toBe("completed");
		expect(parsed.variables.report).toBe("slow");
		expect(parsed.steps[0].request.prompt).toBe("Classify: slow");
	});

	it("exits 1 when the run ends failed", async () => {
		const { script, db } = workdir();
		const env = setup();
		env.faux.setResponses([fauxAssistantMessage([fauxText("no tool call")])]);
		const r = await cli(["run", script, "--db", db, ...fauxArgs(env)], env);
		expect(r.code).toBe(1);
		expect(r.out).toContain("— failed");
	});

	it("refuses an unknown model before creating anything", async () => {
		const { script, db } = workdir();
		const r = await cli(["run", script, "--db", db, "--provider", "faux", "--model", "nope"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain('no model "nope" on provider "faux"');
	});

	it("prints usage without --db or a command", async () => {
		expect((await cli(["run", "x.agent"])).code).toBe(2);
		expect((await cli(["frobnicate"])).err).toContain("usage:");
	});
});

describe("The CLI has exactly two commands and prints usage otherwise", () => {
	it("Scenario: No command prints usage", async () => {
		const r = await cli([]);
		expect(r.err).toContain("usage:");
		expect(r.code).toBe(2);
	});
});

describe("Both commands require a target and a database", () => {
	it("Scenario: resume without a task ID prints usage", async () => {
		const { db } = workdir();
		const r = await cli(["resume", "--db", db]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
		// refused before any database is opened
		expect(existsSync(db)).toBe(false);
	});
});

describe("The CLI opens a durable SQLite harness with both extensions", () => {
	it("Scenario: The harness is closed after a refusal", async () => {
		const { script, db } = workdir();
		const open = Harness.open.bind(Harness);
		let closed: ReturnType<typeof vi.fn> | undefined;
		vi.spyOn(Harness, "open").mockImplementation(async (...args) => {
			const harness = await open(...args);
			const close = harness.close.bind(harness);
			closed = vi.fn(close);
			harness.close = closed as typeof harness.close;
			return harness;
		});

		const r = await cli(["run", script, "--db", db, "--provider", "faux", "--model", "nope"]);

		expect(r.code).toBe(2);
		expect(closed).toBeDefined();
		expect(closed).toHaveBeenCalledTimes(1);
	});

	it("Scenario: A durable run calls a tool from a module", async () => {
		const { script, db } = echoWorkdir();
		const env = setup();
		const r = await cli(["run", script, "--db", db, ...fauxArgs(env), "--tools", join(TOOLS, "echo.mjs"), "--json"], env);

		expect(r.err).not.toContain("ActionBindingError");
		expect(r.code).toBe(0);
		expect(JSON.parse(r.out).variables.out).toBe("hi");
		// a logic-only subagent: the tool ran without the model
		expect(env.requests).toHaveLength(0);
	});
});

describe("run and resume take --tools and --workspace", () => {
	it("Scenario: The resume hint repeats the tools", async () => {
		const { dir, script, db } = echoWorkdir();
		copyFileSync(join(TOOLS, "echo.mjs"), join(dir, "t.mjs"));
		vi.spyOn(process, "cwd").mockReturnValue(dir);
		const env = setup();

		const r = await cli(["run", script, "--db", db, ...fauxArgs(env), "--tools", "./t.mjs"], env);

		expect(r.code).toBe(0);
		const id = /^task (\d+) /.exec(r.err)?.[1];
		expect(id).toMatch(/^\d+$/);
		expect(r.err).toContain(`agentscript-durable resume ${id} --db ${db} --tools ./t.mjs`);
	});

	it("Scenario: A bad tools module is refused before the database opens", async () => {
		const { script, db } = echoWorkdir();
		const module = join(TOOLS, "throws.mjs");

		const r = await cli(["run", script, "--db", db, "--tools", module]);

		expect(r.code).toBe(2);
		expect(r.err).toContain(`--tools ${module}`);
		// refused before the database is opened, so no task can exist
		expect(existsSync(db)).toBe(false);
	});
});

describe("resume re-checks the stored script against its tools", () => {
	const echo = join(TOOLS, "echo.mjs");

	/** Runs ECHO_THEN_RESPOND with `--tools` in a child killed on its first model request; returns the task ID. */
	function crashToolRun(db: string) {
		let id = "";
		let status: number | null = 0;
		try {
			execFileSync(process.execPath, ["--import", TS_HOOK, join(HERE, "fixtures", "crash-tool-run.ts"), db, echo], { encoding: "utf8" });
		} catch (error) {
			const e = error as { stdout: string; status: number | null };
			status = e.status;
			id = /task (\d+) — resume with/.exec(e.stdout)?.[1] ?? "";
		}
		expect(status).toBe(137);
		expect(id).toMatch(/^\d+$/);
		return id;
	}

	it("Scenario: A crashed tool run resumes with its tools", async () => {
		const { db } = workdir();
		const id = crashToolRun(db);

		const env = setup();
		env.faux.setResponses([fauxAssistantMessage([fauxText("Said hi.")])]);
		const r = await cli(["resume", id, "--db", db, "--tools", echo, "--json"], env);

		expect(r.err).toBe("");
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.out);
		expect(parsed.kind).toBe("completed");
		expect(parsed.variables.out).toBe("hi");
		// only `respond` asked the model again
		expect(env.requests).toHaveLength(1);
	}, 90_000);

	it("Scenario: A resume without the tools is refused", async () => {
		const { db } = workdir();
		const id = crashToolRun(db);

		const env = setup();
		const r = await cli(["resume", id, "--db", db], env);

		expect(r.err).toContain("mcpTool://echo is not registered on this host");
		expect(r.code).toBe(2);
		expect(env.requests).toHaveLength(0);
		// nothing resumed: the task is still there to finish with its tools
		const again = setup();
		again.faux.setResponses([fauxAssistantMessage([fauxText("Said hi.")])]);
		expect((await cli(["resume", id, "--db", db, "--tools", echo], again)).code).toBe(0);
	}, 90_000);
});

describe("The model collection defaults to every built-in provider plus claude-code", () => {
	it("Scenario: claude-code is a selectable provider", async () => {
		const { script, db } = workdir();
		const out: string[] = [];
		const err: string[] = [];
		const built = claudeCode.built;

		// no deps.models: the CLI builds its own collection
		const argv = ["run", script, "--db", db, "--provider", "claude-code", "--model", "claude-haiku-4-5", "--entry", "classify", "--entry", "gate", "--entry", "respond"];
		const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });

		expect(err.join("\n")).not.toContain("no model");
		expect(claudeCode.built).toBe(built + 1);
		expect(code).toBe(0);
		expect(out.join("\n")).toContain("— completed");
		// each of the two model steps went to the claude-code provider
		expect(claudeCode.faux?.state.callCount).toBe(2);
	});
});

describe("run resolves provider and model from flag, then environment, then defaults", () => {
	/** A collection with a faux provider for each of the given provider/model pairs. */
	function collection(pairs: [string, string][]) {
		const models = createModels();
		const fauxes = pairs.map(([provider, id]) => {
			const faux = fauxProvider({ provider, models: [{ id }] });
			models.setProvider(faux.provider);
			return faux;
		});
		return { models, fauxes };
	}
	const answers = [
		fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "high" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	];
	const entries = ["--entry", "classify", "--entry", "gate", "--entry", "respond"];

	async function runWith(argv: string[], pairs: [string, string][], answering: number) {
		const { models, fauxes } = collection(pairs);
		fauxes[answering]!.setResponses(answers);
		const out: string[] = [];
		const err: string[] = [];
		const code = await main(argv, { models: () => models, out: (l) => out.push(l), err: (l) => err.push(l) });
		return { code, out: out.join("\n"), err: err.join("\n"), calls: fauxes.map((f) => f.state.callCount) };
	}

	it("Scenario: Environment variables pick the model when flags are absent", async () => {
		const { script, db } = workdir();
		process.env.AGENTSCRIPT_PROVIDER = "claude-code";
		process.env.AGENTSCRIPT_MODEL = "haiku";

		const r = await runWith(["run", script, "--db", db, ...entries], [[DEFAULT_PROVIDER, DEFAULT_MODEL], ["claude-code", "haiku"]], 1);

		expect(r.code).toBe(0);
		expect(r.calls).toEqual([0, 2]);
	});

	it("Scenario: Defaults apply when nothing is set", async () => {
		const { script, db } = workdir();
		delete process.env.AGENTSCRIPT_PROVIDER;
		delete process.env.AGENTSCRIPT_MODEL;

		const r = await runWith(["run", script, "--db", db, ...entries], [[DEFAULT_PROVIDER, DEFAULT_MODEL], ["claude-code", "haiku"]], 0);

		expect(DEFAULT_PROVIDER).toBe("anthropic");
		expect(DEFAULT_MODEL).toBe("claude-haiku-4-5");
		expect(r.code).toBe(0);
		expect(r.calls).toEqual([2, 0]);
	});

	it("takes the flags over the environment", async () => {
		const { script, db } = workdir();
		process.env.AGENTSCRIPT_PROVIDER = "claude-code";
		process.env.AGENTSCRIPT_MODEL = "haiku";

		const r = await runWith(["run", script, "--db", db, "--provider", "anthropic", "--model", "claude-haiku-4-5", ...entries], [[DEFAULT_PROVIDER, DEFAULT_MODEL], ["claude-code", "haiku"]], 0);

		expect(r.code).toBe(0);
		expect(r.calls).toEqual([2, 0]);
	});

	it("Scenario: An unknown model is refused before a task exists", async () => {
		const { script, db } = workdir();
		const r = await cli(["run", script, "--db", db, "--provider", "faux", "--model", "nope"]);
		expect(r.err).toContain('no model "nope" on provider "faux"');
		expect(r.code).toBe(2);
		const storage = await openNodeSqliteStorage(db);
		const tasks = await storage.scanTasks({}, 10, undefined, BACKGROUND_CONTEXT);
		await storage.close(BACKGROUND_CONTEXT);
		expect(tasks.items).toEqual([]);
	});
});

describe("Text output reports each step and the final variables", () => {
	it("Scenario: A failed step prints its category and message", async () => {
		const { script, db } = workdir();
		const env = setup();
		env.faux.setResponses([fauxAssistantMessage([fauxToolCall(RESULT_TOOL, { severity: "high" })], { stopReason: "toolUse" })]); // respond has no answer
		const r = await cli(["run", script, "--db", db, ...fauxArgs(env), "--entry", "classify", "--entry", "gate", "--entry", "respond"], env);

		const lines = r.out.split("\n");
		const heading = lines.indexOf("## step 2: respond → failed");
		expect(heading).toBeGreaterThan(0);
		expect(lines[heading + 1]).toMatch(/^unknown: the step was not answered: /);
		expect(r.code).toBe(1);
	});
});

describe("Both commands resume the harness and wait for the run", () => {
	it("Scenario: An aborted run exits 1 with the reason", async () => {
		const { dir, db } = workdir();
		// A task that ended aborted, in the file the CLI will read.
		const env = setup();
		const harness = await openHarness(await openNodeSqliteStorage(db), env);
		const id = await startScript(harness, PIPELINE, { entry: ENTRIES, model: env.model }, BACKGROUND_CONTEXT);
		await harness.abortTask(id, BACKGROUND_CONTEXT);
		await expect(waitForScript(harness, id, BACKGROUND_CONTEXT)).rejects.toThrow(/ended aborted/);
		await harness.close(BACKGROUND_CONTEXT);

		// main lets the error out ...
		await expect(cli(["resume", String(id), "--db", db])).rejects.toThrow(/ended aborted/);

		// ... and the bin entry point turns it into stderr and exit 1.
		let status: number | null = 0;
		let stderr = "";
		try {
			execFileSync(process.execPath, [join(HERE, "..", "..", "dist", "bin", "agentscript-durable.js"), "resume", String(id), "--db", db], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				cwd: dir,
				timeout: 60_000,
			});
		} catch (error) {
			const e = error as { status?: number | null; stderr?: string };
			status = e.status ?? null;
			stderr = e.stderr ?? "";
		}
		expect(status).toBe(1);
		expect(stderr).toContain("ended aborted");
	}, 90_000);
});

describe("agentscript-durable resume", () => {
	it("finishes a run whose process crashed, from the same database", async () => {
		const { db } = workdir();
		let id = "";
		try {
			execFileSync(process.execPath, ["--import", TS_HOOK, join(HERE, "fixtures", "crash-child.ts"), db, "2"], { encoding: "utf8" });
		} catch (error) {
			id = /TASK (\d+)/.exec((error as { stdout: string }).stdout)?.[1] ?? "";
		}
		expect(id).toMatch(/^\d+$/);

		const env = setup();
		env.faux.setResponses([fauxAssistantMessage([fauxText("Escalated.")])]);
		const r = await cli(["resume", id, "--db", db], env);
		expect(r.code).toBe(0);
		expect(r.out).toContain(`# task ${id} — completed`);
		expect(r.out).toContain("Escalated.");
		expect(r.out).toContain("urgent = true");
		expect(r.env.requests).toHaveLength(1);
	}, 90_000);

	it("refuses a task ID that is not in the database", async () => {
		const { db } = workdir();
		const r = await cli(["resume", "999", "--db", db]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("no task 999");
	});

	it("Scenario: A non-integer task ID is refused", async () => {
		const { db } = workdir();
		const r = await cli(["resume", "abc", "--db", db]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("no task abc");
	});
});

describe("ollama is registered when the run needs it", () => {
	const savedHost = process.env.OLLAMA_HOST;
	const fakes: FakeOllama[] = [];
	afterEach(async () => {
		for (const fake of fakes.splice(0)) await fake.close();
		if (savedHost === undefined) delete process.env.OLLAMA_HOST;
		else process.env.OLLAMA_HOST = savedHost;
	});

	async function fakeOllama() {
		const fake = await startFakeOllama({ models: ["qwen3:8b"], reply: { text: "Hello, Ada." } });
		fakes.push(fake);
		process.env.OLLAMA_HOST = fake.url;
		return fake;
	}

	function helloWorkdir() {
		const w = workdir();
		const script = join(w.dir, "hello.agent");
		writeFileSync(script, HELLO);
		return { ...w, script };
	}

	/** main() on the CLI's own collection (no deps.models), capturing its output. */
	async function ownCli(argv: string[]) {
		const out: string[] = [];
		const err: string[] = [];
		const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
		return { code, out: out.join("\n"), err: err.join("\n") };
	}

	const chats = (fake: FakeOllama) => fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/chat/completions");
	const entries = HELLO_ENTRIES.flatMap((e) => ["--entry", e]);

	it("Scenario: A durable run completes on a pulled ollama model", async () => {
		const { script, db } = helloWorkdir();
		const fake = await fakeOllama();

		const r = await ownCli(["run", script, "--db", db, "--provider", "ollama", "--model", "qwen3:8b", ...entries]);

		expect(r.code).toBe(0);
		expect(r.out).toContain("completed");
		// one chat request per step, each on the pulled model
		expect(chats(fake)).toHaveLength(2);
		for (const chat of chats(fake)) expect((chat.body as { model?: string }).model).toBe("qwen3:8b");
	});

	it("Scenario: Other providers never contact Ollama", async () => {
		const { script, db } = helloWorkdir();
		const fake = await fakeOllama();

		const r = await ownCli(["run", script, "--db", db, "--provider", "anthropic", "--model", "claude-nope"]);

		expect(r.code).toBe(2);
		expect(fake.requests).toEqual([]);
	});

	it("Scenario: An unreachable ollama is named in the refusal", async () => {
		const { script, db } = helloWorkdir();
		const url = await closedPortUrl();
		process.env.OLLAMA_HOST = url;

		const r = await ownCli(["run", script, "--db", db, "--provider", "ollama", "--model", "qwen3:8b"]);

		expect(r.err).toContain(`no model "qwen3:8b" on provider "ollama" (Ollama at ${url}`);
		expect(r.code).toBe(2);
		const storage = await openNodeSqliteStorage(db);
		const tasks = await storage.scanTasks({}, 10, undefined, BACKGROUND_CONTEXT);
		await storage.close(BACKGROUND_CONTEXT);
		expect(tasks.items).toEqual([]);
	});

	it("Scenario: A crashed ollama run finishes on resume", async () => {
		const { db } = workdir();
		let id = "";
		let status: number | null = 0;
		try {
			execFileSync(process.execPath, ["--import", TS_HOOK, join(HERE, "fixtures", "crash-ollama-child.ts"), db], { encoding: "utf8" });
		} catch (error) {
			const e = error as { stdout: string; status: number | null };
			status = e.status;
			id = /TASK (\d+)/.exec(e.stdout)?.[1] ?? "";
		}
		expect(status).toBe(137);
		expect(id).toMatch(/^\d+$/);

		const fake = await fakeOllama();
		const r = await ownCli(["resume", id, "--db", db]);

		expect(r.code).toBe(0);
		expect(r.out).toContain(`# task ${id} — completed`);
		// only the second step (farewell) asked the model again
		expect(chats(fake)).toHaveLength(1);
		const sent = JSON.stringify(chats(fake)[0]!.body);
		expect(sent).toContain("Say goodbye to Ada.");
		expect(sent).not.toContain("Say hello to Ada.");
	}, 90_000);
});

describe("parseVar", () => {
	it.each([
		["a=b", ["a", "b"]],
		["n=2", ["n", 2]],
		["t=True", ["t", true]],
		["f=False", ["f", false]],
	])("%s", (raw, expected) => expect(parseVar(raw)).toEqual(expected));

	it("Scenario: Lower-case booleans and empty values stay strings", () => {
		expect(parseVar("t=true")).toEqual(["t", "true"]);
		expect(parseVar("e=")).toEqual(["e", ""]);
	});

	it("Scenario: A value may contain =", () => {
		expect(parseVar("q=a=b")).toEqual(["q", "a=b"]);
	});

	it("Scenario: A pair without a name is refused", () => {
		expect(() => parseVar("=x")).toThrow("--var expects name=value");
		expect(() => parseVar("novalue")).toThrow("--var expects name=value");
	});

	it.each([
		["n=-3", -3],
		["n=1.5", 1.5],
		["n=1.", "1."],
		["n=.5", ".5"],
		["n=1e3", "1e3"],
	])("types the number-like value in %s", (raw, expected) => expect(parseVar(raw)[1]).toBe(expected));
});
