import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage, type ModelRef } from "@earendil-works/pi-durable";
import {
	createAgentHarness,
	runScript,
	type HostAction,
	type ModelFactory,
	type Workspace,
} from "../../src/durable/index.js";
import { localWorkspace } from "../../src/node/index.js";
import { OFFERING } from "./action-scripts.js";
import { context } from "./helpers.js";

/** Every provider set on a `Models` collection, in order. */
const registered = vi.hoisted(() => [] as unknown[]);
vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
	const original = await importOriginal<typeof import("@earendil-works/pi-ai")>();
	return {
		...original,
		createModels: (...args: Parameters<typeof original.createModels>) => {
			const models = original.createModels(...args);
			const setProvider = models.setProvider.bind(models);
			models.setProvider = (provider) => {
				registered.push(provider);
				setProvider(provider);
			};
			return models;
		},
	};
});

const HERE = dirname(fileURLToPath(import.meta.url));
// `no-default.ts` must fail and `with-default.ts` must pass; the package's tsconfig excludes them.
const TYPES_FIXTURE = join(HERE, "fixtures", "agent-config-types", "tsconfig.json");
const TSC = createRequire(import.meta.url).resolve("typescript/bin/tsc");

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	registered.length = 0;
});

function gitDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "agentscript-agent-config-"));
	dirs.push(dir);
	execFileSync("git", ["init", "-q"], { cwd: dir });
	return dir;
}

function refOf(faux: ReturnType<typeof fauxProvider>, modelId?: string): ModelRef {
	const model = modelId === undefined ? faux.getModel() : faux.getModel(modelId)!;
	return { provider: model.provider, modelId: model.id };
}

const lookup: HostAction = {
	name: "lookup",
	kind: "read",
	inputs: { key: "string" },
	outputs: { value: "string" },
	replay: "safe",
	execute: async () => ({ ok: true, outputs: { value: "found" } }),
};

