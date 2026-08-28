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
import { createMoonflowerScenario } from "@/src/scenarios/moonflower";
import type { CastResult } from "@/src/simulator/cast";
import { createSpellToolHandlers, type ReviewedSpellPatch, type SpellToolPresentation } from "@/src/tools/handlers";
import { registerWebMCPTools } from "@/src/tools/webmcp";

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
  { name: "set_sacred_constraint", label: "Protect ducks", mutates: true },
  { name: "propose_spell_patch", label: "Propose", mutates: false },
  { name: "apply_spell_patch", label: "Apply patch", mutates: true },
];

function initialPositions(graph: SpellGraph): Record<string, NodePosition> {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
}

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

export function HexMachina() {
  const [graph, setGraph] = useState<SpellGraph>(() => createMoonflowerScenario());
  const graphRef = useRef(graph);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [cast, setCast] = useState<CastResult | null>(null);
  const [previewCast, setPreviewCast] = useState<CastResult | null>(null);
  const [patch, setPatch] = useState<ReviewedSpellPatch | null>(null);
  const [revertToken, setRevertToken] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>("multiply");
  const [positions, setPositions] = useState<Record<string, NodePosition>>(() => initialPositions(graph));
  const [dragging, setDragging] = useState<string | null>(null);
  const [mcpReady, setMcpReady] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState("Select a tool to inspect its structured result.");
  const [consoleBusy, setConsoleBusy] = useState<ConsoleTool | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null);
  const [connectionMessage, setConnectionMessage] = useState("Select a rune, then start a typed link.");
  const [gymSession] = useState(() => new AgentGymSession());
  const [gymSnapshot, setGymSnapshot] = useState<AgentGymSnapshot>(() => gymSession.snapshot());
  const [canvasWidth, setCanvasWidth] = useState(0);
  const activityId = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const horizontalInset = canvasWidth ? Math.min(22, Math.max(8, (64 / canvasWidth) * 100)) : 9;

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setCanvasWidth(canvas.clientWidth);
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

  useEffect(() => {
    const registration = new AbortController();
    let active = true;
    registerWebMCPTools(handlers, registration.signal)
      .then((supported) => {
        if (active) setMcpReady(supported);
      })
      .catch(() => {
        if (active) setMcpReady(false);
      });
    return () => {
      active = false;
      registration.abort();
    };
  }, [handlers]);

  const castSpell = async () => {
    setRevertToken(null);
    await handlers.simulate_cast();
  };

  const diagnose = async () => {
    await handlers.trace_effect({ effectId: "flooded-observatory" });
    await handlers.explain_side_effect({ sideEffectId: "flooded-observatory" });
  };

  const protectDucks = async () => {
    await handlers.set_sacred_constraint({
      targetId: "summon-ducks",
      reason: "The ducks are funny. They must remain in the final spell.",
    });
    setPatch(null);
  };

  const proposeRepair = async () => {
    await handlers.propose_spell_patch();
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

  const reset = () => {
    const next = createMoonflowerScenario();
    graphRef.current = next;
    setGraph(next);
    setCast(null);
    setPreviewCast(null);
    setPatch(null);
    setRevertToken(null);
    setActivity([]);
    setSelected("multiply");
    setPositions(initialPositions(next));
    setDragging(null);
    draggingRef.current = null;
    dragOffsetRef.current = { x: 0, y: 0 };
    setConsoleOutput("Lesson reset. Select a tool to inspect graph v1.");
    setConsoleBusy(null);
    setConnectFrom(null);
    setConnectionDraft(null);
    setConnectionMessage("Select a rune, then start a typed link.");
    setGymSnapshot(gymSession.reset());
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
        x: clampPosition(x, horizontalInset, 100 - horizontalInset),
        y: clampPosition(y, 7, 90),
      },
    }));
  }, [horizontalInset]);

  const moveNodeFromPointer = useCallback((clientX: number, clientY: number) => {
    const nodeId = draggingRef.current;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!nodeId || !bounds) return;
    moveNode(
      nodeId,
      ((clientX - bounds.left - dragOffsetRef.current.x) / bounds.width) * 100,
      ((clientY - bounds.top - dragOffsetRef.current.y) / bounds.height) * 100,
    );
  }, [moveNode]);

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
    setConnectionMessage(`${source.label} → ${target.label} supports ${validTypes.join(" or ")}.`);
  };

  const startConnection = () => {
    if (!selectedNode) return;
    setConnectFrom(selectedNode.id);
    setConnectionDraft(null);
    setConnectionMessage(`Linking from ${selectedNode.label}. Choose a highlighted compatible rune.`);
  };

  const cancelConnection = () => {
    setConnectFrom(null);
    setConnectionDraft(null);
    setConnectionMessage("Typed link cancelled. The spell was not changed.");
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
        result = await handlers.trace_effect({ effectId: "flooded-observatory" });
      } else if (tool === "simulate_cast") {
        result = await handlers.simulate_cast();
      } else if (tool === "explain_side_effect") {
        result = await handlers.explain_side_effect({ sideEffectId: "flooded-observatory" });
      } else if (tool === "set_sacred_constraint") {
        result = await handlers.set_sacred_constraint({
          targetId: "summon-ducks",
          reason: "The ducks are funny. They must remain in the final spell.",
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
  const isSacred = graph.constraints.some((item) => item.targetId === "summon-ducks");
  const familiarPrediction = useMemo(
    () => FAMILIAR_GNN_ENABLED && cast && !cast.success ? inferFamiliar(graph, cast) : null,
    [cast, graph],
  );
  const patchPreview = patch?.operationLedger ?? [];
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
  const stage = cast?.success ? "stable" : patch ? "patch" : isSacred ? "constraint" : cast ? "failure" : "ready";

  return (
    <main className={`machina stage-${stage}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">HX</span>
          <div>
            <p className="eyebrow">The cooperative spell debugger</p>
            <h1>Hex Machina</h1>
          </div>
        </div>
        <div className="mission-chip">
          <span>Objective</span>
          <strong>Water the moonflower. Keep the room dry.</strong>
        </div>
        <div className={`site-tool-state ${mcpReady ? "connected" : "local"}`}>
          <span className="status-dot" />
          {mcpReady ? "7 site tools live" : "Local spell console"}
        </div>
      </header>

      <section className="workspace">
        <aside className="brief-panel panel">
          <div>
            <p className="section-kicker">Lesson 01</p>
            <h2>The overenthusiastic rain spell</h2>
            <p className="lede">
              This spell is almost right. Cast it, find the unstable path, then repair it without losing what you love.
            </p>
          </div>

          <ol className="quest-steps" aria-label="Investigation steps">
            <li className={cast ? "done" : "current"}><span>01</span><div><strong>Cast the spell</strong><small>Observe before editing.</small></div></li>
            <li className={activity.some((item) => item.tool === "explain_side_effect") ? "done" : cast ? "current" : ""}><span>02</span><div><strong>Trace the glitch</strong><small>Find the causal path.</small></div></li>
            <li className={isSacred ? "done" : ""}><span>03</span><div><strong>Name what matters</strong><small>The ducks must remain.</small></div></li>
            <li className={cast?.success ? "done" : patch ? "current" : ""}><span>04</span><div><strong>Repair & recast</strong><small>Change the graph, not the wish.</small></div></li>
          </ol>

          <div className="controls">
            {!cast && <button className="primary" onClick={castSpell}>Cast spell <kbd>↵</kbd></button>}
            {cast && !cast.success && !activity.some((item) => item.tool === "explain_side_effect") && <button className="primary" onClick={diagnose}>Trace the glitch</button>}
            {cast && !cast.success && activity.some((item) => item.tool === "explain_side_effect") && !isSacred && <button className="primary" onClick={protectDucks}>Protect the ducks</button>}
            {isSacred && !patch && !cast?.success && <button className="primary" onClick={proposeRepair}>Find a repair</button>}
            {cast?.success && revertToken && <button className="quiet" onClick={undoRepair}>Undo agent patch</button>}
            <button className="quiet" onClick={reset}>Reset lesson</button>
          </div>

          <blockquote className={isSacred ? "wish active" : "wish"}>
            <span>Human intent</span>
            “The ducks are funny. They stay.”
          </blockquote>
        </aside>

        <section className="canvas-panel panel" aria-label="Executable spell graph">
          <div className="canvas-header">
            <div><p className="section-kicker">Live spell · v{graph.version}</p><h2>Rain for a moonflower</h2></div>
            <span className={`cast-state ${cast?.success ? "success" : cast ? "danger" : "idle"}`}>
              {cast?.success ? "Stable" : cast ? "Side effect detected" : "Ready to cast"}
            </span>
          </div>

          <div
            className={`spell-canvas ${dragging ? "is-rearranging" : ""} ${connectSource ? "is-connecting" : ""}`}
            ref={canvasRef}
            onPointerMove={(event) => moveNodeFromPointer(event.clientX, event.clientY)}
            onPointerUp={finishDragging}
            onPointerCancel={finishDragging}
          >
            <svg className="edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker id="arrow-default" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="#8299aa" />
                </marker>
                <marker id="arrow-target" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="#c6543b" />
                </marker>
                <marker id="arrow-add" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="#287a5b" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const from = graph.nodes.find((node) => node.id === edge.from)!;
                const to = graph.nodes.find((node) => node.id === edge.to)!;
                const rawFromPosition = positions[from.id] ?? from;
                const rawToPosition = positions[to.id] ?? to;
                const fromPosition = { ...rawFromPosition, x: clampPosition(rawFromPosition.x, horizontalInset, 100 - horizontalInset) };
                const toPosition = { ...rawToPosition, x: clampPosition(rawToPosition.x, horizontalInset, 100 - horizontalInset) };
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
                const fromPosition = { ...rawFromPosition, x: clampPosition(rawFromPosition.x, horizontalInset, 100 - horizontalInset) };
                const toPosition = { ...rawToPosition, x: clampPosition(rawToPosition.x, horizontalInset, 100 - horizontalInset) };
                const dx = toPosition.x - fromPosition.x;
                const dy = toPosition.y - fromPosition.y;
                const distance = Math.hypot(dx, dy) || 1;
                const endpointInset = 6;
                return <line key={`preview-${entry.edgeId}`} data-preview-edge-id={entry.edgeId} x1={fromPosition.x + (dx / distance) * endpointInset} y1={fromPosition.y + (dy / distance) * endpointInset} x2={toPosition.x - (dx / distance) * endpointInset} y2={toPosition.y - (dy / distance) * endpointInset} className="patch-add" />;
              })}
            </svg>

            <p className="graph-legend" aria-label="Graph edge legend">
              <span><i /> Flow</span>
              <span className="legend-target"><i /> Target</span>
              <span className="legend-modifier"><i /> Modify</span>
              <span className="legend-patch"><i /> Proposed</span>
            </p>

            {graph.nodes.map((node) => {
              const sacred = graph.constraints.some((item) => item.targetId === node.id);
              const highlighted = highlightedIds.has(node.id);
              const rawPosition = positions[node.id] ?? node;
              const position = { ...rawPosition, x: clampPosition(rawPosition.x, horizontalInset, 100 - horizontalInset) };
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
                    const delta = event.shiftKey ? 5 : 2;
                    const offsets: Partial<Record<string, NodePosition>> = {
                      ArrowLeft: { x: -delta, y: 0 },
                      ArrowRight: { x: delta, y: 0 },
                      ArrowUp: { x: 0, y: -delta },
                      ArrowDown: { x: 0, y: delta },
                    };
                    const offset = offsets[event.key];
                    if (!offset) return;
                    event.preventDefault();
                    moveNode(node.id, position.x + offset.x, position.y + offset.y);
                  }}
                  onClick={() => chooseRune(node.id)}
                  aria-label={`${node.label}, ${kindLabel[node.kind]}. ${connectSource ? node.id === connectSource.id ? "Connection source." : validPortTypes.length ? `Compatible ${validPortTypes.join(" or ")} port.` : "Incompatible port." : "Drag to rearrange; arrow keys nudge."}`}
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

            <p className="canvas-hint">Drag runes to rearrange · Arrow keys nudge</p>

            <div className={`cast-vision ${cast ? "visible" : ""} ${cast?.success ? "vision-success" : "vision-failure"}`} aria-live="polite">
              {cast && <><div className="vision-symbol" aria-hidden="true">{cast.success ? "Verified" : "Cast failed"}</div><strong>{cast.success ? "The moonflower blooms" : "Twelve ducks. One indoor lake."}</strong><span>{cast.summary}</span></>}
            </div>
          </div>

          <footer className={`node-inspector ${connectSource ? "connection-active" : ""}`}>
            <span className="inspector-glyph">{selectedNode?.glyph ?? "·"}</span>
            <div><small>{selectedNode ? kindLabel[selectedNode.kind] : "Rune"}</small><strong>{selectedNode?.label ?? "Select a rune"}</strong></div>
            <p>{selectedNode?.description}</p>
            <div className="connection-editor" aria-live="polite">
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

        <aside className="familiar-panel panel">
          <div className="familiar-title"><span className="familiar-orb">M</span><div><p className="section-kicker">Field note</p><h2>Moth</h2></div></div>

          {patch ? (
            <article className="patch-card">
              <p className="section-kicker">{previewCast ? "Unapplied simulation" : "Proposed patch"}</p>
              <h3>{patch.title}</h3>
              <p>{patch.rationale}</p>
              {previewCast && (
                <div className="preview-verdict" role="status">
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
              <div className="patch-actions">
                {!previewCast && <button type="button" className="patch-simulate" onClick={previewRepair}>Simulate patch safely</button>}
                <button type="button" className="patch-apply" onClick={applyRepair}>Apply patch & recast</button>
              </div>
              <div className="preserves">Locked: ducks remain sacred</div>
            </article>
          ) : (
            <div className="familiar-message">
              <p className="section-kicker">Current read</p>
              <p>{cast?.success ? "The graph is stable. Every promise survived the repair." : cast ? "I can see the flood path. Tell me what must survive before I touch the spell." : "Cast first. Good magic begins with evidence."}</p>
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
              <div><p className="section-kicker">Agent Gym · evaluation mode</p><h3>Scored semantic episode</h3></div>
              <span className={gymSnapshot.status}>{gymSnapshot.status}</span>
            </div>
            <p>Every site-tool call is a scored transition over the live graph. The interface and visiting agents use the same handlers.</p>
            <div className="gym-score" aria-live="polite">
              <strong>{gymSnapshot.score}<small> / {gymSnapshot.maxScore}</small></strong>
              <span>{gymSnapshot.trajectory.length} steps · {gymSnapshot.completedMilestones.length}/9 milestones</span>
            </div>
            <div className="gym-meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (gymSnapshot.score / gymSnapshot.maxScore) * 100))}%` }} /></div>
            <div className="gym-foot">
              <small>Single-scenario research prototype</small>
              <button type="button" onClick={exportEpisode} disabled={!gymSnapshot.trajectory.length}>Export episode JSON</button>
            </div>
          </section>

          <div className="activity-header"><span>Tool activity</span><small>{activity.length ? "Live" : "Waiting"}</small></div>
          <div className="activity-list" aria-live="polite">
            {activity.length === 0 && <p className="empty-activity">Semantic tool calls will appear here with visible evidence.</p>}
            {activity.map((item) => (
              <article key={item.id}><span className="activity-mark">{item.tool === "simulate_cast" ? "↯" : item.tool.includes("patch") ? "⌁" : "◎"}</span><div><strong>{item.tool}</strong><p>{item.detail}</p></div></article>
            ))}
          </div>

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
                >
                  <span>{tool.label}</span>
                  <small>{tool.mutates ? "Write" : "Read"}</small>
                </button>
              ))}
            </div>
            <div className="console-result-header">
              <span>Structured result</span>
              <small>{consoleBusy ? `Running ${consoleBusy}` : `Graph v${graph.version}`}</small>
            </div>
            <pre aria-live="polite" aria-label="Tool result JSON">{consoleOutput}</pre>
          </details>
        </aside>
      </section>
    </main>
  );
}
