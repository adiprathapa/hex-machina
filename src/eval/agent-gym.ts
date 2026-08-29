import {
  cloneGraph,
  observeSpellGraph,
  serializeSpellGraph,
  type SpellGraph,
  type SpellObservation,
} from "../domain/spell.ts";
import {
  generateAgentGymScenarioForFamily,
  type AgentGymScenarioVariant,
  type AgentGymFamilyId,
  type AgentGymSplit,
} from "../scenarios/agent-gym-family.ts";
import { createMoonflowerScenario } from "../scenarios/moonflower.ts";
import { createSpellToolHandlers, type SpellToolHandlers } from "../tools/handlers.ts";

export const AGENT_GYM_MAX_SCORE = 23;
export const AGENT_GYM_MAX_EPISODE_STEPS = 32;
export const AGENT_GYM_TOOL_NAMES = [
  "inspect_spell",
  "trace_effect",
  "simulate_cast",
  "explain_side_effect",
  "set_sacred_constraint",
  "propose_spell_patch",
  "apply_spell_patch",
] as const;

export type AgentGymToolName = typeof AGENT_GYM_TOOL_NAMES[number];

type Milestone =
  | "inspected"
  | "observed_failure"
  | "traced"
  | "explained"
  | "preserved_intent"
  | "proposed"
  | "previewed"
  | "applied"
  | "verified";

interface RewardEvent {
  milestone?: Milestone;
  delta: number;
  reason: string;
}

export interface AgentGymStep {
  index: number;
  tool: string;
  input: unknown;
  observationBefore: SpellObservation;
  observationAfter: SpellObservation;
  stateKeyBefore: string;
  stateKeyAfter: string;
  graphVersionBefore: number;
  graphVersionAfter: number;
  mutated: boolean;
  rewardDelta: number;
  rewardReasons: string[];
  result?: unknown;
  error?: string;
}

export interface AgentGymSnapshot {
  protocol: "hex-machina-agent-gym/v1";
  readiness: "multi-family-prototype";
  familyId: AgentGymFamilyId;
  scenarioId: string;
  split: AgentGymSplit | "canonical";
  variantIndex: number | null;
  perturbations: readonly string[];
  seed: number;
  objective: string;
  score: number;
  maxScore: typeof AGENT_GYM_MAX_SCORE;
  status: "running" | "complete" | "truncated";
  terminationReason: "goal-verified" | "step-limit" | null;
  maxEpisodeSteps: typeof AGENT_GYM_MAX_EPISODE_STEPS;
  completedMilestones: Milestone[];
  availableTools: readonly AgentGymToolName[];
  trajectory: AgentGymStep[];
}

interface AgentGymSessionConfig {
  familyId: AgentGymFamilyId;
  scenarioId: string;
  seed: number;
  objective: string;
  split: AgentGymSplit | "canonical";
  variantIndex: number | null;
  perturbations: readonly string[];
}

const CANONICAL_SESSION: AgentGymSessionConfig = {
  familyId: "moonflower-opaque-roles-v1",
  scenarioId: "moonflower-01",
  seed: 12012,
  objective: "Diagnose and repair the spell while preserving the human's ducks.",
  split: "canonical",
  variantIndex: null,
  perturbations: [],
};

