// The fixture MCP server for add-mcp-tools' tests (design.md "Testing").
// Run with `node server.mjs` it serves over stdio (`CRASH=1` exits before the handshake);
// imported, `startHttp()` serves Streamable HTTP on port 0 and records request headers.
// zod is not resolvable from here, so the tools are raw JSON Schema handlers on McpServer's server.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const text = (value) => ({ content: [{ type: "text", text: String(value) }] });

const TOOLS = [
  {
    name: "echo",
    description: "Answers its text.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    call: ({ text: t }) => text(t),
  },
  {
    name: "add",
    description: "Adds two numbers.",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
    outputSchema: { type: "object", properties: { sum: { type: "number" } }, required: ["sum"] },
    call: ({ a, b }) => ({ ...text(a + b), structuredContent: { sum: a + b } }),
  },
  {
    name: "fail",
    description: "Always reports an error.",
    inputSchema: { type: "object", properties: {} },
    call: () => ({ ...text("fx: fail was called"), isError: true }),
  },
  {
    name: "tags",
    description: "Joins its tags; its array parameter makes it unmappable.",
    inputSchema: {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
      required: ["tags"],
    },
    call: ({ tags }) => text(tags.join(",")),
  },
  {
    name: "peek",
    description: "Reads without changing anything.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, idempotentHint: true },
    call: () => text("peeked"),
  },
];

export function createFixtureServer() {
  const mcp = new McpServer({ name: "fx", version: "1.0.0" }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ call, ...tool }) => tool),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) return { ...text(`fx: unknown tool ${request.params.name}`), isError: true };
    return tool.call(request.params.arguments ?? {});
  });
  return mcp;
}

export async function startHttp() {
  const requests = [];
  const http = createServer(async (req, res) => {
    requests.push({ ...req.headers });
    const server = createFixtureServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
        http.closeAllConnections();
      }),
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.env.CRASH === "1") process.exit(1);
  const server = createFixtureServer();
  await server.connect(new StdioServerTransport());
  process.stdin.on("end", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}
