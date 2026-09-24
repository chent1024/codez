import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { createGitService } from "../src/git/gitService.js";
import { setDataBaseDir } from "../src/paths.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]) {
  return (await execFileAsync("git", args, { cwd })).stdout.trim();
}

test("new session worktree starts detached at the selected branch and leaves source changes alone", async () => {
  const base = await mkdtemp(join(tmpdir(), "codez-worktree-"));
  const repo = join(base, "project");
  await mkdir(repo);
  setDataBaseDir(base);
  try {
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "file.txt"), "main\n");
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-m", "initial");
    await git(repo, "branch", "feature");
    await git(repo, "switch", "feature");
    await writeFile(join(repo, "file.txt"), "feature\n");
    await git(repo, "commit", "-am", "feature");
    const featureHead = await git(repo, "rev-parse", "HEAD");
    await git(repo, "switch", "main");
    await writeFile(join(repo, "file.txt"), "local change\n");

    const sourceHead = await git(repo, "rev-parse", "HEAD");
    assert.notEqual(featureHead, sourceHead);
    const created = await createGitService().createWorktree({
      workspacePath: repo,
      startBranchName: "feature",
    });

    assert.equal(created.startCommitHash, featureHead);
    assert.equal(await git(created.worktreePath, "rev-parse", "HEAD"), featureHead);
    assert.equal(await git(created.worktreePath, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD");
    assert.equal(await readFile(join(created.worktreePath, "file.txt"), "utf8"), "feature\n");
    assert.equal(await readFile(join(repo, "file.txt"), "utf8"), "local change\n");
    assert.equal(await git(repo, "branch", "--show-current"), "main");
    assert.equal(await git(repo, "rev-parse", "HEAD"), sourceHead);
  } finally {
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});

test("worktree creation rejects a branch that is not local", async () => {
  const base = await mkdtemp(join(tmpdir(), "codez-worktree-invalid-"));
  const repo = join(base, "project");
  await mkdir(repo);
  setDataBaseDir(base);
  try {
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "file.txt"), "main\n");
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-m", "initial");

    await assert.rejects(
      createGitService().createWorktree({ workspacePath: repo, startBranchName: "missing" }),
      /branch/i,
    );
    assert.equal(
      await git(repo, "worktree", "list", "--porcelain").then(
        (value) => value.split("\n").filter((line) => line.startsWith("worktree ")).length,
      ),
      1,
    );
  } finally {
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});

test("worktree refreshes upstream without moving the source branch", async () => {
  const base = await mkdtemp(join(tmpdir(), "codez-worktree-upstream-"));
  const repo = join(base, "project");
  const remote = join(base, "remote.git");
  const other = join(base, "other");
  await mkdir(repo);
  setDataBaseDir(base);
  try {
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "file.txt"), "initial\n");
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-m", "initial");
    await git(base, "init", "--bare", remote);
    await git(repo, "remote", "add", "origin", remote);
    await git(repo, "push", "-u", "origin", "main");
    const sourceHead = await git(repo, "rev-parse", "HEAD");
    await git(base, "clone", remote, other);
    await git(other, "config", "user.email", "test@example.com");
    await git(other, "config", "user.name", "Test");
    await git(other, "switch", "main");
    await writeFile(join(other, "file.txt"), "upstream\n");
    await git(other, "commit", "-am", "upstream");
    await git(other, "push", "origin", "main");
    const remoteHead = await git(other, "rev-parse", "HEAD");

    const created = await createGitService().createWorktree({
      workspacePath: repo,
      startBranchName: "main",
      refreshUpstream: true,
    });
    assert.equal(created.startCommitHash, remoteHead);
    assert.equal(await git(created.worktreePath, "rev-parse", "HEAD"), remoteHead);
    assert.equal(await git(repo, "rev-parse", "main"), sourceHead);
    const listed = await createGitService().listManagedWorktrees();
    assert.equal(listed.worktrees[0]?.createdFromCommitHash, remoteHead);
    assert.equal(listed.worktrees[0]?.upstreamRefresh, "refreshed");
  } finally {
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});

