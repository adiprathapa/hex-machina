"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectRunes,
  getValidEdgeTypes,
  type RuneNode,
  type SpellEdgeType,
  type SpellGraph,
} from "@/src/domain/spell";
import { FAMILIAR_GNN_ENABLED, inferFamiliar } from "@/src/familiar/gnn";
import {
  AgentGymSession,
  instrumentSpellToolHandlers,
  type AgentGymSnapshot,
} from "@/src/eval/agent-gym";
import { AGENT_GYM_POLICY_BASELINES } from "@/src/eval/policy-benchmark";
import { createMoonflowerScenario } from "@/src/scenarios/moonflower";
import {
  AGENT_GYM_FAMILY_SPLIT_SIZES,
  generateAgentGymScenarioForFamily,
  sampleAgentGymTask,
  type AgentGymFamilyId,
  type AgentGymScenarioVariant,
  type AgentGymSplit,
} from "@/src/scenarios/agent-gym-family";
import type { CastResult } from "@/src/simulator/cast";
import { createSpellToolManifest } from "@/src/tools/definitions";
import { createSpellToolHandlers, type ReviewedSpellPatch, type SpellToolPresentation } from "@/src/tools/handlers";
import { registerWebMCPTools } from "@/src/tools/webmcp";

/* The feed lists every registered tool before any is called, so the roster is
   the same manifest WebMCP registers, in manifest order. A tool leaves the
   roster the moment its first call lands in the feed. */
const TOOL_ROSTER = createSpellToolManifest().tools.map(({ name, description }) => ({ name, description }));

interface Activity {
  id: number;
  tool: string;
  detail: string;
  nodeIds: string[];
}

interface NodePosition {
  x: number;
  y: number;
}

interface ConnectionDraft {
  fromId: string;
  toId: string;
  edgeType: SpellEdgeType;
  validTypes: SpellEdgeType[];
}

type ConsoleTool =
  | "inspect_spell"
  | "trace_effect"
  | "simulate_cast"
  | "explain_side_effect"
  | "set_sacred_constraint"
  | "propose_spell_patch"
  | "apply_spell_patch";

const consoleTools: Array<{ name: ConsoleTool; label: string; mutates: boolean }> = [
  { name: "inspect_spell", label: "Inspect", mutates: false },
  { name: "trace_effect", label: "Trace", mutates: false },
  { name: "simulate_cast", label: "Simulate", mutates: false },
  { name: "explain_side_effect", label: "Explain", mutates: false },
  { name: "set_sacred_constraint", label: "Protect", mutates: true },
  { name: "propose_spell_patch", label: "Propose", mutates: false },
  { name: "apply_spell_patch", label: "Apply patch", mutates: true },
];

function initialPositions(graph: SpellGraph): Record<string, NodePosition> {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
}

// The bounds the scenario generator authors and relaxes layouts within. Mapping
// from this range rather than 0-100 means the authored graph fills the canvas
// instead of leaving a dead margin on all four sides.
const AUTHORED = { minX: 7, maxX: 93, minY: 7, maxY: 90 };

const spanY = AUTHORED.maxY - AUTHORED.minY;

