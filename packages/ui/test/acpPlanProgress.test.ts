import assert from "node:assert/strict";
import test from "node:test";
import { isAcpPlanUnconfirmed } from "../src/v4/conversationStatusPanelModel.js";

const unfinishedPlan = {
  items: [
    { id: "1", content: "检查", status: "completed" as const },
    { id: "2", content: "复查", status: "inProgress" as const },
  ],
  updatedAt: 1,
};

test("ACP final reply does not silently complete an unreported plan step", () => {
  assert.equal(
    isAcpPlanUnconfirmed({
      runtimeId: "qoder",
      phase: "completedSuccess",
      plan: unfinishedPlan,
    }),
    true,
  );
  assert.equal(
    isAcpPlanUnconfirmed({ runtimeId: "qoder", phase: "running", plan: unfinishedPlan }),
    false,
  );
  assert.equal(
    isAcpPlanUnconfirmed({
      runtimeId: "zcode-cli",
      phase: "completedSuccess",
      plan: unfinishedPlan,
    }),
    false,
  );
  assert.equal(
    isAcpPlanUnconfirmed({
      runtimeId: "qoder",
      phase: "completedSuccess",
      plan: {
        ...unfinishedPlan,
        items: unfinishedPlan.items.map((item) => ({ ...item, status: "completed" as const })),
      },
    }),
    false,
  );
});
