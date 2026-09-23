import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { delimiter, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import type { AgentRuntimeId } from "@zcode/shared";
import {
  fingerprintAcpServer,
  readAgentServersRegistry,
} from "#src/agent-runtime/agentServersRegistry.js";

const execFileAsync = promisify(execFile);
const WORKBUDDY_APP_PATH = "/Applications/WorkBuddy.app";
const WORKBUDDY_TEAM_ID = "FN2V63AD2J";
const WORKBUDDY_BUNDLE_ID = "com.tencent.workbuddy.mac";

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

/** 首批可选 ACP 入口；实际安装状态与能力以本机探测和握手为准。 */
export const ACP_RUNTIME_CATALOG: readonly AcpRuntimeSpec[] = [
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

export function getAcpRuntimeSpec(id: AgentRuntimeId): AcpRuntimeSpec | null {
  return ACP_RUNTIME_CATALOG.find((item) => item.id === id) ?? null;
}

/** 格式合法不等于可执行；每次创建或恢复都以 Host 当下的注册表为准。 */
export async function resolveAcpRuntimeSpec(id: AgentRuntimeId): Promise<AcpRuntimeSpec | null> {
  const builtin = getAcpRuntimeSpec(id);
  if (builtin) return builtin;
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

async function resolveVerifiedWorkBuddyCommand(): Promise<string> {
  if (process.platform !== "darwin") throw new Error("WorkBuddy is only supported on macOS");
  const probeOptions = { timeout: 10_000, maxBuffer: 1_000_000 };
  try {
    await execFileAsync(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", WORKBUDDY_APP_PATH],
      probeOptions,
    );
  } catch {
    throw new Error("WorkBuddy app code signature verification failed");
  }
  const signature = await execFileAsync(
    "/usr/bin/codesign",
    ["-dv", "--verbose=4", WORKBUDDY_APP_PATH],
    probeOptions,
  );
  if (!`${signature.stdout}\n${signature.stderr}`.includes(`TeamIdentifier=${WORKBUDDY_TEAM_ID}`))
    throw new Error("WorkBuddy app Team ID is not recognized");
  const bundle = await execFileAsync(
    "/usr/bin/plutil",
    ["-extract", "CFBundleIdentifier", "raw", join(WORKBUDDY_APP_PATH, "Contents", "Info.plist")],
    probeOptions,
  );
  if (bundle.stdout.trim() !== WORKBUDDY_BUNDLE_ID)
    throw new Error("WorkBuddy app bundle ID is not recognized");
  const executable = join(
    WORKBUDDY_APP_PATH,
    "Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
  );
  await access(executable, constants.X_OK);
  return realpath(executable);
}

/** 只解析清单中的命令；嵌入式 WorkBuddy 必须先通过系统签名与应用身份校验。 */
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
  if (spec.distribution === "embedded-app") return resolveVerifiedWorkBuddyCommand();
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