function clampPosition(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

const kindLabel: Record<RuneNode["kind"], string> = {
  source: "Source",
  verb: "Action",
  target: "Target",
  modifier: "Modifier",
  condition: "Condition",
  constraint: "Constraint",
  sink: "Outcome",
};

const DEFAULT_CONSTRAINT = "The ducks are funny. They stay.";


const REPO_URL = "https://github.com/adiprathapa/hex-machina";

const familyIds = Object.keys(AGENT_GYM_FAMILY_SPLIT_SIZES) as AgentGymFamilyId[];

/** Which causal rule each family generates, for labelling the picker. */
const FAMILY_RULE: Record<string, string> = {
  "family-01-v1": "unshielded-amplified-carrier",
  "family-02-v1": "resonant-feedback-cycle",
  "family-03-v1": "unguarded-premature-action",
};

/**
 * Per-rule narration. The graph carries its own objective and constraint, but
 * the framing copy has to change with the family or the interface describes a
 * flood while the agent is repairing a feedback loop.
 */
const STORY: Record<string, {
  lesson: string; title: string; lede: string; canvas: string;
  failure: string; success: string; read: string; nameStep: string; protect: string;
  prompt: string;
}> = {
  "unshielded-amplified-carrier": {
    lesson: "Family 01 · amplified carrier",
    title: "The overenthusiastic rain spell",
    lede: "This spell is almost right. Cast it, find the unstable path, then repair it without losing what you love.",
    canvas: "Rain for a moonflower",
    failure: "Twelve ducks. One indoor lake.",
    success: "The moonflower blooms",
    read: "I can see the flood path. Tell me what must survive before I touch the spell.",
    nameStep: "The ducks must remain.",
    protect: "Protect the ducks",
    prompt: "Inspect my spell and cast it. Explain why it failed, but do not change anything yet. The ducks are funny, so preserve them as a sacred constraint. Find the smallest repair that waters the moonflower without flooding the room, show me the proposed patch, apply it, and cast the spell again.",
  },
  "resonant-feedback-cycle": {
    lesson: "Family 02 · resonant feedback",
    title: "The spell that will not stop singing",
    lede: "A note feeds itself. Cast it, find the cycle that keeps it alive, then break it without silencing the choir.",
    canvas: "Harmony for a glass dome",
    failure: "Seven thunderbirds. One shattered dome.",
    success: "The bell rings true",
    read: "The signal is feeding itself. Tell me what must survive before I touch the spell.",
    nameStep: "The choir must remain.",
    protect: "Protect the choir",
    prompt: "Inspect my spell and cast it. Explain why it failed, but do not change anything yet. The choir is the point of the piece, so preserve the thunderbirds as a sacred constraint. Find the smallest repair that rings the crystal bell without shattering the glass dome, show me the proposed patch, apply it, and cast the spell again.",
  },
  "unguarded-premature-action": {
    lesson: "Family 03 · missing temporal guard",
    title: "The spell that acts too early",
    lede: "Everything here is correct except its timing. Cast it, find the missing guard, then add it without cutting anything out.",
    canvas: "Pollination on a clock",
    failure: "Nine moths. Nothing in bloom.",
    success: "The orchard keeps time",
    read: "It acts before it is allowed to. Tell me what must survive before I touch the spell.",
    nameStep: "The moths must remain.",
    protect: "Protect the moths",
    prompt: "Inspect my spell and cast it. Explain why it failed, but do not change anything yet. The clockwork moths do the pollinating, so preserve them as a sacred constraint. Find the smallest repair that pollinates the Sun Orchid without dusting the sealed bloom, show me the proposed patch, apply it, and cast the spell again.",
  },
};

export function HexMachina() {
  const [graph, setGraph] = useState<SpellGraph>(() => createMoonflowerScenario());
  const graphRef = useRef(graph);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [cast, setCast] = useState<CastResult | null>(null);
  const [previewCast, setPreviewCast] = useState<CastResult | null>(null);
  const [patch, setPatch] = useState<ReviewedSpellPatch | null>(null);
  const [revertToken, setRevertToken] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => graph.semantics.roles.multiplier);
  const [positions, setPositions] = useState<Record<string, NodePosition>>(() => initialPositions(graph));
  const [dragging, setDragging] = useState<string | null>(null);
  const [mcpState, setMcpState] = useState<"checking" | "live" | "unavailable">("checking");
  const [consoleOutput, setConsoleOutput] = useState("Select a tool to inspect its structured result.");
  const [consoleBusy, setConsoleBusy] = useState<ConsoleTool | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null);
  const [connectionMessage, setConnectionMessage] = useState("Select a rune, then start a typed link.");
  // Stateful so loading a scenario rebuilds it. The session captures the family,
  // seed and initial observation at construction and never re-reads the graph,
  // so a swap without a new session reports the wrong episode in the scorecard
  // and in the exported JSON. Replacing it also re-creates `handlers` through the
  // memo below, which clears issued patch capabilities and re-registers WebMCP
  // with the new scenario's identifiers.
  const [gymSession, setGymSession] = useState(() => new AgentGymSession());
  const [variant, setVariant] = useState<AgentGymScenarioVariant | null>(null);
  const [labFamily, setLabFamily] = useState<AgentGymFamilyId>(() => familyIds[0]);
  const [labSplit, setLabSplit] = useState<AgentGymSplit>("test");
  const [labIndex, setLabIndex] = useState(0);
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [gymSnapshot, setGymSnapshot] = useState<AgentGymSnapshot>(() => gymSession.snapshot());
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const activityId = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Every scenario-specific identifier is read from the graph's own semantics,
  // so any of the generated task variants drives the same interface. Naming one
  // story here is what previously made a loaded variant throw on the first tool
  // call and silently stall the lesson at step three.
  const effectId = graph.semantics.effectId;
  const subjectId = graph.semantics.roles.subject;
  const constraintText = variant?.humanConstraint ?? DEFAULT_CONSTRAINT;
  const story = STORY[graph.semantics.ruleId] ?? STORY["unshielded-amplified-carrier"];
  // Every step of the link flow unmounts the control that was just activated,
  // which drops keyboard focus to <body>. Hand focus to wherever the next
  // decision lives instead.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const selector = pendingFocus.current;
    if (!selector) return;
    pendingFocus.current = null;
    document.querySelector<HTMLElement>(selector)?.focus();
  });

  const draggingRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  // Runes are drawn from their centre, so the outer ~half-rune of the canvas on
  // each side cannot hold a centre without clipping. Clamping authored
  // coordinates into that safe area collapses distinct positions onto the same
  // edge value — six of twelve runes stacked on two columns. Map the authored
  // 0-100 range onto the safe area instead: nothing clips, and the spacing the
  // layout was authored with survives.
  const horizontalInset = canvasWidth ? Math.min(22, Math.max(8, (100 / canvasWidth) * 100)) : 9;
  // Half a rune's height against the measured canvas, for the same reason.
  const verticalInset = canvasHeight ? Math.min(16, Math.max(5, (38 / canvasHeight) * 100)) : 6;
  const toCanvasY = useCallback(
    (value: number) => verticalInset + ((value - AUTHORED.minY) / spanY) * (100 - verticalInset * 2),
    [verticalInset],
  );
  const fromCanvasY = useCallback(
    (value: number) => AUTHORED.minY + ((value - verticalInset) / (100 - verticalInset * 2)) * spanY,
    [verticalInset],
  );
  const toCanvasX = useCallback(
    (value: number) =>
      horizontalInset
      + ((value - AUTHORED.minX) / (AUTHORED.maxX - AUTHORED.minX)) * (100 - horizontalInset * 2),
    [horizontalInset],
  );
  const fromCanvasX = useCallback(
    (value: number) =>
      AUTHORED.minX
      + ((value - horizontalInset) / (100 - horizontalInset * 2)) * (AUTHORED.maxX - AUTHORED.minX),
    [horizontalInset],
  );


  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      setCanvasWidth(canvas.clientWidth);
      setCanvasHeight(canvas.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const recordActivity = useCallback((tool: string, detail: string, nodeIds: string[] = []) => {
    activityId.current += 1;
    setActivity((items) => [{ id: activityId.current, tool, detail, nodeIds }, ...items].slice(0, 7));
    if (nodeIds[0]) setSelected(nodeIds[0]);
  }, []);

  const presentToolResult = useCallback((event: SpellToolPresentation) => {
    if (event.tool === "simulate_cast") {
      if (event.previewPatch) {
        setPatch(event.previewPatch);
        setPreviewCast(event.simulation);
      } else {
        setCast(event.simulation);
        setPatch(null);
        setPreviewCast(null);
      }
    } else if (event.tool === "set_sacred_constraint") {
      setPatch(null);
      setPreviewCast(null);
    } else if (event.tool === "propose_spell_patch") {
      setPatch(event.patches[0] ?? null);
      setPreviewCast(null);
    } else {
      setCast(event.verification);
      setPatch(null);
      setPreviewCast(null);
      setRevertToken(event.revertToken ?? null);
    }
  }, []);

  // The closures read graphRef only when a tool executes, never during render.
  /* eslint-disable react-hooks/refs */
  const handlers = useMemo(
    () => {
      const sharedHandlers = createSpellToolHandlers({
        getGraph: () => graphRef.current,
        setGraph: (next) => {
          graphRef.current = next;
          setGraph(next);
          setRevertToken(null);
          setConnectFrom(null);
          setConnectionDraft(null);
        },
        recordActivity,
        presentResult: presentToolResult,
      });
      return instrumentSpellToolHandlers(
        sharedHandlers,
        () => graphRef.current,
        gymSession,
        setGymSnapshot,
      );
    },
    [gymSession, presentToolResult, recordActivity],
  );
  /* eslint-enable react-hooks/refs */

  // The Cast control advertises Enter with a key badge, so Enter has to work.
  // It fires whichever step is currently primary, and stands down whenever the
  // person is typing or a modifier is held.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A") return;
      const primary = document.querySelector<HTMLButtonElement>(".controls .primary");
      if (!primary || primary.disabled) return;
      event.preventDefault();
      primary.click();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const registration = new AbortController();
    let active = true;
    // Registration waits up to eight seconds for a host to inject
    // document.modelContext, because a slow host is worth waiting for. The
    // label must not wait with it: a visitor without a host spent 7.6 seconds
    // reading "connecting to host…", which says nothing true about their
    // situation. After a short grace the label settles on "ready for a host",
    // which is accurate whether or not one ever arrives, and still flips to
    // "registered" if the host turns up later.
    const settle = setTimeout(() => {
      if (active) setMcpState((current) => current === "checking" ? "unavailable" : current);
    }, 1200);
    registerWebMCPTools(handlers, registration.signal, { scenario: graphRef.current })
      .then((supported) => {
        if (active && supported) setMcpState("live");
        else if (active) setMcpState("unavailable");
      })
      .catch(() => {
        if (active) setMcpState("unavailable");
      });
    return () => {
      active = false;
      clearTimeout(settle);
      registration.abort();
    };
  }, [handlers]);

  // Each step of the journey replaces the primary button with the next one, so
  // activating it unmounts the element that had focus. Without this, keyboard
  // and screen-reader users are dropped to <body> four times in five steps.
  const keepFocusOnPrimary = () => {
    pendingFocus.current = ".controls .primary";
    // A handler whose last state update has already been flushed produces no
    // further render, so the effect that consumes pendingFocus never runs. Try
    // again on the next frame; whichever path gets there first clears the ref.
    requestAnimationFrame(() => {
      if (pendingFocus.current !== ".controls .primary") return;
      pendingFocus.current = null;
      document.querySelector<HTMLElement>(".controls .primary")?.focus();
    });
  };

  const castSpell = async () => {
    setRevertToken(null);
    await handlers.inspect_spell();
    await handlers.simulate_cast();
    keepFocusOnPrimary();
  };

  const diagnose = async () => {
    await handlers.trace_effect({ effectId });
    await handlers.explain_side_effect({ sideEffectId: effectId });
    keepFocusOnPrimary();
  };

  const protectSubject = async () => {
    await handlers.set_sacred_constraint({ targetId: subjectId, reason: constraintText });
    setPatch(null);
    keepFocusOnPrimary();
  };

  const proposeRepair = async () => {
    await handlers.propose_spell_patch();
    keepFocusOnPrimary();
  };

  const applyRepair = async () => {
    if (!patch) return;
    await handlers.apply_spell_patch({ patchId: patch.id });
    await handlers.simulate_cast();
  };

  const previewRepair = async () => {
    if (!patch) return;
    await handlers.simulate_cast({ patchId: patch.id });
  };

  const undoRepair = async () => {
    if (!revertToken) return;
    const result = await handlers.apply_spell_patch({ revertToken });
    setConsoleOutput(JSON.stringify(result, null, 2));
  };

  /**
   * Load a task into the live workspace.
   *
   * A scenario swap is not just a new graph: the gym session captures family,
   * seed and initial observation at construction, the tool handlers hold issued
   * patch capabilities in a closure, and the WebMCP manifest advertises the
   * current scenario's identifiers. Replacing the session rebuilds the handlers
   * through their memo, which clears those capabilities and re-registers the
   * tools, so all four stay consistent.
   */
  const loadScenario = (next: SpellGraph, loaded: AgentGymScenarioVariant | null, note: string) => {
    graphRef.current = next;
    setGraph(next);
    setVariant(loaded);
    setCast(null);
    setPreviewCast(null);
    setPatch(null);
    setRevertToken(null);
    setActivity([]);
    activityId.current = 0;
    setSelected(next.semantics.roles.multiplier);
    setPositions(initialPositions(next));
    setDragging(null);
    draggingRef.current = null;
    dragOffsetRef.current = { x: 0, y: 0 };
    setConsoleOutput(note);
    setConsoleBusy(null);
    setConnectFrom(null);
    setConnectionDraft(null);
    setConnectionMessage("Select a rune, then start a typed link.");
    setMcpState("checking");

    const session = loaded
      ? new AgentGymSession({
          familyId: loaded.familyId,
          scenarioId: loaded.scenarioId,
          seed: loaded.seed,
          objective: loaded.objective,
          humanConstraint: loaded.humanConstraint,
          split: loaded.split,
          variantIndex: loaded.index,
          perturbations: loaded.perturbations,
        }, next)
      : new AgentGymSession();
    setGymSession(session);
    setGymSnapshot(session.snapshot());
  };

  const reset = () => loadScenario(
    variant ? generateAgentGymScenarioForFamily(variant.familyId, variant.split, variant.index).graph : createMoonflowerScenario(),
    variant,
    "Task reset. Select a tool to inspect graph v1.",
  );

  const loadTask = (family: AgentGymFamilyId, split: AgentGymSplit, index: number) => {
    const generated = generateAgentGymScenarioForFamily(family, split, index);
    loadScenario(generated.graph, generated, `Loaded ${generated.scenarioId}. Every rune, edge and effect ID is freshly remapped.`);
  };

  const loadRandomTask = () => {
    const seed = Math.floor(Math.random() * 0xffffffff);
    const picked = sampleAgentGymTask("test", seed);
    loadTask(picked.familyId, picked.split, picked.index);
  };

  const exportEpisode = () => {
    const payload = JSON.stringify(gymSession.snapshot(), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "hex-machina-agent-gym-episode.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const moveNode = useCallback((nodeId: string, x: number, y: number) => {
    setPositions((current) => ({
      ...current,
      [nodeId]: {
        x: clampPosition(x, AUTHORED.minX, AUTHORED.maxX),
        y: clampPosition(y, AUTHORED.minY, AUTHORED.maxY),
      },
    }));
  }, []);

  const moveNodeFromPointer = useCallback((clientX: number, clientY: number) => {
    const nodeId = draggingRef.current;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!nodeId || !bounds) return;
    moveNode(
      nodeId,
      fromCanvasX(((clientX - bounds.left - dragOffsetRef.current.x) / bounds.width) * 100),
      fromCanvasY(((clientY - bounds.top - dragOffsetRef.current.y) / bounds.height) * 100),
    );
  }, [moveNode, fromCanvasX, fromCanvasY]);

  const finishDragging = useCallback(() => {
    draggingRef.current = null;
    dragOffsetRef.current = { x: 0, y: 0 };
    setDragging(null);
  }, []);

  const chooseRune = (nodeId: string) => {
    setSelected(nodeId);
    if (!connectFrom || nodeId === connectFrom) return;
    const source = graph.nodes.find((node) => node.id === connectFrom);
    const target = graph.nodes.find((node) => node.id === nodeId);
    if (!source || !target) return;
    const validTypes = getValidEdgeTypes(source.kind, target.kind);
    if (!validTypes.length) {
      setConnectionDraft(null);
      setConnectionMessage(`${source.label} cannot feed ${target.label}; ${source.kind} → ${target.kind} has no valid port.`);
      return;
    }
    setConnectionDraft({ fromId: source.id, toId: target.id, edgeType: validTypes[0], validTypes });
    pendingFocus.current = ".connection-editor select";
    setConnectionMessage(`${source.label} → ${target.label} supports ${validTypes.join(" or ")}.`);
  };

  const startConnection = () => {
    if (!selectedNode) return;
    setConnectFrom(selectedNode.id);
    setConnectionDraft(null);
    setConnectionMessage(`Linking from ${selectedNode.label}. Choose a highlighted compatible rune.`);
    pendingFocus.current = ".rune.connect-compatible";
  };

  const cancelConnection = () => {
    setConnectFrom(null);
    setConnectionDraft(null);
    setConnectionMessage("Typed link cancelled. The spell was not changed.");
    pendingFocus.current = ".start-link";
  };

  const confirmConnection = () => {
    if (!connectionDraft) return;
    try {
      const next = connectRunes(
        graphRef.current,
        connectionDraft.fromId,
        connectionDraft.toId,
        connectionDraft.edgeType,
      );
      const from = next.nodes.find((node) => node.id === connectionDraft.fromId);
      const to = next.nodes.find((node) => node.id === connectionDraft.toId);
      graphRef.current = next;
      setGraph(next);
      setCast(null);
      setPreviewCast(null);
      setPatch(null);
      setRevertToken(null);
      setConnectFrom(null);
      setConnectionDraft(null);
      setConnectionMessage(`Added ${connectionDraft.edgeType}: ${from?.label} → ${to?.label}. Spell advanced to v${next.version}.`);
      pendingFocus.current = ".start-link";
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "The typed connection was rejected.");
    }
  };

  const runConsoleTool = async (tool: ConsoleTool) => {
    setConsoleBusy(tool);
    try {
      let result: unknown;
      if (tool === "inspect_spell") {
        result = await handlers.inspect_spell();
      } else if (tool === "trace_effect") {
        result = await handlers.trace_effect({ effectId });
      } else if (tool === "simulate_cast") {
        result = await handlers.simulate_cast();
      } else if (tool === "explain_side_effect") {
        result = await handlers.explain_side_effect({ sideEffectId: effectId });
      } else if (tool === "set_sacred_constraint") {
        result = await handlers.set_sacred_constraint({
          targetId: subjectId,
          reason: constraintText,
        });
      } else if (tool === "propose_spell_patch") {
        result = await handlers.propose_spell_patch();
      } else {
        if (!patch) throw new Error("Propose a current patch before applying it.");
        result = await handlers.apply_spell_patch({ patchId: patch.id });
      }
      setConsoleOutput(JSON.stringify(result, null, 2));
    } catch (error) {
      setConsoleOutput(JSON.stringify({
        error: error instanceof Error ? error.message : "Tool execution failed.",
      }, null, 2));
    } finally {
      setConsoleBusy(null);
    }
  };

  const selectedNode = graph.nodes.find((node) => node.id === selected);
  const connectSource = graph.nodes.find((node) => node.id === connectFrom);
  const tracedNodeIds = activity[0]?.nodeIds ?? [];
  const highlightedIds = new Set(tracedNodeIds);
  const isSacred = graph.constraints.some((item) => item.targetId === subjectId);
  const familiarPrediction = useMemo(
    () => FAMILIAR_GNN_ENABLED && cast && !cast.success ? inferFamiliar(graph, cast) : null,
    [cast, graph],
  );
  const patchPreview = patch?.operationLedger ?? [];
  // `preserves` holds identifiers, which are the graph's vocabulary and not the
  // human's. Resolve them to rune names so the person approving the patch reads
  // what they are protecting rather than an internal token.
  const preservedNames = (patch?.preserves ?? [])
    .map((id) => graph.nodes.find((node) => node.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  const removedPatchEdgeIds = new Set(
    patchPreview.filter((entry) => entry.kind === "disconnect" && entry.edgeId).map((entry) => entry.edgeId!),
  );
  const activatedPatchNodeIds = new Set(
    patchPreview.filter((entry) => entry.kind === "awaken").flatMap((entry) => entry.nodeIds),
  );
  const addedPatchEdges = patchPreview.filter(
    (entry): entry is typeof entry & { fromId: string; toId: string } =>
      entry.kind === "connect" && Boolean(entry.fromId && entry.toId),
  );

  return (
    <div className="machina">
      <a className="skip-link" href="#workspace">Skip to the spell workspace</a>
      <header className="topbar">
        <div className="brand-lockup">
          {/* A hexagon holding a three-node causal path: the subject of the
              product, drawn rather than abbreviated. "HX" in a bordered box read
              as a placeholder. Inline SVG keeps it under the CSP with no request. */}
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" role="presentation" focusable="false">
              <path
                d="M16 2.6 27.2 9v14L16 29.4 4.8 23V9z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M11 20.5 16 12.4l5 4.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="11" cy="20.5" r="2.1" fill="currentColor" />
              <circle cx="16" cy="12.4" r="2.1" fill="currentColor" />
              <circle cx="21" cy="17.1" r="2.1" fill="currentColor" />
            </svg>
          </span>
          <div>
            <h1>Hex Machina</h1>
            <p className="eyebrow">Agent gym for constraint-aware repair</p>
          </div>
        </div>
        <div className="mission-chip">
          <span>Objective</span>
          <strong>{graph.desiredOutcome}</strong>
        </div>
        {/* An ordinary browser has no model context, so this settles on the
            no-host state in every screenshot and in the demo recording. It says
            what is true — the seven tools are defined and offered — instead of
            labelling the protocol this entry is judged on as unavailable. */}
        <div className={`site-tool-state ${mcpState}`} title="This page defines seven semantic tools and registers them on document.modelContext whenever a browser agent provides one.">
          <span className="status-dot" />
          {mcpState === "live"
            ? "WebMCP · 7 tools registered"
            : mcpState === "checking"
              ? "WebMCP · connecting to host…"
              : "WebMCP · 7 tools ready for a host"}
        </div>
      </header>

      <main className="workspace" id="workspace" tabIndex={-1}>
        <aside className="brief-panel panel" aria-label="Lesson and browser-agent brief">
          <div>
            <p className="section-kicker">{story.lesson}</p>
            <h2>{story.title}</h2>
            <p className="lede">
              {story.lede}
            </p>
          </div>

          <blockquote className={isSacred ? "wish active" : "wish"}>
            <span>Human intent</span>
            {`“${constraintText}”`}
          </blockquote>

          <div className="controls">
            {!cast && <button className="primary" onClick={castSpell}>Cast spell <kbd>↵</kbd></button>}
            {cast && !cast.success && !activity.some((item) => item.tool === "explain_side_effect") && <button className="primary" onClick={diagnose}>Trace the glitch</button>}
            {cast && !cast.success && activity.some((item) => item.tool === "explain_side_effect") && !isSacred && <button className="primary" onClick={protectSubject}>{story.protect}</button>}
            {isSacred && !patch && !cast?.success && <button className="primary" onClick={proposeRepair}>Find a repair</button>}
            {/* Once a patch exists the decision moves to the review card in the
                other rail, and the primary action used to simply vanish from
                here. This keeps the thread: it says where the next step went and
                takes you to it. */}
            {patch && !cast?.success && (
              <button
                className="primary"
                onClick={() => {
                  const card = document.querySelector(".patch-card");
                  card?.scrollIntoView({ behavior: "smooth", block: "center" });
                  card?.querySelector<HTMLButtonElement>(".patch-apply")?.focus();
                }}
              >
                Review the patch
              </button>
            )}
            {cast?.success && (
              <button
                className="primary"
                onClick={() => {
                  const lab = document.querySelector(".scenario-lab");
                  lab?.setAttribute("open", "");
                  lab?.scrollIntoView({ behavior: "smooth", block: "center" });
                  lab?.querySelector<HTMLElement>("summary")?.focus();
                }}
              >
                Try a held-out task
              </button>
            )}
            <button className="quiet" onClick={reset}>Reset lesson</button>
          </div>

          {/* A judge arriving in a WebMCP browser needs the prompt in front of
              them, not in a README they were not told to open. */}
          <section className="agent-brief" aria-label="Drive this with a browser agent">
            <p className="section-kicker">Drive this with a browser agent</p>
            <p className="agent-brief-note">
              Seven tools on <code>document.modelContext</code> let an agent inspect this graph,
              prove why it fails, and repair it without breaking a constraint you set — the shape
              of any workflow builder or data pipeline. Paste this into a WebMCP-capable agent.
            </p>
            <div className="agent-brief-actions">
              <button
                type="button"
                className="quiet"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(story.prompt);
                    setPromptCopied(true);
                    window.setTimeout(() => setPromptCopied(false), 1800);
                  } catch {
                    setPromptCopied(false);
                  }
                }}
              >
                {promptCopied ? "Copied" : "Copy prompt"}
              </button>
              <a className="quiet" href={REPO_URL} target="_blank" rel="noreferrer noopener">Source</a>
            </div>
            <p className={`agent-brief-prompt ${promptExpanded ? "expanded" : ""}`}>{story.prompt}</p>
            {/* A mask fade over clamped text reads as "this is cut off", not as
                "this continues" — measured, it hid up to 69% of the prompt with
                no scrollbar painted. An explicit control says which it is. */}
            <button
              type="button"
              className="prompt-toggle"
              aria-expanded={promptExpanded}
              onClick={() => setPromptExpanded((open) => !open)}
            >
              {promptExpanded ? "Show less" : "Show the full prompt"}
            </button>
          </section>

          <ol className="quest-steps" aria-label="Investigation steps">
            <li className={cast ? "done" : "current"}><span>01</span><div><strong>Cast the spell</strong><small>Observe before editing.</small></div></li>
            <li className={activity.some((item) => item.tool === "explain_side_effect") ? "done" : cast ? "current" : ""}><span>02</span><div><strong>Trace the glitch</strong><small>Find the causal path.</small></div></li>
            <li className={isSacred ? "done" : ""}><span>03</span><div><strong>Name what matters</strong><small>{story.nameStep}</small></div></li>
            <li className={cast?.success ? "done" : patch ? "current" : ""}><span>04</span><div><strong>Repair & recast</strong><small>Change the graph, not the wish.</small></div></li>
          </ol>

        </aside>

        <section className="canvas-panel panel" aria-label="Executable spell graph">
          <div className="canvas-header">
            <div><p className="section-kicker">Live spell · v{graph.version}</p><h2>{story.canvas}</h2></div>
            <p className="graph-legend" aria-label="Graph edge legend">
              <span><i /> Flow</span>
              <span className="legend-target"><i /> Target</span>
              <span className="legend-modifier"><i /> Modify</span>
              <span className="legend-patch"><i /> Proposed</span>
            </p>
            <span className={`cast-state ${cast?.success ? "success" : cast ? "danger" : "idle"}`}>
              {cast?.success ? "Stable" : cast ? "Side effect detected" : "Ready to cast"}
            </span>
          </div>

          {/* A node graph cannot tile a phone-width canvas: a rune is a third of
              the available width, so any layout that fits three columns on a
              desktop collides on a phone. The diagram keeps its proportions and
              pans instead, which is how diagrams behave on phones. */}
          <div className="canvas-viewport">
          <div
            className={`spell-canvas ${dragging ? "is-rearranging" : ""} ${connectSource ? "is-connecting" : ""}`}
            role="application"
            aria-label={`Spell graph, version ${graph.version}: ${graph.nodes.length} runes and ${graph.edges.length} connections. ${
              graph.edges.map((edge) => {
                const from = graph.nodes.find((node) => node.id === edge.from)?.label ?? edge.from;
                const to = graph.nodes.find((node) => node.id === edge.to)?.label ?? edge.to;
                return `${from} ${edge.type.replace("_", " ")} ${to}`;
              }).join(". ")
            }`}
            ref={canvasRef}
            onPointerMove={(event) => moveNodeFromPointer(event.clientX, event.clientY)}
            onPointerUp={finishDragging}
            onPointerCancel={finishDragging}
          >
            <svg className="edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker id="arrow-default" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="var(--edge-flow)" />
                </marker>
                <marker id="arrow-target" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="var(--edge-target)" />
                </marker>
                <marker id="arrow-add" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="var(--edge-add)" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const from = graph.nodes.find((node) => node.id === edge.from)!;
                const to = graph.nodes.find((node) => node.id === edge.to)!;
                const rawFromPosition = positions[from.id] ?? from;
                const rawToPosition = positions[to.id] ?? to;
                const fromPosition = { x: toCanvasX(rawFromPosition.x), y: toCanvasY(rawFromPosition.y) };
                const toPosition = { x: toCanvasX(rawToPosition.x), y: toCanvasY(rawToPosition.y) };
                const dx = toPosition.x - fromPosition.x;
                const dy = toPosition.y - fromPosition.y;
                const distance = Math.hypot(dx, dy) || 1;
                const endpointInset = 6;
                const x1 = fromPosition.x + (dx / distance) * endpointInset;
                const y1 = fromPosition.y + (dy / distance) * endpointInset;
                const x2 = toPosition.x - (dx / distance) * endpointInset;
                const y2 = toPosition.y - (dy / distance) * endpointInset;
                const traceIndex = tracedNodeIds.findIndex((nodeId, index) => (
                  nodeId === from.id && tracedNodeIds[index + 1] === to.id
                ));
                const active = traceIndex >= 0;
                const pendingRemoval = removedPatchEdgeIds.has(edge.id);
                return <line key={edge.id} data-edge-id={edge.id} x1={x1} y1={y1} x2={x2} y2={y2} className={`${edge.type} ${active ? "active" : ""} ${pendingRemoval ? "patch-remove" : ""}`} style={active ? { animationDelay: `${traceIndex * 90}ms` } : undefined} />;
              })}
              {addedPatchEdges.map((entry) => {
                const from = graph.nodes.find((node) => node.id === entry.fromId)!;
                const to = graph.nodes.find((node) => node.id === entry.toId)!;
                const rawFromPosition = positions[from.id] ?? from;
                const rawToPosition = positions[to.id] ?? to;
                const fromPosition = { x: toCanvasX(rawFromPosition.x), y: toCanvasY(rawFromPosition.y) };
                const toPosition = { x: toCanvasX(rawToPosition.x), y: toCanvasY(rawToPosition.y) };
                const dx = toPosition.x - fromPosition.x;
                const dy = toPosition.y - fromPosition.y;
                const distance = Math.hypot(dx, dy) || 1;
                const endpointInset = 6;
                return <line key={`preview-${entry.edgeId}`} data-preview-edge-id={entry.edgeId} x1={fromPosition.x + (dx / distance) * endpointInset} y1={fromPosition.y + (dy / distance) * endpointInset} x2={toPosition.x - (dx / distance) * endpointInset} y2={toPosition.y - (dy / distance) * endpointInset} className="patch-add" />;
              })}
            </svg>

            {graph.nodes.map((node) => {
              const sacred = graph.constraints.some((item) => item.targetId === node.id);
              const highlighted = highlightedIds.has(node.id);
              const rawPosition = positions[node.id] ?? node;
              const position = { x: toCanvasX(rawPosition.x), y: toCanvasY(rawPosition.y) };
              const validPortTypes = connectSource && node.id !== connectSource.id
                ? getValidEdgeTypes(connectSource.kind, node.kind)
                : [];
              const connectionClass = !connectSource
                ? ""
                : node.id === connectSource.id
                  ? "connect-source"
                  : validPortTypes.length
                    ? "connect-compatible"
                    : "connect-incompatible";
              return (
                <button
                  key={node.id}
                  className={`rune rune-${node.kind} ${node.dormant ? "dormant" : ""} ${sacred ? "sacred" : ""} ${highlighted ? "highlighted" : ""} ${activatedPatchNodeIds.has(node.id) ? "patch-activate" : ""} ${selected === node.id ? "selected" : ""} ${dragging === node.id ? "dragging" : ""} ${connectionClass}`}
                  style={{ left: `${position.x}%`, top: `${position.y}%` }}
                  tabIndex={connectionClass === "connect-incompatible" ? -1 : undefined}
                  onPointerDown={(event) => {
                    if (connectSource) return;
                    const nodeBounds = event.currentTarget.getBoundingClientRect();
                    if (nodeBounds) {
                      const nodeCenterX = nodeBounds.left + nodeBounds.width / 2;
                      const nodeCenterY = nodeBounds.top + nodeBounds.height / 2;
                      dragOffsetRef.current = {
                        x: event.clientX - nodeCenterX,
                        y: event.clientY - nodeCenterY,
                      };
                    }
                    draggingRef.current = node.id;
                    setDragging(node.id);
                    setSelected(node.id);
                    canvasRef.current?.setPointerCapture(event.pointerId);
                  }}
                  onKeyDown={(event) => {
                    // Nudges are specified as a share of the canvas the user can
                    // see, so convert into the authored space positions live in.
                    const step = event.shiftKey ? 5 : 2;
                    const deltaX = step / ((100 - horizontalInset * 2) / (AUTHORED.maxX - AUTHORED.minX));
                    const deltaY = step / ((100 - verticalInset * 2) / (AUTHORED.maxY - AUTHORED.minY));
                    const offsets: Partial<Record<string, NodePosition>> = {
                      ArrowLeft: { x: -deltaX, y: 0 },
                      ArrowRight: { x: deltaX, y: 0 },
                      ArrowUp: { x: 0, y: -deltaY },
                      ArrowDown: { x: 0, y: deltaY },
                    };
                    const offset = offsets[event.key];
                    if (!offset) return;
                    event.preventDefault();
                    moveNode(node.id, rawPosition.x + offset.x, rawPosition.y + offset.y);
                  }}
                  onClick={() => chooseRune(node.id)}
                  aria-pressed={selected === node.id}
                  aria-label={`${node.label}, ${kindLabel[node.kind]}.${
                    sacred ? " Protected by a sacred constraint." : ""
                  }${node.dormant ? " Dormant; not part of the live spell." : ""}${
                    activatedPatchNodeIds.has(node.id) ? " Activated by the proposed patch." : ""
                  }${highlighted ? " On the traced causal path." : ""} ${
                    connectSource
                      ? node.id === connectSource.id
                        ? "Connection source."
                        : validPortTypes.length
                          ? `Compatible ${validPortTypes.join(" or ")} port.`
                          : "Incompatible port."
                      : "Drag to rearrange; arrow keys nudge."
                  }`}
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                >
                  <span className="rune-glyph" aria-hidden="true">{node.glyph}</span>
                  <span className="rune-copy"><strong>{node.label}</strong><small>{kindLabel[node.kind]}</small></span>
                  {sacred && <span className="sacred-pin" title="Sacred constraint">Lock</span>}
                  {connectSource && (
                    <span className={`typed-port ${validPortTypes.length ? "valid" : ""}`} aria-hidden="true">
                      {node.id === connectSource.id ? "From" : validPortTypes[0]?.replace("_", " ") ?? "×"}
                    </span>
                  )}
                </button>
              );
            })}

            <p className="canvas-hint">
              <span className="hint-pan">Swipe to pan the graph · </span>Drag runes to rearrange · Arrow keys nudge
            </p>

          </div>
          </div>

          {/* Below the canvas, not over it: an overlay verdict hid the runes it
              was describing, including the dormant ones a repair has to use. */}
          <div className={`cast-vision ${cast ? "visible" : ""} ${cast?.success ? "vision-success" : "vision-failure"}`}>
            {cast && <><div className="vision-symbol" aria-hidden="true">{cast.success ? "Verified" : "Cast failed"}</div><strong>{cast.success ? story.success : story.failure}</strong><span>{cast.summary}</span></>}
          </div>

          <footer className={`node-inspector ${connectSource ? "connection-active" : ""}`}>
            <span className="inspector-glyph">{selectedNode?.glyph ?? "·"}</span>
            <div><small>{selectedNode ? kindLabel[selectedNode.kind] : "Rune"}</small><strong>{selectedNode?.label ?? "Select a rune"}</strong></div>
            <p>{selectedNode?.description}</p>
            <div className="connection-editor">
              {connectionDraft ? (
                <>
                  <label>
                    <span>Edge type</span>
                    <select
                      aria-label="Typed edge category"
                      value={connectionDraft.edgeType}
                      onChange={(event) => setConnectionDraft({ ...connectionDraft, edgeType: event.target.value as SpellEdgeType })}
                    >
                      {connectionDraft.validTypes.map((edgeType) => <option key={edgeType} value={edgeType}>{edgeType.replace("_", " ")}</option>)}
                    </select>
                  </label>
                  <button type="button" className="confirm-link" onClick={confirmConnection}>Add edge</button>
                  <button type="button" className="cancel-link" onClick={cancelConnection}>Cancel</button>
                </>
              ) : connectSource ? (
                <>
                  <span className="connection-prompt">Choose a compatible target</span>
                  <button type="button" className="cancel-link" onClick={cancelConnection}>Cancel</button>
                </>
              ) : (
                <button type="button" className="start-link" onClick={startConnection} disabled={!selectedNode}>Link from rune</button>
              )}
              <small>{connectionMessage}</small>
            </div>
          </footer>
        </section>

        <aside className="familiar-panel panel" aria-label="Agent evidence and evaluation">
          {/* The rail itself never scrolls at desktop widths. This narrative
              zone and the feed below each scroll on their own, so the Task
              loader and Local tool console stay pinned and reachable. */}
          <div className="familiar-scroll">
          <div className="familiar-title"><span className="familiar-orb">M</span><div><p className="section-kicker">Field note</p><h2>Moth</h2></div></div>

          {patch ? (
            <article className="patch-card">
              <p className="section-kicker">{previewCast ? "Unapplied simulation" : "Proposed patch"}</p>
              <h3>{patch.title}</h3>
              <p>{patch.rationale}</p>
              {previewCast && (
                <div className="preview-verdict">
                  <span>Predicted</span>
                  <strong>{previewCast.success ? "Stable" : "Unstable"}</strong>
                  <small>Editor remains at graph v{graph.version}</small>
                </div>
              )}
              <dl><div><dt>Rank</dt><dd>#{patch.searchEvidence.rank}</dd></div><div><dt>Edits</dt><dd>{patch.searchEvidence.editCount}</dd></div><div><dt>Eligible</dt><dd>{patch.searchEvidence.eligibleCandidateCount}/{patch.searchEvidence.candidateCount}</dd></div></dl>
              <div className="patch-preflight" aria-label="Patch preconditions">
                <span>Preflight · graph v{patch.preconditions.expectedGraphVersion}</span>
                <strong>{patch.preconditions.requiredEdgeIds.length} live edges · {patch.preconditions.requiredDormantNodeIds.length} dormant runes · {patch.preconditions.requiredConstraintIds.length} sacred lock</strong>
              </div>
              <div className="patch-actions">
                {!previewCast && <button type="button" className="patch-simulate" onClick={previewRepair}>Simulate patch safely</button>}
                <button type="button" className="patch-apply" onClick={applyRepair}>Apply patch & recast</button>
              </div>
              <details className="patch-ledger" open>
                <summary>Review {patchPreview.length} graph edits</summary>
                <ol>
                  {patchPreview.map((entry) => (
                    <li key={entry.key} data-patch-kind={entry.kind}>
                      <span aria-hidden="true">{entry.kind === "connect" ? "+" : entry.kind === "disconnect" ? "−" : "✦"}</span>
                      <p>{entry.label}</p>
                    </li>
                  ))}
                </ol>
              </details>
              {patch.tradeoffs.length > 0 && (
                <div className="patch-tradeoffs" role="note">
                  <strong>What this repair does</strong>
                  <ul>
                    {patch.tradeoffs.map((tradeoff) => <li key={tradeoff}>{tradeoff}</li>)}
                  </ul>
                </div>
              )}
              <div className="preserves" data-preserving={preservedNames.length > 0}>
                {preservedNames.length > 0
                  ? `Protected: ${preservedNames.join(", ")}`
                  : "No sacred lock is set, so nothing here is protected."}
              </div>
            </article>
          ) : (
            <div className="familiar-message">
              <p className="section-kicker">Current read</p>
              <p>{cast?.success ? "The graph is stable. Every promise survived the repair." : cast ? story.read : "Cast first. Good magic begins with evidence."}</p>
              {/* The patch card unmounts once the repair is applied, so the way
                  back lives with the read that reports the repair held. */}
              {cast?.success && revertToken && (
                <div className="familiar-message-actions">
                  <button type="button" className="quiet" onClick={undoRepair}>Undo agent patch</button>
                </div>
              )}
            </div>
          )}

          {familiarPrediction && (
            <section className="familiar-signal" aria-label="Experimental Familiar graph prediction">
              <div className="familiar-signal-heading">
                <div><p className="section-kicker">Experimental graph signal</p><strong>Two-hop suspect ranking</strong></div>
                <span title="Advisory model; the simulator remains authoritative">Advisory</span>
              </div>
              <ol>
                {familiarPrediction.ranking.map((item, index) => (
                  <li key={item.nodeId}>
                    <button type="button" onClick={() => setSelected(item.nodeId)} aria-label={`Inspect ${item.label}, Familiar rank ${index + 1}`}>
                      <span><b>{index + 1}</b>{item.label}</span>
                      <strong>{Math.round(item.probability * 100)}%</strong>
                    </button>
                    <span className="signal-meter" aria-hidden="true"><i style={{ width: `${Math.round(item.probability * 100)}%` }} /></span>
                  </li>
                ))}
              </ol>
              <p>Two message-passing rounds suggest where to inspect. The deterministic trace still decides what happened.</p>
            </section>
          )}

          <section className="agent-gym" aria-label="Agent Gym evaluation">
            <div className="agent-gym-heading">
              <div><p className="section-kicker">Agent Gym · evaluation mode</p><h3>Scored, replayable episode</h3></div>
              <span className={gymSnapshot.status}>{gymSnapshot.status}</span>
            </div>
            <p>Every site-tool call records reward plus before/after graph observations. The interface and visiting agents use the same handlers.</p>
            <div className="gym-score">
              <strong>{gymSnapshot.score}<small> / {gymSnapshot.maxScore}</small></strong>
              <span>{gymSnapshot.trajectory.length} steps · {gymSnapshot.completedMilestones.length}/9 milestones</span>
            </div>
            <div className="gym-meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (gymSnapshot.score / gymSnapshot.maxScore) * 100))}%` }} /></div>
            <div className="policy-baselines" aria-label="Held-out policy benchmark">
              <div className="policy-baselines-heading"><span>Held-out policy</span><span>Mean reward</span></div>
              <p className="policy-baselines-note">
                Scripted control policies scored on held-out tasks, not options to choose.
                They exist to show the reward separates good repair from cheap repair.
              </p>
              {AGENT_GYM_POLICY_BASELINES.map((baseline) => (
                <div className="policy-baseline" key={baseline.id}>
                  <span>{baseline.label}<small>{baseline.outcome}</small></span>
                  <strong className={baseline.score < 0 ? "negative" : undefined}>{baseline.score > 0 ? `+${baseline.score}` : baseline.score}</strong>
                </div>
              ))}
            </div>
            <div className="gym-foot">
              <small>96 variants · 3 causal families · vector + offline rollouts</small>
              <button type="button" onClick={exportEpisode} disabled={!gymSnapshot.trajectory.length}>Export episode JSON</button>
            </div>
          </section>
          </div>

          <div className="activity-header"><span>Tool activity</span><small>{activity.length ? "Live" : "Waiting · 7 tools registered"}</small></div>
          <div className="activity-list" role="log" aria-live="polite" aria-label="Agent activity">
            {activity.map((item) => (
              <article key={item.id}><span className="activity-mark">{item.tool === "simulate_cast" ? "↯" : item.tool.includes("patch") ? "⌁" : "◎"}</span><div><strong>{item.tool}</strong><p>{item.detail}</p></div></article>
            ))}
            {TOOL_ROSTER.filter((tool) => !activity.some((item) => item.tool === tool.name)).map((tool) => (
              <article key={tool.name} className="waiting" aria-label={`${tool.name} registered, not yet called`}>
                <span className="activity-mark" aria-hidden="true">·</span>
                <div><strong>{tool.name}</strong><p>{tool.description}</p></div>
              </article>
            ))}
          </div>

          {/* Loading a held-out task is the fastest way to show this is not a
              scripted demo: every rune, edge and effect ID is remapped, and the
              same seven tools still solve it. */}
          <details className="tool-console scenario-lab">
            <summary>
              <span>
                <strong>Task loader</strong>
                <small>Swap in any of 96 generated tasks · 3 causal rules</small>
              </span>
              <span aria-hidden="true">⌄</span>
            </summary>
            <p>
              Swap the live workspace for any generated task. Identifiers are opaque and
              remapped per task, so nothing here is memorised from the lesson above.
            </p>
            <div className="lab-controls">
              <label>
                Rule
                <select
                  aria-label="Rule"
                  value={labFamily}
                  onChange={(event) => { setLabFamily(event.target.value as AgentGymFamilyId); setLabIndex(0); }}
                >
                  {familyIds.map((id) => (
                    <option key={id} value={id}>{STORY[FAMILY_RULE[id]]?.lesson ?? id}</option>
                  ))}
                </select>
              </label>
              <label>
                Split
                <select
                  aria-label="Split"
                  value={labSplit}
                  onChange={(event) => { setLabSplit(event.target.value as AgentGymSplit); setLabIndex(0); }}
                >
                  <option value="train">train</option>
                  <option value="validation">validation</option>
                  <option value="test">test (held out)</option>
                </select>
              </label>
              <label>
                Task
                <select aria-label="Task" value={labIndex} onChange={(event) => setLabIndex(Number(event.target.value))}>
                  {Array.from({ length: AGENT_GYM_FAMILY_SPLIT_SIZES[labFamily][labSplit] }, (_, index) => (
                    <option key={index} value={index}>{String(index).padStart(2, "0")}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="lab-actions">
              <button type="button" className="quiet" onClick={loadRandomTask}>Surprise me</button>
              <button type="button" className="primary" onClick={() => loadTask(labFamily, labSplit, labIndex)}>Load task</button>
            </div>
            {variant && (
              <div className="lab-loaded">
                <code>{variant.scenarioId}</code>
                <small>seed {variant.seed} · protects {graph.nodes.find((node) => node.id === subjectId)?.label}</small>
              </div>
            )}
          </details>

          <details className="tool-console">
            <summary>
              <span><strong>Local tool console</strong><small>Same handlers · structured JSON</small></span>
              <span aria-hidden="true">⌄</span>
            </summary>
            <p>Invoke the seven semantic tools directly when browser Site Tools are unavailable.</p>
            <div className="tool-console-grid" aria-label="Semantic tool console">
              {consoleTools.map((tool) => (
                <button
                  key={tool.name}
                  type="button"
                  onClick={() => runConsoleTool(tool.name)}
                  disabled={consoleBusy !== null || (tool.name === "apply_spell_patch" && !patch)}
                  title={tool.name}
                  aria-label={`${tool.label} — ${tool.name}, ${tool.mutates ? "mutating" : "read-only"}`}
                >
                  <span>{tool.label}</span>
                  <small>{tool.mutates ? "Write" : "Read"}</small>
                  <code>{tool.name}</code>
                </button>
              ))}
            </div>
            <div className="console-result-header">
              <span>Structured result</span>
              <small>{consoleBusy ? `Running ${consoleBusy}` : `Graph v${graph.version}`}</small>
            </div>
            <pre aria-label="Tool result JSON">{consoleOutput}</pre>
          </details>
        </aside>
      </main>
    </div>
  );
}
