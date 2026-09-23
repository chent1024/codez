import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveProjectMemoryRoot } from "../../../apps/zcode-cli/packages/core/src/memory/project-root.js";
import { formatProjectMemoryIndexContent } from "../../../apps/zcode-cli/packages/core/src/memory/index-content.js";
import {
  buildAcpProjectMemoryContent,
  readAcpProjectMemoryIndex,
  resolveAcpProjectMemoryWorkspaceId,
} from "../src/agent-runtime/acpProjectMemory.js";
import { getZCodeDataRootDir, setDataBaseDir } from "../src/paths.js";

test("ACP Project Memory uses the CLI workspace identity and respects the enable switch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-acp-memory-"));
  setDataBaseDir(dir);
  const workspacePath = "/same/path";
  const workspaceIdentity = "remote-example-a";
  try {
    const cliRoot = resolveProjectMemoryRoot({
      cliStorageRoot: join(getZCodeDataRootDir(), "cli"),
      workspacePath,
      workspaceIdentity,
    });
    const workspaceId = resolveAcpProjectMemoryWorkspaceId({ workspacePath, workspaceIdentity });
    assert.equal(
      cliRoot,
      join(getZCodeDataRootDir(), "cli", "memories", "projects", workspaceId, "memory"),
    );
    await mkdir(cliRoot, { recursive: true });
    const index = "---\ntitle: project\n---\n<!-- hidden -->\n# Index\n- [detail](detail.md)\n";
    await writeFile(join(cliRoot, "MEMORY.md"), index);
    const enabled = await readAcpProjectMemoryIndex({
      workspacePath,
      workspaceIdentity,
      enabled: true,
    });
    assert.equal(enabled?.content, formatProjectMemoryIndexContent(index));
    assert.equal(enabled?.root, cliRoot);
    assert.equal(
      (buildAcpProjectMemoryContent(enabled, undefined)[0] as { type: string }).type,
      "text",
    );
    const resource = buildAcpProjectMemoryContent(enabled, {
      promptCapabilities: { embeddedContext: true },
    });
    assert.equal(resource[0]?.type, "resource");
    assert.deepEqual(resource[0]?.annotations?.audience, ["assistant"]);
    assert.match(JSON.stringify(resource), /# Memory/);
    assert.equal(
      await readAcpProjectMemoryIndex({ workspacePath, workspaceIdentity, enabled: false }),
      null,
    );
    const other = await readAcpProjectMemoryIndex({
      workspacePath,
      workspaceIdentity: "remote-example-b",
      enabled: true,
    });
    assert.equal(other?.content, "");
    assert.notEqual(other?.root, enabled?.root);
  } finally {
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});
