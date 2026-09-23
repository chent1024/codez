import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type { GitManagedWorktree, GitManagedWorktreeListResult } from "@zcode/shared";
import type { CreateTaskRequest } from "@/app-shell/types.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isAbsoluteFilePath } from "@/lib/path.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WorktreeSettingsSection({
  onCreateTask,
  openWorkspacePaths,
}: {
  onCreateTask?: (request?: CreateTaskRequest) => void;
  openWorkspacePaths: readonly string[];
}) {
  const { intl } = useZCodeIntl();
  const { gitService } = useServices();
  const { settings, update } = useSettings();
  const configuredRoot = settings?.worktreeRootDirectory ?? "";
  const [rootDraft, setRootDraft] = useState("");
  const [savingRoot, setSavingRoot] = useState(false);
  const [listing, setListing] = useState<GitManagedWorktreeListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<GitManagedWorktree | null>(null);

  useEffect(() => {
    setRootDraft(configuredRoot);
  }, [configuredRoot]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setListing(await gitService.listManagedWorktrees());
    } catch (cause) {
      setListing(null);
      setError(getErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [configuredRoot, gitService]);

  const saveRoot = async () => {
    const nextRoot = rootDraft.trim();
    if (nextRoot === configuredRoot) return;
    if (nextRoot && !isAbsoluteFilePath(nextRoot)) {
      setError(intl.formatMessage({ id: "settings.worktrees.absolutePathRequired" }));
      return;
    }
    setSavingRoot(true);
    setError(null);
    try {
      const current = await gitService.listManagedWorktrees();
      if (current.worktrees.length > 0) {
        setError(intl.formatMessage({ id: "settings.worktrees.removeBeforeMove" }));
        return;
      }
      await update({ worktreeRootDirectory: nextRoot });
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setSavingRoot(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = useMemo(() => {
    const byRepository = new Map<string, GitManagedWorktree[]>();
    for (const item of listing?.worktrees ?? []) {
      const group = byRepository.get(item.sourceRepoRoot) ?? [];
      group.push(item);
      byRepository.set(item.sourceRepoRoot, group);
    }
    return [...byRepository.entries()];
  }, [listing]);

  const handleRemove = async () => {
    if (!pendingRemoval || removing) return;
    setRemoving(true);
    setError(null);
    try {
      await gitService.removeManagedWorktree({ worktreePath: pendingRemoval.worktreePath });
      setPendingRemoval(null);
      await refresh();
    } catch (cause) {
      setError(getErrorMessage(cause));
      setPendingRemoval(null);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsGroupCard>
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <div className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "settings.worktrees.directory" })}
            </div>
            <div className="mt-1 text-ui-sm leading-5 text-foreground-subtle">
              {intl.formatMessage({ id: "settings.worktrees.directoryDescription" })}
            </div>
          </div>
          <div className="flex w-full min-w-0 shrink-0 items-center gap-2 sm:w-[390px]">
            <input
              aria-label={intl.formatMessage({ id: "settings.worktrees.directory" })}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-ui-sm text-foreground"
              value={rootDraft}
              placeholder={listing?.rootPath ?? ""}
              onChange={(event) => setRootDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveRoot();
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={savingRoot || rootDraft.trim() === configuredRoot}
              onClick={() => void saveRoot()}
            >
              {intl.formatMessage({ id: "settings.worktrees.save" })}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              {loading ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              {intl.formatMessage({ id: "settings.worktrees.refresh" })}
            </Button>
          </div>
        </div>
      </SettingsGroupCard>

      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!loading && groups.length === 0 ? (
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.worktrees.empty" })}
        </p>
      ) : null}
      {groups.map(([repositoryPath, worktrees]) => (
        <section key={repositoryPath} className="space-y-3">
          <h3 className="break-all text-ui-base font-medium text-foreground">{repositoryPath}</h3>
          <SettingsGroupCard>
            {worktrees.map((worktree) => {
              const isOpen = openWorkspacePaths.includes(worktree.worktreePath);
              const cannotRemove = worktree.isDirty || worktree.isLocked || isOpen;
              const status = worktree.isDirty
                ? "settings.worktrees.dirty"
                : worktree.isLocked
                  ? "settings.worktrees.locked"
                  : isOpen
                    ? "settings.worktrees.open"
                    : "settings.worktrees.clean";
              return (
                <SettingsRow
                  key={worktree.worktreePath}
                  label={intl.formatMessage({ id: "settings.worktrees.item" })}
                  description={
                    <span className="break-all font-mono text-ui-sm">{worktree.worktreePath}</span>
                  }
                  detail={
                    <span className="text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({ id: status })}
                      {worktree.branchName ? ` · ${worktree.branchName}` : ""}
                    </span>
                  }
                  control={
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!onCreateTask}
                        onClick={() =>
                          onCreateTask?.({
                            targetWorkspace: { workspacePath: worktree.worktreePath },
                          })
                        }
                      >
                        {intl.formatMessage({ id: "settings.worktrees.newChat" })}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={cannotRemove || removing}
                        onClick={() => setPendingRemoval(worktree)}
                        className="text-destructive"
                      >
                        {intl.formatMessage({ id: "settings.worktrees.remove" })}
                      </Button>
                    </>
                  }
                />
              );
            })}
          </SettingsGroupCard>
        </section>
      ))}

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: "settings.worktrees.removeTitle" })}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              {pendingRemoval?.worktreePath}
              <span className="mt-2 block">
                {intl.formatMessage({ id: "settings.worktrees.removeDescription" })}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>
              {intl.formatMessage({ id: "settings.worktrees.cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={() => void handleRemove()}
              className="bg-destructive text-destructive-foreground"
            >
              {intl.formatMessage({ id: "settings.worktrees.remove" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
