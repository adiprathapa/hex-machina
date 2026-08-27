"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuneNode, SpellGraph, SpellPatch } from "@/src/domain/spell";
import { FAMILIAR_GNN_ENABLED, inferFamiliar } from "@/src/familiar/gnn";
import { createMoonflowerScenario } from "@/src/scenarios/moonflower";
import type { CastResult } from "@/src/simulator/cast";
import { createSpellToolHandlers } from "@/src/tools/handlers";
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
  const [patch, setPatch] = useState<SpellPatch | null>(null);
  const [selected, setSelected] = useState<string | null>("multiply");
  const [positions, setPositions] = useState<Record<string, NodePosition>>(() => initialPositions(graph));
  const [dragging, setDragging] = useState<string | null>(null);
  const [mcpReady, setMcpReady] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState("Select a tool to inspect its structured result.");
  const [consoleBusy, setConsoleBusy] = useState<ConsoleTool | null>(null);
  const activityId = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  const recordActivity = useCallback((tool: string, detail: string, nodeIds: string[] = []) => {
    activityId.current += 1;
    setActivity((items) => [{ id: activityId.current, tool, detail, nodeIds }, ...items].slice(0, 7));
    if (nodeIds[0]) setSelected(nodeIds[0]);
  }, []);

  const handlers = useMemo(
    // The closures read graphRef only when a tool executes, never during render.
    // eslint-disable-next-line react-hooks/refs
    () => createSpellToolHandlers({
      getGraph: () => graphRef.current,
      setGraph: (next) => {
        graphRef.current = next;
        setGraph(next);
      },
      recordActivity,
    }),
    [recordActivity],
  );

  useEffect(() => {
    registerWebMCPTools(handlers).then(setMcpReady).catch(() => setMcpReady(false));
  }, [handlers]);

  const castSpell = async () => {
    setPatch(null);
    setCast(await handlers.simulate_cast());
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
    const result = await handlers.propose_spell_patch();
    setPatch(result.patches[0]?.predictedOutcome ? result.patches[0] : result.patches[0] ?? null);
  };

  const applyRepair = async () => {
    if (!patch) return;
    const result = await handlers.apply_spell_patch({ patchId: patch.id });
    setCast(result.verification);
    setPatch(null);
  };

  const reset = () => {
    const next = createMoonflowerScenario();
    graphRef.current = next;
    setGraph(next);
    setCast(null);
    setPatch(null);
    setActivity([]);
    setSelected("multiply");
    setPositions(initialPositions(next));
    setDragging(null);
    draggingRef.current = null;
    setConsoleOutput("Lesson reset. Select a tool to inspect graph v1.");
    setConsoleBusy(null);
  };

  const moveNode = useCallback((nodeId: string, x: number, y: number) => {
    setPositions((current) => ({
      ...current,
      [nodeId]: {
        x: clampPosition(x, 7, 93),
        y: clampPosition(y, 7, 90),
      },
    }));
  }, []);

  const moveNodeFromPointer = useCallback((clientX: number, clientY: number) => {
    const nodeId = draggingRef.current;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!nodeId || !bounds) return;
    moveNode(nodeId, ((clientX - bounds.left) / bounds.width) * 100, ((clientY - bounds.top) / bounds.height) * 100);
  }, [moveNode]);

  const finishDragging = useCallback(() => {
    draggingRef.current = null;
    setDragging(null);
  }, []);

  const runConsoleTool = async (tool: ConsoleTool) => {
    setConsoleBusy(tool);
    try {
      let result: unknown;
      if (tool === "inspect_spell") {
        result = await handlers.inspect_spell();
      } else if (tool === "trace_effect") {
        result = await handlers.trace_effect({ effectId: "flooded-observatory" });
      } else if (tool === "simulate_cast") {
        const simulation = await handlers.simulate_cast();
        setCast(simulation);
        setPatch(null);
        result = simulation;
      } else if (tool === "explain_side_effect") {
        result = await handlers.explain_side_effect({ sideEffectId: "flooded-observatory" });
      } else if (tool === "set_sacred_constraint") {
        result = await handlers.set_sacred_constraint({
          targetId: "summon-ducks",
          reason: "The ducks are funny. They must remain in the final spell.",
        });
        setPatch(null);
      } else if (tool === "propose_spell_patch") {
        const proposal = await handlers.propose_spell_patch();
        setPatch(proposal.patches[0] ?? null);
        result = proposal;
      } else {
        if (!patch) throw new Error("Propose a current patch before applying it.");
        const applied = await handlers.apply_spell_patch({ patchId: patch.id });
        setCast(applied.verification);
        setPatch(null);
        result = applied;
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
  const highlightedIds = new Set(activity[0]?.nodeIds ?? []);
  const isSacred = graph.constraints.some((item) => item.targetId === "summon-ducks");
  const familiarPrediction = useMemo(
    () => FAMILIAR_GNN_ENABLED && cast && !cast.success ? inferFamiliar(graph, cast) : null,
    [cast, graph],
  );
  const stage = cast?.success ? "stable" : patch ? "patch" : isSacred ? "constraint" : cast ? "failure" : "ready";

  return (
    <main className={`machina stage-${stage}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">✣</span>
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
            {patch && <button className="primary" onClick={applyRepair}>Apply patch & recast</button>}
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
            className={`spell-canvas ${dragging ? "is-rearranging" : ""}`}
            ref={canvasRef}
            onPointerMove={(event) => moveNodeFromPointer(event.clientX, event.clientY)}
            onPointerUp={finishDragging}
            onPointerCancel={finishDragging}
          >
            <svg className="edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {graph.edges.map((edge) => {
                const from = graph.nodes.find((node) => node.id === edge.from)!;
                const to = graph.nodes.find((node) => node.id === edge.to)!;
                const fromPosition = positions[from.id] ?? from;
                const toPosition = positions[to.id] ?? to;
                const active = highlightedIds.has(from.id) && highlightedIds.has(to.id);
                return <line key={edge.id} x1={fromPosition.x} y1={fromPosition.y} x2={toPosition.x} y2={toPosition.y} className={`${edge.type} ${active ? "active" : ""}`} />;
              })}
            </svg>

            {graph.nodes.map((node) => {
              const sacred = graph.constraints.some((item) => item.targetId === node.id);
              const highlighted = highlightedIds.has(node.id);
              const position = positions[node.id] ?? node;
              return (
                <button
                  key={node.id}
                  className={`rune rune-${node.kind} ${node.dormant ? "dormant" : ""} ${sacred ? "sacred" : ""} ${highlighted ? "highlighted" : ""} ${selected === node.id ? "selected" : ""} ${dragging === node.id ? "dragging" : ""}`}
                  style={{ left: `${position.x}%`, top: `${position.y}%` }}
                  onPointerDown={(event) => {
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
                  onClick={() => setSelected(node.id)}
                  aria-label={`${node.label}, ${kindLabel[node.kind]}. Drag to rearrange; arrow keys nudge.`}
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                >
                  <span className="rune-glyph" aria-hidden="true">{node.glyph}</span>
                  <span className="rune-copy"><strong>{node.label}</strong><small>{kindLabel[node.kind]}</small></span>
                  {sacred && <span className="sacred-pin" title="Sacred constraint">◆</span>}
                </button>
              );
            })}

            <p className="canvas-hint"><span aria-hidden="true">✥</span> Drag runes to rearrange · Arrow keys nudge</p>

            <div className={`cast-vision ${cast ? "visible" : ""} ${cast?.success ? "vision-success" : "vision-failure"}`} aria-live="polite">
              {cast && <><div className="vision-symbol" aria-hidden="true">{cast.success ? "☂ ☂ ☂" : "◇ ◇ ◇ ◇"}</div><strong>{cast.success ? "The moonflower blooms" : "Twelve ducks. One indoor lake."}</strong><span>{cast.summary}</span></>}
            </div>
          </div>

          <footer className="node-inspector">
            <span className="inspector-glyph">{selectedNode?.glyph ?? "·"}</span>
            <div><small>{selectedNode ? kindLabel[selectedNode.kind] : "Rune"}</small><strong>{selectedNode?.label ?? "Select a rune"}</strong></div>
            <p>{selectedNode?.description}</p>
          </footer>
        </section>

        <aside className="familiar-panel panel">
          <div className="familiar-title"><span className="familiar-orb">✦</span><div><p className="section-kicker">Agent familiar</p><h2>Moth</h2></div></div>

          {patch ? (
            <article className="patch-card">
              <p className="section-kicker">Proposed patch</p>
              <h3>{patch.title}</h3>
              <p>{patch.rationale}</p>
              <dl><div><dt>Changes</dt><dd>{patch.operations.length}</dd></div><div><dt>Preserves</dt><dd>{patch.preserves.length}</dd></div></dl>
              <div className="preserves">◆ Ducks remain sacred</div>
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
