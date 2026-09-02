/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  createMcpSession,
  handleMcpRequest,
  handleMcpSessionRequest,
  type McpSession,
} from "../src/tools/mcp-server.ts";

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  newUniqueId(): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  deleteAll(): Promise<void>;
}

interface DurableObjectState {
  id: DurableObjectId;
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface Env {
  ASSETS: AssetFetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  MCP_SESSIONS?: DurableObjectNamespace;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "manifest-src 'self'",
].join("; ");

function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  if (headers.get("content-type")?.toLowerCase().startsWith("text/html")) {
    headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

type PersistedToolCall = {
  name: keyof McpSession["handlers"];
  arguments: unknown;
};

/**
 * One strongly routed MCP conversation per Durable Object ID.
 *
 * The successful call transcript is persisted and replayed through fresh
 * production handlers after an object eviction. Determinism makes this a
 * compact state journal while preserving proposal capability and revert-token
 * semantics held inside the handler closure.
 */
export class HexmendMcpSession {
  private session = createMcpSession();
  private transcript: PersistedToolCall[] = [];
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly state: DurableObjectState) {
    this.ready = state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<PersistedToolCall[]>("tool-transcript");
      if (!Array.isArray(stored) || stored.length === 0) return;
      try {
        for (const call of stored) {
          const execute = this.session.handlers[call.name] as (input: unknown) => Promise<unknown>;
          if (typeof execute !== "function") throw new Error("Unknown persisted tool");
          await execute(call.arguments);
        }
        this.transcript = stored;
      } catch {
        this.session = createMcpSession();
        this.transcript = [];
        await state.storage.deleteAll();
      }
    });
  }

  fetch(request: Request): Promise<Response> {
    const run = this.queue.then(async () => {
      await this.ready;
      return handleMcpSessionRequest(request, {
        session: this.session,
        sessionId: this.state.id.toString(),
        onInitialize: async () => {
          this.session = createMcpSession();
          this.transcript = [];
          await this.state.storage.deleteAll();
        },
        onSuccessfulToolCall: async (call) => {
          this.transcript.push(call);
          await this.state.storage.put("tool-transcript", this.transcript);
        },
        onDelete: async () => {
          this.transcript = [];
          await this.state.storage.deleteAll();
        },
      });
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

async function routeMcpRequest(request: Request, namespace: DurableObjectNamespace) {
  let sessionId = request.headers.get("Mcp-Session-Id");
  if (request.method === "POST") {
    try {
      const message = await request.clone().json() as { method?: unknown };
      if (message.method === "initialize") sessionId = namespace.newUniqueId().toString();
    } catch {
      // The session handler returns the canonical JSON-RPC parse error.
    }
  }
  if (!sessionId) return handleMcpRequest(request);
  try {
    return namespace.get(namespace.idFromString(sessionId)).fetch(request);
  } catch {
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Invalid or expired MCP session; initialize a new connection" },
    }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return secureResponse(response);
    }

    if (url.pathname === "/mcp") {
      return secureResponse(env.MCP_SESSIONS
        ? await routeMcpRequest(request, env.MCP_SESSIONS)
        : await handleMcpRequest(request));
    }

    return secureResponse(await handler.fetch(request, env, ctx));
  },
};

export default worker;
