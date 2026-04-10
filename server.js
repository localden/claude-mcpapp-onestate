// MCP server with one widget tool (`show_cart`) to demo the
// BroadcastChannel "supersede older instances" pattern.
//
// Run:  npm install && npm start
// Then expose http://localhost:3000/mcp via a tunnel (ngrok / cloudflared)
// and add the public URL as a custom connector in Claude.ai.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_HTML = fs.readFileSync(path.join(__dirname, "widget.html"), "utf-8");
const WIDGET_URI = "ui://supersede-demo/cart.html";

/**
 * Build a fresh McpServer for a single request.
 * We run Streamable HTTP in stateless mode (no session id), which is the
 * simplest setup for a demo connector behind a tunnel.
 */
function buildServer() {
  const server = new McpServer(
    { name: "widget-supersede-demo", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  registerAppTool(
    server,
    "show_cart",
    {
      title: "Show cart",
      description:
        "Render the user's shopping cart as an interactive widget. Call this whenever the user wants to see or update their cart.",
      inputSchema: {
        items: z
          .array(z.string())
          .optional()
          .describe("Items currently in the cart"),
      },
      _meta: { ui: { resourceUri: WIDGET_URI } },
    },
    async ({ items }) => {
      const list = Array.isArray(items) ? items : [];
      return {
        content: [
          {
            type: "text",
            text:
              list.length > 0
                ? `Cart rendered with ${list.length} item(s): ${list.join(", ")}.`
                : "Cart rendered (empty).",
          },
        ],
        structuredContent: { items: list },
      };
    },
  );

  registerAppResource(
    server,
    "Cart Widget",
    WIDGET_URI,
    { description: "Interactive cart widget demonstrating instance supersession" },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: WIDGET_HTML,
          _meta: { ui: { prefersBorder: false } },
        },
      ],
    }),
  );

  return server;
}

// ── HTTP wiring ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "4mb" }));

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[/mcp] error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: null,
      });
    }
  }
});

// Stateless mode doesn't use the GET (SSE) or DELETE (session end) endpoints.
const methodNotAllowed = (_req, res) =>
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (stateless server)" },
    id: null,
  });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.get("/", (_req, res) => {
  res.type("text/plain").send("widget-supersede-demo MCP server. POST /mcp");
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`MCP server listening on http://localhost:${PORT}/mcp`);
});
