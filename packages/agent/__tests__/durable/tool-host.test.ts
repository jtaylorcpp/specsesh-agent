// actions/registry: registryHost adapts a registry to a one-shot run's two hosts.

import { describe, expect, it } from "vitest";
import {
	createActionRegistry,
	registryHost,
	type ActionContext,
	type DurableHostAction,
	type ExecutedHostAction,
	type RegistryHost,
} from "../../src/durable/index.js";

const WORKSPACE = "/work/space";

function echo(answer?: Record<string, unknown>): ExecutedHostAction & { contexts: ActionContext[] } {
	const contexts: ActionContext[] = [];
	return {
		name: "echo",
		kind: "read",
		inputs: { text: "string" },
		outputs: { text: "string" },
		replay: "safe",
		contexts,
		async execute(inputs, context) {
			contexts.push(context);
			return { ok: true, outputs: (answer ?? { text: inputs["text"] }) as Record<string, string> };
		},
	};
}

/** Call both hosts for `tool` with `inputs`. */
async function both(host: RegistryHost, tool: string, inputs: Record<string, string>) {
	return [
		await host.actionHost({ subagent: "main", action: tool, tool, inputs, index: 0 }),
		await host.toolHost({ name: tool, tool, inputs }),
	];
}

describe("registryHost", () => {
	it("Scenario: A registered tool runs through both hosts", async () => {
		const action = echo();
		const host = registryHost(createActionRegistry([action]), { workspace: WORKSPACE });
		const results = await both(host, "echo", { text: "hi" });
		for (const result of results) expect(result).toEqual({ ok: true, outputs: { text: "hi" } });
		expect(action.contexts.map((c) => c.workspace)).toEqual([WORKSPACE, WORKSPACE]);
	});

	it("Scenario: An unregistered tool is refused", async () => {
		const host = registryHost(createActionRegistry([echo()]), { workspace: WORKSPACE });
		for (const result of await both(host, "nowhere", {})) {
			expect(result).toEqual({ ok: false, message: "mcpTool://nowhere is not registered on this host" });
		}
	});

	it("Scenario: Wrong outputs are refused", async () => {
		const host = registryHost(createActionRegistry([echo({ text: 3 })]), { workspace: WORKSPACE });
		for (const result of await both(host, "echo", { text: "hi" })) {
			expect(result.ok).toBe(false);
			expect(result.ok === false && result.message).toContain("text");
		}
	});

	it("refuses outputs with a missing or undeclared name", async () => {
		const host = registryHost(createActionRegistry([echo({ other: "x" })]), { workspace: WORKSPACE });
		const [result] = await both(host, "echo", { text: "hi" });
		expect(result).toMatchObject({ ok: false });
		expect(result?.ok === false && result.message).toMatch(/output text is missing.*output other is not declared/);
	});

	it("answers a durable action runs only in a durable host, without starting it", async () => {
		let started = 0;
		const child: DurableHostAction = {
			name: "child",
			kind: "delegate",
			inputs: {},
			outputs: {},
			replay: "safe",
			durable: {
				async start() {
					started += 1;
					return { ok: false, message: "never" };
				},
				async finish() {
					return { ok: true, outputs: {} };
				},
			},
		};
		const host = registryHost(createActionRegistry([child]), { workspace: WORKSPACE });
		for (const result of await both(host, "child", {})) {
			expect(result).toEqual({ ok: false, message: "child runs only in a durable host" });
		}
		expect(started).toBe(0);
	});

	it("answers a throwing execute with its message", async () => {
		const boom: ExecutedHostAction = {
			...echo(),
			async execute() {
				throw new Error("boom");
			},
		};
		const host = registryHost(createActionRegistry([boom]), { workspace: WORKSPACE });
		for (const result of await both(host, "echo", { text: "hi" })) {
			expect(result).toEqual({ ok: false, message: "boom" });
		}
	});

	it("passes a refused result through", async () => {
		const refusing: ExecutedHostAction = { ...echo(), execute: async () => ({ ok: false, message: "no" }) };
		const host = registryHost(createActionRegistry([refusing]), { workspace: WORKSPACE });
		for (const result of await both(host, "echo", { text: "hi" })) expect(result).toEqual({ ok: false, message: "no" });
	});
});
