import { stat, realpath, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";

const MAX_LOCAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function isTextResource(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
}

/** 本地桌面附件只从 Host 可读的绝对路径取内容；上传仓引用不走 ACP 会话。 */
export async function prepareAcpPromptAttachments(
  attachments: readonly AttachmentRef[],
  imageSupported: boolean,
): Promise<{ promptBlocks: ContentBlock[]; transcriptBlocks: ContentBlock[] }> {
  const promptBlocks: ContentBlock[] = [];
  const transcriptBlocks: ContentBlock[] = [];
  for (const attachment of attachments) {
    if (!isAbsolute(attachment.ref))
      throw new Error("ACP attachment requires a local absolute path");
    const path = await realpath(attachment.ref);
    const info = await stat(path);
    if (!info.isFile()) throw new Error("ACP attachment is not a regular file");
    if (info.size > MAX_LOCAL_ATTACHMENT_BYTES)
      throw new Error("ACP attachment exceeds the 20 MiB limit");
    // 引用身份使用用户提交的路径；真实字节仍从已解析的文件读取。
    const uri = pathToFileURL(attachment.ref).href;
    const link: ContentBlock = {
      type: "resource_link",
      uri,
      name: attachment.fileName,
      mimeType: attachment.mime,
      size: info.size,
    };
    transcriptBlocks.push(link);
    const bytes = await readFile(path);
    if (bytes.length > MAX_LOCAL_ATTACHMENT_BYTES)
      throw new Error("ACP attachment exceeds the 20 MiB limit");
    if (!attachment.mime.startsWith("image/")) {
      // Qoder 接受嵌入式 resource；仅传 resource_link 会在真实 prompt 中失败。
      const resource = isTextResource(attachment.mime)
        ? {
            uri,
            mimeType: attachment.mime,
            text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          }
        : { uri, mimeType: attachment.mime, blob: bytes.toString("base64") };
      promptBlocks.push({ type: "resource", resource });
      continue;
    }
    if (!imageSupported) throw new Error("ACP Agent does not support image prompts");
    promptBlocks.push({ type: "image", data: bytes.toString("base64"), mimeType: attachment.mime });
  }
  return { promptBlocks, transcriptBlocks };
}
