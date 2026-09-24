import { ACP_DEFAULT_MODEL_ID, type AgentRuntimeId } from "@zcode/shared";
import type { AgentRuntimeConfigPreview } from "#src/zcode-agent/zcodeAgent.js";
import { AcpConnection } from "#src/agent-runtime/acpConnection.js";
import {
  resolveAcpRuntimeSpec,
  isolateAcpNativeAutoMemory,
  type AcpRuntimeSpec,
} from "#src/agent-runtime/acpRuntimeCatalog.js";

/** 草稿会话使用临时 ACP 进程读取模型与思考选项，不留下空会话绑定。 */
export async function discoverAcpRuntimeConfig(input: {
  runtimeId: AgentRuntimeId;
  workspacePath: string;
  modelId?: string;
  includeAllModelThoughtLevels?: boolean;
  resolveLaunch: (spec: AcpRuntimeSpec) => Promise<{ executable: string; args: readonly string[] }>;
}): Promise<AgentRuntimeConfigPreview> {
  const spec = await resolveAcpRuntimeSpec(input.runtimeId);
  if (!spec) throw new Error(`Unsupported ACP Runtime ${input.runtimeId}`);
  const { executable, args } = await input.resolveLaunch(spec);
  const isolated = isolateAcpNativeAutoMemory(spec, process.env, args);
  const connection = await AcpConnection.open(
    { executable, args: isolated.args, cwd: input.workspacePath, env: isolated.env },
    {
      onUpdate: () => {},
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    },
  );
  try {
    await connection.createSession(input.workspacePath);
    if (input.modelId && input.modelId !== ACP_DEFAULT_MODEL_ID)
      await connection.setModel(input.modelId);
    const models = connection.modelOptions();
    const levels = connection.thinkingLevels();
    const selectedModel = models.find((model) => model.selected)?.id ?? "";
    const modelThoughtLevels = new Map<string, Array<{ value: string; name: string }>>();
    if (input.includeAllModelThoughtLevels) {
      for (const model of models) {
        await connection.setModel(model.id);
        modelThoughtLevels.set(
          model.id,
          connection.thinkingLevels().map(({ value, name }) => ({ value, name })),
        );
      }
      if (selectedModel) await connection.setModel(selectedModel);
    } else if (selectedModel) {
      modelThoughtLevels.set(
        selectedModel,
        levels.map(({ value, name }) => ({ value, name })),
      );
    }
    return {
      models: models.map(({ id, name, description }) => ({
        id,
        name,
        ...(description ? { description } : {}),
        thoughtLevels: modelThoughtLevels.get(id) ?? [],
      })),
      selectedModel,
      thoughtLevels: levels.map(({ value, name }) => ({ value, name })),
      selectedThought: levels.find((level) => level.selected)?.value ?? "",
      modes:
        connection.modeState()?.availableModes.map(({ id, name, description }) => ({
          id,
          name,
          ...(description ? { description } : {}),
        })) ?? [],
      selectedMode: connection.modeState()?.currentModeId ?? "",
    };
  } finally {
    await connection.close();
  }
}