test("worktree refresh stops before creation when the upstream cannot be fetched", async () => {
  const base = await mkdtemp(join(tmpdir(), "codez-worktree-fetch-fail-"));
  const repo = join(base, "project");
  const remote = join(base, "remote.git");
  await mkdir(repo);
  setDataBaseDir(base);
  try {
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "file.txt"), "initial\n");
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-m", "initial");
    await git(base, "init", "--bare", remote);
    await git(repo, "remote", "add", "origin", remote);
    await git(repo, "push", "-u", "origin", "main");
    await git(repo, "remote", "set-url", "origin", join(base, "missing.git"));

    await assert.rejects(
      createGitService().createWorktree({
        workspacePath: repo,
        startBranchName: "main",
        refreshUpstream: true,
      }),
      /refresh upstream/i,
    );
    assert.equal(
      (await git(repo, "worktree", "list", "--porcelain"))
        .split("\n")
        .filter((line) => line.startsWith("worktree ")).length,
      1,
    );
  } finally {
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});

test("worktree refresh refuses diverged local and upstream commits", async () => {
  const base = await mkdtemp(join(tmpdir(), "codez-worktree-diverged-"));
  const repo = join(base, "project");
  const remote = join(base, "remote.git");
  const other = join(base, "other");
  await mkdir(repo);
  setDataBaseDir(base);
  try {
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "file.txt"), "initial\n");
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-m", "initial");
    await git(base, "init", "--bare", remote);
    await git(repo, "remote", "add", "origin", remote);
    await git(repo, "push", "-u", "origin", "main");
    await git(base, "clone", remote, other);
    await git(other, "config", "user.email", "test@example.com");
    await git(other, "config", "user.name", "Test");
    await git(other, "switch", "main");
    await writeFile(join(other, "file.txt"), "remote\n");
    await git(other, "commit", "-am", "remote");
    await git(other, "push", "origin", "main");
    await writeFile(join(repo, "file.txt"), "local\n");
    await git(repo, "commit", "-am", "local");
    const localHead = await git(repo, "rev-parse", "HEAD");

    await assert.rejects(
      createGitService().createWorktree({
        workspacePath: repo,
        startBranchName: "main",
        refreshUpstream: true,
      }),
      /diverged/i,
    );
    assert.equal(await git(repo, "rev-parse", "HEAD"), localHead);
    assert.equal(
      (await git(repo, "worktree", "list", "--porcelain"))
        .split("\n")
        .filter((line) => line.startsWith("worktree ")).length,
      1,
    );
  } finally {
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});

test("worktree refresh uses a local commit when no upstream is configured", async () => {
  const base = await mkdtemp(join(tmpdir(), "codez-worktree-no-upstream-"));
  const repo = join(base, "project");
  await mkdir(repo);
  setDataBaseDir(base);
  try {
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "file.txt"), "local\n");
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-m", "local");
    const localHead = await git(repo, "rev-parse", "HEAD");

    const service = createGitService();
    const created = await service.createWorktree({
      workspacePath: repo,
      startBranchName: "main",
      refreshUpstream: true,
    });
    assert.equal(created.startCommitHash, localHead);
    assert.equal(created.upstreamRefresh, "no-upstream");
    assert.equal(
      (await service.listManagedWorktrees()).worktrees[0]?.upstreamRefresh,
      "no-upstream",
    );
  } finally {
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});

