import type { WorkspaceTabState } from "@/store/tabStore.js";

type WorkspaceProjectLocation = Pick<
  WorkspaceTabState,
  | "workspacePath"
  | "projectWorkspacePath"
  | "workspaceIdentity"
  | "remoteSessionId"
  | "remoteTarget"
>;

function isLocalWorkspace(tab: WorkspaceProjectLocation): boolean {
  return !tab.workspaceIdentity && !tab.remoteSessionId && !tab.remoteTarget;
}

/** 只用已持久化归属或托管工作树的 Git 核验结果；同名目录不足以合并项目。 */
export function projectPathForWorktreeTab(
  tab: WorkspaceProjectLocation,
  tabs: readonly WorkspaceProjectLocation[],
  verifiedSources: ReadonlyMap<string, string>,
): string | null {
  const source = tab.projectWorkspacePath ?? verifiedSources.get(tab.workspacePath);
  if (!source || source === tab.workspacePath || !isLocalWorkspace(tab)) return null;
  return tabs.some((candidate) => candidate.workspacePath === source && isLocalWorkspace(candidate))
    ? source
    : null;
}

/** 已关闭的工作树 tab 仍需作为任务查询目录存在，避免会话从原项目下消失。 */
export function includeManagedWorktreeTaskTabs(
  tabs: readonly WorkspaceTabState[],
  verifiedSources: ReadonlyMap<string, string>,
): WorkspaceTabState[] {
  const knownPaths = new Set(tabs.filter(isLocalWorkspace).map((tab) => tab.workspacePath));
  const result = [...tabs];
  for (const [worktreePath, sourcePath] of verifiedSources) {
    if (!knownPaths.has(sourcePath) || knownPaths.has(worktreePath)) continue;
    result.push({
      kind: "workspace",
      id: `managed-worktree:${worktreePath}`,
      workspacePath: worktreePath,
      label: "Worktree",
      workspacePurpose: "project",
      projectWorkspacePath: sourcePath,
    });
  }
  return result;
}
