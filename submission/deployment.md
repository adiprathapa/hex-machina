# Deployment readiness

Hex Machina builds to a Cloudflare Worker `dist/` bundle and is deployed with `npx wrangler deploy -c dist/server/wrangler.json`; the Sites hosting metadata below is kept synchronized for that packaging path as well. No database, object storage, account system, secret, or runtime environment value is required.

## Proven release shape

- `.openai/hosting.json` contains only the existing Sites project identifier; unused D1 and R2 declarations are absent.
- `dist/server/index.js` is the production Worker entry point.
- `dist/client/` includes content-hashed JavaScript and CSS, locally bundled fonts, the favicon, and the 1200×630 social card.
- The built Worker derives Open Graph and X image URLs from the validated request host.
- The deployment-readiness suite rejects environment files, private keys, source maps, dependencies, tests, and submission sources in the deployable bundle.
- The Sites `package-site.sh` helper also stages the build with `dist/.openai/hosting.json` and produces a valid compressed archive, so either host can take the same bundle.

## Release sequence

1. ~~Select an open-source license, add its standard `LICENSE` file, make the GitHub repository public, and confirm GitHub detects the license.~~ **Done 2026-08-29:** MIT, public at <https://github.com/adiprathapa/hex-machina>, license detected by GitHub.
2. Follow [`video/youtube-upload.md`](video/youtube-upload.md) to upload the existing 160.4-second narrated WebMCP screencast to YouTube with public visibility, then record its URL with the validated `train.py` command.
3. Run `python3 prepare.py --quick` and `npm run test:e2e`.
4. ~~Package the build and deploy it.~~ **Done 2026-08-30 and re-released after every change since:** `npm run build`, then `npx wrangler deploy -c dist/server/wrangler.json` to Cloudflare Workers.
5. ~~Make the live app judge-accessible.~~ **Done:** the Worker is public at <https://hex-machina.hex-machina.workers.dev>.
6. Open the resulting URL in a WebMCP-capable browser and execute the canonical judge prompt.
7. Record the live URL, discovery timestamp, seven discovered tool names, final graph version, Stable result, and zero console errors in `tests/browser-acceptance.json` and `submission/release-evidence.json`.
8. Run full `python3 prepare.py`; only then mark the submission milestone complete.

No deployment or version publication is performed by this readiness check.

## Current release state

The production Worker is public at <https://hex-machina.hex-machina.workers.dev>. Live `document.modelContext` discovery and the registered-tool canonical journey are recorded in `tests/browser-acceptance.json`; no further deployment is needed unless source changes are intentionally released.

The repository gate is closed: `main` is public under MIT at
<https://github.com/adiprathapa/hex-machina>, and it is the source of truth.

One gate remains:

| Gate | Blocked on | Records into |
| --- | --- | --- |
| ~~Live URL~~ | **Done 2026-08-30:** deployed to Cloudflare Workers at <https://hex-machina.hex-machina.workers.dev> | `site.live_url` |
| Public demo | Uploading the existing 160.4-second MP4 to YouTube as public | `video.public_youtube_url` |
| ~~Live discovery~~ | **Done 2026-08-30:** seven tools discovered live; canonical prompt executed end to end through them | `tests/browser-acceptance.json`, `site.webmcp_discovered_live` |

The build is already deploy-shaped: `npm run test:deployment` validates the
Worker entry, hashed client assets, hosting metadata, social metadata, and a
secret-free archive surface on every run.
