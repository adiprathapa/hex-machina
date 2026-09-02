import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  }));
  return nested.flat();
}

async function renderBuiltPage(headers = {}) {
  const workerUrl = pathToFileURL(path.join(DIST, "server/index.js"));
  workerUrl.searchParams.set("deployment-readiness", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("https://hexmend.example/", {
      headers: { accept: "text/html", ...headers },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("deployment output contains the worker and complete app-owned assets only", async () => {
  const worker = path.join(DIST, "server/index.js");
  const ogImage = path.join(DIST, "client/og.png");
  const favicon = path.join(DIST, "client/favicon.png");
  assert.ok((await stat(worker)).size > 100_000);

  // File size was standing in for "a real image, not a placeholder", which
  // stopped meaning anything once the assets were generated from the shipped
  // brand mark and dropped from 1MB to 59KB. Check the thing that actually
  // matters: a valid PNG at the exact dimensions each surface requires.
  const pngShape = async (file) => {
    const bytes = await readFile(file);
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${path.basename(file)} is a PNG`,
    );
    assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", `${path.basename(file)} starts with IHDR`);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
  };

  const og = await pngShape(ogImage);
  assert.deepEqual(
    { width: og.width, height: og.height },
    { width: 1200, height: 630 },
    "the sharing card is the size every platform crops to",
  );
  assert.ok(og.bytes > 10_000, "the sharing card has real content");

  const icon = await pngShape(favicon);
  assert.deepEqual(
    { width: icon.width, height: icon.height },
    { width: 256, height: 256 },
    "the favicon is served at the largest size browsers ask for",
  );
  assert.ok(icon.bytes > 1_000, "the favicon has real content");

  const relativeFiles = (await filesBelow(DIST)).map((file) => path.relative(DIST, file));
  assert.ok(relativeFiles.some((file) => /^client\/_next\/static\/chunks\/.+\.js$/.test(file)));
  const cssFiles = relativeFiles.filter((file) => /^client\/_next\/static\/css\/.+\.css$/.test(file));
  assert.ok(cssFiles.length > 0);
  assert.ok(relativeFiles.some((file) => /^client\/_next\/static\/_vinext_fonts\/.+\.woff2$/.test(file)));
  const builtCss = (await Promise.all(cssFiles.map((file) => readFile(path.join(DIST, file), "utf8")))).join("\n");
  // Both faces survive the build and stay bound to their roles: the interface
  // face for anything a person reads, monospace for machine data.
  assert.match(builtCss, /--font-inter/);
  assert.match(builtCss, /--font-fira-code/);
  assert.match(builtCss, /var\(--font-inter\)/);
  assert.match(builtCss, /var\(--font-fira-code\)/);
  assert.doesNotMatch(builtCss, /font-geist|font-poppins/);
  assert.deepEqual(
    relativeFiles.filter((file) => /(^|\/)(?:\.env|node_modules|submission|tests)(?:\/|$)|\.(?:map|pem)$/i.test(file)),
    [],
  );
});

test("built worker emits canonical host-derived sharing metadata and release headers", async () => {
  const response = await renderBuiltPage({
    "x-forwarded-host": "hexmend.example",
    "x-forwarded-proto": "https",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  const html = await response.text();
  assert.match(html, /<meta property="og:image" content="https:\/\/hexmend\.example\/og\.png"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  // The alt text describes the sharing card, so it has to name the product
  // rather than the scene from a card that no longer exists.
  const ogAlt = html.match(/property="og:image:alt" content="([^"]+)"/)?.[1]
    ?? html.match(/name="twitter:image:alt" content="([^"]+)"/)?.[1]
    ?? html.match(/"alt":"([^"]+)"/)?.[1];
  assert.ok(ogAlt, "the sharing card carries alt text");
  assert.match(ogAlt, /Hexmend/, "the alt text names the product");
  assert.ok(ogAlt.length > 20, "the alt text describes the card rather than labelling it");
  assert.doesNotMatch(html, /localhost:3000|codex-preview|react-loading-skeleton/);
});

test("built worker serves the seven shared tools over Streamable HTTP MCP", async () => {
  const workerUrl = pathToFileURL(path.join(DIST, "server/index.js"));
  workerUrl.searchParams.set("mcp-readiness", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const initialize = await worker.fetch(new Request("https://hexmend.example/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "readiness", version: "1" } },
    }),
  }), env, ctx);
  assert.equal(initialize.status, 200);
  assert.equal(initialize.headers.get("cache-control"), "no-store");
  assert.equal(initialize.headers.get("x-content-type-options"), "nosniff");
  const sessionId = initialize.headers.get("mcp-session-id");
  assert.ok(sessionId);
  assert.equal((await initialize.json()).result.serverInfo.name, "hexmend");

  const listed = await worker.fetch(new Request("https://hexmend.example/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  }), env, ctx);
  const tools = (await listed.json()).result.tools;
  assert.equal(tools.length, 7);
  assert.deepEqual(tools.map((tool) => tool.name), [
    "inspect_spell",
    "trace_effect",
    "simulate_cast",
    "explain_side_effect",
    "set_sacred_constraint",
    "propose_spell_patch",
    "apply_spell_patch",
  ]);
});
