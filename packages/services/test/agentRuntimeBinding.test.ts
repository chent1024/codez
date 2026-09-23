import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { ZCODE_AGENT_PROVIDER } from "../../shared/src/zcode-agent-policy.js";

test("task Runtime binding survives reopen and remains isolated by workspace identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-runtime-binding-"));
  const path = join(dir, "tasks.sqlite");
  const repo = new TaskIndexRepo(path);
  const base = {
    taskId: "workbench-task",
    traceId: "runtime-trace",
    title: "ACP task",
    workspacePath: "/same/path",
    createdAt: 1,
    updatedAt: 2,
    mode: "build" as const,
  };
  try {
    await repo.syncTaskMeta({
      meta: {
        ...base,
        workspaceIdentity: "remote-a",
        runtimeId: "cline-acp",
        nativeSessionId: "cline-native-session",
      },
    });
    await repo.syncTaskMeta({ meta: { ...base, workspaceIdentity: "remote-b" } });
    repo.close();
    const reopened = new TaskIndexRepo(path);
    try {
      const acp = await reopened.getTaskMeta({
        workspacePath: base.workspacePath,
        workspaceIdentity: "remote-a",
        taskId: base.taskId,
      });
      const zcode = await reopened.getTaskMeta({
        workspacePath: base.workspacePath,
        workspaceIdentity: "remote-b",
        taskId: base.taskId,
      });
      assert.equal(acp?.runtimeId, "cline-acp");
      assert.equal(acp?.nativeSessionId, "cline-native-session");
      assert.equal(zcode?.runtimeId, "zcode-cli");
      assert.equal(zcode?.nativeSessionId, undefined);
      await assert.rejects(
        reopened.syncTaskMeta({
          meta: {
            ...base,
            workspaceIdentity: "remote-a",
            runtimeId: "qoder-acp",
            nativeSessionId: "other",
          },
        }),
        /immutable/,
      );
    } finally {
      reopened.close();
    }
    const database = new DatabaseSync(path);
    try {
      const rows = database
        .prepare("SELECT runtime_id, native_session_id FROM tasks ORDER BY workspace_key")
        .all();
      assert.equal(rows.length, 2);
    } finally {
      database.close();
    }
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("current task lists include bound ACP sessions without reintroducing legacy CLI providers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-runtime-list-"));
  const path = join(dir, "tasks.sqlite");
  const repo = new TaskIndexRepo(path);
  const workspacePath = "/shared/workspace";
  const base = {
    traceId: "trace",
    title: "Task",
    workspacePath,
    createdAt: 1,
    updatedAt: 2,
    mode: "build" as const,
  };
  try {
    await repo.syncTaskMeta({
      meta: { ...base, taskId: "cli", provider: ZCODE_AGENT_PROVIDER },
    });
    await repo.syncTaskMeta({
      meta: { ...base, taskId: "acp", runtimeId: "qoder-acp", nativeSessionId: "native-acp" },
    });
    await repo.syncTaskMeta({
      meta: { ...base, taskId: "legacy", provider: ZCODE_AGENT_PROVIDER },
    });
    repo.close();
    const database = new DatabaseSync(path);
    try {
      database.prepare("UPDATE tasks SET provider = 'claude' WHERE task_id = 'legacy'").run();
    } finally {
      database.close();
    }
    const reopened = new TaskIndexRepo(path);
    try {
      const current = await reopened.listTaskMetas({
        workspacePath,
        provider: ZCODE_AGENT_PROVIDER,
      });
      assert.deepEqual(current.map((task) => task.taskId).sort(), ["acp", "cli"]);
      const timeline = await reopened.queryTaskList({
        workspaceScopes: [{ workspacePath }],
        kind: "timeline",
        sortBy: "updated",
        provider: ZCODE_AGENT_PROVIDER,
      });
      assert.deepEqual(timeline.items.map((task) => task.taskId).sort(), ["acp", "cli"]);
    } finally {
      reopened.close();
    }
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
