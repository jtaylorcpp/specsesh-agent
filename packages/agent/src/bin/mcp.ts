/**
 * The bins reach `./mcp` only through here, with a dynamic `import()`, so they still start
 * without the optional peer `@modelcontextprotocol/sdk` (`design.md` of move-mcp-to-own-entry,
 * decision 3). Library entries never do this: `./mcp` imports the SDK statically.
 */

import type { ToolBridgeFactory } from "../claude-code/tool-bridge.js";

type McpEntry = typeof import("../mcp/index.js");

/** `./mcp`, imported on first use; a missing SDK is named. */
export async function importMcp(): Promise<McpEntry> {
	try {
		return await import("../mcp/index.js");
	} catch (error) {
		throw new Error(`MCP needs the optional peer @modelcontextprotocol/sdk; install it (${error instanceof Error ? error.message : String(error)})`);
	}
}

/** `mcpBridge()`, loaded when the first tool step asks for a bridge. */
export function lazyMcpBridge(): ToolBridgeFactory {
	let bridge: ToolBridgeFactory | undefined;
	return async (tools, handler) => {
		bridge ??= (await importMcp()).mcpBridge();
		return bridge(tools, handler);
	};
}
