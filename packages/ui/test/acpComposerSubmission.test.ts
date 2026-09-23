import assert from "node:assert/strict";
import test from "node:test";
import type { ModelSelectionView } from "@zcode/services";
import { createComposerSubmissionConfig } from "../src/v4/composer/composerSubmissionConfig.js";

const view = {
  providers: [],
  acpProviders: [
    {
      providerId: "workbuddy-configured",
      providerName: "WorkBuddy",
      models: [
        {
          modelId: "acp:model:model:hy4-preview-f",
          name: "Hy4 preview",
          reasoningLevels: [
            { value: "high", name: "High" },
            { value: "enabled", name: "On (default)" },
          ],
        },
      ],
    },
  ],
} as ModelSelectionView;

test("ACP model can start with the Agent's default thinking level", () => {
  const selection = {
    providerId: "workbuddy-configured",
    modelId: "acp:model:model:hy4-preview-f",
  };
  const implicit = createComposerSubmissionConfig(
    { mode: "build", modelSelection: selection },
    view,
  );
  assert.ok(implicit);
  assert.equal(implicit.modelSelection.options, undefined);

  const explicit = createComposerSubmissionConfig(
    { mode: "build", modelSelection: { ...selection, options: { reasoningLevel: "high" } } },
    view,
  );
  assert.equal(explicit?.modelSelection.options?.reasoningLevel, "high");

  assert.equal(
    createComposerSubmissionConfig(
      { mode: "build", modelSelection: { ...selection, options: { reasoningLevel: "unknown" } } },
      view,
    ),
    null,
  );
});
