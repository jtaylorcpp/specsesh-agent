// The `actions/delegation` grant scenarios: what a grant builds, and what a run refuses at start.
// Runs go through createAgentHarness on the faux provider over an in-memory workspace; no process starts.

import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import {
	ActionBindingError,
	DelegateGrantError,
	createActionRegistry,
	createAgentHarness,
	delegationActions,
	startScript,
	waitForScript,
	type DelegateGrants,
	type HostAction,
	type ProcessRunner,
	type Workspace,
} from "../../src/durable/index.js";
import { defaultRunners } from "../../src/node/index.js";
import { NO_DELEGATE, delegateTwice } from "./delegation-scripts.js";
import { context } from "./helpers.js";

/** Files in a Map; `exec` and `snapshot` only count their calls. */
function memWorkspace() {
	const files = new Map<string, string>();
	const calls = { exec: 0, snapshot: 0 };
	const workspace: Workspace = {
		root: "mem",
		async read(path) {
			const content = files.get(path);
			if (content === undefined) throw new Error(`no such file: ${path}`);
			return content;
		},
		async write(path, content) {
			files.set(path, content);
		},
		async exec() {
			calls.exec += 1;
			return { kind: "exited", code: 0, stdout: "", stderr: "" };
		},
		async snapshot() {
			calls.snapshot += 1;
			return new Map();
		},
	};
	return { workspace, calls };
}

const fakeRunner: ProcessRunner = {
	kind: "process",
	label: "Fake",
	grantKeys: {},
	prepare: () => ({ argv: ["true"], stdin: "", env: {} }),
	read: () => ({ ok: true, summary: "" }),
};

const runners = { "claude-code": fakeRunner };

/** (a) `run` on `mcpTool://delegate/claude_code` with the delegate signature. */
const DELEGATES = delegateTwice();
/** (b) the same, declaring an extra output `branch: string`. */
const DELEGATES_WITH_BRANCH = DELEGATES.replace("files_changed: number\n", "files_changed: number\n                branch: string\n");

/** Builds the harness on a faux model with `delegates` granted, and starts `source`. */
async function startWith(source: string, delegates: DelegateGrants | undefined) {
	const faux = fauxProvider();
	faux.setResponses([fauxAssistantMessage([fauxText("Hi.")])]);
	const model = faux.getModel();
	const mem = memWorkspace();
	const { harness, models } = await createAgentHarness(
		{
			models: { default: () => ({ provider: faux.provider, model: { provider: model.provider, modelId: model.id } }) },
			workspace: () => mem.workspace,
			...(delegates !== undefined ? { delegates } : {}),
			runners,
		},
		{ storage: new MemoryStorage(), env: {}, context },
	);
	const started = startScript(harness, source, { model: models.default }, context);
	return { harness, started, faux, calls: mem.calls };
}

async function refusal(source: string, delegates: DelegateGrants | undefined) {
	const { harness, started, faux, calls } = await startWith(source, delegates);
	const error = await started.catch((e: unknown) => e);
	await harness.close(context);
	expect(error).toBeInstanceOf(ActionBindingError);
	expect(faux.state.callCount).toBe(0);
	expect(calls.exec).toBe(0);
	return (error as Error).message;
}

function thrownBy(build: () => unknown): unknown {
	try {
		build();
	} catch (error) {
		return error;
	}
	return undefined;
}

describe("actions/delegation", () => {
	it("Scenario: One action per grant", () => {
		const { workspace } = memWorkspace();
		const actions = delegationActions({ claude_code: { runner: "claude-code" }, reviewer: { runner: "claude-code" } }, { workspace, runners });
		expect(actions.map((a) => a.name)).toEqual(["delegate/claude_code", "delegate/reviewer"]);
		for (const action of actions) {
			expect(action.kind).toBe("delegate");
			expect(action.replay).toBe("unsafe");
		}
	});

	it("Scenario: An extra output is refused at start", async () => {
		expect(DELEGATES_WITH_BRANCH).toContain("branch: string");
		const message = await refusal(DELEGATES_WITH_BRANCH, { claude_code: { runner: "claude-code" } });
		expect(message).toContain("branch");
	});

	it("Scenario: A hand-made delegate action is refused", () => {
		const handMade: HostAction = {
			name: "delegate/anything",
			kind: "delegate",
			inputs: { instructions: "string" },
			outputs: { ok: "boolean", summary: "string", files_changed: "number" },
			replay: "unsafe",
			execute: async () => ({ ok: true, outputs: { ok: true, summary: "", files_changed: 0 } }),
		};
		expect(() => createActionRegistry([handMade])).toThrow("delegate/anything");
	});

	it("Scenario: No grants", async () => {
		for (const delegates of [undefined, {}]) {
			const message = await refusal(DELEGATES, delegates);
			expect(message).toContain("delegate/claude_code");
			expect(message).toContain("no delegates are granted");
		}
	});

	it("Scenario: A different grant", async () => {
		const message = await refusal(DELEGATES, { reviewer: { runner: "claude-code" } });
		expect(message).toContain("delegate/claude_code");
		expect(message).toContain("reviewer");
	});

	it("Scenario: An unused grant is fine", async () => {
		const { harness, started } = await startWith(NO_DELEGATE, { claude_code: { runner: "claude-code" } });
		const id = await started;
		const result = await waitForScript(harness, id, context);
		await harness.close(context);
		expect(result.kind).toBe("completed");
	});

	it("Scenario: Another permission mode is refused", () => {
		const { workspace } = memWorkspace();
		const error = thrownBy(() =>
			delegationActions({ claude_code: { runner: "claude-code", permissionMode: "bypassPermissions" } }, { workspace, runners: defaultRunners }),
		);
		expect(error).toBeInstanceOf(DelegateGrantError);
		expect((error as Error).message).toContain("claude_code");
		expect((error as Error).message).toContain("permissionMode");
	});

	it("Scenario: An unknown runner is refused", () => {
		const { workspace } = memWorkspace();
		const error = thrownBy(() => delegationActions({ claude_code: { runner: "codex" } }, { workspace, runners }));
		expect(error).toBeInstanceOf(DelegateGrantError);
		for (const word of ["runner", "codex", "claude-code"]) expect((error as Error).message).toContain(word);
	});
});
