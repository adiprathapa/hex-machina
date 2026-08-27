import assert from "node:assert/strict";
import test from "node:test";

async function renderProductionPage() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("acceptance", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://hex-machina.local/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("production worker renders the complete playable shell", async () => {
  const response = await renderProductionPage();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Hex Machina — Cooperative Spell Debugging<\/title>/i);
  assert.match(html, /The overenthusiastic rain spell/);
  assert.match(html, /Water the moonflower\. Keep the room dry\./);
  assert.match(html, /Cast spell/);
  assert.match(html, /Executable spell graph/);
  assert.match(html, /Local spell console/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/);
});

test("production shell exposes accessible controls and state regions", async () => {
  const response = await renderProductionPage();
  const html = await response.text();
  assert.match(html, /<main/);
  assert.match(html, /aria-label="Investigation steps"/);
  assert.match(html, /aria-label="Moonwell, Source\. Drag to rearrange; arrow keys nudge\."/);
  assert.match(html, /aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /rel="stylesheet"/);
});
