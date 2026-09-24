/* oxlint-disable eslint(max-lines) -- ACP 更新、回放与 V4 投影共享同一会话状态。 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
  SessionNotification,
  PromptResponse,
  ToolCallStatus,
  RequestPermissionRequest,
  SessionModeState,
} from "@agentclientprotocol/sdk";
import {
  type ConversationRow,
  type ConversationSnapshot,
  type PlanState,
  type PendingInteraction,
} from "@zcode/shared/zcode-protocol-v4";
import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";
import type { AcpTranscriptEntry } from "#src/agent-runtime/acpTranscriptStore.js";
import type { AcpModelOption, AcpThinkingLevel } from "#src/agent-runtime/acpConnection.js";
import { buildAcpProjectionSnapshot } from "#src/agent-runtime/acpProjectionSnapshot.js";

/** ACP 会话自身的只读工作台投影，不借用 ZCode CLI 的 SessionRecord。 */
export class AcpConversationProjection {
  private readonly logEpoch = randomUUID();
  private readonly rows: ConversationRow[] = [];
  private readonly rowByMessageId = new Map<string, number>();
  private readonly rowByToolCallId = new Map<string, number>();
  private readonly reasoningStartedAt = new Map<number, number>();
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
  private modes: SessionModeState | null = null;
  private unavailableReason: string | null = null;
  private lastError: {
    code: string;
    message: string;
    recoverable: boolean;
    at: number;
    source: "runtime";
  } | null = null;

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
        const attachments: AttachmentRef[] = entry.content.flatMap((block) => {
          if (block.type !== "resource_link" || !block.uri.startsWith("file:")) return [];
          try {
            return [
              {
                ref: fileURLToPath(block.uri),
                fileName: block.name,
                mime: block.mimeType ?? "application/octet-stream",
                bytes: block.size ?? 0,
              },
            ];
          } catch {
            return [];
          }
        });
        this.beginTurn(entry.commandId, text, attachments, entry.at);
      } else if (entry.kind === "update") {
        this.applyUpdate({ sessionId: this.taskId, update: entry.update }, entry.at);
      } else {
        this.finishTurn(entry.result, entry.at);
      }
    }
    if (this.activeTurnId)
      this.finishTurn({ error: "ACP turn outcome is unknown after process exit" });
  }

  beginTurn(
    commandId: string,
    text: string,
    attachments?: readonly AttachmentRef[],
    at = Date.now(),
  ): void {
    if (this.activeTurnId) throw new Error("ACP projection already has an active turn");
    this.anonymousChunkRow = null;
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    this.phase = "running";
    this.lastError = null;
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
      ...(attachments?.length ? { attachments: [...attachments] } : {}),
    });
  }

  applyUpdate(notification: SessionNotification, at = Date.now()): void {
    if (!this.activeTurnId) return;
    const update = notification.update;
    if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk"
    ) {
      if (update.sessionUpdate === "agent_message_chunk") this.completeReasoning(at);
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
        if (kind === "reasoning") this.reasoningStartedAt.set(row.rowId, at);
      }
      if (key) this.anonymousChunkRow = null;
    } else if (update.sessionUpdate === "session_info_update" && update.title) {
      this.title = update.title;
      this.advance();
    } else if (update.sessionUpdate === "current_mode_update" && this.modes) {
      this.modes = { ...this.modes, currentModeId: update.currentModeId };
      this.advance();
    } else if (
      update.sessionUpdate === "tool_call" ||
      update.sessionUpdate === "tool_call_update"
    ) {
      this.completeReasoning(at);
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
      this.completeReasoning(at);
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

  finishTurn(result: PromptResponse | { error: string }, endedAt = Date.now()): void {
    if (!this.activeTurnId) return;
    const failure = acpPromptFailure(result);
    const failed = failure !== null;
    const cancelled = !failed && "stopReason" in result && result.stopReason === "cancelled";
    this.completeReasoning(endedAt, cancelled || failed);
    this.lastError = failure
      ? {
          code: "acpPromptFailed",
          message: failure,
          recoverable: true,
          at: endedAt,
          source: "runtime",
        }
      : null;
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
    this.reasoningStartedAt.clear();
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

  setModes(modes: SessionModeState | null): void {
    this.modes = modes;
    this.advance();
  }

  setTitle(title: string): void {
    if (this.title === title) return;
    this.title = title;
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
      modes: this.modes,
      permissions: [...this.permissions.values()],
      plan: this.plan,
      rows: this.rows,
      unavailableReason: this.unavailableReason,
      lastError: this.lastError,
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

  private completeReasoning(at: number, interrupted = false): void {
    for (let index = 0; index < this.rows.length; index++) {
      const row = this.rows[index];
      if (
        row?.kind !== "reasoning" ||
        row.turnId !== this.activeTurnId ||
        row.state !== "streaming"
      )
        continue;
      this.rows[index] = {
        ...row,
        state: interrupted ? "interrupted" : "complete",
        durationMs: Math.max(0, at - (this.reasoningStartedAt.get(row.rowId) ?? at)),
      };
      this.reasoningStartedAt.delete(row.rowId);
      for (const [key, rowId] of this.rowByMessageId) {
        if (rowId === row.rowId) this.rowByMessageId.delete(key);
      }
      if (this.anonymousChunkRow?.rowId === row.rowId) this.anonymousChunkRow = null;
      this.advance();
    }
  }
}

/** ACP refusal can carry a provider failure in metadata while the transport call itself succeeds. */
export function acpPromptFailure(result: PromptResponse | { error: string }): string | null {
  if ("error" in result) return sanitizeAcpFailureMessage(result.error);
  const meta = result._meta as Record<string, unknown> | undefined;
  const knownFailure = meta?.["codebuddy.ai/outcome"] === "FAILED_MODEL_REQUEST";
  if (!knownFailure && result.stopReason !== "refusal") return null;
  const raw = meta?.["codebuddy.ai/errorMessage"];
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "message" in parsed &&
        typeof parsed.message === "string"
      )
        return sanitizeAcpFailureMessage(parsed.message);
    } catch {
      return sanitizeAcpFailureMessage(raw);
    }
  }
  return knownFailure ? "ACP Agent 请求失败" : "ACP Agent 拒绝了本次请求";
}

function sanitizeAcpFailureMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s)]+/gu, "[URL]")
    .replace(/[\r\n\t]+/gu, " ")
    .slice(0, 500);
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