const REWARDS: Record<Milestone, number> = {
  inspected: 1,
  observed_failure: 1,
  traced: 2,
  explained: 2,
  preserved_intent: 3,
  proposed: 2,
  previewed: 2,
  applied: 6,
  verified: 4,
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function graphVersion(graph: SpellGraph) {
  return graph.version;
}

function stateKey(graph: SpellGraph) {
  const serialized = serializeSpellGraph(graph);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export class AgentGymSession {
  private score = 0;
  private complete = false;
  private truncated = false;
  private milestones = new Set<Milestone>();
  private trajectory: AgentGymStep[] = [];

  constructor(private readonly config: AgentGymSessionConfig = CANONICAL_SESSION) {}

  reset() {
    this.score = 0;
    this.complete = false;
    this.truncated = false;
    this.milestones.clear();
    this.trajectory = [];
    return this.snapshot();
  }

  snapshot(): AgentGymSnapshot {
    return {
      protocol: "hex-machina-agent-gym/v1",
      readiness: "multi-family-prototype",
      familyId: this.config.familyId,
      scenarioId: this.config.scenarioId,
      split: this.config.split,
      variantIndex: this.config.variantIndex,
      perturbations: [...this.config.perturbations],
      seed: this.config.seed,
      objective: this.config.objective,
      score: this.score,
      maxScore: AGENT_GYM_MAX_SCORE,
      status: this.complete ? "complete" : this.truncated ? "truncated" : "running",
      terminationReason: this.complete ? "goal-verified" : this.truncated ? "step-limit" : null,
      maxEpisodeSteps: AGENT_GYM_MAX_EPISODE_STEPS,
      completedMilestones: [...this.milestones],
      availableTools: AGENT_GYM_TOOL_NAMES,
      trajectory: cloneSerializable(this.trajectory),
    };
  }

  recordSuccess(
    tool: AgentGymToolName,
    input: unknown,
    before: SpellGraph,
    after: SpellGraph,
    result: unknown,
  ) {
    const rewards = this.evaluate(tool, input, result);
    this.pushStep(tool, input, before, after, rewards, result);
  }

  recordError(
    tool: string,
    input: unknown,
    before: SpellGraph,
    after: SpellGraph,
    error: unknown,
  ) {
    this.pushStep(
      tool,
      input,
      before,
      after,
      [{ delta: -2, reason: "Invalid or stale tool call" }],
      undefined,
      error instanceof Error ? error.message : "Tool execution failed",
    );
  }

  private award(milestone: Milestone, reason: string): RewardEvent {
    if (this.milestones.has(milestone)) {
      return { delta: -0.25, reason: `Redundant milestone: ${reason}` };
    }
    this.milestones.add(milestone);
    return { milestone, delta: REWARDS[milestone], reason };
  }

  private evaluate(tool: AgentGymToolName, input: unknown, result: unknown): RewardEvent[] {
    const output = recordOf(result);
    const parsedInput = recordOf(input) ?? {};

    if (tool === "inspect_spell") return [this.award("inspected", "Grounded in the live typed graph")];
    if (tool === "trace_effect") return [this.award("traced", "Recovered the causal path")];
    if (tool === "explain_side_effect") return [this.award("explained", "Proved the minimal responsible subgraph")];
    if (tool === "set_sacred_constraint") {
      const events = [this.award("preserved_intent", "Encoded the human's subjective constraint")];
      if (!this.milestones.has("explained")) events.push({ delta: -5, reason: "Mutated state before explaining the failure" });
      return events;
    }
    if (tool === "propose_spell_patch") return [this.award("proposed", "Produced a constraint-aware repair")];
    if (tool === "apply_spell_patch") {
      const events = [this.award("applied", "Applied a verified graph patch atomically")];
      if (!this.milestones.has("explained")) events.push({ delta: -5, reason: "Mutated state before explaining the failure" });
      return events;
    }
    if (tool === "simulate_cast" && parsedInput.patchId !== undefined) {
      const preview = recordOf(output?.preview);
      if (output?.success === true && preview?.editorMutated === false) {
        return [this.award("previewed", "Tested the repair without mutating editor state")];
      }
      return [];
    }
    if (tool === "simulate_cast" && output?.success === true && this.milestones.has("applied")) {
      this.complete = true;
      return [this.award("verified", "Recast the repaired graph successfully")];
    }
    if (tool === "simulate_cast" && output?.success === false) {
      return [this.award("observed_failure", "Observed the deterministic failure before repair")];
    }
    return [];
  }

  private pushStep(
    tool: string,
    input: unknown,
    before: SpellGraph,
    after: SpellGraph,
    rewards: RewardEvent[],
    result?: unknown,
    error?: string,
  ) {
    const rewardDelta = rewards.reduce((total, reward) => total + reward.delta, 0);
    this.score += rewardDelta;
    this.trajectory.push({
      index: this.trajectory.length,
      tool,
      input,
      observationBefore: observeSpellGraph(before),
      observationAfter: observeSpellGraph(after),
      stateKeyBefore: stateKey(before),
      stateKeyAfter: stateKey(after),
      graphVersionBefore: graphVersion(before),
      graphVersionAfter: graphVersion(after),
      mutated: graphVersion(before) !== graphVersion(after),
      rewardDelta,
      rewardReasons: rewards.map((reward) => reward.reason),
      ...(result === undefined ? {} : { result }),
      ...(error === undefined ? {} : { error }),
    });
    if (!this.complete && this.trajectory.length >= AGENT_GYM_MAX_EPISODE_STEPS) {
      this.truncated = true;
    }
  }
}

export interface AgentGymTransition {
  observation: SpellObservation;
  reward: number;
  terminated: boolean;
  truncated: boolean;
  result?: unknown;
  error?: { name: string; message: string };
  episode: AgentGymSnapshot;
  info: {
    scenarioId: string;
    stepIndex: number | null;
    graphVersion: number;
    mutated: boolean;
    rewardReasons: string[];
    actionAccepted: boolean;
  };
}

export function instrumentSpellToolHandlers(
  handlers: SpellToolHandlers,
  getGraph: () => SpellGraph,
  session: AgentGymSession,
  onSnapshot: (snapshot: AgentGymSnapshot) => void = () => {},
): SpellToolHandlers {
  const invoke = async (
    tool: AgentGymToolName,
    input: unknown,
    execute: () => Promise<unknown>,
  ) => {
    const before = cloneGraph(getGraph());
    try {
      const result = await execute();
      session.recordSuccess(tool, input, before, cloneGraph(getGraph()), result);
      onSnapshot(session.snapshot());
      return result;
    } catch (error) {
      session.recordError(tool, input, before, cloneGraph(getGraph()), error);
      onSnapshot(session.snapshot());
      throw error;
    }
  };

  return {
    inspect_spell: (input = {}) => invoke("inspect_spell", input, () => handlers.inspect_spell(input)) as ReturnType<SpellToolHandlers["inspect_spell"]>,
    trace_effect: (input = {}) => invoke("trace_effect", input, () => handlers.trace_effect(input)) as ReturnType<SpellToolHandlers["trace_effect"]>,
    simulate_cast: (input = {}) => invoke("simulate_cast", input, () => handlers.simulate_cast(input)) as ReturnType<SpellToolHandlers["simulate_cast"]>,
    explain_side_effect: (input = {}) => invoke("explain_side_effect", input, () => handlers.explain_side_effect(input)) as ReturnType<SpellToolHandlers["explain_side_effect"]>,
    set_sacred_constraint: (input = {}) => invoke("set_sacred_constraint", input, () => handlers.set_sacred_constraint(input)) as ReturnType<SpellToolHandlers["set_sacred_constraint"]>,
    propose_spell_patch: (input = {}) => invoke("propose_spell_patch", input, () => handlers.propose_spell_patch(input)) as ReturnType<SpellToolHandlers["propose_spell_patch"]>,
    apply_spell_patch: (input = {}) => invoke("apply_spell_patch", input, () => handlers.apply_spell_patch(input)) as ReturnType<SpellToolHandlers["apply_spell_patch"]>,
  };
}

export function createAgentGymEnvironment(options?: { family?: AgentGymFamilyId; split: AgentGymSplit; index: number }) {
  const variant: AgentGymScenarioVariant | null = options
    ? generateAgentGymScenarioForFamily(options.family ?? "moonflower-opaque-roles-v1", options.split, options.index)
    : null;
  const initialGraph = variant?.graph ?? createMoonflowerScenario();
  let graph = cloneGraph(initialGraph);
  const session = new AgentGymSession(variant ? {
    familyId: variant.familyId,
    scenarioId: variant.scenarioId,
    seed: variant.seed,
    objective: variant.objective,
    split: variant.split,
    variantIndex: variant.index,
    perturbations: variant.perturbations,
  } : CANONICAL_SESSION);
  let handlers: SpellToolHandlers;

  const rebuildHandlers = () => {
    const sharedHandlers = createSpellToolHandlers({
      getGraph: () => graph,
      setGraph: (next) => { graph = next; },
      recordActivity() {},
    });
    handlers = instrumentSpellToolHandlers(sharedHandlers, () => graph, session);
  };
  rebuildHandlers();

  return {
    reset() {
      graph = cloneGraph(initialGraph);
      session.reset();
      rebuildHandlers();
      return {
        observation: observeSpellGraph(graph),
        task: {
          objective: variant?.objective ?? CANONICAL_SESSION.objective,
          humanConstraint: variant?.humanConstraint ?? "The ducks are funny. They stay.",
        },
        episode: session.snapshot(),
        info: {
          protocol: "hex-machina-agent-gym/v1" as const,
          observationSchema: "hex-machina-public-spell-graph/v1" as const,
          scenarioId: session.snapshot().scenarioId,
          actionSpace: AGENT_GYM_TOOL_NAMES,
          maxEpisodeSteps: AGENT_GYM_MAX_EPISODE_STEPS,
        },
      };
    },
    async step(action: { tool: string; input?: unknown }): Promise<AgentGymTransition> {
      const beforeEpisode = session.snapshot();
      if (beforeEpisode.status !== "running") {
        return {
          observation: observeSpellGraph(graph),
          reward: 0,
          terminated: beforeEpisode.status === "complete",
          truncated: beforeEpisode.status === "truncated",
          error: {
            name: "EpisodeStateError",
            message: `Episode is ${beforeEpisode.status}; call reset before another action`,
          },
          episode: beforeEpisode,
          info: {
            scenarioId: beforeEpisode.scenarioId,
            stepIndex: null,
            graphVersion: graph.version,
            mutated: false,
            rewardReasons: [],
            actionAccepted: false,
          },
        };
      }

      const input = action.input ?? {};
      let result: unknown;
      let caught: unknown;
      if (!AGENT_GYM_TOOL_NAMES.includes(action.tool as AgentGymToolName)) {
        const error = new Error(`Unknown Agent Gym tool: ${action.tool}`);
        session.recordError(action.tool, input, cloneGraph(graph), cloneGraph(graph), error);
        caught = error;
      } else {
        try {
          const tool = action.tool as AgentGymToolName;
          result = await handlers[tool](input);
        } catch (error) {
          caught = error;
        }
      }

      const episode = session.snapshot();
      const step = episode.trajectory.at(-1)!;
      return {
        observation: observeSpellGraph(graph),
        reward: step.rewardDelta,
        terminated: episode.status === "complete",
        truncated: episode.status === "truncated",
        ...(caught === undefined ? { result } : {
          error: {
            name: caught instanceof Error ? caught.name : "Error",
            message: caught instanceof Error ? caught.message : "Tool execution failed",
          },
        }),
        episode,
        info: {
          scenarioId: episode.scenarioId,
          stepIndex: step.index,
          graphVersion: graph.version,
          mutated: step.mutated,
          rewardReasons: step.rewardReasons,
          actionAccepted: caught === undefined,
        },
      };
    },
    snapshot: () => session.snapshot(),
  };
}
