# Acceptance matrix

This matrix maps every item in the project definition of done to current, inspectable evidence. A green local command is not treated as proof for a requirement it does not exercise.

| # | Requirement | Status | Authoritative evidence |
|---:|---|---|---|
| 1 | A new visitor understands the objective without documentation. | Verified | The production shell renders the objective, lesson premise, ordered investigation steps, and primary cast action; `tests/e2e.test.mjs` checks the server-rendered copy and `tests/browser-journey.test.mjs` checks the visible journey. |
| 2 | The Moonflower scenario completes from failure through a constraint-preserving recast. | Verified | The production-browser test performs the complete journey and asserts failure, sacred ducks, Stable v3, and blooming Moonflower. |
| 3 | The spell is a typed directed graph rather than a cosmetic canvas. | Verified | `src/domain/spell.ts` defines node and edge vocabularies, endpoint compatibility, graph validation, versioned edits, and deterministic serialization; domain tests exercise accepted and rejected connections. |
| 4 | Casting is deterministic for a graph and seed. | Verified | `src/simulator/cast.ts` is pure; the spell-engine suite compares repeated cast results structurally. |
| 5 | All seven required WebMCP tools are registered with narrow schemas. | Verified | `src/tools/webmcp.ts` registers exactly seven definitions; the WebMCP suite checks their names, described and bounded inputs, enums, patterns, mutually exclusive patch/revert inputs, and `additionalProperties: false`. The dated draft audit is in `submission/webmcp-conformance.md`. |
| 6 | Read-only and mutating tools are accurately annotated. | Verified | Registration tests distinguish five reads and two writes, require the current `readOnlyHint` and `untrustedContentHint` fields, reject legacy annotation fields, and prove pre-cancelled executions never reach handlers. |
| 7 | Tool results provide structured verification evidence. | Verified | Handler tests consume graph versions, stable IDs, traces, duck counts, ranked edit and eligibility evidence, before/after summaries, predicted outcomes, verification casts, and one-use revert tokens. |
| 8 | Agent activity is visible in the interface. | Verified | Shared handlers feed a typed result-presentation channel, activity list, and graph highlighting. The production-browser test invokes all seven registered definitions directly and checks the causal failure, sacred pin, patch preview, applied outcome, rollback, and console-error absence. |
| 9 | Human constraints materially change the repair. | Verified | Solver tests prove an unconstrained six-edit route bypasses the ducks while the sacred constraint rejects that candidate, ranks an eight-edit Umbrella route first, and preserves all twelve ducks. Atomic patch tests independently reject a candidate that disconnects a sacred rune. |
| 10 | No OpenAI API key is required. | Verified | The application has no model/API dependency, runtime secret, account surface, analytics, or external request. Deterministic local handlers power both WebMCP and the fallback console; the Chrome journey asserts same-origin-only traffic. |
| 11 | Keyboard, focus, reduced motion, contrast, and mobile fallback are present. | Verified | CSS/source tests cover focus and reduced motion; the production-browser test checks keyboard rune nudging, mobile order, 44px target, objective visibility, and zero horizontal overflow. |
| 12 | Unit, integration, production-build, and browser tests pass through `prepare.py`. | Verified locally and in CI | `python3 prepare.py --quick` passes locally; GitHub Actions performs a clean install, zero-vulnerability audit, quick acceptance, deployment-bundle checks, production response-policy assertions, and a Chrome journey covering human controls, direct registered-tool execution, and same-origin-only traffic on Node 22.13. Full local acceptance reaches only the separate live discovery gate below. |
| 13 | A deployed experience is tested in a WebMCP-capable in-app browser. | Pending external release | Local in-app production testing is recorded in `tests/browser-acceptance.json`, but the page was intentionally not published and that session did not expose `document.modelContext`. This remains the only unmet acceptance gate. |
| 14 | Submission description, architecture, tools, limitations, screenshots, and 60–90 second demo exist. | Verified locally | `submission/` contains Devpost-ready copy mapped to every judging criterion, architecture, tool inventory, limitations, three validated 1280×720 captures, a 75-second H.264/AAC video, narration, captions, and reproducible render script. Internal links and required sections are tested. Public delivery URLs remain tracked separately below. |

## Release condition

Do not mark the project complete until a private or explicitly approved public deployment exposes the seven tools to a compatible browser, the canonical judge prompt succeeds against that deployment, and the live URL and verification timestamp replace the pending evidence above.

The exact pre-deployment archive shape and authorized handoff sequence are documented in `submission/deployment.md`.

## Challenge eligibility gates

The official challenge additionally requires a judge-accessible live URL, a public repository with a visible open-source license, and a public YouTube demo with audio. Their authoritative current values live in `submission/release-evidence.json`; full acceptance fails until each is present. The repository, live site, and submission must remain frozen after the deadline during judging.
