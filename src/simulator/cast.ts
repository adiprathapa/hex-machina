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
    duckCount: number;
    roomFlooded: boolean;
    flowerWatered: boolean;
    flowerBloomed: boolean;
  };
}

function hasEdge(graph: SpellGraph, from: string, to: string): boolean {
  return graph.edges.some((edge) => edge.from === from && edge.to === to);
}

export function simulateCast(graph: SpellGraph): CastResult {
  const {
    source,
    multiplier,
    subject,
    action,
    failureTarget,
    safeguard,
    goalTarget,
    goalSink,
  } = graph.semantics.roles;
  const multipliedDucks = hasEdge(graph, source, multiplier) &&
    hasEdge(graph, multiplier, subject);
  const ducksPresent = multipliedDucks || hasEdge(graph, source, subject);
  const duckCount = multipliedDucks ? 12 : ducksPresent ? 1 : 0;
  const ducksCarryWater = ducksPresent && hasEdge(graph, subject, action);
  const directRoute = hasEdge(graph, source, action);
  const umbrellaRoute =
    (hasEdge(graph, subject, safeguard) || hasEdge(graph, source, safeguard)) &&
    hasEdge(graph, safeguard, action);
  const roomFlooded = hasEdge(graph, action, failureTarget) && (ducksCarryWater || directRoute) && !umbrellaRoute;
  const flowerWatered = hasEdge(graph, action, goalTarget) && (umbrellaRoute || directRoute);
  const flowerBloomed = flowerWatered && hasEdge(graph, goalTarget, goalSink);

  const events: CastEvent[] = [
    {
      id: "event-source",
      order: 1,
      nodeId: source,
      tone: "magic",
      message: "The Moonwell releases a silver ribbon of water.",
    },
  ];
  if (multipliedDucks) {
    events.push({
      id: "event-ducks-twelve",
      order: 2,
      nodeId: multiplier,
      tone: "magic",
      message: "Multiply fires before targeting: twelve lunar ducks arrive.",
    });
  } else if (ducksPresent) {
    events.push({
      id: "event-ducks-preserved",
      order: 2,
      nodeId: subject,
      tone: "magic",
      message: "The lunar ducks remain part of the spell.",
    });
  }
  if (umbrellaRoute) {
    events.push({
      id: "event-umbrellas",
      order: 3,
      nodeId: safeguard,
      tone: "magic",
      message: "Tiny umbrellas open and catch the falling water.",
    });
  }
  if (roomFlooded) {
    events.push({
      id: "event-flood",
      order: events.length + 1,
      nodeId: failureTarget,
      tone: "danger",
      message: "With no bounded target, the ducks pour water across the room.",
    });
  }
  if (flowerWatered) {
    events.push({
      id: "event-water-flower",
      order: events.length + 1,
      nodeId: goalTarget,
      tone: "success",
      message: "Umbrella rain falls gently onto the Moonflower.",
    });
  }
  if (flowerBloomed) {
    events.push({
      id: "event-bloom",
      order: events.length + 1,
      nodeId: goalSink,
      tone: "success",
      message: "The Moonflower opens. The spell settles without a flood.",
    });
  }

  const sideEffects: SideEffect[] = roomFlooded
    ? [
        {
          id: graph.semantics.effectId,
          label: "Observatory flooded by twelve enthusiastic ducks",
          severity: "messy",
          responsibleNodeIds: [source, multiplier, subject, action, failureTarget],
          responsibleEdgeIds: graph.semantics.initialRouteEdgeIds,
        },
      ]
    : [];

  return {
    graphVersion: graph.version,
    seed: graph.seed,
    success: flowerBloomed && !roomFlooded,
    summary: flowerBloomed && !roomFlooded
      ? duckCount === 12
        ? "Stable cast: twelve umbrella-equipped ducks water the Moonflower and the room remains dry."
        : duckCount === 1
          ? "Stable cast: an umbrella-equipped duck waters the Moonflower and the room remains dry."
          : "Stable cast: Moonwell water reaches the Moonflower directly and the room remains dry."
      : "Unstable cast: the room floods before the Moonflower receives any water.",
    events,
    sideEffects,
    assertions: { ducksPresent, duckCount, roomFlooded, flowerWatered, flowerBloomed },
  };
}
