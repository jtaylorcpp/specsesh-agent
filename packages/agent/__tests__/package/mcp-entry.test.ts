import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// dist/ is built by the suite's global setup (`pnpm build`).
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NODE_ENTRY = pathToFileURL(join(PKG_DIR, "dist", "node", "index.js")).href;
const MCP_ENTRY = pathToFileURL(join(PKG_DIR, "dist", "mcp", "index.js")).href;

/** Every URL a fresh Node process resolves while importing `entry`, recorded by a resolve hook. */
function resolvedBy(entry: string): string[] {
	const script = `
import { registerHooks } from "node:module";
const seen = [];
registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context); seen.push(r.url); return r; } });
await import(${JSON.stringify(entry)});
process.stdout.write(JSON.stringify(seen));
`;
	return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" })) as string[];
}

describe("The node entry loads without the MCP SDK", () => {
	it("Scenario: Importing ./node loads no MCP SDK module", () => {
		const urls = resolvedBy(NODE_ENTRY);

		expect(urls).toContain(NODE_ENTRY);
		expect(urls.filter((url) => url.includes("@modelcontextprotocol"))).toEqual([]);
		// The probe sees the SDK when it is there.
		expect(resolvedBy(MCP_ENTRY).some((url) => url.includes("@modelcontextprotocol"))).toBe(true);
	});

	it("Scenario: The mcp entry exports the MCP tools", async () => {
		const mcp = (await import(MCP_ENTRY)) as Record<string, unknown>;
		const node = (await import(NODE_ENTRY)) as Record<string, unknown>;

		for (const name of ["mcpTools", "mapTool", "McpServerError", "mcpBridge"]) {
			expect(typeof mcp[name], name).toBe("function");
			expect(node[name], name).toBeUndefined();
		}
	});
});
