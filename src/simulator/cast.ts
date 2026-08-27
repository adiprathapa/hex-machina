import type { SpellGraph } from "../domain/spell.ts";

export interface CastEvent {
  id: string;
  order: number;
  nodeId: string;
  tone: "neutral" | "magic" | "danger" | "success";
  message: string;
}

export interface SideEffect {
  id: string;
  label: string;
  severity: "curious" | "messy" | "catastrophic";
  responsibleNodeIds: string[];
  responsibleEdgeIds: string[];
}

export interface CastResult {
  graphVersion: number;
  seed: number;
  success: boolean;
  summary: string;
  events: CastEvent[];
  sideEffects: SideEffect[];
  assertions: {
    ducksPresent: boolean;
    roomFlooded: boolean;
    flowerWatered: boolean;
    flowerBloomed: boolean;
  };
}

function hasEdge(graph: SpellGraph, from: string, to: string): boolean {
  return graph.edges.some((edge) => edge.from === from && edge.to === to);
}

export function simulateCast(graph: SpellGraph): CastResult {
  const multipliedDucks = hasEdge(graph, "moonwell", "multiply") &&
    hasEdge(graph, "multiply", "summon-ducks");
  const ducksPresent = multipliedDucks || hasEdge(graph, "moonwell", "summon-ducks");
  const umbrellaRoute =
    (hasEdge(graph, "summon-ducks", "umbrella") ||
      hasEdge(graph, "moonwell", "umbrella")) &&
    hasEdge(graph, "umbrella", "pour");
  const roomFlooded = hasEdge(graph, "pour", "room") && !umbrellaRoute;
  const flowerWatered = hasEdge(graph, "pour", "moonflower") && umbrellaRoute;
  const flowerBloomed = flowerWatered && hasEdge(graph, "moonflower", "bloom");

  const events: CastEvent[] = [
    {
      id: "event-source",
      order: 1,
      nodeId: "moonwell",
      tone: "magic",
      message: "The Moonwell releases a silver ribbon of water.",
    },
  ];
  if (multipliedDucks) {
    events.push({
      id: "event-ducks-twelve",
      order: 2,
      nodeId: "multiply",
      tone: "magic",
      message: "Multiply fires before targeting: twelve lunar ducks arrive.",
    });
  } else if (ducksPresent) {
    events.push({
      id: "event-ducks-preserved",
      order: 2,
      nodeId: "summon-ducks",
      tone: "magic",
      message: "The lunar ducks remain part of the spell.",
    });
  }
  if (umbrellaRoute) {
    events.push({
      id: "event-umbrellas",
      order: 3,
      nodeId: "umbrella",
      tone: "magic",
      message: "Tiny umbrellas open and catch the falling water.",
    });
  }
  if (roomFlooded) {
    events.push({
      id: "event-flood",
      order: events.length + 1,
      nodeId: "room",
      tone: "danger",
      message: "With no bounded target, the ducks pour water across the room.",
    });
  }
  if (flowerWatered) {
    events.push({
      id: "event-water-flower",
      order: events.length + 1,
      nodeId: "moonflower",
      tone: "success",
      message: "Umbrella rain falls gently onto the Moonflower.",
    });
  }
  if (flowerBloomed) {
    events.push({
      id: "event-bloom",
      order: events.length + 1,
      nodeId: "bloom",
      tone: "success",
      message: "The Moonflower opens. The spell settles without a flood.",
    });
  }

  const sideEffects: SideEffect[] = roomFlooded
    ? [
        {
          id: "flooded-observatory",
          label: "Observatory flooded by twelve enthusiastic ducks",
          severity: "messy",
          responsibleNodeIds: ["multiply", "summon-ducks", "pour", "room"],
          responsibleEdgeIds: ["e-water-multiply", "e-multiply-ducks", "e-pour-room"],
        },
      ]
    : [];

  return {
    graphVersion: graph.version,
    seed: graph.seed,
    success: flowerBloomed && !roomFlooded,
    summary: flowerBloomed && !roomFlooded
      ? "Stable cast: the ducks water the Moonflower and the room remains dry."
      : "Unstable cast: the room floods before the Moonflower receives any water.",
    events,
    sideEffects,
    assertions: { ducksPresent, roomFlooded, flowerWatered, flowerBloomed },
  };
}
