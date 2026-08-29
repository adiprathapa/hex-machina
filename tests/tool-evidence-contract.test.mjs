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
    /reason must be a string/,
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
