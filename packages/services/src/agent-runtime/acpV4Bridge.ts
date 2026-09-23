import { randomUUID } from "node:crypto";
import type { AgentRuntimeId } from "@zcode/shared";
import {
  commandPayloadSchemas,
  conversationTopic,
  conversationTopicFrameSchema,
  encodeTopicWireFrames,
  utf8JsonByteLength,
  type CommandAck,
  type CommandKey,
  type CommandEnvelope,
  type ConversationSnapshot,
  type ConversationTopicWireCandidate,
  type TopicFrameDeliveryKind,
} from "@zcode/shared/zcode-protocol-v4";
import type { TaskIndexRepo } from "#src/session/taskIndexRepo.js";
import {
  AcpRuntimeCoordinator,
  type AcpWorkspaceTarget,
} from "#src/agent-runtime/acpRuntimeCoordinator.js";

interface AcpV4Subscription {
  target: AcpWorkspaceTarget & { taskId: string };
  subscriptionId: string;
  ordinal: number;
}

function targetKey(target: AcpWorkspaceTarget & { taskId: string }): string {
  return `${target.workspaceIdentity?.trim() || target.workspacePath}\0${target.taskId}`;
}

/** ACP 到既有 ZCode V4 conversation wire 的唯一转换边界。 */
export class AcpV4Bridge {
  private readonly subscriptions = new Map<string, AcpV4Subscription>();
  private readonly lastTaskState = new Map<string, string>();
  readonly coordinator: AcpRuntimeCoordinator;

  constructor(
    private readonly taskIndex: TaskIndexRepo,
    private readonly emit: (
      target: AcpWorkspaceTarget,
      frame: ConversationTopicWireCandidate,
    ) => void,
    isMemoryEnabled: () => boolean | Promise<boolean>,
    private readonly onTaskChanged?: (target: AcpWorkspaceTarget) => void,
  ) {
    this.coordinator = new AcpRuntimeCoordinator(
      taskIndex,
      {
        onSnapshot: (target, snapshot) => {
          this.publish(target, snapshot, "online");
          const key = targetKey(target);
          const state = `${snapshot.control.phase}\0${snapshot.meta.title}`;
          if (this.lastTaskState.get(key) !== state) {
            this.lastTaskState.set(key, state);
            this.onTaskChanged?.(target);
          }
        },
        // pending interaction 已投影到 V4；具体选项由 resolveInteraction 回传。
        onPermission: () => {},
      },
      undefined,
      isMemoryEnabled,
    );
  }

  async isAcpTask(target: AcpWorkspaceTarget & { taskId: string }): Promise<boolean> {
    const meta = await this.taskIndex.getTaskMeta(target);
    return !!meta && !!meta.runtimeId && meta.runtimeId !== "zcode-cli";
  }

