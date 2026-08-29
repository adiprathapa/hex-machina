import type { SpellGraph } from "../domain/spell.ts";

/** A second causal algebra: a reachable directed cycle amplifies song into failure. */
export function createResonantAviaryScenario(): SpellGraph {
  return {
    id: "spell-resonant-aviary-01",
    version: 1,
    scenario: "resonant-aviary",
    seed: 27027,
    desiredOutcome: "Ring the crystal bell without shattering the glass dome.",
    semantics: {
      effectId: "shattered-glass-dome",
      ruleId: "resonant-feedback-cycle",
      roles: {
        source: "stormcall",
        multiplier: "echo",
        subject: "thunderbirds",
        action: "sing",
        failureTarget: "glass-dome",
        safeguard: "dampener",
        goalTarget: "crystal-bell",
        goalSink: "harmony",
      },
      initialRouteEdgeIds: [
        "e-storm-echo",
        "e-echo-birds",
        "e-birds-sing",
        "e-sing-echo",
        "e-sing-dome",
      ],
    },
    constraints: [],
    nodes: [
      { id: "stormcall", kind: "source", label: "Stormcall", glyph: "ϟ", description: "A pulse of charged wind.", x: 8, y: 44 },
      { id: "echo", kind: "modifier", label: "Echo", glyph: "∞", description: "Feeds a received song back into its singer.", x: 28, y: 24 },
      { id: "thunderbirds", kind: "verb", label: "Summon thunderbirds", glyph: "⌁", description: "Calls seven iridescent thunderbirds.", x: 47, y: 43 },
      { id: "sing", kind: "verb", label: "Sing", glyph: "♫", description: "Releases the birds' resonant chord.", x: 68, y: 39 },
      { id: "glass-dome", kind: "target", label: "Glass dome", glyph: "◯", description: "A fragile dome around the aviary.", x: 88, y: 18 },
      { id: "dampener", kind: "modifier", label: "Dampener", glyph: "≋", description: "Absorbs feedback while preserving the original song.", x: 49, y: 76, dormant: true },
      { id: "crystal-bell", kind: "target", label: "Crystal bell", glyph: "◇", description: "Rings only when struck by a controlled chord.", x: 88, y: 63 },
      { id: "harmony", kind: "sink", label: "Harmony", glyph: "✧", description: "The desired stable terminal state.", x: 70, y: 83, dormant: true },
      { id: "hush", kind: "modifier", label: "Hush", glyph: "∿", description: "A decoy that weakens volume but does not break cycles.", x: 27, y: 84, dormant: true },
      { id: "weather-vane", kind: "target", label: "Weather vane", glyph: "⌖", description: "A grounded decoy target.", x: 89, y: 88, dormant: true },
      { id: "dawn", kind: "condition", label: "At dawn", glyph: "☼", description: "A dormant timing condition.", x: 8, y: 14, dormant: true },
      { id: "release", kind: "verb", label: "Release", glyph: "⇡", description: "Lets a chord dissipate without selecting a destination.", x: 69, y: 12, dormant: true },
    ],
    edges: [
      { id: "e-storm-echo", from: "stormcall", to: "echo", type: "flows_to" },
      { id: "e-echo-birds", from: "echo", to: "thunderbirds", type: "flows_to" },
      { id: "e-birds-sing", from: "thunderbirds", to: "sing", type: "flows_to" },
      { id: "e-sing-echo", from: "sing", to: "echo", type: "flows_to" },
      { id: "e-sing-dome", from: "sing", to: "glass-dome", type: "targets" },
    ],
  };
}
