import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AcpTranscriptStore } from "../src/agent-runtime/acpTranscriptStore.js";

test("ACP transcript records ordered wire events and isolates workspaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "codez-acp-transcript-"));
  try {
    const left = new AcpTranscriptStore("remote:first:/repo", "task-1", root);
    const right = new AcpTranscriptStore("remote:second:/repo", "task-1", root);
    await Promise.all([left.initialize(), right.initialize()]);
    await left.appendPrompt("command-1", [{ type: "text", text: "hello" }]);
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        left.appendUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: String(index) },
        }),
      ),
    );
    await left.appendTurnEnd({ stopReason: "end_turn" });
    await left.flush();
    const entries = await left.read();
    assert.equal(entries?.length, 42);
    assert.equal(entries?.[0]?.kind, "prompt");
    assert.equal(entries?.[41]?.kind, "turnEnd");
    assert.deepEqual(
      entries
        ?.slice(1, 41)
        .map((entry) =>
          entry.kind === "update" &&
          entry.update.sessionUpdate === "agent_message_chunk" &&
          entry.update.content.type === "text"
            ? entry.update.content.text
            : null,
        ),
      Array.from({ length: 40 }, (_, index) => String(index)),
    );
    assert.deepEqual(await right.read(), []);
    const reopened = new AcpTranscriptStore("remote:first:/repo", "task-1", root);
    await reopened.initialize();
    assert.deepEqual(await reopened.read(), entries);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP transcript refuses a symlinked file", async () => {
  const root = await mkdtemp(join(tmpdir(), "codez-acp-transcript-link-"));
  try {
    const store = new AcpTranscriptStore("/repo", "task-2", root);
    await store.initialize();
    // The path is deliberately located by its single file, without depending on hash internals.
    const { readdir, rename } = await import("node:fs/promises");
    const workspaceDir = join(
      root,
      "acp",
      "transcripts",
      (await readdir(join(root, "acp", "transcripts")))[0]!,
    );
    const file = join(workspaceDir, (await readdir(workspaceDir))[0]!);
    const moved = join(root, "original.jsonl");
    await rename(file, moved);
    await symlink(moved, file);
    await assert.rejects(store.read());
    await assert.rejects(store.appendPrompt("command", [{ type: "text", text: "bad" }]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
