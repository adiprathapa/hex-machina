# ChatGPT MCP compatibility

Hexmend exposes its seven production tools at:

`https://hexmend.hex-machina.workers.dev/mcp`

This is a Streamable HTTP MCP endpoint for ChatGPT and other remote MCP
clients. It complements the page-level WebMCP transport; it does not shim or
claim that ChatGPT's in-app browser supplies `document.modelContext`.

## Connect in ChatGPT

1. Open **Settings → Security and login** and enable **Developer mode**.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins), choose the plus button,
   and create a public MCP connection named **Hexmend** using the endpoint
   above.
3. Review the discovered seven tools.
4. Start a new conversation, attach Hexmend from the tools menu, and use the
   judge prompt from the app or README.

Developer mode can depend on the ChatGPT account and workspace policy. Adding
the connection is a user/account action; the website cannot perform it on the
user's behalf.

## Verified release

After deployment on 2026-09-02, a clean remote connection:

- initialized over public HTTPS with protocol version `2025-06-18`;
- discovered exactly `inspect_spell`, `trace_effect`, `simulate_cast`,
  `explain_side_effect`, `set_sacred_constraint`, `propose_spell_patch`, and
  `apply_spell_patch`;
- completed the canonical nine-call journey through those remote tools;
- previewed and applied `patch-umbrella-v2`; and
- finished Stable at graph v3 with zero active side effects.

The focused transport tests repeat that journey, prove two connections cannot
see each other's constraints, exercise model-readable failures, and verify the
built Worker route rather than only the unbundled handler.

## State boundary

Each initialized connection receives a random opaque session ID and its own
canonical graph. Sessions expire after 30 minutes, are bounded to 128 per
Worker isolate, and disappear on disconnect or isolate restart. A remote
ChatGPT session does not mirror a separately opened browser tab. This keeps the
compatibility layer honest and dependency-free; durable state and an MCP Apps
widget are possible later extensions.
