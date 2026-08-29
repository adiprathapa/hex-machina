import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute);
    return entry.name.endsWith(".md") ? [absolute] : [];
  }));
  return nested.flat();
}

test("all local Markdown links in the judge package resolve", async () => {
  const files = [
    path.join(ROOT, "README.md"),
    path.join(ROOT, "CONTRIBUTING.md"),
    ...await markdownFiles(path.join(ROOT, "submission")),
  ];
  const missing = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].trim().replace(/^<|>$/g, "").split("#", 1)[0];
      if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
      try {
        await stat(resolved);
      } catch {
        missing.push(`${path.relative(ROOT, file)} -> ${target}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("Devpost copy directly answers every required explanation and judging criterion", async () => {
  const copy = await readFile(path.join(ROOT, "submission/devpost-entry.md"), "utf8");
  for (const heading of [
    "Why this is a strong fit for WebMCP",
    "How it creates a better user experience",
    "What people and agents can do together",
    "How WebMCP was implemented",
    "WebMCP leverage",
    "Execution",
    "Potential impact",
    "Creativity and ambition",
    "How to test",
    "Build provenance",
  ]) {
    assert.match(copy, new RegExp(`^#{2,3} ${heading}$`, "mi"));
  }
  assert.match(copy, /document\.modelContext\.registerTool\(\)/);
  assert.match(copy, /all twelve ducks preserved/i);
  assert.match(copy, /Public GitHub repository with a visible open-source license/);
  assert.match(copy, /Public YouTube demo with audio/);
  assert.match(copy, /96 deterministic tasks/i);
  assert.match(copy, /one to three seeded, typed decoy edges/i);
  assert.match(copy, /at least three visible topologies/i);
  assert.match(copy, /Seeded resets select reproducibly/i);
  assert.match(copy, /family-restricted curriculum/i);
  assert.match(copy, /cross-rule grounding evidence/i);
  assert.match(copy, /omit the simulator's role map/i);
  assert.match(copy, /natural-language constraints plus inspected rune text/i);
  assert.match(copy, /rule-revealing family\/scenario names/i);
  assert.match(copy, /pre-cast diagnostic assertions/i);
  assert.match(copy, /not a learned-policy result/i);
  assert.match(copy, /JSONL exporter/i);
  assert.match(copy, /independent bounded verifier/i);
  assert.match(copy, /altered metadata, actions, rewards/i);
  assert.match(copy, /duplicate scenarios/i);
  assert.match(copy, /termination\/truncation flags/i);
  assert.match(copy, /32 actions/i);
  assert.match(copy, /streaming JSONL service/i);
  assert.match(copy, /Python adapters/i);
  assert.match(copy, /isolated parallel vectors/i);
  assert.match(copy, /contrast suite/i);
  assert.match(copy, /canonical-ID memorization \(−8\)/i);
});

test("release evidence truthfully records local proof and unresolved external gates", async () => {
  const evidence = JSON.parse(await readFile(path.join(ROOT, "submission/release-evidence.json"), "utf8"));
  assert.equal(evidence.schema_version, 1);
  assert.equal(evidence.project.created_during_submission_period, true);
  assert.match(evidence.project.first_commit, /^[a-f0-9]{7,40}$/);
  assert.ok(Date.parse(evidence.project.first_commit_at) >= Date.parse("2026-08-25T11:00:00-07:00"));
  assert.equal(evidence.devpost.copy_ready, true);
  assert.equal(evidence.video.duration_seconds, 75);
  assert.equal(evidence.video.has_audio, true);
  assert.ok((await stat(path.join(ROOT, evidence.video.local_path))).size > 500_000);
  assert.equal(evidence.repository.public, false);
  assert.equal(evidence.repository.license_spdx, null);
  assert.equal(evidence.video.public_youtube_url, null);
  assert.equal(evidence.site.live_url, null);
  assert.equal(evidence.site.webmcp_discovered_live, false);
});
