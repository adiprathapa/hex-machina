import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const SCREENSHOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCREENSHOT_DIR, "../..");

async function availablePort() {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.unref();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      assert.ok(address && typeof address !== "string");
      socket.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through conventional system-browser locations.
    }
  }
  throw new Error("A system Chrome/Chromium executable is required; set CHROME_PATH if needed.");
}

function stopProcess(child) {
  if (child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function startServer(port) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", "start", "--", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: ROOT,
    detached: process.platform !== "win32",
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production server exited early.\n${output}`);
    try {
      const response = await fetch(url);
      if (response.ok) return { child, url, output: () => output };
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  stopProcess(child);
  throw new Error(`Production server did not become ready.\n${output}`);
}

async function capture(page, filename) {
  await page.evaluate(() => {
    document.documentElement.scrollLeft = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollLeft = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
    // The rails are their own scroll containers. Focusing a control inside one
    // leaves it scrolled mid-sentence, which reads as a cropped screenshot.
    for (const rail of document.querySelectorAll(".brief-panel, .familiar-panel")) {
      rail.scrollTop = 0;
    }
  });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, filename),
    type: "jpeg",
    quality: 90,
    animations: "disabled",
  });
}

const port = await availablePort();
const server = await startServer(port);
let browser;

try {
  browser = await chromium.launch({
    executablePath: await chromeExecutable(),
    headless: true,
    args: process.platform === "linux" ? ["--no-sandbox"] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  const externalRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(server.url).origin) externalRequests.push(request.url());
  });
  await page.addInitScript(() => {
    const tools = new Map();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(definition, options = {}) {
          tools.set(definition.name, definition);
          options.signal?.addEventListener("abort", () => tools.delete(definition.name), { once: true });
          return Promise.resolve();
        },
      },
    });
  });

  await page.goto(server.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Cast spell/ }).click();
  await page.getByRole("button", { name: "Trace the glitch", exact: true }).click();
  await page.getByText("Twelve ducks. One indoor lake.", { exact: true }).waitFor();
  await capture(page, "01-failure-diagnosis.jpg");

  await page.getByRole("button", { name: "Protect the ducks", exact: true }).click();
  await page.getByRole("button", { name: "Find a repair", exact: true }).click();
  await page.getByRole("heading", { name: "Give the ducks umbrellas", exact: true }).waitFor();
  await capture(page, "02-constraint-aware-patch.jpg");

  await page.getByRole("button", { name: "Simulate patch safely", exact: true }).click();
  await page.getByText("Unapplied simulation", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Apply patch & recast", exact: true }).click();
  await page.getByText("Stable", { exact: true }).waitFor();
  await page.locator(".cast-vision").getByText(/twelve umbrella-equipped ducks/).waitFor();
  await capture(page, "03-successful-recast.jpg");

  assert.deepEqual(errors, [], `Browser errors:\n${errors.join("\n")}`);
  assert.deepEqual(externalRequests, [], `External requests:\n${externalRequests.join("\n")}`);
  process.stdout.write("Captured three verified 1280×720 submission screenshots.\n");
} catch (error) {
  if (server.output()) error.message += `\nProduction server output:\n${server.output()}`;
  throw error;
} finally {
  await browser?.close();
  stopProcess(server.child);
  if (server.child.exitCode === null) {
    await Promise.race([once(server.child, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}
