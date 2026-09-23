import {
  conversationSnapshotSchema,
  type ConversationRow,
  type ConversationSnapshot,
  type PendingInteraction,
  type PlanState,
} from "@zcode/shared/zcode-protocol-v4";
import type { AgentRuntimeId } from "@zcode/shared";

const HISTORY_WINDOW_ROWS = 60;
const UNSUPPORTED = { allowed: false as const, reasonCode: "acpCapabilityUnsupported" };

/** 将 ACP 持有的只读状态映射到现有 V4 会话视图。 */
export function buildAcpProjectionSnapshot(input: {
  taskId: string;
  logEpoch: string;
  seq: number;
  revision: number;
  phase: ConversationSnapshot["control"]["phase"];
  title: string;
  runtimeId?: AgentRuntimeId;
  model: string;
  thought: string;
  thoughtLevels: string[];
  modelOptions: Array<{ id: string; name: string }>;
  permissions: PendingInteraction[];
  plan: PlanState | null;
  rows: ConversationRow[];
  unavailableReason?: string | null;
}): ConversationSnapshot {
  const { phase } = input;
  return conversationSnapshotSchema.parse({
    protocolVersion: 1,
    sessionId: input.taskId,
    logEpoch: input.logEpoch,
    seq: input.seq,
    revision: input.revision,
    control: {
      phase,
      sessionEnded: phase !== "draft" && phase !== "running",
      canStop: phase === "running",
      stopState: phase === "running" ? "stoppable" : "idle",
      stopTargetKind: phase === "running" ? "assistant" : "unknown",
      activeWorks: [],
      lastError: input.unavailableReason
        ? {
            code: "acpRuntimeUnavailable",
            message: input.unavailableReason,
            recoverable: false,
            at: Date.now(),
            source: "runtime",
          }
        : null,
      apiRetry: null,
    },
    availability: {
      fork: UNSUPPORTED,
      compact: UNSUPPORTED,
      switchModelConfig:
        phase === "running" || input.unavailableReason
          ? {
              allowed: false,
              reasonCode: input.unavailableReason ? "acpRuntimeUnavailable" : "acpTurnRunning",
            }
          : { allowed: true },
      setFollowupMode: UNSUPPORTED,
      queueEdit: UNSUPPORTED,
      sendQueuedNow: UNSUPPORTED,
      pauseGoal: UNSUPPORTED,
      resumeGoal: UNSUPPORTED,
    },
    inputRouting: input.unavailableReason
      ? { mode: "reject", reasonCode: "acpRuntimeUnavailable" }
      : phase === "running"
        ? { mode: "reject", reasonCode: "acpTurnRunning" }
        : { mode: "startNow" },
    meta: {
      title: input.title,
      titleSource: "default",
      ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
    },
    config: {
      provider: input.runtimeId ?? "acp",
      model: input.model,
      thought: input.thought,
      ...(input.runtimeId && input.model
        ? {
            modelSelection: {
              providerId: input.runtimeId,
              modelId: input.model,
              ...(input.thought ? { options: { reasoningLevel: input.thought } } : {}),
            },
          }
        : {}),
      thoughtLevels: input.thoughtLevels,
      acpModelOptions: input.modelOptions,
      followupMode: "queue",
      mode: "build",
    },
    modelTransition: null,
    usage: {
      contextWindow: null,
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: input.permissions,
    pendingCommands: [],
    backgroundWorks: [],
    subagents: { revision: 0, childSessionIds: [], running: [], endedTotal: 0 },
    goal: null,
    plan: input.plan,
    workspaceHookAdmission: null,
    rows: {
      window: input.rows.slice(-HISTORY_WINDOW_ROWS),
      totalCount: input.rows.length,
      firstRowId: input.rows[0]?.rowId ?? null,
    },
  });
}
