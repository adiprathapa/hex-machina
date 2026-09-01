import type { SpellGraph } from "../domain/spell.ts";
import { fillLayout } from "../domain/layout.ts";

/**
 * `layout: "authored"` returns the hand-authored rune positions untouched, for
 * callers that will jitter and fill the layout themselves; the default fills
 * the layout so it renders evenly spaced and never overlapping.
 */
export type ScenarioLayoutOptions = { layout?: "authored" | "filled" };

export function createMoonflowerScenario(options: ScenarioLayoutOptions = {}): SpellGraph {
  const graph: SpellGraph = {
    id: "spell-moonflower-01",
    version: 1,
    scenario: "moonflower",
    seed: 12012,
    desiredOutcome: "Water the moonflower without flooding the room.",
    semantics: {
      effectId: "flooded-observatory",
      ruleId: "unshielded-amplified-carrier",
      roles: {
        source: "moonwell",
        multiplier: "multiply",
        subject: "summon-ducks",
        action: "pour",
        failureTarget: "room",
        safeguard: "umbrella",
        goalTarget: "moonflower",
        goalSink: "bloom",
      },
      initialRouteEdgeIds: ["e-water-multiply", "e-multiply-ducks", "e-ducks-pour", "e-pour-room"],
    },
    constraints: [],
    nodes: [
      {
        id: "moonwell",
        kind: "source",
        label: "Moonwell",
        glyph: "◒",
        description: "A source of cold lunar water.",
        x: 8,
        y: 43,
      },
      {
        id: "moonrise",
        kind: "condition",
        label: "At moonrise",
        glyph: "◐",
        description: "Allows an effect only while the observatory moon is rising.",
        x: 8,
        y: 9,
        dormant: true,
      },
      {
        id: "multiply",
        kind: "modifier",
        label: "Multiply",
        glyph: "×12",
        description: "Repeats the next effect twelve times.",
        x: 30,
        y: 25,
      },
      {
        id: "summon-ducks",
        kind: "verb",
        label: "Summon ducks",
        glyph: "♢",
        description: "Summons compliant but easily distracted lunar ducks.",
        x: 47,
        y: 41,
      },
      {
        id: "umbrella",
        kind: "modifier",
        label: "Umbrella",
        glyph: "⌒",
        description: "Catches and redirects falling water.",
        x: 48,
        y: 76,
        dormant: true,
      },
      {
        id: "pour",
        kind: "verb",
        label: "Pour",
        glyph: "↘",
        description: "Releases carried water toward a target.",
        x: 68,
        y: 38,
      },
      {
        id: "room",
        kind: "target",
        label: "The room",
        glyph: "□",
        description: "Everything inside the observatory laboratory.",
        x: 87,
        y: 24,
      },
      {
        id: "moonflower",
        kind: "target",
        label: "Moonflower",
        glyph: "✦",
        description: "A rare flower that blooms when gently watered.",
        x: 87,
        y: 63,
      },
      {
        id: "bloom",
        kind: "sink",
        label: "Bloom",
        glyph: "✺",
        description: "The desired terminal state.",
        x: 68,
        y: 75,
        dormant: true,
      },
      {
        id: "soften",
        kind: "modifier",
        label: "Soften",
        glyph: "≈",
        description: "Reduces the force of the next effect without changing its target.",
        x: 27,
        y: 83,
        dormant: true,
      },
      {
        id: "mirror",
        kind: "target",
        label: "Silver mirror",
        glyph: "◈",
        description: "A reflective decoy target kept on the workshop shelf.",
        x: 90,
        y: 89,
        dormant: true,
      },
      {
        id: "release",
        kind: "verb",
        label: "Release",
        glyph: "⇡",
        description: "Lets a bound effect go without choosing a new destination.",
        x: 66,
        y: 9,
        dormant: true,
      },
    ],
    edges: [
      { id: "e-water-multiply", from: "moonwell", to: "multiply", type: "flows_to" },
      { id: "e-multiply-ducks", from: "multiply", to: "summon-ducks", type: "flows_to" },
      { id: "e-ducks-pour", from: "summon-ducks", to: "pour", type: "flows_to" },
      { id: "e-pour-room", from: "pour", to: "room", type: "targets" },
    ],
  };

  // The authored layout is spread and relaxed the same way generated variants
  // are, so the lesson fills its canvas without an empty band through the
  // middle and can never render two runes on top of each other. The family
  // generator asks for the authored skeleton instead: it jitters that and
  // fills once, so a variant never accumulates two passes of displacement.
  if (options.layout !== "authored") fillLayout(graph.nodes);
  return graph;
}
