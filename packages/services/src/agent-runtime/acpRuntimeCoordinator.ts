/* eslint-disable max-lines -- ACP session lifecycle, restore, and command admission share one owner. */
import type { ContentBlock, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { open, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentRuntimeId, ZCodeTaskMeta } from "@zcode/shared";
import type { AgentRuntimeConfigPreview } from "#src/zcode-agent/zcodeAgent.js";
import { discoverAcpRuntimeConfig } from "#src/agent-runtime/acpConfigDiscovery.js";
import type {
  AttachmentRef,
  ConversationSnapshot,
  V4AttachmentReadParams,
  V4AttachmentReadResult,
} from "@zcode/shared/zcode-protocol-v4";
import { getZCodeDataRootDir } from "#src/paths.js";
import type { TaskIndexRepo } from "#src/session/taskIndexRepo.js";
import { AcpConnection } from "#src/agent-runtime/acpConnection.js";
import { AcpConversationProjection } from "#src/agent-runtime/acpConversationProjection.js";
import { AcpTranscriptStore } from "#src/agent-runtime/acpTranscriptStore.js";
import { createAcpManagedSession } from "#src/agent-runtime/acpSessionCreation.js";
import { prepareAcpPromptAttachments } from "#src/agent-runtime/acpPromptAttachments.js";
import {
  createAcpSessionObserver,
  createManagedAcpSession,
  type ManagedAcpSession,
  type PendingPermission,
  workspaceKey,
  sessionKey,
} from "#src/agent-runtime/acpManagedSession.js";
import {
  resolveAcpRuntimeSpec,
  isolateAcpNativeAutoMemory,
  resolveAcpRuntimeCommand,
  type AcpRuntimeSpec,
} from "#src/agent-runtime/acpRuntimeCatalog.js";

export interface AcpWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface AcpRuntimeCoordinatorEvents {
  onSnapshot?(
    target: AcpWorkspaceTarget & { taskId: string },
    snapshot: ConversationSnapshot,
  ): void;
  onPermission?(
    target: AcpWorkspaceTarget & { taskId: string; interactionId: string },
    request: RequestPermissionRequest,
  ): void;
}

/** ACP 进程是会话执行所有者；task index 仅持久化工作台与原生会话的绑定。 */
export class AcpRuntimeCoordinator {
  private readonly active = new Map<string, ManagedAcpSession>();
  private readonly unavailable = new Map<string, AcpConversationProjection>();
  private readonly creating = new Map<string, Promise<ZCodeTaskMeta>>();

  constructor(
    private readonly taskIndex: Pick<
      TaskIndexRepo,
      "getTaskMeta" | "syncTaskMetaAtGroupedTop" | "syncTaskMeta"
    >,
    private readonly events: AcpRuntimeCoordinatorEvents = {},
    private readonly resolveLaunch: (
      spec: AcpRuntimeSpec,
    ) => Promise<{ executable: string; args: readonly string[] }> = async (spec) => ({
      executable: await resolveAcpRuntimeCommand(spec),
      args: spec.args,
    }),
    private readonly isMemoryEnabled: () => boolean | Promise<boolean> = () => false,
  ) {}

  async discoverConfig(
    input: AcpWorkspaceTarget & {
      runtimeId: AgentRuntimeId;
      modelId?: string;
      includeAllModelThoughtLevels?: boolean;
    },
  ): Promise<AgentRuntimeConfigPreview> {
    return discoverAcpRuntimeConfig({ ...input, resolveLaunch: this.resolveLaunch });
  }

  async create(
    input: AcpWorkspaceTarget & {
      commandId: string;
      runtimeId: AgentRuntimeId;
      modelId?: string;
      thoughtLevel?: string;
      parentTaskId?: string;
    },
  ): Promise<ZCodeTaskMeta> {
    const key = sessionKey(input, input.commandId);
    const creating = this.creating.get(key);
    if (creating) return creating;
    const task = this.createOnce(input);
    this.creating.set(key, task);
    try {
      return await task;
    } finally {
      if (this.creating.get(key) === task) this.creating.delete(key);
    }
  }

  private async createOnce(
    input: AcpWorkspaceTarget & {
      commandId: string;
      runtimeId: AgentRuntimeId;
      modelId?: string;
      thoughtLevel?: string;
      parentTaskId?: string;
    },
  ): Promise<ZCodeTaskMeta> {
    // 旧内置项仅允许从已验证的历史父会话派生；顶层新建仍只使用配置注册表。
    const spec = await resolveAcpRuntimeSpec(input.runtimeId, {
      restoreLegacy: Boolean(input.parentTaskId),
    });
    if (!spec) throw new Error(`Unsupported ACP Runtime ${input.runtimeId}`);
    const existing = await this.taskIndex.getTaskMeta({ ...input, taskId: input.commandId });
    if (existing) {
      if (existing.runtimeId !== input.runtimeId)
        throw new Error("ACP create command belongs to another Runtime");
      if (existing.forkedFromTaskId !== input.parentTaskId)
        throw new Error("ACP create command belongs to another parent session");
      return existing;
    }
    const taskId = input.commandId;
    const key = sessionKey(input, taskId);
    if (this.active.has(key)) throw new Error("ACP create is already in progress");
    const managed = await createAcpManagedSession({
      taskId,
      runtimeId: input.runtimeId,
      workspacePath: input.workspacePath,
      workspaceIdentity: input.workspaceIdentity,
      workspaceKey: workspaceKey(input),
      modelId: input.modelId,
      thoughtLevel: input.thoughtLevel,
      parentTaskId: input.parentTaskId,
      spec,
      resolveLaunch: this.resolveLaunch,
      isMemoryEnabled: this.isMemoryEnabled,
      syncTaskMetaAtGroupedTop: async (meta) => {
        // 辅助对话是已有任务的子会话；持久化绑定后由侧面板呈现，不作为新顶层任务插队。
        if (input.parentTaskId) await this.taskIndex.syncTaskMeta({ meta });
        else await this.taskIndex.syncTaskMetaAtGroupedTop({ meta });
      },
      makeObserver: (projection, transcript, pending, current) =>
        this.makeObserver(input, taskId, projection, transcript, pending, current),
    });
    this.active.set(key, managed);
    this.publish(managed);
    return managed.meta;
  }

  async load(target: AcpWorkspaceTarget & { taskId: string }): Promise<ConversationSnapshot> {
    const key = sessionKey(target, target.taskId);
    const current = this.active.get(key);
    if (current && !current.crashed) return current.projection.snapshot();
    if (current) this.active.delete(key);
    const meta = await this.requireMeta(target);
    const projection = new AcpConversationProjection(
      meta.taskId,
      meta.title,
      meta.runtimeId,
      meta.model,
      meta.thoughtLevel,
    );
    const transcript = new AcpTranscriptStore(
      workspaceKey(target),
      meta.taskId,
      getZCodeDataRootDir(),
    );
    projection.restore((await transcript.read()) ?? []);
    try {
      const spec = await resolveAcpRuntimeSpec(meta.runtimeId ?? "zcode-cli", {
        restoreLegacy: true,
      });
      if (!spec || !meta.nativeSessionId) throw new Error("ACP task binding is incomplete");
      if (meta.agentServerFingerprint && meta.agentServerFingerprint !== spec.fingerprint)
        throw new Error("ACP Agent configuration changed; this session cannot continue safely");
      const pendingPermissions = new Map<string, PendingPermission>();
      let managed: ManagedAcpSession | null = null;
      const observer = this.makeObserver(
        target,
        meta.taskId,
        projection,
        transcript,
        pendingPermissions,
        () => managed,
      );
      const { executable, args } = await this.resolveLaunch(spec);
      const isolated = isolateAcpNativeAutoMemory(spec, process.env, args);
      const connection = await AcpConnection.open(
        {
          executable,
          args: isolated.args,
          cwd: target.workspacePath,
          env: isolated.env,
          memory: { workspaceIdentity: target.workspaceIdentity, isEnabled: this.isMemoryEnabled },
        },
        observer,
      );
      try {
        await connection.loadSession(meta.nativeSessionId, target.workspacePath);
        if (
          meta.model &&
          !connection.modelOptions().some((model) => model.id === meta.model && model.selected)
        )
          await connection.setModel(meta.model);
        if (
          meta.thoughtLevel &&
          !connection
            .thinkingLevels()
            .some((level) => level.value === meta.thoughtLevel && level.selected)
        )
          await connection.setThinkingLevel(meta.thoughtLevel);
        projection.setModelOptions(connection.modelOptions());
        projection.setThinkingLevels(connection.thinkingLevels());
        const entries = (await transcript.read()) ?? [];
        managed = createManagedAcpSession({
          connection,
          meta,
          projection,
          transcript,
          acceptedCommandIds: new Set(
            entries.filter((entry) => entry.kind === "prompt").map((entry) => entry.commandId),
          ),
          pendingPermissions,
        });
        this.active.set(key, managed);
        this.unavailable.delete(key);
        this.publish(managed);
        return projection.snapshot();
      } catch (error) {
        await connection.close();
        throw error;
      }
    } catch (error) {
      projection.markUnavailable(error instanceof Error ? error.message : String(error));
      this.unavailable.set(key, projection);
      return projection.snapshot();
    }
  }

  async sendPrompt(
    target: AcpWorkspaceTarget & {
      taskId: string;
      commandId: string;
      text: string;
      attachments?: readonly AttachmentRef[];
    },
  ): Promise<"accepted" | "duplicate"> {
    const managed = this.active.get(sessionKey(target, target.taskId));
    if (!managed) throw new Error("ACP session is not loaded");
    if (managed.crashed)
      throw new Error("ACP process exited; reload the session before sending another prompt");
    if (managed.acceptedCommandIds.has(target.commandId)) return "duplicate";
    if (managed.projection.snapshot().control.phase === "running")
      throw new Error("ACP session is busy");
    // 先校验全部附件，再持久接纳输入；任何图片能力/路径失败都不会启动部分 prompt。
    const prepared = await prepareAcpPromptAttachments(
      target.attachments ?? [],
      managed.connection.initializeResponse.agentCapabilities?.promptCapabilities?.image === true,
    );
    const textBlock: ContentBlock = { type: "text", text: target.text };
    const content: ContentBlock[] = [textBlock, ...prepared.promptBlocks];
    await managed.transcript.appendPrompt(target.commandId, [
      textBlock,
      ...prepared.transcriptBlocks,
    ]);
    managed.acceptedCommandIds.add(target.commandId);
    managed.projection.beginTurn(target.commandId, target.text, target.attachments);
    managed.activeCommandId = target.commandId;
    managed.turnSettled = false;
    managed.meta = { ...managed.meta, updatedAt: Date.now(), status: "running" };
    try {
      await this.taskIndex.syncTaskMeta({ meta: managed.meta });
    } catch (error) {
      await this.finishTurn(managed, {
        error: "ACP prompt was not started because task state could not be saved",
      });
      throw error;
    }
    this.publish(managed);
    void this.runPrompt(managed, target.commandId, content);
    return "accepted";
  }

  snapshot(target: AcpWorkspaceTarget & { taskId: string }): ConversationSnapshot | null {
    const key = sessionKey(target, target.taskId);
    return (
      this.active.get(key)?.projection.snapshot() ?? this.unavailable.get(key)?.snapshot() ?? null
    );
  }

  isUnavailable(target: AcpWorkspaceTarget & { taskId: string }): boolean {
    return this.unavailable.has(sessionKey(target, target.taskId));
  }

  rowsRange(target: AcpWorkspaceTarget & { taskId: string; beforeRowId?: number; limit: number }) {
    const key = sessionKey(target, target.taskId);
    const projection = this.active.get(key)?.projection ?? this.unavailable.get(key);
    if (!projection) throw new Error("ACP session is not loaded");
    return projection.rowsRange(target.beforeRowId, target.limit);
  }

  async readAttachment(
    target: AcpWorkspaceTarget & V4AttachmentReadParams,
  ): Promise<V4AttachmentReadResult> {
    if (!isAbsolute(target.ref)) throw new Error("fault.attachment.previewRefNotAuthorized");
    const transcript = new AcpTranscriptStore(
      workspaceKey(target),
      target.sessionId,
      getZCodeDataRootDir(),
    );
    const entries = (await transcript.read()) ?? [];
    const uri = pathToFileURL(target.ref).href;
    const matched = entries.some(
      (entry) =>
        entry.kind === "prompt" &&
        entry.content.some((block) => block.type === "resource_link" && block.uri === uri),
    );
    if (!matched) throw new Error("fault.attachment.previewRefNotAuthorized");
    const path = await realpath(target.ref);
    const info = await stat(path);
    if (!info.isFile() || info.size > 20 * 1024 * 1024)
      throw new Error("fault.attachment.previewRangeInvalid");
    const attachment = entries
      .flatMap((entry) => (entry.kind === "prompt" ? entry.content : []))
      .find((block) => block.type === "resource_link" && block.uri === uri);
    const mediaType = attachment?.type === "resource_link" ? attachment.mimeType : undefined;
    if (!mediaType || (!mediaType.startsWith("image/") && mediaType !== "application/pdf"))
      throw new Error("fault.attachment.readUnsupported");
    if (target.offset > info.size) throw new Error("fault.attachment.previewRangeInvalid");
    const length = Math.min(target.limit, info.size - target.offset);
    const buffer = Buffer.alloc(length);
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      let bytesRead = 0;
      while (bytesRead < length) {
        const result = await handle.read(
          buffer,
          bytesRead,
          length - bytesRead,
          target.offset + bytesRead,
        );
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
      if (bytesRead !== length) throw new Error("fault.attachment.previewRangeInvalid");
    } finally {
      await handle.close();
    }
    const nextOffset = target.offset + length;
    return {
      dataBase64: buffer.toString("base64"),
      mediaType,
      totalBytes: info.size,
      nextOffset: nextOffset < info.size ? nextOffset : null,
    };
  }

  async hasAcceptedCommand(
    target: AcpWorkspaceTarget & { taskId: string; commandId: string },
  ): Promise<boolean> {
    const managed = this.active.get(sessionKey(target, target.taskId));
    if (managed) return managed.acceptedCommandIds.has(target.commandId);
    const transcript = new AcpTranscriptStore(
      workspaceKey(target),
      target.taskId,
      getZCodeDataRootDir(),
    );
    return ((await transcript.read()) ?? []).some(
      (entry) => entry.kind === "prompt" && entry.commandId === target.commandId,
    );
  }

  async cancel(target: AcpWorkspaceTarget & { taskId: string }): Promise<void> {
    const managed = this.active.get(sessionKey(target, target.taskId));
    if (!managed) throw new Error("ACP session is not loaded");
    await managed.connection.cancel();
  }

  async setThinkingLevel(target: AcpWorkspaceTarget & { taskId: string; value: string }) {
    const managed = this.active.get(sessionKey(target, target.taskId));
    if (!managed) throw new Error("ACP session is not loaded");
    const levels = await managed.connection.setThinkingLevel(target.value);
    managed.projection.setThinkingLevels(levels);
    managed.meta = { ...managed.meta, thoughtLevel: target.value, updatedAt: Date.now() };
    await this.taskIndex.syncTaskMeta({ meta: managed.meta });
    this.publish(managed);
    return levels;
  }

  async setModel(target: AcpWorkspaceTarget & { taskId: string; value: string }): Promise<void> {
    const managed = this.active.get(sessionKey(target, target.taskId));
    if (!managed) throw new Error("ACP session is not loaded");
    const result = await managed.connection.setModel(target.value);
    managed.projection.setModelOptions(result.models);
    managed.projection.setThinkingLevels(result.thinkingLevels);
    managed.meta = {
      ...managed.meta,
      model: target.value,
      thoughtLevel: result.thinkingLevels.find((level) => level.selected)?.value,
      updatedAt: Date.now(),
    };
    await this.taskIndex.syncTaskMeta({ meta: managed.meta });
    this.publish(managed);
  }

  respondPermission(
    target: AcpWorkspaceTarget & { taskId: string; interactionId: string; optionId?: string },
  ): boolean {
    const managed = this.active.get(sessionKey(target, target.taskId));
    const pending = managed?.pendingPermissions.get(target.interactionId);
    if (!pending) return false;
    if (
      target.optionId &&
      !pending.request.options.some((option) => option.optionId === target.optionId)
    )
      return false;
    managed?.pendingPermissions.delete(target.interactionId);
    managed?.projection.settlePermission(target.interactionId);
    if (managed) this.publish(managed);
    pending.resolve(
      target.optionId
        ? { outcome: { outcome: "selected", optionId: target.optionId } }
        : { outcome: { outcome: "cancelled" } },
    );
    return true;
  }

  async close(target: AcpWorkspaceTarget & { taskId: string }): Promise<void> {
    const key = sessionKey(target, target.taskId);
    this.unavailable.delete(key);
    const managed = this.active.get(key);
    if (!managed) return;
    managed.closing = true;
    this.active.delete(key);
    await managed.connection.close();
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.active.values()].map((session) =>
        this.close({ ...session.meta, taskId: session.meta.taskId }),
      ),
    );
    this.unavailable.clear();
  }

  private async requireMeta(
    target: AcpWorkspaceTarget & { taskId: string },
  ): Promise<ZCodeTaskMeta> {
    const meta = await this.taskIndex.getTaskMeta(target);
    if (!meta || !meta.runtimeId || meta.runtimeId === "zcode-cli")
      throw new Error("ACP task was not found");
    return meta;
  }

  private makeObserver(
    target: AcpWorkspaceTarget,
    taskId: string,
    projection: AcpConversationProjection,
    transcript: AcpTranscriptStore,
    pending: Map<string, PendingPermission>,
    current: () => ManagedAcpSession | null,
  ) {
    return createAcpSessionObserver({
      taskId,
      projection,
      transcript,
      pending,
      current,
      syncMeta: async (meta) => {
        await this.taskIndex.syncTaskMeta({ meta });
      },
      publish: (managed) => this.publish(managed),
      onPermission: this.events.onPermission
        ? (interactionId, request) =>
            this.events.onPermission?.({ ...target, taskId, interactionId }, request)
        : undefined,
      finishCrashedTurn: (managed) =>
        this.finishTurn(managed, { error: "ACP process exited; turn outcome is unknown" }),
    });
  }

  private async runPrompt(
    managed: ManagedAcpSession,
    commandId: string,
    content: ContentBlock[],
  ): Promise<void> {
    try {
      const result = await managed.connection.prompt(commandId, content);
      await this.finishTurn(
        managed,
        managed.crashed ? { error: "ACP process exited; turn outcome is unknown" } : result,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.finishTurn(managed, {
        error: managed.crashed ? "ACP process exited; turn outcome is unknown" : message,
      }).catch(() => {});
    }
  }

  private async finishTurn(
    managed: ManagedAcpSession,
    result: Awaited<ReturnType<AcpConnection["prompt"]>> | { error: string },
  ): Promise<void> {
    if (managed.turnSettled) return;
    managed.turnSettled = true;
    await managed.transcript.flush();
    await managed.transcript.appendTurnEnd(result);
    managed.projection.finishTurn(result);
    managed.activeCommandId = null;
    managed.meta = {
      ...managed.meta,
      updatedAt: Date.now(),
      status: "error" in result ? "error" : "completed",
    };
    await this.taskIndex.syncTaskMeta({ meta: managed.meta }).catch(() => {});
    this.publish(managed);
  }

  private publish(managed: ManagedAcpSession): void {
    this.events.onSnapshot?.(
      { ...managed.meta, taskId: managed.meta.taskId },
      managed.projection.snapshot(),
    );
  }
}
