import {
  AGENT_GYM_MAX_EPISODE_STEPS,
  AGENT_GYM_TOOL_NAMES,
  createAgentGymEnvironment,
} from "./agent-gym.ts";
import {
  AGENT_GYM_SPLIT_SIZES,
  type AgentGymSplit,
} from "../scenarios/agent-gym-family.ts";

export const AGENT_GYM_JSONL_PROTOCOL = "hex-machina-agent-gym/jsonl-v1" as const;

type RequestId = string | number;

interface RolloutRequest {
  id: RequestId;
  op: "describe" | "reset" | "step" | "snapshot";
  split?: AgentGymSplit;
  index?: number;
  action?: { tool: string; input?: unknown };
}

type AgentGymEnvironment = ReturnType<typeof createAgentGymEnvironment>;

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseRequest(line: string): RolloutRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("Request must be valid JSON");
  }
  const request = recordOf(parsed);
  if (!request) throw new Error("Request must be a JSON object");
  if (typeof request.id !== "string" && typeof request.id !== "number") {
    throw new Error("Request id must be a string or number");
  }
  if (!["describe", "reset", "step", "snapshot"].includes(String(request.op))) {
    throw new Error("Request op must be describe, reset, step, or snapshot");
  }
  return request as unknown as RolloutRequest;
}

function parseResetOptions(request: RolloutRequest) {
  if (request.split === undefined && request.index === undefined) return undefined;
  if (!Object.hasOwn(AGENT_GYM_SPLIT_SIZES, String(request.split))) {
    throw new Error("Reset split must be train, validation, or test");
  }
  const index = request.index ?? 0;
  if (!Number.isInteger(index)) throw new Error("Reset index must be an integer");
  return { split: request.split!, index };
}

function parseAction(request: RolloutRequest) {
  const action = recordOf(request.action);
  if (!action || typeof action.tool !== "string") {
    throw new Error("Step action must be an object with a string tool name");
  }
  return {
    tool: action.tool,
    ...(Object.hasOwn(action, "input") ? { input: action.input } : {}),
  };
}

function response(
  id: RequestId | null,
  op: string | null,
  ok: boolean,
  payload: unknown,
) {
  return JSON.stringify({
    protocol: AGENT_GYM_JSONL_PROTOCOL,
    id,
    op,
    ok,
    ...(ok ? { payload } : { error: payload }),
  });
}

export function createAgentGymJsonlBridge() {
  let environment: AgentGymEnvironment | null = null;

  return {
    async handleLine(line: string) {
      let request: RolloutRequest;
      try {
        request = parseRequest(line);
      } catch (error) {
        return response(null, null, false, {
          code: "invalid-request",
          message: error instanceof Error ? error.message : "Invalid request",
        });
      }

      try {
        if (request.op === "describe") {
          return response(request.id, request.op, true, {
            environmentProtocol: "hex-machina-agent-gym/v1",
            actionSpace: AGENT_GYM_TOOL_NAMES,
            splitSizes: AGENT_GYM_SPLIT_SIZES,
            maxEpisodeSteps: AGENT_GYM_MAX_EPISODE_STEPS,
            transport: "One JSON request and one JSON response per line on stdin/stdout.",
          });
        }
        if (request.op === "reset") {
          environment = createAgentGymEnvironment(parseResetOptions(request));
          return response(request.id, request.op, true, environment.reset());
        }
        if (!environment) throw new Error("Call reset before step or snapshot");
        if (request.op === "step") {
          return response(request.id, request.op, true, await environment.step(parseAction(request)));
        }
        return response(request.id, request.op, true, environment.snapshot());
      } catch (error) {
        return response(request.id, request.op, false, {
          code: "operation-error",
          message: error instanceof Error ? error.message : "Operation failed",
        });
      }
    },
  };
}
