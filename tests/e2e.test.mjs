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
  assert.match(html, /<title>Hex Machina \| Agent Gym for Constraint-Aware Repair<\/title>/i);
  assert.match(html, /The overenthusiastic rain spell/);
  // The objective is rendered from the loaded task's own graph rather than
  // written into the markup, so the shell shows the canonical scenario's
  // desiredOutcome verbatim.
  assert.match(html, /Water the moonflower without flooding the room\./);
  assert.match(html, /Cast spell/);
  assert.match(html, /Executable spell graph/);
  // The shell must name the protocol a judge was told to test, and ship the
  // canonical prompt, rather than leaving both in a README.
  assert.match(html, /WebMCP/);
  assert.match(html, /document\.modelContext/);
  assert.match(html, /Copy prompt/);
  assert.match(html, /github\.com\/adiprathapa\/hex-machina/);
  assert.match(html, /Agent Gym evaluation mode/);
  assert.match(html, /Scored, replayable episode/);
  assert.match(html, /reward plus before\/after graph observations/);
  assert.match(html, /96 variants across 3 causal families, with vector and offline rollouts/);
  assert.match(html, /Held-out policy/);
  assert.match(html, /Memorized IDs/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/);
});

test("production shell exposes accessible controls and state regions", async () => {
  const response = await renderProductionPage();
  const html = await response.text();
  assert.match(html, /<main/);
  assert.match(html, /aria-label="Investigation steps"/);
  assert.match(html, /aria-label="Moonwell, Source\. Drag to rearrange; arrow keys nudge\."/);
  assert.match(html, /aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"/);
  assert.match(html, /Local tool console/);
  assert.match(html, /aria-label="Semantic tool console"/);
  assert.match(html, /aria-label="Agent Gym evaluation"/);
  assert.match(html, /Link from rune/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /rel="stylesheet"/);
});

test("production worker emits a restrictive browser security policy", async () => {
  const response = await renderProductionPage();
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(response.headers.get("permissions-policy") ?? "", /microphone=\(\)/);
  const policy = response.headers.get("content-security-policy") ?? "";
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /connect-src 'self'/);
  assert.doesNotMatch(policy, /https?:|\*/);
});
