import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGitService } from "../src/git/gitService.js";
import { setDataBaseDir } from "../src/paths.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { createZCodeTaskServiceAdapter } from "../src/zcode-agent/zcodeTaskServiceAdapter.js";

const worktreePath = "/managed/project-123/project";
const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]) {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

function task(taskId: string, status: "running" | "completed" | "error") {
  return {
    taskId,
    traceId: `trace-${taskId}`,
    title: taskId,
    workspacePath: worktreePath,
    createdAt: 1,
    updatedAt: 2,
    mode: "build" as const,
    status,
  };
}

test("manual archive removes only the final published and terminal worktree conversation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-archive-worktree-"));
  const taskIndexRepo = new TaskIndexRepo(join(dir, "tasks.sqlite"));
  const removed: string[] = [];
  let runtimeReleased = false;
  const disposable = () => ({ dispose() {} });
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  const service = createZCodeTaskServiceAdapter({
    zcodeAgentService: {
      async disposeWorkspace() {
        runtimeReleased = true;
      },
      disposeAll() {},
    } as unknown as Options["zcodeAgentService"],
    taskIndexRepo,
    taskIndexSyncer: {
      onSessionTerminalEvent: disposable,
      onSessionReadyEvent: disposable,
      emitWorkspaceTaskListChanged() {},
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
    gitService: {
      async listManagedWorktrees() {
        return {
          rootPath: "/managed",
          worktrees: [
            {
              worktreePath,
              sourceRepoRoot: "/source/project",
              headCommitHash: "a".repeat(40),
              branchName: "feature",
              isDirty: false,
              isLocked: false,
            },
          ],
        };
      },
      async removeManagedWorktree({ worktreePath: path }) {
        assert.equal(runtimeReleased, true);
        removed.push(path);
      },
    } as Options["gitService"],
  });
  try {
    await taskIndexRepo.syncTaskMeta({ meta: task("first", "completed") });
    await taskIndexRepo.syncTaskMeta({ meta: task("second", "running") });
    await service.archiveTask({ taskId: "first", workspacePath: worktreePath });
    assert.deepEqual(removed, []);
    assert.equal(
      (await taskIndexRepo.getTaskMeta({ taskId: "first", workspacePath: worktreePath }))
        ?.projectWorkspacePath,
      "/source/project",
    );

    await taskIndexRepo.applyAgentPatch({
      taskId: "second",
      workspacePath: worktreePath,
      patch: { status: "completed" },
    });
    await service.archiveTask({ taskId: "second", workspacePath: worktreePath });
    assert.deepEqual(removed, [worktreePath]);
    assert.equal(
      (await taskIndexRepo.getTaskMeta({ taskId: "second", workspacePath: worktreePath }))
        ?.projectWorkspacePath,
      "/source/project",
    );
    await taskIndexRepo.syncTaskMeta({ meta: task("second", "completed") });
    assert.equal(
      (await taskIndexRepo.getTaskMeta({ taskId: "second", workspacePath: worktreePath }))
        ?.projectWorkspacePath,
      "/source/project",
    );
    assert.equal(
      (await taskIndexRepo.listTaskMetas({ workspacePath: worktreePath, archived: true })).length,
      2,
    );
  } finally {
    service.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanup failure keeps the successful archive and ordinary workspaces are untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-archive-worktree-failure-"));
  const taskIndexRepo = new TaskIndexRepo(join(dir, "tasks.sqlite"));
  const disposable = () => ({ dispose() {} });
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  let removalAttempts = 0;
  let listingAttempts = 0;
  const service = createZCodeTaskServiceAdapter({
    zcodeAgentService: {
      async disposeWorkspace() {},
      disposeAll() {},
    } as unknown as Options["zcodeAgentService"],
    taskIndexRepo,
    taskIndexSyncer: {
      onSessionTerminalEvent: disposable,
      onSessionReadyEvent: disposable,
      emitWorkspaceTaskListChanged() {},
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
    gitService: {
      async listManagedWorktrees() {
        listingAttempts += 1;
        return {
          rootPath: "/managed",
          worktrees: [
            {
              worktreePath,
              sourceRepoRoot: "/source/project",
              headCommitHash: "a".repeat(40),
              branchName: "feature",
              isDirty: false,
              isLocked: false,
            },
          ],
        };
      },
      async removeManagedWorktree() {
        removalAttempts += 1;
        throw new Error("remote unavailable");
      },
    } as Options["gitService"],
  });
  try {
    await taskIndexRepo.syncTaskMeta({ meta: task("managed", "completed") });
    await taskIndexRepo.syncTaskMeta({
      meta: { ...task("ordinary", "completed"), workspacePath: "/ordinary/project" },
    });
    await taskIndexRepo.syncTaskMeta({
      meta: { ...task("remote", "completed"), workspaceIdentity: "remote-example" },
    });
    await service.archiveTask({ taskId: "managed", workspacePath: worktreePath });
    await service.archiveTask({ taskId: "ordinary", workspacePath: "/ordinary/project" });
    await service.archiveTask({
      taskId: "remote",
      workspacePath: worktreePath,
      workspaceIdentity: "remote-example",
    });
    assert.equal(removalAttempts, 1);
    assert.equal(listingAttempts, 2);
    assert.equal(
      (await taskIndexRepo.listTaskMetas({ workspacePath: worktreePath, archived: true })).length,
      1,
    );
  } finally {
    service.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an archived running conversation keeps its managed worktree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-archive-running-worktree-"));
  const taskIndexRepo = new TaskIndexRepo(join(dir, "tasks.sqlite"));
  const disposable = () => ({ dispose() {} });
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  let removalAttempts = 0;
  const service = createZCodeTaskServiceAdapter({
    zcodeAgentService: {
      async disposeWorkspace() {},
      disposeAll() {},
    } as unknown as Options["zcodeAgentService"],
    taskIndexRepo,
    taskIndexSyncer: {
      onSessionTerminalEvent: disposable,
      onSessionReadyEvent: disposable,
      emitWorkspaceTaskListChanged() {},
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
    gitService: {
      async listManagedWorktrees() {
        return {
          rootPath: "/managed",
          worktrees: [
            {
              worktreePath,
              sourceRepoRoot: "/source/project",
              headCommitHash: "a".repeat(40),
              branchName: "feature",
              isDirty: false,
              isLocked: false,
            },
          ],
        };
      },
      async removeManagedWorktree() {
        removalAttempts += 1;
      },
    } as Options["gitService"],
  });
  try {
    await taskIndexRepo.syncTaskMeta({ meta: task("running", "running") });
    await service.archiveTask({ taskId: "running", workspacePath: worktreePath });
    assert.equal(removalAttempts, 0);
    assert.equal(
      (await taskIndexRepo.listTaskMetas({ workspacePath: worktreePath, archived: true })).length,
      1,
    );
  } finally {
    service.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("archiving a published managed worktree removes its directory and keeps the task record", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-archive-worktree-integrated-"));
  const source = join(dir, "project");
  const remote = join(dir, "remote.git");
  await mkdir(source);
  setDataBaseDir(dir);
  const taskIndexRepo = new TaskIndexRepo(join(dir, "tasks.sqlite"));
  const disposable = () => ({ dispose() {} });
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  const gitService = createGitService();
  const service = createZCodeTaskServiceAdapter({
    zcodeAgentService: {
      async disposeWorkspace() {},
      disposeAll() {},
    } as unknown as Options["zcodeAgentService"],
    taskIndexRepo,
    taskIndexSyncer: {
      onSessionTerminalEvent: disposable,
      onSessionReadyEvent: disposable,
      emitWorkspaceTaskListChanged() {},
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
    gitService,
  });
  try {
    await git(source, "init", "-b", "main");
    await git(source, "config", "user.email", "test@example.com");
    await git(source, "config", "user.name", "Test");
    await writeFile(join(source, "file.txt"), "initial\n");
    await git(source, "add", "file.txt");
    await git(source, "commit", "-m", "initial");
    await git(dir, "init", "--bare", remote);
    await git(source, "remote", "add", "origin", remote);
    const created = await gitService.createWorktree({
      workspacePath: source,
      startBranchName: "main",
    });
    await git(created.worktreePath, "switch", "-c", "archive-cleanup");
    await git(created.worktreePath, "push", "-u", "origin", "archive-cleanup");
    await taskIndexRepo.syncTaskMeta({
      meta: { ...task("integrated", "completed"), workspacePath: created.worktreePath },
    });

    await service.archiveTask({
      taskId: "integrated",
      workspacePath: created.worktreePath,
    });

    await assert.rejects(stat(created.worktreePath), { code: "ENOENT" });
    assert.equal((await gitService.listManagedWorktrees()).worktrees.length, 0);
    assert.equal(
      (
        await taskIndexRepo.listTaskMetas({
          workspacePath: created.worktreePath,
          archived: true,
        })
      ).length,
      1,
    );
    assert.equal((await stat(source)).isDirectory(), true);
  } finally {
    service.disposeAll();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});
