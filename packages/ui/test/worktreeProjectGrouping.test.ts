import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceTabState } from "../src/store/tabStore.js";
import {
  includeManagedWorktreeTaskTabs,
  projectPathForWorktreeTab,
} from "../src/lib/worktreeProjectGrouping.js";

function tab(id: string, workspacePath: string, projectWorkspacePath?: string): WorkspaceTabState {
  return { id, kind: "workspace", label: "chub", workspacePath, projectWorkspacePath };
}

test("managed worktree groups by verified source path, never by matching directory name", () => {
  const first = tab("first", "/projects/one/chub");
  const second = tab("second", "/projects/two/chub");
  const worktree = tab("worktree", "/managed/abc/chub");
  const sources = new Map([[worktree.workspacePath, first.workspacePath]]);
  assert.equal(
    projectPathForWorktreeTab(worktree, [first, second, worktree], sources),
    first.workspacePath,
  );
  assert.equal(projectPathForWorktreeTab(second, [first, second, worktree], sources), null);
  assert.equal(projectPathForWorktreeTab(worktree, [second, worktree], sources), null);
});

test("persisted worktree affiliation survives removal from managed Git listing", () => {
  const source = tab("source", "/projects/chub");
  const worktree = tab("worktree", "/managed/abc/chub", source.workspacePath);
  assert.equal(
    projectPathForWorktreeTab(worktree, [source, worktree], new Map()),
    source.workspacePath,
  );
});

test("a closed managed worktree still supplies tasks beneath its local source project", () => {
  const source = tab("source", "/projects/chub");
  const paths = new Map([["/managed/abc/chub", source.workspacePath]]);
  const tabs = includeManagedWorktreeTaskTabs([source], paths);
  assert.equal(tabs.length, 2);
  assert.equal(tabs[1]?.workspacePath, "/managed/abc/chub");
  assert.equal(projectPathForWorktreeTab(tabs[1]!, tabs, paths), source.workspacePath);
  assert.equal(includeManagedWorktreeTaskTabs(tabs, paths).length, 2);

  const remote = { ...source, id: "remote", workspaceIdentity: "remote:ssh:host:/projects/chub" };
  assert.equal(includeManagedWorktreeTaskTabs([remote], paths).length, 1);
});
