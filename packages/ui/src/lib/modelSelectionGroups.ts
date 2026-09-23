import {
  isZCodeAgentProvider,
  resolveModelProviderFamilySpecByProviderId,
  zcodeProviderAccountAccessSchema,
  type ZCodeProviderAccountAccess,
  type ZCodeProvider,
} from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { shouldShowModelVisionBadge } from "@/lib/modelVisionBadge.js";

export interface ModelProviderGroupLabelOptions {
  apiKeyLabel?: string;
  apiKeyBadgeLabel?: string;
  codingPlanLabel?: string;
  codingPlanBadgeLabel?: string;
  startPlanLabel?: string;
  startPlanBadgeLabel?: string;
  teamPlanBadgeLabel?: string;
  teamPlanFallbackLabel?: string;
}

function supportsRegistryApiFormat(
  selectedProvider: ZCodeProvider,
  apiFormat: string | null | undefined,
): boolean {
  if (!apiFormat) return false;
  // 仅剩 glm（ZCode Agent）provider；三方 CLI 的 api format 差异已随 provider 下线。
  return isZCodeAgentProvider(selectedProvider);
}

export function buildRegistryModelSelectGroups(
  selectedProvider: ZCodeProvider,
  view: ModelSelectionView,
  labels: ModelProviderGroupLabelOptions = {},
): ModelSelectGroup[] {
  const apiGroups = view.providers.flatMap((provider) => {
    if (!supportsRegistryApiFormat(selectedProvider, provider.config.api?.type)) {
      return [];
    }

    const accountAccess = zcodeProviderAccountAccessSchema.safeParse(provider.config.access);
    const accountPresentation = accountAccess.success
      ? getRegistryAccountProviderGroupPresentation(provider.providerId, accountAccess.data, labels)
      : null;

    return [
      {
        key: `registry-provider:${provider.providerId}`,
        label: accountPresentation?.label || provider.providerName?.trim() || provider.providerId,
        ...(accountPresentation?.labelBadge ? { labelBadge: accountPresentation.labelBadge } : {}),
        ...(accountPresentation ? { directItems: true } : {}),
        items: provider.models.map(({ modelId, config }) => ({
          key: `registry-provider:${provider.providerId}:${modelId}`,
          value: encodeCustomModelValue(provider.providerId, modelId),
          name: modelId,
          ...(shouldShowModelVisionBadge(
            modelId,
            config.properties?.inputFormat?.supportsImage,
            provider.config.access,
          )
            ? { supportsVisionInput: true }
            : {}),
        })),
      },
    ];
  });
  const acpGroups: ModelSelectGroup[] = (view.acpProviders ?? []).map((provider) => ({
    key: `acp-provider:${provider.providerId}`,
    label: provider.providerName,
    labelBadge: "ACP",
    items: provider.models.map((model) => ({
      key: `acp-provider:${provider.providerId}:${model.modelId}`,
      value: encodeCustomModelValue(provider.providerId, model.modelId),
      name: disambiguateAcpModelName(model, provider.models),
      ...(model.description ? { badgeLabel: extractAcpBenefitBadge(model.description) } : {}),
    })),
  }));
  return [...apiGroups, ...acpGroups];
}

/** 同名的不同模型显示 Agent ID 后缀，避免把两个选择项误认成同一模型。 */
export function disambiguateAcpModelName<
  T extends { id?: string; modelId?: string; name: string; description?: string },
>(model: T, models: readonly T[]): string {
  const id = model.id ?? model.modelId;
  const sameName = models.filter((other) => other.name === model.name);
  if (sameName.length < 2 || !id) return model.name;
  const suffix = id.slice(id.lastIndexOf(":") + 1);
  const uniqueSuffix = sameName.every(
    (other) => other === model || (other.id ?? other.modelId)?.split(":").at(-1) !== suffix,
  );
  return `${model.name} · ${uniqueSuffix ? suffix : id}`;
}

/** 只展示 Agent 描述中明示的优惠或积分倍率，不推断实际价格。 */
export function extractAcpBenefitBadge(description: string): string | undefined {
  const explicit = description.match(
    /(?:\bfree\b|免费|\d+(?:\.\d+)?\s*%\s*(?:off|discount)|\d+(?:\.\d+)?\s*折|折扣|\bx\s*\d+(?:\.\d+)?(?:\s*credits?)?\b|\b\d+(?:\.\d+)?\s*x(?:\s*credits?)?\b)/iu,
  );
  return explicit?.[0];
}

function getRegistryAccountProviderGroupPresentation(
  providerId: string,
  access: ZCodeProviderAccountAccess,
  labels: ModelProviderGroupLabelOptions,
): Pick<ModelSelectGroup, "label" | "labelBadge"> {
  const familySpec = resolveModelProviderFamilySpecByProviderId(providerId);
  const label = familySpec?.label ?? providerId;
  if (access.mode === "start-plan") {
    return { label: "Start Plan", labelBadge: labels.startPlanBadgeLabel ?? "Free" };
  }
  if (access.mode === "team-coding-plan") {
    return { label, labelBadge: labels.teamPlanBadgeLabel ?? "Team" };
  }
  return { label, labelBadge: labels.codingPlanBadgeLabel ?? "Individual" };
}

export function resolveModelDisplayName(
  modelGroups: readonly ModelSelectGroup[],
  value: string,
): string | null {
  for (const group of modelGroups) {
    const matched = group.items.find((item) => item.value === value);
    if (matched) return matched.name;
  }

  return decodeCustomModelValue(value)?.modelName ?? null;
}
