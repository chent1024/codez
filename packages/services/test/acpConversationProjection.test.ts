import assert from "node:assert/strict";
import test from "node:test";
import { AcpConversationProjection } from "../src/agent-runtime/acpConversationProjection.js";

test("ACP updates form a V4 snapshot with stable workbench IDs and a terminal turn", () => {
  const projection = new AcpConversationProjection("workbench-id", "ACP session");
  assert.equal(projection.snapshot().control.phase, "draft");
  projection.beginTurn("command-id", "question");
  projection.applyUpdate({
    sessionId: "native-id",
    update: {
      sessionUpdate: "agent_message_chunk",
      messageId: "message-1",
      content: { type: "text", text: "hel" },
    },
  });
  projection.applyUpdate({
    sessionId: "native-id",
    update: {
      sessionUpdate: "agent_message_chunk",
      messageId: "message-1",
      content: { type: "text", text: "lo" },
    },
  });
  const running = projection.snapshot();
  assert.equal(running.sessionId, "workbench-id");
  assert.equal(running.inputRouting.mode, "reject");
  assert.equal(running.rows.window.find((row) => row.kind === "assistantText")?.text, "hello");
  projection.finishTurn({ stopReason: "end_turn" });
  const ended = projection.snapshot();
  assert.equal(ended.control.phase, "completedSuccess");
  assert.equal(ended.rows.window.find((row) => row.kind === "assistantText")?.state, "complete");
  assert.equal(
    ended.rows.window.find((row) => row.kind === "turnHeader")?.state,
    "completedSuccess",
  );
});

test("ACP projection replays a durable transcript and marks an unfinished turn as failed", () => {
  const projection = new AcpConversationProjection("workbench-id");
  projection.restore([
    { v: 1, kind: "prompt", at: 1, commandId: "first", content: [{ type: "text", text: "hello" }] },
    {
      v: 1,
      kind: "update",
      at: 2,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "first-reply",
        content: { type: "text", text: "done" },
      },
    },
    { v: 1, kind: "turnEnd", at: 3, result: { stopReason: "end_turn" } },
    {
      v: 1,
      kind: "prompt",
      at: 4,
      commandId: "second",
      content: [{ type: "text", text: "again" }],
    },
  ]);
  const snapshot = projection.snapshot();
  assert.equal(snapshot.control.phase, "error");
  assert.deepEqual(
    snapshot.rows.window.filter((row) => row.kind === "turnHeader").map((row) => row.state),
    ["completedSuccess", "failed"],
  );
  assert.deepEqual(
    snapshot.rows.window.filter((row) => row.kind === "userInput").map((row) => row.text),
    ["hello", "again"],
  );
});

test("ACP chunks without messageId form continuous reasoning and answer rows on live and replay", () => {
  const updates = [
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "The" } },
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: " user" } },
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: " greeted" } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "你好" } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "！有什么可以帮" } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "你的吗？" } },
  ] as const;
  const live = new AcpConversationProjection("workbench-id");
  live.beginTurn("command-id", "你好");
  for (const update of updates) live.applyUpdate({ sessionId: "native-id", update });
  live.finishTurn({ stopReason: "end_turn" });

  const replay = new AcpConversationProjection("workbench-id");
  replay.restore([
    {
      v: 1,
      kind: "prompt",
      at: 1,
      commandId: "command-id",
      content: [{ type: "text", text: "你好" }],
    },
    ...updates.map((update, index) => ({
      v: 1 as const,
      kind: "update" as const,
      at: index + 2,
      update,
    })),
    { v: 1, kind: "turnEnd", at: 9, result: { stopReason: "end_turn" } },
  ]);

  for (const projection of [live, replay]) {
    const content = projection
      .snapshot()
      .rows.window.filter((row) => row.kind === "reasoning" || row.kind === "assistantText");
    assert.deepEqual(
      content.map((row) => row.kind),
      ["reasoning", "assistantText"],
    );
    assert.deepEqual(
      content.map((row) => row.text),
      ["The user greeted", "你好！有什么可以帮你的吗？"],
    );
  }
});

test("anonymous ACP chunks do not merge across a tool call", () => {
  const projection = new AcpConversationProjection("workbench-id");
  projection.beginTurn("command-id", "question");
  projection.applyUpdate({
    sessionId: "native-id",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before" } },
  });
  projection.applyUpdate({
    sessionId: "native-id",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Read file",
      kind: "read",
      status: "completed",
    },
  });
  projection.applyUpdate({
    sessionId: "native-id",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "after" } },
  });
  assert.deepEqual(
    projection
      .snapshot()
      .rows.window.filter((row) => row.kind === "assistantText")
      .map((row) => row.text),
    ["before", "after"],
  );
});
