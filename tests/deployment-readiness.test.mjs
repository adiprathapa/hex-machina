import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8"));
}

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
    new Request("https://hex-machina.example/", {
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

test("Sites hosting metadata is minimal and synchronized into the build", async () => {
  const source = await json(".openai/hosting.json");
  const built = await json("dist/.openai/hosting.json");
  assert.deepEqual(Object.keys(source), ["project_id"]);
  assert.match(source.project_id, /^appgprj_[a-f0-9]{32}$/);
  assert.deepEqual(built, source);
});

test("deployment output contains the worker and complete app-owned assets only", async () => {
  const worker = path.join(DIST, "server/index.js");
  const ogImage = path.join(DIST, "client/og.png");
  const favicon = path.join(DIST, "client/favicon.png");
  assert.ok((await stat(worker)).size > 100_000);
  assert.ok((await stat(ogImage)).size > 500_000);
  assert.ok((await stat(favicon)).size > 20_000);

  const relativeFiles = (await filesBelow(DIST)).map((file) => path.relative(DIST, file));
  assert.ok(relativeFiles.some((file) => /^client\/_next\/static\/chunks\/.+\.js$/.test(file)));
  const cssFiles = relativeFiles.filter((file) => /^client\/_next\/static\/css\/.+\.css$/.test(file));
  assert.ok(cssFiles.length > 0);
  assert.ok(relativeFiles.some((file) => /^client\/_next\/static\/_vinext_fonts\/.+\.woff2$/.test(file)));
  const builtCss = (await Promise.all(cssFiles.map((file) => readFile(path.join(DIST, file), "utf8")))).join("\n");
  assert.match(builtCss, /--font-poppins/);
  assert.match(builtCss, /--font-fira-code/);
  assert.match(builtCss, /var\(--font-poppins\)/);
  assert.match(builtCss, /var\(--font-fira-code\)/);
  assert.doesNotMatch(builtCss, /font-geist/);
  assert.deepEqual(
    relativeFiles.filter((file) => /(^|\/)(?:\.env|node_modules|submission|tests)(?:\/|$)|\.(?:map|pem)$/i.test(file)),
    [],
  );
});

test("built worker emits canonical host-derived sharing metadata and release headers", async () => {
  const response = await renderBuiltPage({
    "x-forwarded-host": "hex-machina.example",
    "x-forwarded-proto": "https",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  const html = await response.text();
  assert.match(html, /<meta property="og:image" content="https:\/\/hex-machina\.example\/og\.png"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /umbrella-equipped ducks and a blooming moonflower/);
  assert.doesNotMatch(html, /localhost:3000|codex-preview|react-loading-skeleton/);
});
