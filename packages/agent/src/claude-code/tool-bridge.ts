/**
 * The tool bridge: how a step's offered tools reach `claude -p`.
 *
 * Claude Code calls tools natively from MCP servers named in `--mcp-config`, so a
 * tool step serves its offers as one local MCP server, named `agentscript`, and
 * allows only its tools, as `mcp__agentscript__<name>`. Each call comes back
 * through the `BridgeHandler`, which runs it on our host.
 *
 * Only the interface lives here: `src/claude-code` may not import the MCP SDK
 * (the layer rule), so the implementation is `mcpBridge` in `src/mcp`, and the
 * port is tested with a fake factory.
 */

/** The server name in `--mcp-config`; allowed tools are `mcp__agentscript__<name>`. */
export const BRIDGE_SERVER = "agentscript" as const;

/** One offered tool, as the bridge lists it. */
export interface BridgeTool {
	readonly name: string;
	readonly description: string;
	/** JSON Schema of the tool's inputs, as the offer carries it. */
	readonly inputSchema: Record<string, unknown>;
}

/** What a call answers: the outputs as text when `ok`, or the error message. */
export interface BridgeReply {
	readonly ok: boolean;
	readonly text: string;
}

/** Runs one call that Claude Code made through the bridge. */
export type BridgeHandler = (name: string, args: Record<string, unknown>) => Promise<BridgeReply>;

/** A running bridge, for one step. */
export interface ToolBridge {
	/** Passed to `--mcp-config`. */
	readonly mcpConfig: string;
	/** Passed to `--allowedTools`, comma-joined. */
	readonly allowedTools: readonly string[];
	/** Stops serving. Idempotent. */
	close(): Promise<void>;
}

/** Starts a bridge serving `tools`, each call answered by `handler`. */
export type ToolBridgeFactory = (tools: readonly BridgeTool[], handler: BridgeHandler) => Promise<ToolBridge>;
