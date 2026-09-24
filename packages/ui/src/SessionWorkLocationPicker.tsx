import { useCallback, useState } from "react";
import type { GitRepositorySummary, GitLocalBranch } from "@zcode/shared";
import { CheckIcon, ChevronDownIcon, GitBranchIcon, LaptopIcon, GitForkIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

interface SessionWorkLocationPickerProps {
  workspacePath: string;
  gitSummary: GitRepositorySummary;
  remote: boolean;
  selectedBranch: string | null;
  onSelectBranch: (branch: string | null) => void;
}

export function SessionWorkLocationPicker({
  workspacePath,
  gitSummary,
  remote,
  selectedBranch,
  onSelectBranch,
}: SessionWorkLocationPickerProps) {
  const { gitService } = useServices();
  const { intl } = useZCodeIntl();
  const [locationOpen, setLocationOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<GitLocalBranch[]>([]);
  const [branchError, setBranchError] = useState(false);
  const worktreeAvailable = !remote && gitSummary.isGitAvailable && gitSummary.isRepository;

  const loadBranches = useCallback(async () => {
    try {
      const result = await gitService.getLocalBranches({ workspacePath });
      setBranches(result.branches);
      setBranchError(false);
      return result.branches;
    } catch (error) {
      logger.warn("[worktree-picker] Could not load local branches", { error: String(error) });
      setBranchError(true);
      return null;
    }
  }, [gitService, workspacePath]);

  const chooseWorktree = useCallback(async () => {
    const available = await loadBranches();
    const initial =
      available?.find((branch) => branch.name === gitSummary.branchName) ?? available?.[0];
    if (initial) onSelectBranch(initial.name);
    else
      toast(
        intl.formatMessage({ id: available ? "worktree.noBranch" : "worktree.branchLoadFailed" }),
      );
    setLocationOpen(false);
  }, [gitSummary.branchName, intl, loadBranches, onSelectBranch]);

  return (
    <>
      <Popover open={locationOpen} onOpenChange={setLocationOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-foreground"
            aria-label={intl.formatMessage({ id: "worktree.location" })}
          >
            {selectedBranch ? (
              <GitForkIcon className="size-4 text-foreground-subtle" />
            ) : (
              <LaptopIcon className="size-4 text-foreground-subtle" />
            )}
            <span>
              {intl.formatMessage({ id: selectedBranch ? "worktree.worktree" : "worktree.local" })}
            </span>
            <ChevronDownIcon className="size-3 text-foreground-subtle" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          avoidCollisions={false}
          className="w-56 gap-0.5 rounded-lg border-popover-border bg-menu p-1 text-foreground"
        >
          <div className="px-2 py-1 text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: "worktree.location" })}
          </div>
          <button
            type="button"
            className="flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ui-base/relaxed text-foreground hover:bg-menu-hover"
            onClick={() => {
              onSelectBranch(null);
              setLocationOpen(false);
            }}
          >
            <LaptopIcon className="size-4 text-foreground-subtle" />
            {intl.formatMessage({ id: "worktree.local" })}
            {!selectedBranch && <CheckIcon className="ml-auto size-4" />}
          </button>
          <button
            type="button"
            disabled={!worktreeAvailable}
            title={
              !worktreeAvailable ? intl.formatMessage({ id: "worktree.unavailable" }) : undefined
            }
            className="flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ui-base/relaxed text-foreground hover:bg-menu-hover disabled:opacity-50"
            onClick={() => void chooseWorktree()}
          >
            <GitForkIcon className="size-4 text-foreground-subtle" />
            {intl.formatMessage({ id: "worktree.newLocal" })}
            {selectedBranch && <CheckIcon className="ml-auto size-4" />}
          </button>
        </PopoverContent>
      </Popover>
      {selectedBranch && (
        <Popover
          open={branchOpen}
          onOpenChange={(open) => {
            setBranchOpen(open);
            if (open) void loadBranches();
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-foreground">
              <GitBranchIcon className="size-4 text-foreground-subtle" />
              <span className="max-w-40 truncate">{selectedBranch}</span>
              <ChevronDownIcon className="size-3 text-foreground-subtle" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" avoidCollisions={false} className="w-72 p-1">
            <Command>
              <CommandInput placeholder={intl.formatMessage({ id: "worktree.searchBranch" })} />
              <CommandList className="max-h-48">
                <CommandEmpty>
                  {intl.formatMessage({
                    id: branchError ? "worktree.branchLoadFailed" : "worktree.noBranch",
                  })}
                </CommandEmpty>
                {branches.map((branch) => (
                  <CommandItem
                    key={branch.name}
                    value={branch.name}
                    onSelect={() => {
                      onSelectBranch(branch.name);
                      setBranchOpen(false);
                    }}
                  >
                    <GitBranchIcon className="size-4" />
                    <span className="truncate">{branch.name}</span>
                    {branch.name === selectedBranch && <CheckIcon className="ml-auto size-4" />}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
