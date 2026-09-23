/* oxlint-disable eslint(max-lines) -- ACP 更新、回放与 V4 投影共享同一会话状态。 */
import { randomUUID } from "node:crypto";
import type {
  SessionNotification,
  PromptResponse,
  ToolCallStatus,
  RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import {
  type ConversationRow,
  type ConversationSnapshot,
  type PlanState,
  type PendingInteraction,
} from "@zcode/shared/zcode-protocol-v4";
import type { AcpTranscriptEntry } from "#src/agent-runtime/acpTranscriptStore.js";
import type { AcpModelOption, AcpThinkingLevel } from "#src/agent-runtime/acpConnection.js";
import { buildAcpProjectionSnapshot } from "#src/agent-runtime/acpProjectionSnapshot.js";

/** ACP 会话自身的只读工作台投影，不借用 ZCode CLI 的 SessionRecord。 */
export class AcpConversationProjection {
  private readonly logEpoch = randomUUID();
  private readonly rows: ConversationRow[] = [];
  private readonly rowByMessageId = new Map<string, number>();
  private readonly rowByToolCallId = new Map<string, number>();
  private anonymousChunkRow: { kind: "assistantText" | "reasoning"; rowId: number } | null = null;
  private nextRowId = 0;
  private seq = 0;
  private revision = 0;
  private activeTurnId: string | null = null;
  private activeTurnHeaderRowId: number | null = null;
  private phase: ConversationSnapshot["control"]["phase"] = "draft";
  private plan: PlanState | null = null;
  private readonly permissions = new Map<string, PendingInteraction>();
  private thoughtLevels: string[] = [];
  private thought = "";
  private model = "";
  private modelOptions: Array<{ id: string; name: string }> = [];
  private unavailableReason: string | null = null;

  constructor(
    readonly taskId: string,
    private title = "",
    private readonly runtimeId?: import("@zcode/shared").AgentRuntimeId,
    initialModel = "",
    initialThought = "",
  ) {
    this.model = initialModel;
    this.thought = initialThought;
  }

  /** 只重放工作台已记录的 ACP 事件；不依赖 Agent 的私有历史格式。 */
  restore(entries: readonly AcpTranscriptEntry[]): void {
    if (this.rows.length > 0 || this.activeTurnId)
      throw new Error("ACP projection is already populated");
    for (const entry of entries) {
      if (entry.kind === "prompt") {
        if (this.activeTurnId)
          this.finishTurn({ error: "ACP turn ended without a terminal response" });
        const text = entry.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        this.beginTurn(entry.commandId, text);
      } else if (entry.kind === "update") {
        this.applyUpdate({ sessionId: this.taskId, update: entry.update });
      } else {
        this.finishTurn(entry.result);
      }
    }
    if (this.activeTurnId)
      this.finishTurn({ error: "ACP turn outcome is unknown after process exit" });
  }

  beginTurn(commandId: string, text: string): void {
    if (this.activeTurnId) throw new Error("ACP projection already has an active turn");
    this.anonymousChunkRow = null;
    const turnId = randomUUID();
    const at = Date.now();
    this.activeTurnId = turnId;
    this.phase = "running";
    const header = this.pushRow({
      kind: "turnHeader",
      turnId,
      origin: "userInput",
      executionKind: "agent",
      sourceCommandId: commandId,
      state: "running",
      startedAt: at,
    });
    this.activeTurnHeaderRowId = header.rowId;
    this.pushRow({
      kind: "userInput",
      turnId,
      text,
      origin: "realUser",
      sourceCommandId: commandId,
    });
  }

  applyUpdate(notification: SessionNotification): void {
    if (!this.activeTurnId) return;
    const update = notification.update;
    if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk"
    ) {
      if (update.content.type !== "text") return;
      const kind = update.sessionUpdate === "agent_message_chunk" ? "assistantText" : "reasoning";
      const key = update.messageId ? `${kind}:${update.messageId}` : null;
      // ACP 不要求 messageId。无 ID 的连续同类 chunk 属于同一段流式消息，
      // 不能把每个 token 投影成独立的思考/回复块。
      const existingRowId = key
        ? this.rowByMessageId.get(key)
        : this.anonymousChunkRow?.kind === kind
          ? this.anonymousChunkRow.rowId
          : undefined;
      if (existingRowId !== undefined) {
        const index = this.rows.findIndex((row) => row.rowId === existingRowId);
        const existing = this.rows[index];
        if (existing && (existing.kind === "assistantText" || existing.kind === "reasoning")) {
          this.rows[index] = { ...existing, text: existing.text + update.content.text };
          this.advance();
        }
      } else {
        const row =
          kind === "assistantText"
            ? this.pushRow({
                kind,
                turnId: this.activeTurnId,
                text: update.content.text,
                state: "streaming",
              })
            : this.pushRow({
                kind,
                turnId: this.activeTurnId,
                text: update.content.text,
                state: "streaming",
              });
        if (key) this.rowByMessageId.set(key, row.rowId);
        else this.anonymousChunkRow = { kind, rowId: row.rowId };
      }
      if (key) this.anonymousChunkRow = null;
    } else if (update.sessionUpdate === "session_info_update" && update.title) {
      this.title = update.title;
      this.advance();
    } else if (
      update.sessionUpdate === "tool_call" ||
      update.sessionUpdate === "tool_call_update"
    ) {
      const status = mapToolStatus(update.status);
      const existingRowId = this.rowByToolCallId.get(update.toolCallId);
      const index =
        existingRowId === undefined
          ? -1
          : this.rows.findIndex((row) => row.rowId === existingRowId);
      const existing = index >= 0 ? this.rows[index] : undefined;
      const title =
        update.title ?? (existing?.kind === "toolCall" ? existing.toolName : null) ?? "ACP tool";
      const inputText =
        update.rawInput === undefined
          ? existing?.kind === "toolCall"
            ? existing.inputText
            : ""
          : boundedText(update.rawInput);
      const contentText = update.content
        ?.flatMap((item) =>
          item.type === "content" && item.content.type === "text" ? [item.content.text] : [],
        )
        .join("\n");
      const outputText =
        contentText || (update.rawOutput === undefined ? "" : boundedText(update.rawOutput));
      if (existing?.kind === "toolCall") {
        this.rows[index] = {
          ...existing,
          toolName: update.name ?? title,
          status: status ?? existing.status,
          inputText,
          ...(outputText ? { output: { text: outputText } } : {}),
          ...(status === "success" || status === "error" ? { endedAt: Date.now() } : {}),
          ...(status === "error"
            ? { error: { code: "acpToolFailed", message: `${title} failed` } }
            : {}),
        };
        this.advance();
      } else {
        const row = this.pushRow({
          kind: "toolCall",
          turnId: this.activeTurnId,
          toolCallId: update.toolCallId,
          toolName: update.name ?? title,
          status: status ?? "inputStreaming",
          inputText,
          ...(outputText ? { output: { text: outputText } } : {}),
          startedAt: Date.now(),
          ...(status === "error"
            ? { error: { code: "acpToolFailed", message: `${title} failed` } }
            : {}),
        });
        this.rowByToolCallId.set(update.toolCallId, row.rowId);
      }
    } else if (update.sessionUpdate === "plan") {
      this.plan = {
        items: update.entries.map((entry, index) => ({
          id: `acp-${index}`,
          content: entry.content,
          status: entry.status === "in_progress" ? "inProgress" : entry.status,
        })),
        updatedAt: Date.now(),
      };
      this.advance();
    }
    if (
      update.sessionUpdate === "tool_call" ||
      update.sessionUpdate === "tool_call_update" ||
      update.sessionUpdate === "plan"
    ) {
      this.anonymousChunkRow = null;
    }
  }

  finishTurn(result: PromptResponse | { error: string }): void {
    if (!this.activeTurnId) return;
    const endedAt = Date.now();
    const failed = "error" in result;
    const cancelled = !failed && result.stopReason === "cancelled";
    this.phase = failed ? "error" : cancelled ? "completedInterrupted" : "completedSuccess";
    for (let index = 0; index < this.rows.length; index++) {
      const row = this.rows[index]!;
      if (row.turnId !== this.activeTurnId) continue;
      if (row.kind === "turnHeader" && row.rowId === this.activeTurnHeaderRowId) {
        this.rows[index] = {
          ...row,
          state: failed ? "failed" : cancelled ? "completedInterrupted" : "completedSuccess",
          endedAt,
        };
      } else if (row.kind === "assistantText" && row.state === "streaming") {
        this.rows[index] = {
          ...row,
          state: failed ? "failed" : cancelled ? "interrupted" : "complete",
        };
      } else if (row.kind === "reasoning" && row.state === "streaming") {
        this.rows[index] = { ...row, state: cancelled || failed ? "interrupted" : "complete" };
      } else if (
        row.kind === "toolCall" &&
        row.status !== "success" &&
        row.status !== "error" &&
        row.status !== "cancelled"
      ) {
        this.rows[index] = {
          ...row,
          status: cancelled ? "cancelled" : "error",
          ...(cancelled
            ? {}
            : {
                error: {
                  code: "acpToolIncomplete",
                  message: "Tool ended without a terminal update",
                },
              }),
          endedAt,
        };
      }
    }
    this.activeTurnId = null;
    this.activeTurnHeaderRowId = null;
    this.rowByMessageId.clear();
    this.rowByToolCallId.clear();
    this.anonymousChunkRow = null;
    this.permissions.clear();
    this.advance();
  }

  requestPermission(request: RequestPermissionRequest): string {
    const interactionId = request.toolCall.toolCallId;
    this.permissions.set(interactionId, {
      interactionId,
      kind: "permission",
      anchorRowId: this.rowByToolCallId.get(interactionId) ?? null,
      createdAt: Date.now(),
      payload: {
        kind: "permission",
        toolCallId: interactionId,
        toolName: request.toolCall.title || "ACP tool",
        summary: request.toolCall.title || "ACP tool permission",
        detail: request.toolCall,
        options: request.options.map((option) => ({
          optionId: option.optionId,
          label: option.name,
          kind:
            option.kind === "allow_once"
              ? "allowOnce"
              : option.kind === "allow_always"
                ? "allowAlways"
                : option.kind === "reject_once" || option.kind === "reject_always"
                  ? "deny"
                  : "custom",
        })),
      },
    });
    this.advance();
    return interactionId;
  }

  settlePermission(interactionId: string): void {
    if (this.permissions.delete(interactionId)) this.advance();
  }

  setThinkingLevels(levels: readonly AcpThinkingLevel[]): void {
    this.thoughtLevels = levels.map((level) => level.value);
    this.thought = levels.find((level) => level.selected)?.value ?? "";
    this.advance();
  }

  setModelOptions(models: readonly AcpModelOption[]): void {
    this.modelOptions = models.map((model) => ({ id: model.id, name: model.name }));
    this.model = models.find((model) => model.selected)?.id ?? "";
    this.advance();
  }

  markUnavailable(reason: string): void {
    this.phase = "error";
    this.unavailableReason = reason;
    this.advance();
  }

  snapshot(): ConversationSnapshot {
    return buildAcpProjectionSnapshot({
      taskId: this.taskId,
      logEpoch: this.logEpoch,
      seq: this.seq,
      revision: this.revision,
      phase: this.phase,
      title: this.title,
      runtimeId: this.runtimeId,
      model: this.model,
      thought: this.thought,
      thoughtLevels: this.thoughtLevels,
      modelOptions: this.modelOptions,
      permissions: [...this.permissions.values()],
      plan: this.plan,
      rows: this.rows,
      unavailableReason: this.unavailableReason,
    });
  }

  rowsRange(beforeRowId: number | undefined, limit: number) {
    const snapshot = this.snapshot();
    const earlier = this.rows.filter((row) => beforeRowId === undefined || row.rowId < beforeRowId);
    return {
      rows: earlier.slice(-limit),
      atSeq: snapshot.seq,
      atRevision: snapshot.revision,
      atLogEpoch: snapshot.logEpoch,
      hasMore: earlier.length > limit,
    };
  }

  private pushRow(
    row:
      | {
          kind: "turnHeader";
          turnId: string;
          origin: "userInput";
          executionKind: "agent";
          sourceCommandId: string;
          state: "running";
          startedAt: number;
        }
      | {
          kind: "userInput";
          turnId: string;
          text: string;
          origin: "realUser";
          sourceCommandId: string;
        }
      | {
          kind: "assistantText" | "reasoning";
          turnId: string;
          text: string;
          state: "streaming";
        }
      | {
          kind: "toolCall";
          turnId: string;
          toolCallId: string;
          toolName: string;
          status: "inputStreaming" | "running" | "success" | "error";
          inputText: string;
          output?: { text: string };
          startedAt: number;
          error?: { code: string; message: string };
        },
  ): ConversationRow {
    const rowId = this.nextRowId++;
    this.advance();
    const value = {
      ...row,
      rowId,
      entityId: `${this.taskId}:${rowId}`,
      productTurnId: row.turnId,
      visibility: "visible" as const,
      createdAt: Date.now(),
      createdAtSeq: this.seq,
    } as ConversationRow;
    this.rows.push(value);
    return value;
  }

  private advance(): void {
    this.seq++;
    this.revision++;
  }
}

function mapToolStatus(
  status: ToolCallStatus | null | undefined,
): "inputStreaming" | "running" | "success" | "error" | null {
  switch (status) {
    case "pending":
      return "inputStreaming";
    case "in_progress":
      return "running";
    case "completed":
      return "success";
    case "failed":
      return "error";
    default:
      return null;
  }
}

function boundedText(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return (serialized ?? "").slice(0, 8_192);
}
