import assert from "node:assert/strict";
import test from "node:test";

import { createSpellToolHandlers } from "../src/tools/handlers.ts";
import { createMoonflowerScenario } from "../src/scenarios/moonflower.ts";

function handlers() {
  let graph = createMoonflowerScenario();
  return {
    tools: createSpellToolHandlers({
      getGraph: () => graph,
      setGraph: (next) => { graph = next; },
      recordActivity() {},
    }),
    graph: () => graph,
  };
}

test("mutating results are snapshots, not live references", async () => {
  const { tools, graph } = handlers();
  const subject = graph().semantics.roles.subject;

  const first = await tools.set_sacred_constraint({ targetId: subject, reason: "Keep them." });
  const second = await tools.set_sacred_constraint({ targetId: subject, reason: "Still keep them." });

  assert.notEqual(second.before, first.after, "results must not share an array");
  second.before.push({ id: "injected" });
  assert.equal(first.after.length, 1, "one result must not be editable through another");
  assert.equal(graph().constraints.length, 1, "and neither must the live graph");

  second.after[0].reason = "rewritten by the caller";
  assert.notEqual(graph().constraints[0].reason, "rewritten by the caller");
});

test("both mutating tools report the same before/after evidence shape", async () => {
  const { tools, graph } = handlers();
  const subject = graph().semantics.roles.subject;

  const constraint = await tools.set_sacred_constraint({ targetId: subject, reason: "Keep them." });
  assert.equal(constraint.beforeVersion, 1);
  assert.equal(constraint.graphVersion, 2);
  assert.equal(constraint.graphVersion, constraint.beforeVersion + 1);

  const proposal = await tools.propose_spell_patch({});
  const applied = await tools.apply_spell_patch({ patchId: proposal.patches[0].id });
  assert.ok(Object.hasOwn(applied, "before") && Object.hasOwn(applied, "after"));
});

test("releasing a constraint needs no invented justification", async () => {
  const { tools, graph } = handlers();
  const subject = graph().semantics.roles.subject;
  await tools.set_sacred_constraint({ targetId: subject, reason: "Keep them." });

  // `reason` records why a rune must be kept. Requiring it to release a lock
  // forced an agent to fabricate an explanation that is then discarded.
  const released = await tools.set_sacred_constraint({ targetId: subject, preserve: false });
  assert.deepEqual(released.after, []);
  assert.equal(released.before.length, 1);
  assert.equal(graph().constraints.length, 0);

  // Setting one still requires a reason.
  await assert.rejects(
    () => tools.set_sacred_constraint({ targetId: subject }),
    /set_sacred_constraint: reason is required/,
    "a missing required field must say it is required, and name the tool",
  );
  await assert.rejects(
    () => tools.set_sacred_constraint({ targetId: subject, reason: 7 }),
    /set_sacred_constraint: reason must be a string, received number/,
    "a wrong type is a different mistake with a different fix",
  );
});

test("a wrong revert token does not claim rollback is gone", async () => {
  const { tools, graph } = handlers();
  const subject = graph().semantics.roles.subject;
  await tools.set_sacred_constraint({ targetId: subject, reason: "Keep them." });
  const proposal = await tools.propose_spell_patch({});
  const applied = await tools.apply_spell_patch({ patchId: proposal.patches[0].id });
  assert.ok(applied.revertToken, "an applied patch must be reversible");

  const wrong = applied.revertToken.replace(/after-v\d+$/, "after-v99");
  await assert.rejects(
    () => tools.apply_spell_patch({ revertToken: wrong }),
    (error) => {
      assert.doesNotMatch(
        error.message,
        /has already been used/,
        "a valid token still exists; saying rollback is gone is misleading",
      );
      assert.match(error.message, /revertToken returned by the last apply_spell_patch/);
      return true;
    },
  );

  // The real token still works, which is what the message now implies.
  const reverted = await tools.apply_spell_patch({ revertToken: applied.revertToken });
  assert.ok(reverted);
});

test("reverting with nothing applied says exactly that", async () => {
  const { tools } = handlers();
  await assert.rejects(
    () => tools.apply_spell_patch({ revertToken: "revert-patch-umbrella-v1-after-v2" }),
    /No patch is currently reversible/,
  );
});

test("every field rejection names the tool it came from", async () => {
  const { tools, graph } = handlers();
  const subject = graph().semantics.roles.subject;

  // Under concurrent tool calls, "patchId must be a string" does not tell an
  // agent which call failed.
  const cases = [
    ["trace_effect", () => tools.trace_effect({ effectId: 7 })],
    ["trace_effect", () => tools.trace_effect({ effectId: "x", maxDepth: 99 })],
    ["simulate_cast", () => tools.simulate_cast({ patchId: 7 })],
    ["explain_side_effect", () => tools.explain_side_effect({})],
    ["explain_side_effect", () => tools.explain_side_effect({ sideEffectId: 7 })],
    ["set_sacred_constraint", () => tools.set_sacred_constraint({})],
    ["set_sacred_constraint", () => tools.set_sacred_constraint({ targetId: subject, reason: 7 })],
    ["apply_spell_patch", () => tools.apply_spell_patch({ patchId: 7 })],
    ["apply_spell_patch", () => tools.apply_spell_patch({ revertToken: 7 })],
  ];

  for (const [tool, call] of cases) {
    await assert.rejects(call, (error) => {
      assert.ok(
        error.message.startsWith(`${tool}:`),
        `"${error.message}" does not identify which tool rejected the call`,
      );
      return true;
    });
  }
});

test("a rejected sacred target is told how to find the right one", async () => {
  const { tools, graph } = handlers();
  const wrong = graph().nodes.find((node) => node.id !== graph().semantics.roles.subject);

  await assert.rejects(
    () => tools.set_sacred_constraint({ targetId: wrong.id, reason: "Keep it." }),
    (error) => {
      // The message must give a next move without naming the answer.
      assert.match(error.message, /inspect_spell/);
      assert.match(error.message, /human's stated constraint/);
      assert.equal(
        error.message.includes(graph().semantics.roles.subject),
        false,
        "the error must not hand over the protected rune's identifier",
      );
      return true;
    },
  );
});