  async subscribe(target: AcpWorkspaceTarget & { taskId: string }): Promise<{
    ack: {
      subscriptionId: string;
      mode: "snapshot";
      logEpoch: string;
    };
  }> {
    const snapshot = await this.coordinator.load(target);
    const subscriptionId = randomUUID();
    const subscription: AcpV4Subscription = { target, subscriptionId, ordinal: 0 };
    this.subscriptions.set(subscriptionId, subscription);
    this.publishTo(subscription, snapshot, "initial");
    return { ack: { subscriptionId, mode: "snapshot", logEpoch: snapshot.logEpoch } };
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  hasSubscription(subscriptionId: string): boolean {
    return this.subscriptions.has(subscriptionId);
  }

  resync(
    subscriptionId: string,
  ): { ack: { subscriptionId: string; mode: "snapshot"; logEpoch: string } } | null {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return null;
    const snapshot = this.coordinator.snapshot(subscription.target);
    if (!snapshot) return null;
    this.publishTo(subscription, snapshot, "recovery");
    return { ack: { subscriptionId, mode: "snapshot", logEpoch: snapshot.logEpoch } };
  }

  async command(target: AcpWorkspaceTarget, envelope: CommandEnvelope): Promise<CommandAck> {
    const revision = envelope.sessionId
      ? (this.coordinator.snapshot({ ...target, taskId: envelope.sessionId })?.revision ?? 0)
      : 0;
    const reject = (reasonCode: string): CommandAck => ({
      commandId: envelope.commandId,
      status: "rejected",
      reasonCode,
      revisionAtDecision: revision,
    });
    if (envelope.type === "createSession") {
      const payload = commandPayloadSchemas.createSession.parse(envelope.payload);
      if (!payload.runtimeId || payload.runtimeId === "zcode-cli")
        return reject("acpRuntimeNotSelected");
      if (payload.firstInput?.attachments?.length || payload.mcpServers?.length)
        return reject("acpCapabilityUnsupported");
      const meta = await this.coordinator.create({
        ...target,
        commandId: envelope.commandId,
        runtimeId: payload.runtimeId as AgentRuntimeId,
        modelId: payload.acpConfig?.modelId,
        thoughtLevel: payload.acpConfig?.thoughtLevel,
      });
      if (payload.firstInput) {
        await this.coordinator.sendPrompt({
          ...target,
          taskId: meta.taskId,
          commandId: envelope.commandId,
          text: payload.firstInput.text,
        });
      }
      return {
        commandId: envelope.commandId,
        status: "accepted",
        revisionAtDecision: 0,
        result: {
          type: "createSession",
          sessionId: meta.taskId,
          ...(payload.firstInput
            ? { input: { delivery: "startNow", inputId: envelope.commandId } }
            : {}),
        },
      };
    }
    if (!envelope.sessionId) return reject("acpSessionRequired");
    const task = { ...target, taskId: envelope.sessionId };
    if (!this.coordinator.snapshot(task)) await this.coordinator.load(task);
    if (this.coordinator.isUnavailable(task)) return reject("acpRuntimeUnavailable");
    switch (envelope.type) {
      case "sendText": {
        const payload = commandPayloadSchemas.sendText.parse(envelope.payload);
        if (payload.attachments?.length || payload.context_refs?.length || payload.modelExecution)
          return reject("acpCapabilityUnsupported");
        const outcome = await this.coordinator.sendPrompt({
          ...task,
          commandId: envelope.commandId,
          text: payload.text,
        });
        return {
          commandId: envelope.commandId,
          status: outcome === "duplicate" ? "duplicate" : "accepted",
          revisionAtDecision: this.coordinator.snapshot(task)?.revision ?? revision,
          result: { type: "inputAccepted", delivery: "startNow", inputId: envelope.commandId },
        };
      }
      case "stop":
        await this.coordinator.cancel(task);
        return { commandId: envelope.commandId, status: "accepted", revisionAtDecision: revision };
      case "resolveInteraction": {
        const payload = commandPayloadSchemas.resolveInteraction.parse(envelope.payload);
        const settled = this.coordinator.respondPermission({
          ...task,
          interactionId: payload.interactionId,
          optionId: payload.answer.optionId,
        });
        if (!settled) return reject("acpInteractionNotPending");
        return {
          commandId: envelope.commandId,
          status: "accepted",
          revisionAtDecision: revision,
          result: {
            type: "resolveInteraction",
            resolvedBy: {
              clientId: envelope.clientId,
              ...(payload.answer.optionId ? { optionId: payload.answer.optionId } : {}),
            },
          },
        };
      }
      case "switchModelConfig": {
        const payload = commandPayloadSchemas.switchModelConfig.parse(envelope.payload);
        if (payload.provider !== "acp") return reject("acpProviderRequired");
        const current = this.coordinator.snapshot(task);
        if (payload.model && payload.model !== current?.config.model)
          await this.coordinator.setModel({ ...task, value: payload.model });
        if (payload.thought && payload.thought !== this.coordinator.snapshot(task)?.config.thought)
          await this.coordinator.setThinkingLevel({ ...task, value: payload.thought });
        if (!payload.model && !payload.thought) return reject("acpModelOrThoughtRequired");
        return { commandId: envelope.commandId, status: "accepted", revisionAtDecision: revision };
      }
      default:
        return reject("acpCapabilityUnsupported");
    }
  }

  async queryCommand(
    target: AcpWorkspaceTarget,
    key: CommandKey,
  ): Promise<CommandAck | "unknown" | null> {
    if (key.sessionId === null) {
      const meta = await this.taskIndex.getTaskMeta({ ...target, taskId: key.commandId });
      if (!meta || !meta.runtimeId || meta.runtimeId === "zcode-cli") return null;
      return {
        commandId: key.commandId,
        status: "accepted",
        revisionAtDecision: 0,
        result: { type: "createSession", sessionId: meta.taskId },
      };
    }
    if (!(await this.isAcpTask({ ...target, taskId: key.sessionId }))) return null;
    if (
      !(await this.coordinator.hasAcceptedCommand({
        ...target,
        taskId: key.sessionId,
        commandId: key.commandId,
      }))
    )
      return "unknown";
    return {
      commandId: key.commandId,
      status: "accepted",
      revisionAtDecision: 0,
      result: { type: "inputAccepted", delivery: "startNow", inputId: key.commandId },
    };
  }

  async dispose(): Promise<void> {
    this.subscriptions.clear();
    await this.coordinator.closeAll();
  }

  private publish(
    target: AcpWorkspaceTarget & { taskId: string },
    snapshot: ConversationSnapshot,
    delivery: TopicFrameDeliveryKind,
  ): void {
    const key = targetKey(target);
    for (const subscription of this.subscriptions.values()) {
      if (targetKey(subscription.target) === key) this.publishTo(subscription, snapshot, delivery);
    }
  }

  private publishTo(
    subscription: AcpV4Subscription,
    snapshot: ConversationSnapshot,
    deliveryKind: TopicFrameDeliveryKind,
  ): void {
    const topic = conversationTopic(subscription.target.taskId);
    const frame = conversationTopicFrameSchema.parse({
      topic,
      subscriptionId: subscription.subscriptionId,
      fromSeq: 0,
      toSeq: snapshot.seq,
      sentAt: Date.now(),
      payload: { kind: "snapshot", snapshot },
    });
    const frames = encodeTopicWireFrames(frame, {
      deliveryKind,
      topic,
      subscriptionId: subscription.subscriptionId,
      logicalFrameId: randomUUID(),
      logicalFrameOrdinal: ++subscription.ordinal,
      measurePhysicalFrameBytes: utf8JsonByteLength,
    });
    for (const item of frames) this.emit(subscription.target, item);
  }
}
