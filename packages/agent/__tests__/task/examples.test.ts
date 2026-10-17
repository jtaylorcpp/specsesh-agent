/**
 * examples/agents: every example checks clean, the action examples bind to the built-ins a host
 * registers, and the custom task agent keeps the task-script contract.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { checkBindings, createActionRegistry } from "../../src/durable/index.js";
import { builtinActions } from "../../src/node/index.js";
import { checkContract, prepareTaskLoop } from "../../src/task/index.js";
import { cleanTemps, tinyChange } from "./helpers.js";

afterEach(cleanTemps);

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "examples", "agents");
const read = (name: string) => readFileSync(join(EXAMPLES, name), "utf8");

describe("examples/agents", () => {
	it("holds the six examples, and each checks clean", async () => {
		const files = readdirSync(EXAMPLES).filter((f) => f.endsWith(".agent")).sort();
		expect(files).toEqual([
			"01-hello.agent",
			"02-structured-output.agent",
			"03-branching.agent",
			"04-run-action.agent",
			"05-model-tools.agent",
			"06-custom-task-agent.agent",
		]);
		const out: string[] = [];
		const code = await main(["agent", "check", ...files.map((f) => join(EXAMPLES, f))], { out: (line) => out.push(line), err: (line) => out.push(line) });
		expect(out).toEqual([]);
		expect(code).toBe(0);
	});

	it("binds the action examples to the built-ins builtinActions registers", () => {
		const actions = createActionRegistry(builtinActions({ workspace: EXAMPLES }));
		for (const name of ["04-run-action.agent", "05-model-tools.agent"]) {
			expect(() => checkBindings(read(name), actions), name).not.toThrow();
		}
	});

	it("keeps the task-script contract in the custom task agent", () => {
		const source = read("06-custom-task-agent.agent");
		expect(() => checkContract(source)).not.toThrow();
		// And the whole start check a task loop makes: contract, document, actions against the loop's registry.
		const dir = tinyChange();
		expect(() => prepareTaskLoop({ change: { dir }, task: "1.1", script: { text: source }, workspace: dir })).not.toThrow();
	});
});
