# WebMCP conformance snapshot

Audited 2026-08-27 against the [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/) published 2026-08-26 and its [primary specification source](https://github.com/webmachinelearning/webmcp/blob/main/index.bs). WebMCP is experimental, so this record identifies the exact contract the submission targets.

| Current draft contract | Hex Machina evidence |
|---|---|
| Tools register imperatively through `document.modelContext.registerTool()`. | `src/tools/webmcp.ts` feature-detects the method and registers seven definitions. |
| Tool names are stable, non-empty identifiers of at most 128 allowed characters. | All seven names are short lowercase ASCII identifiers; contract tests compare the exact set. |
| Definitions include a description, optional human-facing title, JSON-serializable input schema, and asynchronous execute callback. | Every definition has a title and task-specific description. Tests inspect schemas, and production Chrome invokes each callback. |
| Input schemas are JSON Schema objects. | Every schema is a bounded object with `additionalProperties: false`; IDs use enums or anchored patterns, arrays are bounded and unique, and human text is length-limited. Every agent-facing parameter has a description. |
| Execution callbacks receive input plus an options object containing an `AbortSignal`. | All seven definitions use a shared wrapper that rejects an already-cancelled execution before application logic runs. Registration tests exercise this path. |
| Callback results may be any JSON-serializable value and are serialized by the browser for the caller. | Handler results contain plain structured data only: graph versions, IDs, ordered events, assertions, diffs, verification casts, and revert tokens. |
| Standard annotations are `readOnlyHint` and `untrustedContentHint`. | Reads declare `readOnlyHint: true`; writes declare it false. All outputs are deterministic application-owned data and explicitly declare `untrustedContentHint: false`. Non-standard annotation fields are not emitted. |
| Registration accepts a signal that unregisters the tool when aborted. | One abort controller scopes all seven registrations to the React page lifecycle; remount tests prove cleanup prevents duplicate names. |
| Tools should read current application state when executed rather than stale registration snapshots. | Definitions register once per mount, while shared handlers read `graphRef.current` at execution time. The production-browser suite mutates versions through registered calls and observes fresh state. |
| Direct tool execution should exercise the same validated application path as visible UI interaction. | UI buttons, fallback console, and registered callbacks all invoke the same runtime-validated handlers and typed result-presentation channel. |

## Trust boundary

The browser’s schema handling is treated as discoverability, not authorization. Every handler independently rejects malformed objects, unknown fields, out-of-range collections, unknown IDs, invalid patterns, and stale writes before mutation. Tool output contains no external or user-generated web content, credentials, cross-origin data, or hidden instructions.

## Remaining interoperability proof

The local production harness supplies the current `document.modelContext` contract and executes all seven registered definitions in system Chrome. Final acceptance still requires an authorized deployment and discovery through a real WebMCP-capable browser implementation; the harness is not presented as a substitute for that external proof.
