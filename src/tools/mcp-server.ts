import { cloneGraph, type SpellGraph } from "../domain/spell.ts";
import { createMoonflowerScenario } from "../scenarios/moonflower.ts";
import { createSpellToolManifest, type SpellToolName } from "./definitions.ts";
import { createSpellToolHandlers } from "./handlers.ts";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 128;

interface McpSession {
  graph: SpellGraph;
  handlers: ReturnType<typeof createSpellToolHandlers>;
  touchedAt: number;
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

const sessions = new Map<string, McpSession>();

function json(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function rpcResult(id: unknown, result: unknown, extraHeaders?: HeadersInit) {
  return json({ jsonrpc: "2.0", id, result }, 200, extraHeaders);
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
}

function pruneSessions(now: number) {
  for (const [id, session] of sessions) {
    if (now - session.touchedAt > SESSION_TTL_MS) sessions.delete(id);
  }
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value as string | undefined;
    if (!oldest) break;
    sessions.delete(oldest);
  }
}

function createSession(now: number) {
  pruneSessions(now);
  const graph = createMoonflowerScenario();
  const session = {} as McpSession;
  session.graph = graph;
  session.touchedAt = now;
  session.handlers = createSpellToolHandlers({
    getGraph: () => session.graph,
    setGraph: (next) => { session.graph = cloneGraph(next); },
    recordActivity: () => {},
  });
  return session;
}

function findSession(request: Request) {
  const id = request.headers.get("Mcp-Session-Id");
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  session.touchedAt = Date.now();
  // Refresh insertion order so the bounded map evicts the least recently used
  // session instead of the oldest-created active conversation.
  sessions.delete(id);
  sessions.set(id, session);
  return { id, session };
}

function toolManifest(graph: SpellGraph) {
  return createSpellToolManifest({
    runeIds: graph.nodes.map((node) => node.id),
    sourceIds: graph.nodes.filter((node) => node.kind === "source").map((node) => node.id),
    effectIds: [graph.semantics.effectId],
  }).tools.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: annotations.readOnlyHint,
      destructiveHint: false,
      idempotentHint: annotations.readOnlyHint,
      openWorldHint: false,
    },
  }));
}

function requestId(message: JsonRpcRequest) {
  return message.id === undefined ? null : message.id;
}

/**
 * Streamable HTTP MCP transport for ChatGPT and other remote MCP clients.
 *
 * Browser WebMCP and remote MCP are deliberately separate transports. Both
 * expose the same manifest factory and production handlers, while each remote
 * MCP connection owns an isolated, expiring graph so one conversation cannot
 * mutate another person's lesson.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method === "DELETE") {
    const id = request.headers.get("Mcp-Session-Id");
    if (id) sessions.delete(id);
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET") {
    return json({
      name: "Hexmend MCP",
      transport: "Streamable HTTP",
      endpoint: "/mcp",
      message: "Send MCP JSON-RPC requests with POST.",
    });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST, DELETE" } });
  }

  let message: JsonRpcRequest;
  try {
    message = await request.json() as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(requestId(message), -32600, "Invalid JSON-RPC request", 400);
  }

  if (message.method === "initialize") {
    const sessionId = crypto.randomUUID();
    const session = createSession(Date.now());
    sessions.set(sessionId, session);
    const requestedVersion = typeof message.params === "object" && message.params !== null
      ? (message.params as Record<string, unknown>).protocolVersion
      : undefined;
    const protocolVersion = typeof requestedVersion === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requestedVersion)
      ? requestedVersion
      : MCP_PROTOCOL_VERSION;
    return rpcResult(requestId(message), {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "hexmend", title: "Hexmend Agent Gym", version: "0.1.0" },
      instructions:
        "Inspect before acting. Simulate the current cast, trace and explain its active side effect, preserve the human-stated intent with set_sacred_constraint, then propose, preview, and only after review apply a patch. Finish by simulating the applied graph.",
    }, { "Mcp-Session-Id": sessionId });
  }

  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
    return new Response(null, { status: 202 });
  }

  const found = findSession(request);
  if (!found) {
    return rpcError(requestId(message), -32001, "Missing or expired MCP session; initialize a new connection", 404);
  }

  if (message.method === "ping") return rpcResult(requestId(message), {});
  if (message.method === "tools/list") {
    return rpcResult(requestId(message), { tools: toolManifest(found.session.graph) });
  }
  if (message.method === "tools/call") {
    const params = typeof message.params === "object" && message.params !== null
      ? message.params as Record<string, unknown>
      : {};
    const name = params.name;
    const manifest = toolManifest(found.session.graph);
    if (typeof name !== "string" || !manifest.some((tool) => tool.name === name)) {
      return rpcResult(requestId(message), {
        isError: true,
        content: [{ type: "text", text: `Unknown Hexmend tool: ${String(name)}` }],
      });
    }
    try {
      const execute = found.session.handlers[name as SpellToolName] as (input: unknown) => Promise<unknown>;
      const result = await execute(params.arguments ?? {});
      return rpcResult(requestId(message), {
        structuredContent: result,
        content: [{ type: "text", text: JSON.stringify(result) }],
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Hexmend tool call failed";
      return rpcResult(requestId(message), {
        isError: true,
        content: [{ type: "text", text }],
      });
    }
  }

  return rpcError(requestId(message), -32601, `Method not found: ${message.method}`);
}

/** Test-only visibility without exporting mutable session state. */
export function activeMcpSessionCount() {
  return sessions.size;
}
