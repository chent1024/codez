import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { basename, isAbsolute, join, relative, resolve, dirname } from "node:path";
import type {
  Client,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import { getZCodeDataRootDir } from "#src/paths.js";
import { resolveAcpProjectMemoryWorkspaceId } from "#src/agent-runtime/acpProjectMemory.js";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTreeAndWait,
} from "#src/process/processTreeTerminator.js";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_READ_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_TERMINALS = 8;
const MAX_TERMINAL_OUTPUT_BYTES = 1024 * 1024;

function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return (
    part === "" ||
    (part !== ".." &&
      !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(part))
  );
}

function utf8Tail(value: string, limit: number): string {
  if (Buffer.byteLength(value, "utf8") <= limit) return value;
  const points = Array.from(value);
  let bytes = 0;
  let first = points.length;
  while (first > 0) {
    const next = Buffer.byteLength(points[first - 1]!, "utf8");
    if (bytes + next > limit) break;
    first -= 1;
    bytes += next;
  }
  return points.slice(first).join("");
}

interface TerminalState {
  child: ChildProcessWithoutNullStreams;
  output: string;
  truncated: boolean;
  limit: number;
  exitStatus: { exitCode: number | null; signal: string | null } | null;
  done: Promise<{ exitCode: number | null; signal: string | null }>;
}

/** 仅为当前 ACP 会话提供受工作区约束的 Client 回调。 */
export class AcpHostCapabilities {
  private readonly terminals = new Map<string, TerminalState>();

  constructor(
    private readonly workspacePath: string,
    private readonly workspaceIdentity: string | undefined,
    private readonly memoryEnabled: (() => boolean | Promise<boolean>) | undefined,
    private readonly sessionId: () => string | null,
    private readonly requestPermission: (
      request: RequestPermissionRequest,
    ) => Promise<RequestPermissionResponse>,
  ) {}

  private assertSession(id: string): void {
    if (!this.sessionId() || id !== this.sessionId())
      throw new Error("ACP session identity mismatch");
  }

  private async roots(): Promise<string[]> {
    const roots = [await realpath(this.workspacePath)];
    if (this.memoryEnabled && (await this.memoryEnabled())) {
      const workspaceId = resolveAcpProjectMemoryWorkspaceId({
        workspacePath: this.workspacePath,
        workspaceIdentity: this.workspaceIdentity,
      });
      const memoryRoot = join(
        getZCodeDataRootDir(),
        "cli",
        "memories",
        "projects",
        workspaceId,
        "memory",
      );
      await mkdir(memoryRoot, { recursive: true });
      roots.push(await realpath(memoryRoot));
    }
    return roots;
  }

