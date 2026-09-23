import { useRef, useState } from "react";
import type { AgentRuntimeInstallStatus } from "@zcode/services";
import { ACP_DEFAULT_MODEL_ID } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { useServices } from "@/hooks/useServices.js";
import { disambiguateAcpModelName, extractAcpBenefitBadge } from "@/lib/modelSelectionGroups.js";

export function AcpProviderDetail({
  status,
  configPath,
  onSaved,
  workspacePath,
  workspaceIdentity,
  create = false,
  onBack,
}: {
  status?: AgentRuntimeInstallStatus;
  configPath?: string;
  onSaved?: (id: string) => void;
  workspacePath: string;
  workspaceIdentity?: string;
  create?: boolean;
  onBack?: () => void;
}) {
  const { zcodeAgentService } = useServices();
  const [id, setId] = useState(status?.id ?? "");
  const [name, setName] = useState(status?.name ?? "");
  const [command, setCommand] = useState(status?.command ?? "");
  const [argsText, setArgsText] = useState("[]");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const toggleSavingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{
    id: string;
    name: string;
    description?: string;
  }> | null>(status?.availableModels ? [...status.availableModels] : null);
  const [enabledModelIds, setEnabledModelIds] = useState(
    () => new Set((status?.models ?? []).map((model) => model.id)),
  );
  const editable = create;

  const save = async () => {
    setError(null);
    let args: unknown;
    try {
      args = JSON.parse(argsText) as unknown;
    } catch {
      setError('参数必须是 JSON 字符串数组，例如 ["acp"]');
      return;
    }
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
      setError("参数必须是 JSON 字符串数组");
      return;
    }
    setSaving(true);
    try {
      await zcodeAgentService.saveAgentServer({ id, name, command, args });
      onSaved?.(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const syncModels = async () => {
    if (!status || !workspacePath) return;
    setSaving(true);
    setSyncing(true);
    setError(null);
    try {
      const preview = await zcodeAgentService.discoverAgentRuntimeConfig({
        runtimeId: status.id,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        includeAllModelThoughtLevels: true,
      });
      const models = preview.models.length
        ? preview.models
        : [{ id: ACP_DEFAULT_MODEL_ID, name: "默认模型" }];
      setAvailableModels(models);
      setEnabledModelIds(
        (current) =>
          new Set(models.filter((model) => current.has(model.id)).map((model) => model.id)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSyncing(false);
      setSaving(false);
    }
  };

  const toggleModel = async (modelId: string, checked: boolean) => {
    if (!status || toggleSavingRef.current) return;
    toggleSavingRef.current = true;
    const previous = enabledModelIds;
    const next = new Set(previous);
    if (checked) next.add(modelId);
    else next.delete(modelId);
    // 保存期间禁用其他开关，避免较晚完成的旧请求覆盖较新的选择。
    setEnabledModelIds(next);
    setSaving(true);
    setError(null);
    try {
      await zcodeAgentService.saveAgentServerModels({
        runtimeId: status.id,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        modelIds: [...next],
      });
      onSaved?.(status.id);
    } catch (cause) {
      setEnabledModelIds(previous);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      toggleSavingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4" aria-label="ACP 供应商">
      <div>
        {create && onBack ? (
          <Button type="button" variant="ghost" onClick={onBack}>
            返回
          </Button>
        ) : null}
        <h2 className="text-ui-lg font-semibold">{create ? "添加 ACP 供应商" : status?.name}</h2>
        <p className="mt-1 text-ui-sm text-foreground-subtle">
          ACP CLI 由执行 Agent 的 Host 启动；安装与认证由该 CLI 自己管理。
        </p>
      </div>
      <p className="break-all text-ui-sm text-foreground-subtle">
        配置文件：{configPath ?? status?.configPath ?? "~/.codez/v2/agent-servers.json"}
      </p>
      {status ? (
        <div className="space-y-1 text-ui-sm">
          <p role={status.reason || !status.installed ? "alert" : undefined}>
            {status.reason ?? (status.installed ? "可执行文件已找到" : "不可用")}
          </p>
          <p className="text-foreground-subtle">
            项目记忆会按记忆开关注入；ACP 自动记忆提取尚未实现，Agent 原生记忆状态未统一验证。
          </p>
        </div>
      ) : null}
      {editable ? (
        <div className="grid gap-3">
          <label className="grid gap-1 text-ui-sm">
            稳定 ID
            <Input value={id} onChange={(event) => setId(event.target.value)} />
          </label>
          <label className="grid gap-1 text-ui-sm">
            显示名称
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-1 text-ui-sm">
            命令绝对路径
            <Input value={command} onChange={(event) => setCommand(event.target.value)} />
          </label>
          <label className="grid gap-1 text-ui-sm">
            参数（JSON 字符串数组）
            <Input value={argsText} onChange={(event) => setArgsText(event.target.value)} />
          </label>
          {error ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "保存中…" : "保存 ACP 供应商"}
          </Button>
        </div>
      ) : status ? (
        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            disabled={!status.installed || saving || !workspacePath}
            onClick={() => void syncModels()}
          >
            {syncing ? "同步中…" : "同步 Agent 模型"}
          </Button>
          {availableModels === null && status.models?.length ? (
            <p className="text-ui-sm text-foreground-subtle">
              已启用 {status.models.length} 个模型。同步后可重新勾选。
            </p>
          ) : null}
          {availableModels?.map((model) => (
            <label
              key={model.id}
              className="flex min-h-10 items-center justify-between gap-3 border-b border-border/60 px-1 py-2 text-ui-base last:border-b-0"
            >
              <span
                className="min-w-0"
                title={[model.id, model.description].filter(Boolean).join(" · ")}
              >
                <span className="break-words text-foreground">
                  {disambiguateAcpModelName(model, availableModels)}
                </span>
                {model.description && extractAcpBenefitBadge(model.description) ? (
                  <span className="ml-2 inline-flex rounded-md bg-surface px-1.5 py-0.5 text-ui-sm text-foreground-subtle ring-1 ring-border">
                    {extractAcpBenefitBadge(model.description)}
                  </span>
                ) : null}
              </span>
              <Switch
                disabled={saving}
                checked={enabledModelIds.has(model.id)}
                onCheckedChange={(checked) => void toggleModel(model.id, checked)}
              />
            </label>
          ))}
          {error ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
