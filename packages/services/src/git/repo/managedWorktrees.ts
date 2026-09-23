import { lstat, readFile, readdir, realpath, rmdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { GitManagedWorktree, GitManagedWorktreeListResult } from "@zcode/shared";
import { getZCodeDataRootDir } from "#src/paths.js";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";
import { ensureGitCommandSucceeded } from "./gitCliHelpers.js";

const MARKER_NAME = ".codez-worktree.json";

interface WorktreeMarker {
  kind: "codez-managed-worktree";
  version: 1;
  worktreePath: string;
}

export function getManagedWorktreeRoot(managedRootPath?: string): string {
  const configured = managedRootPath?.trim();
  if (!configured) return join(getZCodeDataRootDir(), "worktrees");
  if (!isAbsolute(configured)) throw new Error("Managed worktree directory must be absolute");
  return resolve(configured);
}

async function resolvePlannedDirectory(path: string): Promise<string> {
  const missing: string[] = [];
  let existing = path;
  while (true) {
    try {
      return resolve(await realpath(existing), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
}

export async function assertManagedRootOutsideRepository(
  managedRootPath: string,
  repoRoot: string,
): Promise<void> {
  const source = await realpath(repoRoot);
  const plannedRoot = await resolvePlannedDirectory(managedRootPath);
  const child = relative(source, plannedRoot);
  if (child === "" || (!child.startsWith("..") && !isAbsolute(child))) {
    throw new Error("Managed worktree directory cannot be inside the source repository");
  }
}

export async function writeManagedWorktreeMarker(
  containerPath: string,
  worktreePath: string,
): Promise<void> {
  const marker: WorktreeMarker = {
    kind: "codez-managed-worktree",
    version: 1,
    worktreePath,
  };
  await writeFile(join(containerPath, MARKER_NAME), JSON.stringify(marker), { flag: "wx" });
}

async function readMarker(containerPath: string): Promise<WorktreeMarker | null> {
  try {
    if (!(await lstat(join(containerPath, MARKER_NAME))).isFile()) return null;
    const parsed: unknown = JSON.parse(await readFile(join(containerPath, MARKER_NAME), "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("kind" in parsed) ||
      parsed.kind !== "codez-managed-worktree" ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("worktreePath" in parsed) ||
      typeof parsed.worktreePath !== "string"
    ) {
      return null;
    }
    return parsed as WorktreeMarker;
  } catch {
    return null;
  }
}

interface GitWorktreeRecord {
  path: string;
  isLocked: boolean;
}

function parseWorktreeRecords(output: string): GitWorktreeRecord[] {
  return output
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      return {
        path: lines.find((line) => line.startsWith("worktree "))?.slice(9) ?? "",
        isLocked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
      };
    })
    .filter((record) => record.path);
}

async function inspectManagedWorktree(
  commandProvider: GitCommandProvider,
  rootPath: string,
  containerName: string,
): Promise<GitManagedWorktree | null> {
  const containerPath = join(rootPath, containerName);
  const [containerInfo, marker] = await Promise.all([
    lstat(containerPath).catch(() => null),
    readMarker(containerPath),
  ]);
  if (!containerInfo?.isDirectory() || !marker) return null;
  const worktreePath = marker.worktreePath;
  if (dirname(worktreePath) !== containerPath || basename(worktreePath) === MARKER_NAME) {
    return null;
  }
  const [worktreeInfo, gitInfo] = await Promise.all([
    lstat(worktreePath).catch(() => null),
    lstat(join(worktreePath, ".git")).catch(() => null),
  ]);
  if (!worktreeInfo?.isDirectory() || !gitInfo?.isFile()) return null;

  const [root, records, head, branch, status] = await Promise.all([
    commandProvider.run({ cwd: worktreePath, args: ["rev-parse", "--show-toplevel"] }),
    commandProvider.run({ cwd: worktreePath, args: ["worktree", "list", "--porcelain"] }),
    commandProvider.run({ cwd: worktreePath, args: ["rev-parse", "HEAD"] }),
    commandProvider.run({ cwd: worktreePath, args: ["branch", "--show-current"] }),
    commandProvider.run({
      cwd: worktreePath,
      args: ["status", "--porcelain", "--untracked-files=all", "--ignored"],
    }),
  ]);
  if ([root, records, head, branch, status].some((result) => result.exitCode !== 0)) return null;
  if ((await realpath(root.stdout.trim())) !== (await realpath(worktreePath))) return null;
  const registered = parseWorktreeRecords(records.stdout);
  const first = registered[0];
  const canonicalWorktreePath = await realpath(worktreePath);
  const current = (
    await Promise.all(
      registered.map(async (record) => ({
        record,
        realPath: await realpath(record.path).catch(() => null),
      })),
    )
  ).find(({ realPath }) => realPath === canonicalWorktreePath)?.record;
  if (!first || !current || current === first) return null;
  return {
    worktreePath,
    sourceRepoRoot: first.path,
    headCommitHash: head.stdout.trim(),
    branchName: branch.stdout.trim() || null,
    isDirty: status.stdout.trim().length > 0,
    isLocked: current.isLocked,
  };
}

async function assertHeadPublishedToUpstream(
  commandProvider: GitCommandProvider,
  worktreePath: string,
  expectedHead: string,
): Promise<void> {
  const branch = await commandProvider.run({
    cwd: worktreePath,
    args: ["symbolic-ref", "--quiet", "HEAD"],
  });
  if (branch.exitCode !== 0 || !branch.stdout.trim().startsWith("refs/heads/")) {
    throw new Error("Cannot remove a detached worktree without a published branch");
  }
  const branchRef = branch.stdout.trim();
  const upstream = await commandProvider.run({
    cwd: worktreePath,
    args: ["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)", branchRef],
  });
  ensureGitCommandSucceeded("git for-each-ref upstream", upstream);
  const [remoteName, remoteRef] = upstream.stdout.trim().split("\0");
  if (!remoteName || remoteName === "." || !remoteRef?.startsWith("refs/heads/")) {
    throw new Error("Current branch has no remote upstream");
  }
  const published = await commandProvider.run({
    cwd: worktreePath,
    args: ["ls-remote", "--exit-code", "--refs", remoteName, remoteRef],
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  if (published.exitCode !== 0 || published.outputTruncated) {
    throw new Error("Cannot verify the remote upstream branch");
  }
  const remoteHead = published.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .find(([, ref]) => ref === remoteRef)?.[0];
  if (!remoteHead || remoteHead !== expectedHead) {
    throw new Error("Worktree HEAD does not match the pushed remote upstream");
  }
}

export async function listManagedWorktrees(
  commandProvider: GitCommandProvider,
  managedRootPath?: string,
): Promise<GitManagedWorktreeListResult> {
  const rootPath = getManagedWorktreeRoot(managedRootPath);
  const rootInfo = await lstat(rootPath).catch(() => null);
  if (!rootInfo) return { rootPath, worktrees: [] };
  if (!rootInfo.isDirectory()) {
    throw new Error("Managed worktree directory is invalid");
  }
  const names = await readdir(rootPath);
  const inspected: Array<GitManagedWorktree | null> = [];
  for (let index = 0; index < names.length; index += 8) {
    inspected.push(
      ...(await Promise.all(
        names.slice(index, index + 8).map(async (name) => {
          try {
            return await inspectManagedWorktree(commandProvider, rootPath, name);
          } catch {
            return null;
          }
        }),
      )),
    );
  }
  return {
    rootPath,
    worktrees: inspected
      .filter((entry): entry is GitManagedWorktree => entry !== null)
      .sort(
        (left, right) =>
          left.sourceRepoRoot.localeCompare(right.sourceRepoRoot) ||
          left.worktreePath.localeCompare(right.worktreePath),
      ),
  };
}

export async function removeManagedWorktree(
  commandProvider: GitCommandProvider,
  worktreePath: string,
  managedRootPath?: string,
): Promise<void> {
  const listing = await listManagedWorktrees(commandProvider, managedRootPath);
  const entry = listing.worktrees.find((item) => item.worktreePath === worktreePath);
  if (!entry) throw new Error("Path is not a managed worktree");
  if (entry.isDirty) throw new Error("Worktree has uncommitted changes");
  if (entry.isLocked) throw new Error("Worktree is locked");
  const containerPath = dirname(worktreePath);
  const siblings = await readdir(containerPath);
  if (
    siblings.length !== 2 ||
    !siblings.includes(MARKER_NAME) ||
    !siblings.includes(basename(worktreePath))
  ) {
    throw new Error("Managed worktree container has other files");
  }
  await assertHeadPublishedToUpstream(commandProvider, worktreePath, entry.headCommitHash);
  const refreshed = await inspectManagedWorktree(
    commandProvider,
    listing.rootPath,
    basename(containerPath),
  );
  if (
    !refreshed ||
    refreshed.headCommitHash !== entry.headCommitHash ||
    refreshed.isDirty ||
    refreshed.isLocked
  ) {
    throw new Error("Worktree changed during removal verification");
  }
  const removed = await commandProvider.run({
    cwd: entry.sourceRepoRoot,
    args: ["worktree", "remove", worktreePath],
  });
  ensureGitCommandSucceeded("git worktree remove", removed);
  await rm(join(containerPath, MARKER_NAME));
  await rmdir(containerPath);
}
