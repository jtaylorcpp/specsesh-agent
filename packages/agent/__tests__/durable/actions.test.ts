// Smoke tests of the reserved `delegate/` namespace and of binding an ungranted delegate.
// The `actions/delegation` scenarios are pinned in delegation-grants (2.4).

import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import {
	ActionBindingError,
	agentScriptExtensions,
	createActionRegistry,
	delegationActions,
	runScript,
	startScript,
	type DelegateGrants,
	type HostAction,
	type Workspace,
} from "../../src/durable/index.js";
import { delegateTwice, fakeClaudeRunner, NO_DELEGATE } from "./delegation-scripts.js";
import { context, openHarness, setup } from "./helpers.js";

const workspace: Workspace = {
	root: "memory",
	read: async () => "",
	write: async () => {},
};
const runners = { fake: fakeClaudeRunner("/nonexistent/claude") };

const handMade: HostAction = {
	name: "delegate/anything",
	kind: "delegate",
	inputs: { instructions: "string" },
	outputs: { ok: "boolean", summary: "string", files_changed: "number" },
	replay: "unsafe",
	execute: async () => ({ ok: true, outputs: { ok: true, summary: "", files_changed: 0 } }),
};

describe("the delegate/ namespace is reserved", () => {
	it("refuses a hand-made delegate/ action, naming it", () => {
		expect(() => createActionRegistry([handMade])).toThrow(
			"action delegate/anything: the delegate/ namespace is reserved for granted delegates (delegationActions)",
		);
	});

	it("refuses a copy of a granted delegate", () => {
		const [granted] = delegationActions({ anything: { runner: "fake" } }, { workspace, runners });
		expect(() => createActionRegistry([{ ...(granted as HostAction) }])).toThrow("delegate/anything");
	});

	it("accepts the actions delegationActions made, and still refuses a duplicate name", () => {
		const granted = delegationActions({ claude_code: { runner: "fake" }, reviewer: { runner: "fake" } }, { workspace, runners });
		expect([...createActionRegistry(granted).keys()]).toEqual(["delegate/claude_code", "delegate/reviewer"]);
		expect(() => createActionRegistry([...granted, granted[0] as HostAction])).toThrow('two host actions are named "delegate/claude_code"');
	});
});

describe("an ungranted delegate is refused at start, listing the grants", () => {
	async function start(source: string, grants: DelegateGrants) {
		const env = setup();
		const actions = createActionRegistry(delegationActions(grants, { workspace, runners }));
		const installed = agentScriptExtensions({ actions, workspace: "memory" });
		env.registry.install(installed.run);
		env.registry.install(installed.step);
		const harness = await openHarness(new MemoryStorage(), env);
		return { env, harness };
	}

	it("says no delegates are granted", async () => {
		const { env, harness } = await start(delegateTwice(), {});
		const error = await startScript(harness, delegateTwice(), { model: env.model }, context).catch((e: unknown) => e);
		await harness.close(context);
		expect(error).toBeInstanceOf(ActionBindingError);
		expect((error as Error).message).toContain("delegate/claude_code");
		expect((error as Error).message).toContain("no delegates are granted");
		expect(env.requests).toHaveLength(0);
	});

	it("lists the granted names", async () => {
		const { env, harness } = await start(delegateTwice(), { reviewer: { runner: "fake" }, tester: { runner: "fake" } });
		const error = await startScript(harness, delegateTwice(), { model: env.model }, context).catch((e: unknown) => e);
		await harness.close(context);
		expect(error).toBeInstanceOf(ActionBindingError);
		expect((error as Error).message).toContain("mcpTool://delegate/claude_code is not registered on this host; granted delegates: reviewer, tester");
		expect((error as Error).message).not.toContain("no delegates are granted");
	});

	it("starts a delegate-free script with an unused grant", async () => {
		const { env, harness } = await start(NO_DELEGATE, { claude_code: { runner: "fake" } });
		env.faux.setResponses([fauxAssistantMessage([fauxText("Hi.")])]);
		const result = await runScript(harness, NO_DELEGATE, { model: env.model }, context);
		await harness.close(context);
		expect(result.kind).toBe("completed");
	});

	it("adds no grants note for an unregistered tool outside delegate/", async () => {
		const source = delegateTwice().replace("mcpTool://delegate/claude_code", "mcpTool://deploy");
		const { env, harness } = await start(source, {});
		const error = await startScript(harness, source, { model: env.model }, context).catch((e: unknown) => e);
		await harness.close(context);
		expect(error).toBeInstanceOf(ActionBindingError);
		expect((error as Error).message).toContain("mcpTool://deploy is not registered on this host");
		expect((error as Error).message).not.toContain("delegates");
	});
});
