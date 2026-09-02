import assert from "node:assert/strict";
import test from "node:test";

import { activeMcpSessionCount, handleMcpRequest } from "../src/tools/mcp-server.ts";

const endpoint = "https://hexmend.example/mcp";

async function rpc(method, params, sessionId, id = 1) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const response = await handleMcpRequest(new Request(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }),
  }));
  return { response, body: await response.json() };
}

async function initialize() {
  const { response, body } = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  return { sessionId: response.headers.get("Mcp-Session-Id"), body };
}

async function call(sessionId, name, args = {}) {
  const { body } = await rpc("tools/call", { name, arguments: args }, sessionId);
  return body.result;
}

test("remote MCP initializes and exposes the same seven bounded tools", async () => {
  const { sessionId, body } = await initialize();
  assert.ok(sessionId);
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.match(body.result.instructions, /Inspect before acting/);

  const listed = await rpc("tools/list", {}, sessionId);
  assert.deepEqual(listed.body.result.tools.map((tool) => tool.name), [
    "inspect_spell",
    "trace_effect",
    "simulate_cast",
    "explain_side_effect",
    "set_sacred_constraint",
    "propose_spell_patch",
    "apply_spell_patch",
  ]);
  assert.equal(listed.body.result.tools[0].annotations.openWorldHint, false);
  assert.equal(listed.body.result.tools.at(-1).annotations.readOnlyHint, false);
});

test("a ChatGPT-style MCP session completes the constraint-preserving repair", async () => {
  const { sessionId } = await initialize();
  const inspection = (await call(sessionId, "inspect_spell")).structuredContent;
  const subject = inspection.nodes.find((node) => /duck/i.test(node.label));
  assert.ok(subject, "the protected subject must be grounded from inspection");

  const failed = (await call(sessionId, "simulate_cast")).structuredContent;
  assert.equal(failed.success, false);
  const sideEffectId = failed.sideEffects[0].id;
  assert.equal((await call(sessionId, "trace_effect", { effectId: sideEffectId })).isError, undefined);
  assert.equal((await call(sessionId, "explain_side_effect", { sideEffectId })).isError, undefined);
  assert.equal((await call(sessionId, "set_sacred_constraint", {
    targetId: subject.id,
    reason: "The ducks must stay.",
  })).isError, undefined);

  const proposal = (await call(sessionId, "propose_spell_patch")).structuredContent;
  const patch = proposal.patches[0];
  const preview = (await call(sessionId, "simulate_cast", { patchId: patch.id })).structuredContent;
  assert.equal(preview.success, true);
  const applied = (await call(sessionId, "apply_spell_patch", { patchId: patch.id })).structuredContent;
  assert.equal(applied.verification.success, true);
  const verified = (await call(sessionId, "simulate_cast")).structuredContent;
  assert.equal(verified.success, true);
  assert.equal(verified.sideEffects.length, 0);
});

test("remote MCP sessions are isolated and bad calls become model-readable tool errors", async () => {
  const first = await initialize();
  const second = await initialize();
  const firstInspection = (await call(first.sessionId, "inspect_spell")).structuredContent;
  const subject = firstInspection.nodes.find((node) => /duck/i.test(node.label));
  await call(first.sessionId, "set_sacred_constraint", { targetId: subject.id, reason: "Keep them." });

  const secondInspection = (await call(second.sessionId, "inspect_spell")).structuredContent;
  assert.equal(secondInspection.constraints.length, 0);
  const bad = await call(second.sessionId, "not_a_tool");
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /Unknown Hexmend tool/);

  const beforeDelete = activeMcpSessionCount();
  const deleted = await handleMcpRequest(new Request(endpoint, {
    method: "DELETE",
    headers: { "Mcp-Session-Id": first.sessionId },
  }));
  assert.equal(deleted.status, 204);
  assert.equal(activeMcpSessionCount(), beforeDelete - 1);
});

test("remote MCP rejects calls without a live initialized session", async () => {
  const { response, body } = await rpc("tools/list", {}, undefined);
  assert.equal(response.status, 404);
  assert.equal(body.error.code, -32001);
  assert.match(body.error.message, /initialize a new connection/);
});
