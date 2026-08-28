# Security and privacy posture

Hex Machina is a local-first, single-scenario game with no accounts, analytics, external APIs, cookies, browser storage, or user-uploaded content. The production browser journey asserts that every runtime request remains same-origin.

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

## Supply chain

Dependencies are exactly locked. GitHub Actions performs `npm ci`, fails on high-severity audit findings, and runs type checks, unit/integration tests, the production build, lint, worker assertions, and the complete Chrome journey for every push and pull request.

## Secrets and persistence

The application needs no OpenAI key or other runtime secret. `.env*`, generated output, local build state, and credentials are excluded from source control. The game retains no state after a page reset or reload.
