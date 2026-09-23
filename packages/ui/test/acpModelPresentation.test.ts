import assert from "node:assert/strict";
import test from "node:test";
import {
  disambiguateAcpModelName,
  extractAcpBenefitBadge,
} from "../src/lib/modelSelectionGroups.js";

test("ACP model benefits show only the Agent's explicit description", () => {
  for (const description of ["x0.00", "x0.34 credits", "0.50x Credit", "Free", "75% off"]) {
    assert.equal(extractAcpBenefitBadge(description), description);
  }
  assert.equal(extractAcpBenefitBadge("fast reasoning"), undefined);
});

test("same-name ACP models retain their Agent identity in the visible label", () => {
  const models = [
    { id: "hy3", name: "Hy3", description: "x0.00" },
    { id: "hy3-x", name: "Hy3", description: "x0.05" },
    { id: "hy3-alt", name: "Hy3", description: "x0.00" },
  ];
  assert.equal(disambiguateAcpModelName(models[0]!, models), "Hy3 · hy3");
  assert.equal(disambiguateAcpModelName(models[1]!, models), "Hy3 · hy3-x");
});