describe("host/agent-config: the durable entry exports the config types", () => {
	it("Scenario: A config without a default model does not type-check", () => {
		const tsc = spawnSync(process.execPath, [TSC, "--noEmit", "--pretty", "false", "-p", TYPES_FIXTURE], {
			cwd: dirname(TYPES_FIXTURE),
			encoding: "utf8",
		});
		const errors = tsc.stdout.split("\n").filter((line) => line.includes("error TS"));

		expect(tsc.status).not.toBe(0);
		expect(errors.length).toBeGreaterThan(0);
		for (const error of errors) {
			expect(error).toMatch(/^no-default\.ts\(/);
			expect(error).toContain("default");
		}
	}, 60_000);
});

describe("host/agent-config: createAgentHarness builds a harness from a config", () => {
	it("Scenario: A script runs on the config's default model in its workspace", async () => {
		const dir = gitDir();
		const faux = fauxProvider();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("note", { content: "from the default model" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Noted.")]),
		]);
		const { harness, models } = await createAgentHarness(
			{ models: { default: () => ({ provider: faux.provider, model: refOf(faux) }) }, workspace: () => localWorkspace(dir) },
			{ storage: new MemoryStorage(), env: {}, context },
		);
		const result = await runScript(harness, OFFERING, { model: models.default }, context);
		await harness.close(context);

		expect(result.kind).toBe("completed");
		expect(readFileSync(join(dir, "NOTES.md"), "utf8")).toBe("from the default model");
	});

	it("Scenario: A host's own action sits beside the built-ins", async () => {
		const faux = fauxProvider();
		const { harness, actions } = await createAgentHarness(
			{
				models: { default: () => ({ provider: faux.provider, model: refOf(faux) }) },
				workspace: () => localWorkspace(gitDir()),
				actions: () => [lookup],
			},
			{ storage: new MemoryStorage(), env: {}, context },
		);
		await harness.close(context);

		expect([...actions.keys()]).toEqual(["read_file", "edit_file", "run_command", "run_checks", "lookup"]);
	});
});

describe("host/agent-config: every model closure is called once and its provider registered once", () => {
	it("Scenario: Two models on one provider", async () => {
		const faux = fauxProvider({ models: [{ id: "faux-main" }, { id: "faux-reviewer" }] });
		const mainFactory = vi.fn<ModelFactory<{}>>(() => ({ provider: faux.provider, model: refOf(faux, "faux-main") }));
		const reviewerFactory = vi.fn<ModelFactory<{}>>(() => ({ provider: faux.provider, model: refOf(faux, "faux-reviewer") }));
		const env = {};

		const { harness, models } = await createAgentHarness(
			{ models: { default: mainFactory, reviewer: reviewerFactory }, workspace: () => localWorkspace(gitDir()) },
			{ storage: new MemoryStorage(), env, context },
		);
		await harness.close(context);

		expect(mainFactory).toHaveBeenCalledTimes(1);
		expect(reviewerFactory).toHaveBeenCalledTimes(1);
		expect(mainFactory.mock.calls[0]![0]).toBe(env);
		expect(reviewerFactory.mock.calls[0]![0]).toBe(env);
		expect(mainFactory.mock.invocationCallOrder[0]).toBeLessThan(reviewerFactory.mock.invocationCallOrder[0]!);
		expect(models).toEqual({ default: refOf(faux, "faux-main"), reviewer: refOf(faux, "faux-reviewer") });
		expect(registered).toEqual([faux.provider]);
		expect(registered[0]).toBe(faux.provider);
	});

	it("Scenario: A provider name clash is refused", async () => {
		const first = fauxProvider();
		const second = fauxProvider();
		expect(first.provider.id).toBe("faux");
		expect(second.provider.id).toBe("faux");

		await expect(
			createAgentHarness(
				{
					models: {
						default: () => ({ provider: first.provider, model: refOf(first) }),
						reviewer: () => ({ provider: second.provider, model: refOf(second) }),
					},
					workspace: () => localWorkspace(gitDir()),
				},
				{ storage: new MemoryStorage(), env: {}, context },
			),
		).rejects.toThrow('models "default" and "reviewer" both use provider "faux" with different provider objects');
	});
});

describe("createAgentHarness before delegation lands", () => {
	it("refuses a config that grants a delegate", async () => {
		const faux = fauxProvider();
		await expect(
			createAgentHarness(
				{
					models: { default: () => ({ provider: faux.provider, model: refOf(faux) }) },
					workspace: () => localWorkspace(gitDir()),
					delegates: { claude_code: { runner: "claude-code" } },
				},
				{ storage: new MemoryStorage(), env: {}, context },
			),
		).rejects.toThrow("delegates are not supported yet (granted: claude_code)");
	});
});

describe("host/agent-config: the environment reaches every closure", () => {
	it("Scenario: A binding-like value reaches the model factory", async () => {
		const fakeBinding = { run: () => undefined };
		const env = { AI: fakeBinding };
		const faux = fauxProvider();
		const seen: { factory?: unknown; workspace?: unknown; actions?: unknown } = {};
		const dir = gitDir();
		let built: Workspace | undefined;

		const result = await createAgentHarness(
			{
				models: {
					default: (e) => {
						seen.factory = e.AI;
						return { provider: faux.provider, model: refOf(faux) };
					},
				},
				workspace: (e) => {
					seen.workspace = e;
					built = localWorkspace(dir);
					return Promise.resolve(built);
				},
				actions: (e, workspace) => {
					seen.actions = e;
					expect(workspace).toBe(built);
					return [];
				},
			},
			{ storage: new MemoryStorage(), env, context },
		);
		await result.harness.close(context);

		expect(seen.factory).toBe(fakeBinding);
		expect(seen.workspace).toBe(env);
		expect(seen.actions).toBe(env);
		expect(result.workspace).toBe(built);
	});
});
