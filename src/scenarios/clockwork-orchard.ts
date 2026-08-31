import type { SpellGraph } from "../domain/spell.ts";
import { relaxLayoutOverlaps } from "../domain/layout.ts";

/** A third causal algebra: an action fired before its required condition damages the target. */
export function createClockworkOrchardScenario(): SpellGraph {
  const graph: SpellGraph = {
    id: "spell-clockwork-orchard-01",
    version: 1,
    scenario: "clockwork-orchard",
    seed: 38038,
    desiredOutcome: "Pollinate the Sun Orchid after dawn without bruising its closed bloom.",
    semantics: {
      effectId: "bruised-sun-orchid",
      ruleId: "unguarded-premature-action",
      roles: {
        source: "starlight",
        multiplier: "hasten",
        subject: "clockwork-moths",
        action: "pollinate",
        failureTarget: "closed-bloom",
        safeguard: "after-dawn",
        goalTarget: "sun-orchid",
        goalSink: "seed-song",
      },
      initialRouteEdgeIds: [
        "e-starlight-hasten",
        "e-hasten-moths",
        "e-moths-pollinate",
        "e-pollinate-closed",
      ],
    },
    constraints: [],
    nodes: [
      { id: "starlight", kind: "source", label: "Starlight", glyph: "✦", description: "A cool beam that winds the orchard mechanisms.", x: 8, y: 42 },
      { id: "hasten", kind: "modifier", label: "Hasten", glyph: "»", description: "Advances the next action before its natural time.", x: 30, y: 26 },
      { id: "clockwork-moths", kind: "verb", label: "Summon clockwork moths", glyph: "Ӝ", description: "Releases nine brass moths to carry pollen.", x: 47, y: 42 },
      { id: "pollinate", kind: "verb", label: "Pollinate", glyph: "⁙", description: "Dusts a selected bloom with sun pollen.", x: 67, y: 38 },
      { id: "closed-bloom", kind: "target", label: "Closed bloom", glyph: "◉", description: "A fragile orchid bud that cannot yet receive pollen.", x: 88, y: 24 },
      { id: "after-dawn", kind: "condition", label: "After dawn", glyph: "☼", description: "Guards an action until the Sun Orchid has opened.", x: 49, y: 76, dormant: true },
      { id: "sun-orchid", kind: "target", label: "Sun Orchid", glyph: "✺", description: "The open bloom that should receive the moths' pollen.", x: 88, y: 62 },
      { id: "seed-song", kind: "sink", label: "Seed song", glyph: "♩", description: "The desired fertile terminal state.", x: 68, y: 75, dormant: true },
      { id: "sleep", kind: "modifier", label: "Sleep", glyph: "∼", description: "A decoy that pauses the moths without proving correct timing.", x: 27, y: 84, dormant: true },
      { id: "moon-cactus", kind: "target", label: "Moon cactus", glyph: "♧", description: "A hardy but irrelevant nocturnal plant.", x: 90, y: 89, dormant: true },
      { id: "at-midnight", kind: "condition", label: "At midnight", glyph: "◐", description: "A tempting but incorrect timing guard.", x: 8, y: 9, dormant: true },
      { id: "scatter", kind: "verb", label: "Scatter", glyph: "⋰", description: "Disperses pollen without selecting a viable bloom.", x: 66, y: 9, dormant: true },
    ],
    edges: [
      { id: "e-starlight-hasten", from: "starlight", to: "hasten", type: "flows_to" },
      { id: "e-hasten-moths", from: "hasten", to: "clockwork-moths", type: "flows_to" },
      { id: "e-moths-pollinate", from: "clockwork-moths", to: "pollinate", type: "flows_to" },
      { id: "e-pollinate-closed", from: "pollinate", to: "closed-bloom", type: "targets" },
    ],
  };

  // The authored layout is relaxed the same way generated variants are, so
  // the default lesson can never render two runes on top of each other.
  relaxLayoutOverlaps(graph.nodes);
  return graph;
}
