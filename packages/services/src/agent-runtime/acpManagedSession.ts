import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { AcpConnection, type AcpSessionObserver } from "#src/agent-runtime/acpConnection.js";
import { AcpConversationProjection } from "#src/agent-runtime/acpConversationProjection.js";
import { AcpTranscriptStore } from "#src/agent-runtime/acpTranscriptStore.js";

export interface PendingPermission {
  request: RequestPermissionRequest;
  resolve: (response: RequestPermissionResponse) => void;
}

export interface ManagedAcpSession {
  connection: AcpConnection;
  meta: ZCodeTaskMeta;
  projection: AcpConversationProjection;
  transcript: AcpTranscriptStore;
  acceptedCommandIds: Set<string>;
  pendingPermissions: Map<string, PendingPermission>;
  closing: boolean;
  crashed: boolean;
  activeCommandId: string | null;
  turnSettled: boolean;
}

export function workspaceKey(target: {
  workspacePath: string;
  workspaceIdentity?: string;
}): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

export function sessionKey(
  target: { workspacePath: string; workspaceIdentity?: string },
  taskId: string,
): string {
  return `${workspaceKey(target)}\0${taskId}`;
}

export function createManagedAcpSession(input: {
  connection: AcpConnection;
  meta: ZCodeTaskMeta;
  projection: AcpConversationProjection;
  transcript: AcpTranscriptStore;
  pendingPermissions: Map<string, PendingPermission>;
  acceptedCommandIds: Set<string>;
}): ManagedAcpSession {
  return {
    ...input,
    closing: false,
    crashed: false,
    activeCommandId: null,
    turnSettled: true,
  };
}

export function createAcpSessionObserver(input: {
  taskId: string;
  projection: AcpConversationProjection;
  transcript: AcpTranscriptStore;
  pending: Map<string, PendingPermission>;
  current: () => ManagedAcpSession | null;
  syncMeta: (meta: ZCodeTaskMeta) => Promise<void>;
  publish: (managed: ManagedAcpSession) => void;
  onPermission?: (interactionId: string, request: RequestPermissionRequest) => void;
  finishCrashedTurn: (managed: ManagedAcpSession) => Promise<void>;
}): AcpSessionObserver {
  return {
    onUpdate: async (notification) => {
      const managed = input.current();
      // session/load 可回放 Agent 自有历史；工作台只使用已持久记录的转录重建，禁止重复追加。
      if (!managed) return;
      await input.transcript.appendUpdate(notification.update);
      input.projection.applyUpdate(notification);
      if (
        notification.update.sessionUpdate === "session_info_update" &&
        notification.update.title
      ) {
        managed.meta = { ...managed.meta, title: notification.update.title, updatedAt: Date.now() };
        await input.syncMeta(managed.meta);
      }
      if (notification.update.sessionUpdate === "config_option_update") {
        const models = managed.connection.modelOptions();
        const levels = managed.connection.thinkingLevels();
        input.projection.setModelOptions(models);
        input.projection.setThinkingLevels(levels);
        const model = models.find((item) => item.selected)?.id;
        const thoughtLevel = levels.find((item) => item.selected)?.value;
        if (managed.meta.model !== model || managed.meta.thoughtLevel !== thoughtLevel) {
          managed.meta = { ...managed.meta, model, thoughtLevel, updatedAt: Date.now() };
          await input.syncMeta(managed.meta);
        }
      }
      input.publish(managed);
    },
    requestPermission: (request): Promise<RequestPermissionResponse> => {
      if (!input.onPermission || !input.current())
        return Promise.resolve({ outcome: { outcome: "cancelled" } });
      const interactionId = request.toolCall.toolCallId;
      if (input.pending.has(interactionId))
        return Promise.resolve({ outcome: { outcome: "cancelled" } });
      return new Promise((resolve) => {
        input.pending.set(interactionId, { request, resolve });
        input.projection.requestPermission(request);
        const managed = input.current();
        if (managed) input.publish(managed);
        input.onPermission?.(interactionId, request);
      });
    },
    onExit: () => {
      const managed = input.current();
      if (!managed || managed.closing) return;
      managed.crashed = true;
      for (const request of input.pending.values())
        request.resolve({ outcome: { outcome: "cancelled" } });
      for (const interactionId of input.pending.keys())
        managed.projection.settlePermission(interactionId);
      input.pending.clear();
      if (managed.activeCommandId) void input.finishCrashedTurn(managed).catch(() => {});
    },
  };
}
