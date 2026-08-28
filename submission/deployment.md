# Deployment readiness

Hex Machina is configured as an existing Sites project and builds to a Cloudflare Worker-compatible `dist/` bundle. No database, object storage, account system, secret, or runtime environment value is required.

## Proven release shape

- `.openai/hosting.json` contains only the existing Sites project identifier; unused D1 and R2 declarations are absent.
- `dist/server/index.js` is the production Worker entry point.
- `dist/client/` includes content-hashed JavaScript and CSS, locally bundled fonts, the favicon, and the 1200×630 social card.
- The built Worker derives Open Graph and X image URLs from the validated request host.
- The deployment-readiness suite rejects environment files, private keys, source maps, dependencies, tests, and submission sources in the deployable bundle.
- The official Sites `package-site.sh` helper successfully stages the build with `dist/.openai/hosting.json` and produces a valid compressed archive.

## Release sequence

1. Select an open-source license, add its standard `LICENSE` file, make the GitHub repository public, and confirm GitHub detects the license.
2. Upload the existing 75-second narrated MP4 to YouTube with public visibility and record its URL.
3. Run `python3 prepare.py --quick` and `npm run test:e2e`.
4. Package the unchanged successful build with the official Sites helper.
5. Save one version using the synchronized Git commit and deploy it.
6. Make the live app judge-accessible. The current Sites project cannot invite external visitors, so its challenge release must use public access unless another authorized host or judge credential path is chosen.
7. Open the resulting URL in a WebMCP-capable browser and execute the canonical judge prompt.
8. Record the live URL, discovery timestamp, seven discovered tool names, final graph version, Stable result, and zero console errors in `tests/browser-acceptance.json` and `submission/release-evidence.json`.
9. Run full `python3 prepare.py`; only then mark the submission milestone complete.

No deployment or version publication is performed by this readiness check.

## Current Sites state

The existing **Hex Machina** Sites project is active with custom owner-only access. It currently has zero saved versions, no preview URL, and no live URL. Its workspace policy does not permit external visitor invitations, so an owner-only deployment would not satisfy the judge-access requirement. Explicit authorization is needed for public site access, public repository access plus license selection, and public YouTube upload. The synchronized private GitHub `main` branch remains the source of truth until then.
