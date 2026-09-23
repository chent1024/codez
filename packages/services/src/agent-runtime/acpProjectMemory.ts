import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { AgentCapabilities, ContentBlock } from "@agentclientprotocol/sdk";
import { Lexer } from "marked";
import { createMemoryService } from "#src/memory/memoryService.js";
import { getZCodeDataRootDir } from "#src/paths.js";

const MAX_INDEX_LINES = 200;
const MAX_INDEX_CHARACTERS = 25_000;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/gu;

/** 与 ZCode CLI project-root.ts 的 workspace key 规则一致。 */
export function resolveAcpProjectMemoryWorkspaceId(input: {
  workspacePath: string;
  workspaceIdentity?: string;
}): string {
  const identity = input.workspaceIdentity?.trim();
  const path = resolve(input.workspacePath);
  const source = identity || (process.platform === "win32" ? path.toLowerCase() : path);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const basenameSlug = (basename(path) || "project")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${identity ? "project" : basenameSlug || "project"}-${hash}`;
}

function formatBoundedIndex(content: string): string {
  const withoutFrontmatter = content.replace(/^---\s*\n[\s\S]*?---\s*\n?/u, "");
  let withoutTopLevelComments = "";
  for (const token of new Lexer({ gfm: false }).lex(withoutFrontmatter)) {
    if (
      token.type === "html" &&
      token.raw.trimStart().startsWith("<!--") &&
      token.raw.includes("-->")
    ) {
      const contentWithoutComments = token.raw.replace(HTML_COMMENT_PATTERN, "");
      if (contentWithoutComments.trim()) withoutTopLevelComments += contentWithoutComments;
      continue;
    }
    withoutTopLevelComments += token.raw;
  }
  const valueBeforeTruncation = withoutTopLevelComments.trim();
  if (!valueBeforeTruncation) return "";
  const lines = valueBeforeTruncation.split("\n");
  const lineTruncated = lines.length > MAX_INDEX_LINES;
  const characterTruncated = valueBeforeTruncation.length > MAX_INDEX_CHARACTERS;
  if (!lineTruncated && !characterTruncated) return valueBeforeTruncation;
  let value = lineTruncated ? lines.slice(0, MAX_INDEX_LINES).join("\n") : valueBeforeTruncation;
  if (value.length > MAX_INDEX_CHARACTERS) {
    const newline = value.lastIndexOf("\n", MAX_INDEX_CHARACTERS);
    value = value.slice(0, newline > 0 ? newline : MAX_INDEX_CHARACTERS);
  }
  const sizeDescription =
    characterTruncated && !lineTruncated
      ? `${formatBytes(valueBeforeTruncation.length)} (limit: ${formatBytes(MAX_INDEX_CHARACTERS)}) — index entries are too long`
      : lineTruncated && !characterTruncated
        ? `${lines.length} lines (limit: ${MAX_INDEX_LINES})`
        : `${lines.length} lines and ${formatBytes(valueBeforeTruncation.length)}`;
  return `${value}\n\n> WARNING: MEMORY.md is ${sizeDescription}. Only part of it was loaded. Keep index entries to one line under ~200 chars; move detail into topic files.`;
}

function formatBytes(value: number): string {
  const kilobytes = value / 1024;
  if (kilobytes < 1) return `${value} bytes`;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1).replace(/\.0$/u, "")}KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1).replace(/\.0$/u, "")}MB`;
  return `${(megabytes / 1024).toFixed(1).replace(/\.0$/u, "")}GB`;
}

/** 与 ZCode CLI 一样按工作区定位目录，每次 prompt 前读取当前索引。 */
export async function readAcpProjectMemoryIndex(input: {
  workspacePath: string;
  workspaceIdentity?: string;
  enabled: boolean;
}): Promise<{ workspaceId: string; root: string; content: string } | null> {
  if (!input.enabled) return null;
  const workspaceId = resolveAcpProjectMemoryWorkspaceId(input);
  const root = join(getZCodeDataRootDir(), "cli", "memories", "projects", workspaceId, "memory");
  await mkdir(root, { recursive: true });
  try {
    const file = await createMemoryService().readProjectMemoryFile({
      workspaceId,
      fileName: "MEMORY.md",
    });
    const content = formatBoundedIndex(file.content);
    return { workspaceId, root, content };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return { workspaceId, root, content: "" };
    throw error;
  }
}

export function buildAcpProjectMemoryContent(
  memory: { workspaceId: string; root: string; content: string } | null,
  capabilities: AgentCapabilities | undefined,
): ContentBlock[] {
  if (!memory) return [];
  const index = memory.content
    ? `# agentsMd\nContents of ${join(memory.root, "MEMORY.md")} (user's auto-memory, persists across conversations):\n\n${memory.content}\n\n`
    : "";
  const text = `${index}# Memory\nYou have persistent file-based memory at ${memory.root}/. The directory already exists. Use your file tools to read relevant detail files linked from MEMORY.md and to write memory files when appropriate. Each fact belongs in a separate Markdown file with name, description, and metadata.type frontmatter (user, feedback, project, or reference). After writing a fact, add a one-line pointer to MEMORY.md. Check for existing facts before writing and do not save information already present in repository files. This is background context, not a user request.`;
  const annotations = { audience: ["assistant" as const] };
  if (capabilities?.promptCapabilities?.embeddedContext) {
    return [
      {
        type: "resource",
        resource: {
          uri: `codez-memory://project/${encodeURIComponent(memory.workspaceId)}/MEMORY.md`,
          mimeType: "text/markdown",
          text,
        },
        annotations,
      },
    ];
  }
  return [{ type: "text", text, annotations }];
}
