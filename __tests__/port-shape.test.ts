import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/interpreter/index.js";
import { IN_SUBSET, STRUCTURED } from "./helpers/fixtures.js";
import { answered, recordingPort } from "./helpers/recording-port.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir = join(PKG_DIR, "src")): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

/** Source with comments stripped: the file may DISCUSS a tool loop; it may not have one. */
function codeOf(file: string): string {
	return readFileSync(file, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
}

describe("platform-agentscript-interpreter: Reasoning Goes Out Through A Declared Port, And The Package Imports No Model Client", () => {
	it("Scenario: The port carries no tool set, no executor and no round bound, and the package holds no tool-dispatch loop", async () => {
		// THE DECLARED CONTRACT. A ReasoningRequest is three fields and there is no
		// fourth. A contract holding its own tools, its own executor and its own
		// round bound IS a model boundary, whatever it is called — and declaring
		// one here would put two in one product again.
		const port = codeOf(join(PKG_DIR, "src/interpreter/port.ts"));
		const request = port.slice(
			port.indexOf("export interface ReasoningRequest"),
			port.indexOf("export interface ReasoningPort"),
		);
		expect(request.match(/^\treadonly (\w+)/gm)?.map((m) => m.trim())).toEqual([
			"readonly systemInstructions",
			"readonly prompt",
			"readonly outputSchema",
		]);
		expect(request).not.toMatch(/tool|executor|rounds?|maxTurns|bound/i);

		// The port itself is one method, for the same reason.
		const contract = port.slice(
			port.indexOf("export interface ReasoningPort"),
			port.indexOf("export class NoReasoningPortError"),
		);
		expect(contract.match(/^\t\w+\(/gm)).toEqual(["\treason("]);

		// WHAT IS DISPATCHED. Not only the type — the object that actually crosses
		// the boundary at run time, for a plain step and for a structured one.
		const plain = recordingPort(answered());
		await run(IN_SUBSET, { port: plain.port });
		const structured = recordingPort({ kind: "answered", text: "", structured: { verdict: "ok" } });
		await run(STRUCTURED, { port: structured.port });
		expect(plain.requests.length + structured.requests.length).toBe(2);
		for (const dispatched of [...plain.requests, ...structured.requests]) {
			for (const key of Object.keys(dispatched)) {
				expect(["systemInstructions", "prompt", "outputSchema"]).toContain(key);
			}
		}

		// NO LOOP. The package neither names a tool nor runs one: the loop and its
		// bound belong to the port's implementation, per
		// `specsketch-workbench-agent`'s one-boundary requirement.
		const calls: string[] = [];
		for (const file of sourceFiles()) {
			const code = codeOf(file);
			expect(code, `${file} names a tool`).not.toMatch(/\btool(s|Use|Call|Set|Result|Executor)?\b/i);
			expect(code, `${file} counts rounds`).not.toMatch(/\b(maxRounds|roundLimit|rounds)\b/);
			for (const _ of code.matchAll(/\.reason\s*\(/g)) calls.push(file);
		}
		// Exactly one call site, and it is the runner dispatching one step. A
		// second would be the beginnings of a loop.
		expect(calls.map((f) => f.slice(PKG_DIR.length + 1))).toEqual(["src/interpreter/run.ts"]);
	});
});
