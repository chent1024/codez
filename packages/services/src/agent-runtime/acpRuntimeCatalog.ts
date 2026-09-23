import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import type { AgentRuntimeId } from "@zcode/shared";
import {
  fingerprintAcpServer,
  readAgentServersRegistry,
} from "#src/agent-runtime/agentServersRegistry.js";

const WORKBUDDY_APP_PATH = "/Applications/WorkBuddy.app";
const WORKBUDDY_EXECUTABLE = join(
  WORKBUDDY_APP_PATH,
  "Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
);

export interface AcpRuntimeSpec {
  id: Exclude<AgentRuntimeId, "zcode-cli">;
  name: string;
  command: string;
  args: readonly string[];
  distribution: "npm" | "embedded-app" | "configured";
  packageName?: string;
  macOnly?: boolean;
  fingerprint?: string;
}

/** 仅供迁移前旧会话恢复；新建与供应商列表只读取 Host 配置注册表。 */
const LEGACY_ACP_RUNTIME_CATALOG: readonly AcpRuntimeSpec[] = [
  {
    id: "qoder-acp",
    name: "Qoder",
    command: "qoder",
    args: ["--acp"],
    distribution: "npm",
    packageName: "@qoder-ai/qodercli",
  },
  {
    id: "cline-acp",
    name: "Cline",
    command: "cline",
    args: ["--acp"],
    distribution: "npm",
    packageName: "cline",
  },
  {
    id: "codebuddy-acp",
    name: "CodeBuddy",
    command: "codebuddy",
    args: ["--acp"],
    distribution: "npm",
    packageName: "@tencent-ai/codebuddy-code",
  },
  {
    id: "workbuddy-acp",
    name: "WorkBuddy",
    command: "codebuddy",
    args: ["--acp"],
    distribution: "embedded-app",
    macOnly: true,
  },
];

export function getLegacyAcpRuntimeSpec(id: AgentRuntimeId): AcpRuntimeSpec | null {
  return LEGACY_ACP_RUNTIME_CATALOG.find((item) => item.id === id) ?? null;
}

/** 格式合法不等于可执行；每次创建或恢复都以 Host 当下的注册表为准。 */
export async function resolveAcpRuntimeSpec(
  id: AgentRuntimeId,
  options: { restoreLegacy?: boolean } = {},
): Promise<AcpRuntimeSpec | null> {
  if (options.restoreLegacy) {
    const legacy = getLegacyAcpRuntimeSpec(id);
    if (legacy) return legacy;
  }
  const registry = await readAgentServersRegistry();
  const configured = registry.servers.find((item) => item.id === id);
  return configured
    ? {
        id: configured.id,
        name: configured.name,
        command: configured.command,
        args: configured.args,
        distribution: "configured",
        fingerprint: configured.fingerprint,
      }
    : null;
}

export function acpSpecIdentity(spec: AcpRuntimeSpec): string {
  return spec.fingerprint ?? fingerprintAcpServer(spec.command, spec.args);
}

/** 仅使用已核对的进程局部开关，保留用户的原生配置文件。 */
export function isolateAcpNativeAutoMemory(
  spec: AcpRuntimeSpec,
  env: NodeJS.ProcessEnv,
  baseArgs: readonly string[] = spec.args,
): { args: readonly string[]; env: NodeJS.ProcessEnv; verified: boolean } {
  if (spec.id === "qoder-acp") {
    return {
      args: [...baseArgs, "--settings", JSON.stringify({ autoMemoryEnabled: false })],
      env: { ...env, QODER_MEMORY: "0", QODER_MEMORY_USER: "0" },
      verified: true,
    };
  }
  if (spec.id === "codebuddy-acp") {
    return {
      args: baseArgs,
      env: { ...env, CODEBUDDY_DISABLE_AUTO_MEMORY: "1" },
      verified: true,
    };
  }
  return { args: baseArgs, env, verified: false };
}

async function resolveWorkBuddyCommand(): Promise<string> {
  if (process.platform !== "darwin") throw new Error("WorkBuddy is only supported on macOS");
  await access(WORKBUDDY_EXECUTABLE, constants.X_OK);
  return realpath(WORKBUDDY_EXECUTABLE);
}
/** 列表曾因每次深度验签延迟显示；WorkBuddy 固定路径只核对可执行权限。 */
export async function resolveAcpRuntimeCommand(
  spec: AcpRuntimeSpec,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (spec.distribution === "configured") {
    const registry = await readAgentServersRegistry();
    const current = registry.servers.find((item) => item.id === spec.id);
    if (!current || current.fingerprint !== spec.fingerprint)
      throw new Error(`ACP Agent configuration changed or is unavailable: ${spec.id}`);
    return current.command;
  }
  if (spec.distribution === "embedded-app") return resolveWorkBuddyCommand();
  if (spec.macOnly && process.platform !== "darwin")
    throw new Error(`${spec.name} is only supported on macOS`);
  const pathEntries = (env.PATH ?? "").split(delimiter).filter(Boolean);
  if (process.platform === "darwin") {
    for (const fallback of [
      join(env.HOME?.trim() || homedir(), ".qoder", "entry"),
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]) {
      if (!pathEntries.includes(fallback)) pathEntries.push(fallback);
    }
  }
  const names =
    process.platform === "win32"
      ? [
          spec.command,
          ...[".exe", ".cmd", ".bat"].map((extension) => `${spec.command}${extension}`),
        ]
      : [spec.command];
  for (const pathEntry of pathEntries) {
    if (!isAbsolute(pathEntry)) continue;
    for (const name of names) {
      const candidate = join(pathEntry, name);
      try {
        await access(candidate, constants.X_OK);
        return await realpath(candidate);
      } catch {
        // Continue through the trusted process PATH.
      }
    }
  }
  throw new Error(`${spec.name} executable was not found on PATH`);
}
