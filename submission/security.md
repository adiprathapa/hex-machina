# Security and privacy posture

Hexmend is a local-first canonical game plus a deterministic in-memory evaluation family. It has no accounts, analytics, third-party APIs, cookies, browser storage, or user-uploaded content. The production browser journey asserts that every page request remains same-origin. Its same-origin `/mcp` endpoint accepts server-to-server MCP JSON-RPC calls from explicitly connected clients.

## Response boundary

The Cloudflare-compatible worker adds these protections to every response:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `X-Frame-Options: SAMEORIGIN`
- a restrictive `Permissions-Policy` disabling camera, microphone, geolocation, payment, and USB
- `X-Permitted-Cross-Domain-Policies: none`

HTML responses additionally receive a Content Security Policy restricted to same-origin scripts, styles, fonts, images, connections, forms, and manifests; objects and base-URL rewriting are disabled. Framework hydration requires inline script and style allowances, but no arbitrary remote origin is permitted.

## WebMCP boundary

- Tool schemas expose no personal, cross-site, authentication, or payment parameters.
- Runtime handlers revalidate inputs independently of browser schema enforcement.
- Tool output is deterministic application-owned graph data and is marked trusted with `untrustedContentHint: false`.
- Read and write annotations match actual behavior.
- Writes are versioned, atomic, and reversible; stale or reused tokens fail without mutation.
- Already-cancelled tool executions are rejected before application logic runs.
- Registration is removed when the page lifecycle aborts.

## Remote MCP boundary

- ChatGPT receives the same seven definitions and invokes the same runtime-validated handlers over Streamable HTTP; there is no second repair implementation.
- Every initialized connection receives an opaque random session ID and an isolated graph. Sessions expire after 30 minutes, are capped at 128 per Worker isolate, and are discarded on explicit disconnect or isolate restart.
- Remote writes affect only that ephemeral session. They cannot alter another connection, the public site, a user's browser tab, or an external system; MCP annotations therefore mark every tool `openWorldHint: false` and every operation `destructiveHint: false`.
- Missing and expired sessions fail closed. Handler failures return model-readable MCP tool errors without leaking stack traces.
- Responses are non-cacheable and inherit the worker's MIME, referrer, permissions, and cross-origin resource protections.

## Supply chain

Dependencies are exactly locked. GitHub Actions performs `npm ci`, fails on high-severity audit findings, and runs type checks, unit/integration tests, the production build, lint, worker assertions, and the complete Chrome journey for every push and pull request.

## Secrets and persistence

The application needs no OpenAI key or other runtime secret. `.env*`, generated output, local build state, and credentials are excluded from source control. Browser game state ends on reset or reload; remote MCP state ends on disconnect, expiry, eviction, or Worker restart.
