"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type SyntheticEvent } from "react";
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
import { BRAND_MARK_CORNER, BRAND_MARK_HEX, BRAND_MARK_VIEWBOX } from "@/src/brand/mark";

/* The right rail's two reference tables (the held-out policy benchmark and the
   two-hop ranking) fold shut on a short window so the tool feed is not pushed
   300-700px below the fold; on a tall window they render open on first paint.
   The server snapshot is "tall" so the HTML still carries every row and the
   hydrated tree matches it before the media query is consulted. The window
   height is only the coarse gate for the benchmark: settleRail below measures
   whether the open Agent Gym card actually fits its zone, because on a tall
   window the same table that fit in the idle state pushed the card's Export
   button under the zone's clip once the ranking appeared (1728x1000: the
   button was 0% visible; 1920x1080: a 6px sliver). */
const TALL_VIEWPORT_QUERY = "(min-height: 1000px)";
const subscribeTallViewport = (onChange: () => void) => {
  const query = window.matchMedia(TALL_VIEWPORT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const readTallViewport = () => window.matchMedia(TALL_VIEWPORT_QUERY).matches;
const readTallViewportOnServer = () => true;
/* The tool feed's CSS floor; settleRail raises it to two rows when they need more. */
const RAIL_FEED_FLOOR = 140;

/* The feed lists every registered tool before any is called, so the roster is
   the same manifest WebMCP registers, in manifest order. A tool leaves the
   roster the moment its first call lands in the feed and never returns: the
   feed keeps only the seven newest calls, so membership is tracked separately
   from the entries themselves (inspect_spell is called on Cast and would
   otherwise reappear as "not yet called" after the repair evicts it). */
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
// instead of leaving a dead margin on all four sides. `fillLayout` puts a rune
// centre on every edge of exactly this box, so the outermost runes always land
// on the inset line and the ink margin is the same on every edge.
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


const REPO_URL = "https://github.com/adiprathapa/hexmend";

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
    lesson: "Family 01, amplified carrier",
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
    lesson: "Family 02, resonant feedback",
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
    lesson: "Family 03, missing temporal guard",
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

export function Hexmend() {
  const [graph, setGraph] = useState<SpellGraph>(() => createMoonflowerScenario());
  const tallViewport = useSyncExternalStore(subscribeTallViewport, readTallViewport, readTallViewportOnServer);
  const graphRef = useRef(graph);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [calledTools, setCalledTools] = useState<ReadonlySet<string>>(() => new Set());
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
  // Whether the collapsed prompt is actually cutting anything off. The clamp is
  // sized by the rail's leftover height, so on a tall screen it can show the
  // whole prompt and the "Show the full prompt" control would be a lie. The
  // server does not know the screen, so it renders the control and the client
  // only ever blanks it in place (see .prompt-toggle.idle) — never removes it.
  const [promptClips, setPromptClips] = useState(true);
  const promptRef = useRef<HTMLParagraphElement>(null);
  const promptToggleRef = useRef<HTMLButtonElement>(null);
  const [gymSnapshot, setGymSnapshot] = useState<AgentGymSnapshot>(() => gymSession.snapshot());
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  // The rendered size of every rune, keyed by node id. Edges end on the rune's
  // actual border rather than on a guessed half-extent, so a long label does
  // not swallow its arrowhead.
  const [runeSizes, setRuneSizes] = useState<Record<string, { w: number; h: number }>>({});
  const activityId = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  // The rail's two scroll zones and the pieces settleRail measures.
  const railZoneRef = useRef<HTMLDivElement>(null);
  const railFeedRef = useRef<HTMLDivElement>(null);
  const gymCardRef = useRef<HTMLElement>(null);
  const policyDetailsRef = useRef<HTMLDetailsElement>(null);
  const labRef = useRef<HTMLDetailsElement>(null);
  // `true` until the client measures, matching the server snapshot; a person
  // who toggles the benchmark themselves takes over from the measurement.
  const [policyOpen, setPolicyOpen] = useState(true);
  const policyOpenRef = useRef(true);
  const policyChoice = useRef<boolean | null>(null);
  const railSignature = useRef("");

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

  const measurePromptClips = useCallback(() => {
    const el = promptRef.current;
    if (!el) return;
    // Show only whole lines: the box's height is whatever slack the rail has,
    // so the clamp is recomputed from it (see .agent-brief-prompt).
    const text = el.querySelector<HTMLElement>(".agent-brief-prompt-text");
    if (!text) return;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 18;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    if (el.classList.contains("expanded")) {
      el.style.removeProperty("max-height");
      text.style.removeProperty("max-height");
      text.style.removeProperty("-webkit-line-clamp");
    } else {
      // Release the cap and the clamp first so the box can take whatever
      // slack the rail has now (a clamped box reports only its clamped lines
      // as content, which made the last measurement sticky), then cap the
      // text to the whole lines that fit and the box to those lines plus its
      // padding. The text has its own clipping box: clipping the padded box
      // instead showed the top of the next line inside the bottom padding.
      el.style.removeProperty("max-height");
      text.style.removeProperty("max-height");
      text.style.removeProperty("-webkit-line-clamp");
      const lines = Math.max(1, Math.floor((el.clientHeight - padding) / lineHeight + 0.01));
      text.style.setProperty("-webkit-line-clamp", String(lines));
      text.style.maxHeight = `${lines * lineHeight}px`;
      el.style.maxHeight = `${lines * lineHeight + padding}px`;
    }
    const clips = text.scrollHeight - text.clientHeight > 1;
    // Blanking the control while it owns focus drops the keyboard user to
    // <body>. Leave it until focus moves on; onBlur measures again.
    if (!clips && document.activeElement === promptToggleRef.current) return;
    setPromptClips(clips);
  }, []);

  useEffect(() => {
    const el = promptRef.current;
    // An open prompt never clips, and measuring it would mark the control idle
    // for the frame in which it collapses — the frame that lost focus before.
    if (el && promptExpanded) {
      // The open prompt shows everything: drop the collapsed cap and clamp.
      el.style.removeProperty("max-height");
      const text = el.querySelector<HTMLElement>(".agent-brief-prompt-text");
      text?.style.removeProperty("max-height");
      text?.style.removeProperty("-webkit-line-clamp");
    }
    if (!el || promptExpanded || typeof ResizeObserver === "undefined") return;
    measurePromptClips();
    const observer = new ResizeObserver(measurePromptClips);
    observer.observe(el);
    // A capped box does not resize when the rail gains room, so a window
    // resize measures again on its own.
    window.addEventListener("resize", measurePromptClips);
    return () => { observer.disconnect(); window.removeEventListener("resize", measurePromptClips); };
  }, [story.prompt, promptExpanded, measurePromptClips]);

  const draggingRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  // Runes are drawn from their centre, so the outer ~half-rune of the canvas on
  // each side cannot hold a centre without clipping. Clamping authored
  // coordinates into that safe area collapses distinct positions onto the same
  // edge value — six of twelve runes stacked on two columns. Map the authored
  // 0-100 range onto the safe area instead: nothing clips, and the spacing the
  // layout was authored with survives.
  // The inset is derived from the rune size the stylesheet will actually
  // produce at this canvas width (the same clamps as `.rune` in globals.css)
  // until the runes have been measured, then from the widest and tallest rune
  // actually rendered: a fixed half-rune guess left the tallest label 2px past
  // the bottom edge at 1920x1080, and keeping the guess as a floor after
  // measuring made the left margin 20px wider than the right. The layout
  // pass puts a rune centre on every edge of the authored box (see
  // `fillLayout`), so the margin here is the whole gap between the outermost
  // ink and the canvas edge: 28px on every side, the same at 1280 and 2560.
  // Before the layout pass filled the box, the top row sat at authored y ~14
  // and an 8px margin drew a 105px empty band across the top at 2560x1440
  // with the lowest rune 17px from the bottom edge.
  const EDGE_MARGIN = 28;
  const runeW = Math.min(260, Math.max(112, canvasWidth * 0.175));
  const runeH = Math.min(118, Math.max(56, canvasWidth * 0.084));
  const measuredRunes = Object.values(runeSizes);
  const allRunesMeasured = measuredRunes.length > 0
    && graph.nodes.every((node) => runeSizes[node.id] !== undefined);
  const widestRune = measuredRunes.reduce((max, size) => Math.max(max, size.w), allRunesMeasured ? 0 : runeW * 1.15);
  const tallestRune = measuredRunes.reduce((max, size) => Math.max(max, size.h), allRunesMeasured ? 0 : runeH);
  const horizontalInset = canvasWidth
    ? Math.min(22, Math.max(8, ((widestRune / 2 + EDGE_MARGIN) / canvasWidth) * 100))
    : 9;
  const verticalInset = canvasHeight
    ? Math.min(16, Math.max(5, ((tallestRune / 2 + EDGE_MARGIN) / canvasHeight) * 100))
    : 6;
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

  // An edge in canvas pixels, running from the border of one rune to the
  // border of the other with a 4px standoff so the arrowhead is not painted
  // under the target. Endpoints are found by intersecting the centre-to-centre
  // line with each rune's rectangle; the rectangle is the measured rune where
  // one exists and the stylesheet's minimum otherwise.
  const edgeSegment = useCallback((fromId: string, toId: string) => {
    const from = graph.nodes.find((node) => node.id === fromId);
    const to = graph.nodes.find((node) => node.id === toId);
    if (!from || !to || !canvasWidth || !canvasHeight) return null;
    const rawFrom = positions[from.id] ?? from;
    const rawTo = positions[to.id] ?? to;
    const fx = (toCanvasX(rawFrom.x) / 100) * canvasWidth;
    const fy = (toCanvasY(rawFrom.y) / 100) * canvasHeight;
    const tx = (toCanvasX(rawTo.x) / 100) * canvasWidth;
    const ty = (toCanvasY(rawTo.y) / 100) * canvasHeight;
    const dx = tx - fx;
    const dy = ty - fy;
    if (!dx && !dy) return null;
    const reach = (id: string, standoff: number) => {
      const size = runeSizes[id] ?? { w: runeW, h: runeH };
      const hw = size.w / 2 + standoff;
      const hh = size.h / 2 + standoff;
      return Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    };
    // Neighbouring runes on a short canvas can sit within a few pixels of
    // each other; the standoff gives way before the line does. Runes that
    // actually overlap leave no room at all, and the segment collapses to the
    // midpoint rather than disappearing, so the edge still exists for
    // anything that counts or inspects it.
    let fromT = 0.5;
    let toT = 0.5;
    for (const standoff of [4, 2, 0]) {
      const a = reach(from.id, standoff);
      const b = reach(to.id, standoff);
      if (a + b < 1) {
        fromT = a;
        toT = b;
        break;
      }
    }
    return {
      x1: +(fx + dx * fromT).toFixed(1),
      y1: +(fy + dy * fromT).toFixed(1),
      x2: +(tx - dx * toT).toFixed(1),
      y2: +(ty - dy * toT).toFixed(1),
    };
  }, [graph.nodes, positions, canvasWidth, canvasHeight, runeSizes, runeW, runeH, toCanvasX, toCanvasY]);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const runes = [...canvas.querySelectorAll<HTMLElement>(".rune[data-node-id]")];
    const measure = () => {
      setRuneSizes((previous) => {
        let changed = false;
        const next: Record<string, { w: number; h: number }> = {};
        for (const rune of runes) {
          const id = rune.dataset.nodeId!;
          const size = { w: rune.offsetWidth, h: rune.offsetHeight };
          next[id] = size;
          const before = previous[id];
          if (!before || Math.abs(before.w - size.w) > 0.5 || Math.abs(before.h - size.h) > 0.5) changed = true;
        }
        if (!changed && Object.keys(previous).length === runes.length) return previous;
        return next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const rune of runes) observer.observe(rune);
    return () => observer.disconnect();
  }, [graph.nodes]);

  const recordActivity = useCallback((tool: string, detail: string, nodeIds: string[] = []) => {
    activityId.current += 1;
    setActivity((items) => [{ id: activityId.current, tool, detail, nodeIds }, ...items].slice(0, 7));
    setCalledTools((called) => (called.has(tool) ? called : new Set(called).add(tool)));
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
      // A focused <summary> toggles on Enter; stealing the key from it left
      // every disclosure in the rail keyboard-openable only by Space.
      if (target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return;
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
  const handFocusTo = (selector: string) => {
    pendingFocus.current = selector;
    // A handler whose last state update has already been flushed produces no
    // further render, so the effect that consumes pendingFocus never runs. Try
    // again on the next frame; whichever path gets there first clears the ref.
    requestAnimationFrame(() => {
      if (pendingFocus.current !== selector) return;
      pendingFocus.current = null;
      document.querySelector<HTMLElement>(selector)?.focus();
    });
  };
  const keepFocusOnPrimary = () => handFocusTo(".controls .primary");

  // The open Task loader is pinned below the right rail's narrative zone and
  // leaves it 33-65px of a 620px rail at 1280x720 (95-130px at 1440x815), so a
  // loader opened and not used (the "Try a held-out task" primary opens it,
  // and so does curiosity) hid every read of the next lesson and, at "Review
  // the patch", the card itself: 58 of 623px with the Apply button out of the
  // zone. Loading a task folds it (loadTask below); a lesson step taken with
  // it still open folds it too, so the zone always holds what the step wrote.
  const foldLab = () => {
    const lab = labRef.current;
    if (lab?.open) lab.open = false;
  };

  const castSpell = async () => {
    foldLab();
    setRevertToken(null);
    await handlers.inspect_spell();
    await handlers.simulate_cast();
    keepFocusOnPrimary();
  };

  const diagnose = async () => {
    foldLab();
    await handlers.trace_effect({ effectId });
    await handlers.explain_side_effect({ sideEffectId: effectId });
    keepFocusOnPrimary();
  };

  const protectSubject = async () => {
    foldLab();
    await handlers.set_sacred_constraint({ targetId: subjectId, reason: constraintText });
    setPatch(null);
    keepFocusOnPrimary();
  };

  const proposeRepair = async () => {
    foldLab();
    await handlers.propose_spell_patch();
    keepFocusOnPrimary();
  };

  const applyRepair = async () => {
    if (!patch) return;
    await handlers.apply_spell_patch({ patchId: patch.id });
    await handlers.simulate_cast();
    // Applying unmounts the patch card and with it the button that had focus,
    // so the climax of the demo dropped keyboard users to <body>. The next
    // decision is the primary control again ("Try a held-out task").
    keepFocusOnPrimary();
    // Reviewing the patch scrolled the narrative zone down to the card; the
    // verdict that replaces it is written at the top, so bring the zone back.
    document.querySelector<HTMLElement>(".familiar-scroll")?.scrollTo({ top: 0 });
  };

  const previewRepair = async () => {
    if (!patch) return;
    await handlers.simulate_cast({ patchId: patch.id });
    // The simulate button unmounts once its verdict is in; the next decision
    // is Apply, so keyboard focus goes there instead of to <body>.
    handFocusTo(".patch-apply");
  };

  const undoRepair = async () => {
    if (!revertToken) return;
    const result = await handlers.apply_spell_patch({ revertToken });
    setConsoleOutput(JSON.stringify(result, null, 2));
    // The Undo button unmounts with the success read it lives in.
    keepFocusOnPrimary();
    document.querySelector<HTMLElement>(".familiar-scroll")?.scrollTo({ top: 0 });
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
    setCalledTools(new Set());
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
    // The open loader is pinned below the narrative zone and takes 276px of a
    // 620px rail at 1280x720, so while it stayed open the zone fell to 12px
    // with a task loaded (75px at 1440x815) and the read that carries the
    // lesson was gone. Once the task is in the workspace the loader has done
    // its job: it folds shut, its summary carries what loaded, and the zone
    // returns to the read at its head. The Load task button hides with the
    // body, so focus moves to the summary rather than falling to <body>.
    const lab = labRef.current;
    if (lab) {
      lab.open = false;
      lab.querySelector<HTMLElement>("summary")?.focus();
    }
    document.querySelector<HTMLElement>(".familiar-scroll")?.scrollTo({ top: 0 });
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
    link.download = "hexmend-agent-gym-episode.json";
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
      // The button is disabled while its call runs, which drops focus to <body>.
      handFocusTo(`.tool-console-grid button[title="${tool}"]`);
    }
  };

  /* The right rail's narrative zone and tool feed each scroll on their own at
     desktop widths, and CSS alone cannot tell whether either overflows. After
     every render this pass measures them before paint and (a) decides whether
     the held-out benchmark may stay open: only when the whole Agent Gym card,
     Export button included, clears the zone's fade band, or sits entirely
     below the fold while still shorter than the zone so it shows whole once
     scrolled to; (b) marks each zone that overflows, which is what turns on
     its bottom fade and the padding that keeps the last control out of it;
     and (c) raises the feed's floor to its first two rows, so the roster
     never shows as a one-row sliver. The DOM is set first and React state
     follows, so the toggle event this raises reads as our own rather than the
     person's. A signature of the geometry that feeds the decision skips the
     work on the many renders (rune drags) that cannot have changed it. */
  const settleRail = useCallback(() => {
    const zone = railZoneRef.current;
    const feed = railFeedRef.current;
    const details = policyDetailsRef.current;
    const card = gymCardRef.current;
    if (!zone || !feed) return;
    const scrolls = getComputedStyle(zone).overflowY === "auto";
    const signature = [
      scrolls, tallViewport, policyChoice.current, zone.clientHeight, zone.scrollHeight,
      card?.offsetHeight, details?.open, feed.clientHeight, feed.scrollHeight, feed.firstElementChild?.clientHeight,
    ].join("|");
    if (signature === railSignature.current) return;
    if (!scrolls) {
      delete zone.dataset.overflow;
      delete feed.dataset.overflow;
      feed.style.removeProperty("min-height");
    } else {
      const rows = [...feed.querySelectorAll("article")].slice(0, 2);
      const rowPad = parseFloat(getComputedStyle(feed).getPropertyValue("--rail-row-pad")) || 0;
      const twoRows = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0) + rowPad;
      feed.style.minHeight = twoRows > RAIL_FEED_FLOOR ? `${Math.ceil(twoRows)}px` : "";
    }
    const fade = parseFloat(getComputedStyle(zone).getPropertyValue("--rail-fade")) || 0;
    const overflowing = (element: HTMLElement) => {
      element.dataset.overflow = "false";
      const clipped = element.scrollHeight > element.clientHeight + 0.5;
      element.dataset.overflow = String(clipped);
      return clipped;
    };
    if (details && card) {
      let open: boolean;
      if (policyChoice.current !== null) {
        open = policyChoice.current;
      } else if (!tallViewport) {
        open = false;
      } else if (!scrolls) {
        open = true;
      } else {
        details.open = true;
        const reserved = overflowing(zone) ? fade : 0;
        const zoneBox = zone.getBoundingClientRect();
        const cardBox = card.getBoundingClientRect();
        // In the zone's content coordinates, not the viewport's: judged
        // against the visible box, the same card fit or did not fit depending
        // on how far the zone happened to be scrolled, so the table folded
        // and unfolded as the reader scrolled.
        const cardTop = cardBox.top - zoneBox.top + zone.scrollTop;
        const fitsAbove = cardTop + cardBox.height <= zone.clientHeight - reserved + 0.5;
        const fitsBelow = cardTop >= zone.clientHeight && cardBox.height <= zone.clientHeight - reserved;
        open = fitsAbove || fitsBelow;
      }
      details.open = open;
      policyOpenRef.current = open;
      setPolicyOpen(open);
    }
    if (scrolls) {
      overflowing(zone);
      overflowing(feed);
    }
    railSignature.current = [
      scrolls, tallViewport, policyChoice.current, zone.clientHeight, zone.scrollHeight,
      card?.offsetHeight, details?.open, feed.clientHeight, feed.scrollHeight, feed.firstElementChild?.clientHeight,
    ].join("|");
  }, [tallViewport]);
  useLayoutEffect(settleRail);
  useEffect(() => {
    // The resize steps run before paint, so a window resize settles in the
    // same frame; late web fonts can move the rows by a pixel or two.
    window.addEventListener("resize", settleRail);
    document.fonts?.ready.then(settleRail, () => undefined);
    return () => window.removeEventListener("resize", settleRail);
  }, [settleRail]);
  const onPolicyToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const next = event.currentTarget.open;
    if (next === policyOpenRef.current) return;
    policyChoice.current = next;
    policyOpenRef.current = next;
    setPolicyOpen(next);
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
    <div className="hexmend">
      <a className="skip-link" href="#workspace">Skip to the spell workspace</a>
      <header className="topbar">
        <div className="brand-lockup">
          {/* A plain solid hexagon. Solid because the same drawing is the tab
              icon, where an outline vanished at 16px; one shared definition
              (src/brand/mark.ts) draws the header, the favicon and the social
              card so they cannot drift apart. Inline SVG keeps it under the
              CSP with no request. */}
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox={BRAND_MARK_VIEWBOX} role="presentation" focusable="false">
              <path d={BRAND_MARK_HEX} fill="currentColor" stroke="currentColor" strokeWidth={BRAND_MARK_CORNER} strokeLinejoin="round" />
            </svg>
          </span>
          <h1>Hexmend</h1>
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
            ? "7 WebMCP tools registered"
            : mcpState === "checking"
              ? "WebMCP connecting to host…"
              : "7 WebMCP tools ready for a host"}
        </div>
      </header>

      <main className="workspace" id="workspace" tabIndex={-1}>
        <aside className="brief-panel panel" aria-label="Lesson and browser-agent brief">
          <div>
            {/* The lesson is one instance of the larger claim, so the claim is
                stated once, above every lesson, in the words the social card
                uses. Without it the interface read as a single puzzle. */}
            <p className="thesis">Humans decide what matters. Agents prove the <em>smallest repair</em>.</p>
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
                  foldLab();
                  const card = document.querySelector<HTMLElement>(".patch-card");
                  const zone = card?.closest<HTMLElement>(".familiar-scroll");
                  // The rail's narrative zone is shorter than the card on a
                  // laptop (286px against a 344px card at 1280x720), so
                  // centring the card scrolled its title and rationale out of
                  // the zone and left only the buttons. Rest the zone on the
                  // card's head when the card cannot fit, and keep the focus
                  // call from scrolling it again.
                  const fits = !!card && !!zone && card.offsetHeight <= zone.clientHeight;
                  card?.scrollIntoView({ behavior: "smooth", block: fits ? "center" : "start" });
                  card?.querySelector<HTMLButtonElement>(".patch-apply")?.focus({ preventScroll: true });
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
          <section className={promptExpanded ? "agent-brief open" : "agent-brief"} aria-label="Drive this with a browser agent">
            <p className="section-kicker">Drive this with a browser agent</p>
            <p className="agent-brief-note">
              Seven tools on <code>document.modelContext</code>. Paste this into a WebMCP agent:
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
            <p ref={promptRef} className={`agent-brief-prompt ${promptExpanded ? "expanded" : ""}`}><span className="agent-brief-prompt-text">{story.prompt}</span></p>
            {/* A mask fade over clamped text reads as "this is cut off", not as
                "this continues" — measured, it hid up to 69% of the prompt with
                no scrollbar painted. An explicit control says which it is. */}
            <button
              ref={promptToggleRef}
              type="button"
              className={promptExpanded || promptClips ? "prompt-toggle" : "prompt-toggle idle"}
              aria-expanded={promptExpanded}
              onClick={() => setPromptExpanded((open) => !open)}
              onBlur={measurePromptClips}
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
            <div><p className="section-kicker">Live spell v{graph.version}</p><h2>{story.canvas}</h2></div>
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
            <svg className="edge-layer" aria-hidden="true">
              <defs>
                <marker id="arrow-default" markerUnits="userSpaceOnUse" markerWidth={11} markerHeight={11} refX={10} refY={5.5} orient="auto-start-reverse">
                  <path d="M 0 0 L 11 5.5 L 0 11 z" fill="var(--edge-flow)" />
                </marker>
                <marker id="arrow-target" markerUnits="userSpaceOnUse" markerWidth={11} markerHeight={11} refX={10} refY={5.5} orient="auto-start-reverse">
                  <path d="M 0 0 L 11 5.5 L 0 11 z" fill="var(--edge-target)" />
                </marker>
                <marker id="arrow-add" markerUnits="userSpaceOnUse" markerWidth={11} markerHeight={11} refX={10} refY={5.5} orient="auto-start-reverse">
                  <path d="M 0 0 L 11 5.5 L 0 11 z" fill="var(--edge-add)" />
                </marker>
              </defs>
              {canvasWidth > 0 && canvasHeight > 0 && graph.edges.map((edge) => {
                const from = graph.nodes.find((node) => node.id === edge.from)!;
                const to = graph.nodes.find((node) => node.id === edge.to)!;
                const segment = edgeSegment(from.id, to.id);
                if (!segment) return null;
                const traceIndex = tracedNodeIds.findIndex((nodeId, index) => (
                  nodeId === from.id && tracedNodeIds[index + 1] === to.id
                ));
                const active = traceIndex >= 0;
                const pendingRemoval = removedPatchEdgeIds.has(edge.id);
                return <line key={edge.id} data-edge-id={edge.id} x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} pathLength={active ? 100 : undefined} className={`${edge.type} ${active ? "active" : ""} ${pendingRemoval ? "patch-remove" : ""}`} style={active ? { animationDelay: `${traceIndex * 90}ms` } : undefined} />;
              })}
              {canvasWidth > 0 && canvasHeight > 0 && addedPatchEdges.map((entry) => {
                const segment = edgeSegment(entry.fromId, entry.toId);
                if (!segment) return null;
                return <line key={`preview-${entry.edgeId}`} data-preview-edge-id={entry.edgeId} x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} className="patch-add" />;
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
                  data-node-id={node.id}
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
              <span className="hint-pan">Swipe to pan the graph. </span>Drag runes to rearrange<span className="hint-keys">. Arrow keys nudge</span>
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
          <div
            className="familiar-scroll"
            ref={railZoneRef}
            onScroll={(event) => { event.currentTarget.dataset.scrolled = event.currentTarget.scrollTop > 2 ? "true" : "false"; }}
          >
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
                <span>Preflight for graph v{patch.preconditions.expectedGraphVersion}</span>
                <strong>{patch.preconditions.requiredEdgeIds.length} live edges, {patch.preconditions.requiredDormantNodeIds.length} dormant runes, {patch.preconditions.requiredConstraintIds.length} sacred lock</strong>
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
              <p>{cast?.success ? "The graph is stable. Every promise survived the repair. That is the whole idea: you named what mattered, and the agent proved the smallest change around it." : cast ? story.read : "Cast first. Good magic begins with evidence."}</p>
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
            <details className="familiar-signal" aria-label="Experimental Familiar graph prediction" open={tallViewport}>
              <summary className="familiar-signal-heading">
                <span className="familiar-signal-title"><span className="section-kicker">Experimental graph signal</span><strong>Two-hop suspect ranking</strong></span>
                <span title="Advisory model; the simulator remains authoritative">Advisory</span>
                <span className="rail-disclosure" aria-hidden="true">⌄</span>
              </summary>
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
            </details>
          )}

          <section className="agent-gym" aria-label="Agent Gym evaluation" ref={gymCardRef}>
            <div className="agent-gym-heading">
              <div><p className="section-kicker">Agent Gym evaluation mode</p><h3>Scored, replayable episode</h3></div>
              <span className={gymSnapshot.status}>{gymSnapshot.status}</span>
            </div>
            <p>Every site-tool call records reward plus before/after graph observations. The interface and visiting agents use the same handlers.</p>
            <div className="gym-score">
              <strong>{gymSnapshot.score}<small> / {gymSnapshot.maxScore}</small></strong>
              <span>{gymSnapshot.trajectory.length} steps, {gymSnapshot.completedMilestones.length}/9 milestones</span>
            </div>
            <div className="gym-meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (gymSnapshot.score / gymSnapshot.maxScore) * 100))}%` }} /></div>
            <details className="policy-baselines" aria-label="Held-out policy benchmark" open={policyOpen} onToggle={onPolicyToggle} ref={policyDetailsRef}>
              <summary className="policy-baselines-heading">
                <span>Held-out policy</span>
                <span>Mean reward, {AGENT_GYM_POLICY_BASELINES.length} policies</span>
                <span className="rail-disclosure" aria-hidden="true">⌄</span>
              </summary>
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
            </details>
            <div className="gym-foot">
              <small title="96 variants across 3 causal families, with vector and offline rollouts">96 variants, 3 causal families</small>
              <button type="button" onClick={exportEpisode} disabled={!gymSnapshot.trajectory.length}>Export episode JSON</button>
            </div>
          </section>
          </div>

          <div className="activity-header"><span>Tool activity</span><small>{activity.length ? "Live" : "Waiting for the first call"}</small></div>
          <div className="activity-list" role="log" aria-live="polite" aria-label="Agent activity" ref={railFeedRef}>
            {activity.map((item) => (
              <article key={item.id}><span className="activity-mark">{item.tool === "simulate_cast" ? "↯" : item.tool.includes("patch") ? "⌁" : "◎"}</span><div><strong>{item.tool}</strong><p>{item.detail}</p></div></article>
            ))}
            {TOOL_ROSTER.filter((tool) => !calledTools.has(tool.name)).map((tool) => (
              <article key={tool.name} className="waiting" aria-label={`${tool.name} registered, not yet called`}>
                <span className="activity-mark" aria-hidden="true">·</span>
                <div><strong>{tool.name}</strong><p>{tool.description}</p></div>
              </article>
            ))}
          </div>

          {/* Loading a held-out task is the fastest way to show this is not a
              scripted demo: every rune, edge and effect ID is remapped, and the
              same seven tools still solve it. */}
          <details className="tool-console scenario-lab" ref={labRef}>
            <summary>
              <span>
                <strong>Task loader</strong>
                {variant ? (
                  <small className="lab-loaded"><code>{variant.scenarioId}</code> seed {variant.seed}, protects {graph.nodes.find((node) => node.id === subjectId)?.label}</small>
                ) : (
                  <small>Swap in any of 96 generated tasks across 3 causal rules</small>
                )}
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
          </details>

          <details className="tool-console">
            <summary>
              <span><strong>Local tool console</strong><small>Same handlers, structured JSON</small></span>
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
                  aria-label={`${tool.label}: ${tool.name}, ${tool.mutates ? "mutating" : "read-only"}`}
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