  private async allowedPath(path: string, write: boolean): Promise<string> {
    if (!isAbsolute(path)) throw new Error("ACP file path must be absolute");
    const canonical = write ? await realpath(dirname(path)) : await realpath(path);
    if (!(await this.roots()).some((root) => inside(root, canonical)))
      throw new Error("ACP file path is outside the workspace");
    if (write) {
      const target = resolve(canonical, basename(path));
      const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing?.isSymbolicLink()) throw new Error("ACP file target must not be a symlink");
      return target;
    }
    return canonical;
  }

  private async allowOperation(sessionId: string, title: string): Promise<void> {
    const optionId = "codez-allow-once";
    const answer = await this.requestPermission({
      sessionId,
      toolCall: { toolCallId: randomUUID(), title },
      options: [
        { optionId, name: "Allow once", kind: "allow_once" },
        { optionId: "codez-reject-once", name: "Reject", kind: "reject_once" },
      ],
    });
    if (answer.outcome.outcome !== "selected" || answer.outcome.optionId !== optionId)
      throw new Error("ACP operation denied by user");
  }

  readTextFile: NonNullable<Client["readTextFile"]> = async (params) => {
    this.assertSession(params.sessionId);
    const path = await this.allowedPath(params.path, false);
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES)
      throw new Error("ACP file is not readable within limit");
    const content = await readFile(path, "utf8");
    if (params.line != null && (!Number.isSafeInteger(params.line) || params.line < 1))
      throw new Error("ACP line must be positive");
    if (params.limit != null && (!Number.isSafeInteger(params.limit) || params.limit < 1))
      throw new Error("ACP limit must be positive");
    const selected =
      params.line || params.limit
        ? content
            .split(/(?<=\n)/u)
            .slice(
              (params.line ?? 1) - 1,
              params.limit ? (params.line ?? 1) - 1 + params.limit : undefined,
            )
            .join("")
        : content;
    if (Buffer.byteLength(selected, "utf8") > MAX_READ_RESPONSE_BYTES)
      throw new Error("ACP file response exceeds limit");
    return { content: selected };
  };

  writeTextFile: NonNullable<Client["writeTextFile"]> = async (params) => {
    this.assertSession(params.sessionId);
    if (Buffer.byteLength(params.content, "utf8") > MAX_FILE_BYTES)
      throw new Error("ACP file write exceeds limit");
    const path = await this.allowedPath(params.path, true);
    await this.allowOperation(params.sessionId, `Write ${path}`);
    const handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(params.content, "utf8");
    } finally {
      await handle.close();
    }
  };

  createTerminal: NonNullable<Client["createTerminal"]> = async (params) => {
    this.assertSession(params.sessionId);
    if (!params.command.trim() || this.terminals.size >= MAX_TERMINALS)
      throw new Error("ACP terminal request is invalid or limit reached");
    const requestedCwd = params.cwd ?? this.workspacePath;
    if (!isAbsolute(requestedCwd)) throw new Error("ACP terminal cwd must be absolute");
    const cwd = await realpath(requestedCwd);
    if (!inside(await realpath(this.workspacePath), cwd))
      throw new Error("ACP terminal cwd is outside the workspace");
    await this.allowOperation(
      params.sessionId,
      `Run ${params.command} ${(params.args ?? []).join(" ")}`,
    );
    const limit = params.outputByteLimit ?? MAX_TERMINAL_OUTPUT_BYTES;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("ACP terminal output limit is invalid");
    const env = { ...process.env };
    for (const item of params.env ?? []) env[item.name] = item.value;
    const child = spawn(params.command, params.args ?? [], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: shouldSpawnInDetachedProcessGroup(),
    });
    child.stdin.end();
    const state: TerminalState = {
      child,
      output: "",
      truncated: false,
      limit: Math.min(limit, MAX_TERMINAL_OUTPUT_BYTES),
      exitStatus: null,
      done: Promise.resolve({ exitCode: null, signal: null }),
    };
    const append = (value: string) => {
      const joined = state.output + value;
      state.output = utf8Tail(joined, state.limit);
      if (joined.length !== state.output.length) state.truncated = true;
    };
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder("utf8");
      stream.on("data", (chunk: Buffer) => append(decoder.write(chunk)));
      stream.once("end", () => append(decoder.end()));
    }
    state.done = new Promise((resolveExit) => {
      child.once("close", (exitCode, signal) => {
        state.exitStatus = { exitCode, signal };
        resolveExit(state.exitStatus);
      });
      child.once("error", () => {
        state.exitStatus = { exitCode: null, signal: null };
        resolveExit(state.exitStatus);
      });
    });
    await new Promise<void>((resolveSpawn, reject) => {
      child.once("spawn", resolveSpawn);
      child.once("error", reject);
    });
    const terminalId = randomUUID();
    this.terminals.set(terminalId, state);
    return { terminalId };
  };

  private terminal(sessionId: string, terminalId: string): TerminalState {
    this.assertSession(sessionId);
    const state = this.terminals.get(terminalId);
    if (!state) throw new Error("ACP terminal was not found");
    return state;
  }

  terminalOutput: NonNullable<Client["terminalOutput"]> = async (params) => {
    const state = this.terminal(params.sessionId, params.terminalId);
    return {
      output: state.output,
      truncated: state.truncated,
      ...(state.exitStatus ? { exitStatus: state.exitStatus } : {}),
    };
  };

  waitForTerminalExit: NonNullable<Client["waitForTerminalExit"]> = async (params) =>
    this.terminal(params.sessionId, params.terminalId).done;

  killTerminal: NonNullable<Client["killTerminal"]> = async (params) => {
    const state = this.terminal(params.sessionId, params.terminalId);
    await terminateProcessTreeAndWait(state.child, { ownedProcessGroupId: state.child.pid });
  };

  releaseTerminal: NonNullable<Client["releaseTerminal"]> = async (params) => {
    const state = this.terminal(params.sessionId, params.terminalId);
    this.terminals.delete(params.terminalId);
    await terminateProcessTreeAndWait(state.child, { ownedProcessGroupId: state.child.pid });
  };

  async close(): Promise<void> {
    const pending = [...this.terminals.values()];
    this.terminals.clear();
    await Promise.all(
      pending.map((state) =>
        terminateProcessTreeAndWait(state.child, { ownedProcessGroupId: state.child.pid }),
      ),
    );
  }
}
