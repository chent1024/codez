import { ACP_DEFAULT_MODEL_ID, type AgentRuntimeId, type ZCodeTaskMeta } from "@zcode/shared";
import { getZCodeDataRootDir } from "#src/paths.js";
import { AcpConnection, type AcpSessionObserver } from "#src/agent-runtime/acpConnection.js";
import { AcpConversationProjection } from "#src/agent-runtime/acpConversationProjection.js";
import {
  createManagedAcpSession,
  type ManagedAcpSession,
  type PendingPermission,
} from "#src/agent-runtime/acpManagedSession.js";
import {
  isolateAcpNativeAutoMemory,
  type AcpRuntimeSpec,
} from "#src/agent-runtime/acpRuntimeCatalog.js";
import { AcpTranscriptStore } from "#src/agent-runtime/acpTranscriptStore.js";

/** 建立 ACP 原生会话、持久绑定和工作台投影；失败时回收进程。 */
export async function createAcpManagedSession(input: {
  taskId: string;
  runtimeId: AgentRuntimeId;
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceKey: string;
  modelId?: string;
  thoughtLevel?: string;
  spec: AcpRuntimeSpec;
  resolveLaunch: (spec: AcpRuntimeSpec) => Promise<{ executable: string; args: readonly string[] }>;
  isMemoryEnabled: () => boolean | Promise<boolean>;
  syncTaskMetaAtGroupedTop: (meta: ZCodeTaskMeta) => Promise<void>;
  makeObserver: (
    projection: AcpConversationProjection,
    transcript: AcpTranscriptStore,
    pending: Map<string, PendingPermission>,
    current: () => ManagedAcpSession | null,
  ) => AcpSessionObserver;
}): Promise<ManagedAcpSession> {
  const projection = new AcpConversationProjection(input.taskId, "", input.runtimeId);
  const transcript = new AcpTranscriptStore(
    input.workspaceKey,
    input.taskId,
    getZCodeDataRootDir(),
  );
  const pendingPermissions = new Map<string, PendingPermission>();
  let managed: ManagedAcpSession | null = null;
  const observer = input.makeObserver(projection, transcript, pendingPermissions, () => managed);
  const { executable, args } = await input.resolveLaunch(input.spec);
  const isolated = isolateAcpNativeAutoMemory(input.spec, process.env, args);
  const connection = await AcpConnection.open(
    {
      executable,
      args: isolated.args,
      cwd: input.workspacePath,
      env: isolated.env,
      memory: { workspaceIdentity: input.workspaceIdentity, isEnabled: input.isMemoryEnabled },
    },
    observer,
  );
  try {
    const nativeSessionId = await connection.createSession(input.workspacePath);
    if (input.modelId && input.modelId !== ACP_DEFAULT_MODEL_ID)
      await connection.setModel(input.modelId);
    if (input.thoughtLevel) await connection.setThinkingLevel(input.thoughtLevel);
    projection.setModelOptions(connection.modelOptions());
    projection.setThinkingLevels(connection.thinkingLevels());
    await transcript.initialize();
    const now = Date.now();
    const meta: ZCodeTaskMeta = {
      taskId: input.taskId,
      runtimeId: input.runtimeId,
      nativeSessionId,
      ...(input.spec.fingerprint ? { agentServerFingerprint: input.spec.fingerprint } : {}),
      traceId: input.taskId,
      title: "New session",
      workspacePath: input.workspacePath,
      model: connection.modelOptions().find((model) => model.selected)?.id,
      thoughtLevel: connection.thinkingLevels().find((level) => level.selected)?.value,
      ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
      createdAt: now,
      updatedAt: now,
      mode: "build",
      status: "completed",
    };
    await input.syncTaskMetaAtGroupedTop(meta);
    managed = createManagedAcpSession({
      connection,
      meta,
      projection,
      transcript,
      acceptedCommandIds: new Set(),
      pendingPermissions,
    });
    return managed;
  } catch (error) {
    await connection.close();
    throw error;
  }
}
