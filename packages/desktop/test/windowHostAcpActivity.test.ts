import assert from "node:assert/strict";
import test from "node:test";
import type { IZCodeTaskService } from "@zcode/services";
import type { TraceId, ZCodeTaskMeta, ZCodeWorkspaceEvent } from "@zcode/shared";
import { createWindowHostControllerRuntime } from "../src/host/windowHostControllerService.js";

test("ACP sidebar activity requires a live Host event and stops at turn end", async () => {
  const workspacePath = "/tmp/codez-acp-activity-test";
  let meta: ZCodeTaskMeta = {
    taskId: "acp-task",
    runtimeId: "qoder",
    traceId: "test-trace" as TraceId,
    title: "Task",
    workspacePath,
    createdAt: 1,
    updatedAt: 1,
    mode: "build",
    status: "running",
  };
  let listener: ((event: ZCodeWorkspaceEvent) => void) | undefined;
  const taskService = {
    listTasks: async () => [meta],
    listPinnedTasks: async () => [],
    listArchivedTasks: async () => [],
    onDynamicWorkspaceEvent: () => (next: (event: ZCodeWorkspaceEvent) => void) => {
      listener = next;
      return { dispose: () => (listener = undefined) };
    },
  } as unknown as IZCodeTaskService;
  const runtime = createWindowHostControllerRuntime({
    createId: () => "test-id",
    resolveSource: () => ({
      scope: { kind: "local", workspacePath },
      taskService,
      sourceAvailability: "online",
    }),
  });
  const query = {
    kind: "active" as const,
    workspaceScopes: [{ workspacePath }],
    sortBy: "updated" as const,
  };
  try {
    assert.equal((await runtime.service.listTaskList(query)).items[0]?.liveStatus, "idle");
    assert.ok(listener);
    listener({
      type: "workspace_task_list_changed",
      workspacePath,
      taskId: meta.taskId,
      reason: "task_status_changed",
      taskMeta: meta,
    });
    assert.equal((await runtime.service.listTaskList(query)).items[0]?.activity?.phase, "running");

    meta = { ...meta, status: "completed", updatedAt: 2 };
    listener({
      type: "workspace_task_list_changed",
      workspacePath,
      taskId: meta.taskId,
      reason: "task_status_changed",
      taskMeta: meta,
    });
    assert.notEqual((await runtime.service.listTaskList(query)).items[0]?.liveStatus, "running");
  } finally {
    runtime.dispose();
  }
});