test("managed worktrees can be listed and clean worktrees removed", async () => {
  const base = await mkdtemp(join(tmpdir(), "codez-worktree-manage-"));
  const repo = join(base, "project");
  const remote = join(base, "remote.git");
  await mkdir(repo);
  setDataBaseDir(base);
  try {
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "file.txt"), "main\n");
    await writeFile(join(repo, ".gitignore"), "*.env\n");
    await git(repo, "add", "file.txt");
    await git(repo, "add", ".gitignore");
    await git(repo, "commit", "-m", "initial");
    await git(base, "init", "--bare", remote);
    await git(repo, "remote", "add", "origin", remote);

    const service = createGitService();
    assert.deepEqual((await service.listManagedWorktrees()).worktrees, []);
    const created = await service.createWorktree({ workspacePath: repo, startBranchName: "main" });
    assert.match(basename(dirname(created.worktreePath)), /^project-[^/]+$/);
    const listed = await service.listManagedWorktrees();
    assert.equal(listed.worktrees.length, 1);
    assert.equal(listed.worktrees[0]?.worktreePath, created.worktreePath);
    assert.equal(
      await git(listed.worktrees[0]!.sourceRepoRoot, "rev-parse", "HEAD"),
      await git(repo, "rev-parse", "HEAD"),
    );
    assert.equal(listed.worktrees[0]?.isDirty, false);

    await writeFile(join(created.worktreePath, "file.txt"), "dirty\n");
    await assert.rejects(
      service.removeManagedWorktree({ worktreePath: created.worktreePath }),
      /uncommitted|dirty/i,
    );
    assert.equal(await readFile(join(created.worktreePath, "file.txt"), "utf8"), "dirty\n");
    await assert.rejects(service.removeManagedWorktree({ worktreePath: repo }), /managed/i);

    await writeFile(join(created.worktreePath, "file.txt"), "main\n");
    await writeFile(join(created.worktreePath, "secret.env"), "private\n");
    await assert.rejects(
      service.removeManagedWorktree({ worktreePath: created.worktreePath }),
      /uncommitted|dirty/i,
    );
    await rm(join(created.worktreePath, "secret.env"));
    const unrelatedFile = join(dirname(created.worktreePath), "keep.txt");
    await writeFile(unrelatedFile, "do not remove\n");
    await assert.rejects(
      service.removeManagedWorktree({ worktreePath: created.worktreePath }),
      /other files/i,
    );
    assert.equal(await readFile(unrelatedFile, "utf8"), "do not remove\n");
    await rm(unrelatedFile);
    await git(repo, "worktree", "lock", created.worktreePath);
    assert.equal((await service.listManagedWorktrees()).worktrees[0]?.isLocked, true);
    await assert.rejects(
      service.removeManagedWorktree({ worktreePath: created.worktreePath }),
      /locked/i,
    );
    await git(repo, "worktree", "unlock", created.worktreePath);
    await assert.rejects(
      service.removeManagedWorktree({ worktreePath: created.worktreePath }),
      /detached|branch/i,
    );
    await git(created.worktreePath, "switch", "-c", "cleanup");
    await assert.rejects(
      service.removeManagedWorktree({ worktreePath: created.worktreePath }),
      /upstream/i,
    );
    await git(created.worktreePath, "push", "-u", "origin", "cleanup");
    await git(repo, "remote", "set-url", "origin", join(base, "missing-remote.git"));
    await assert.rejects(
      service.removeManagedWorktree({ worktreePath: created.worktreePath }),
      /verify.*remote/i,
    );
    await git(repo, "remote", "set-url", "origin", remote);
    await writeFile(join(created.worktreePath, "file.txt"), "committed but not pushed\n");
    await git(created.worktreePath, "commit", "-am", "unpublished");
    await assert.rejects(
      service.removeManagedWorktree({ worktreePath: created.worktreePath }),
      /remote|pushed|upstream/i,
    );
    assert.equal((await service.listManagedWorktrees()).worktrees.length, 1);
    await git(created.worktreePath, "push");
    await service.removeManagedWorktree({ worktreePath: created.worktreePath });
    assert.deepEqual((await service.listManagedWorktrees()).worktrees, []);
    assert.equal(
      (await git(repo, "worktree", "list", "--porcelain"))
        .split("\n")
        .filter((line) => line.startsWith("worktree ")).length,
      1,
    );
  } finally {
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});

test("custom worktree root is used consistently and cannot be nested in the source", async () => {
  const base = await mkdtemp(join(tmpdir(), "codez-worktree-custom-"));
  const repo = join(base, "project");
  const remote = join(base, "remote.git");
  const managedRootPath = join(base, "custom-worktrees");
  await mkdir(repo);
  setDataBaseDir(base);
  try {
    await git(repo, "init", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "file.txt"), "main\n");
    await git(repo, "add", "file.txt");
    await git(repo, "commit", "-m", "initial");
    await git(base, "init", "--bare", remote);
    await git(repo, "remote", "add", "origin", remote);
    const service = createGitService({
      readManagedWorktreeRoot: async () => managedRootPath,
    });
    await assert.rejects(
      createGitService({
        readManagedWorktreeRoot: async () => join(repo, "nested"),
      }).createWorktree({
        workspacePath: repo,
        startBranchName: "main",
      }),
      /source repository/i,
    );
    await assert.rejects(stat(join(repo, "nested")), { code: "ENOENT" });
    const created = await service.createWorktree({
      workspacePath: repo,
      startBranchName: "main",
    });
    assert.equal((await createGitService().listManagedWorktrees()).worktrees.length, 0);
    assert.equal(
      (await service.listManagedWorktrees()).worktrees[0]?.worktreePath,
      created.worktreePath,
    );
    await assert.rejects(
      createGitService().removeManagedWorktree({ worktreePath: created.worktreePath }),
      /managed/i,
    );
    await git(created.worktreePath, "switch", "-c", "custom-cleanup");
    await git(created.worktreePath, "push", "-u", "origin", "custom-cleanup");
    await service.removeManagedWorktree({ worktreePath: created.worktreePath });
    assert.equal((await service.listManagedWorktrees()).worktrees.length, 0);
  } finally {
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});
