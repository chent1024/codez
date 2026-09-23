import assert from "node:assert/strict";
import test from "node:test";
import {
  getAcpRuntimeSpec,
  isolateAcpNativeAutoMemory,
} from "../src/agent-runtime/acpRuntimeCatalog.js";

test("ACP launch disables verified native automatic memory without changing global environment", () => {
  const original = { QODER_MEMORY: "1", CODEBUDDY_DISABLE_AUTO_MEMORY: "0" };
  const qoder = isolateAcpNativeAutoMemory(getAcpRuntimeSpec("qoder-acp")!, original);
  assert.equal(qoder.verified, true);
  assert.equal(qoder.env.QODER_MEMORY, "0");
  assert.deepEqual(qoder.args.slice(-2), ["--settings", '{"autoMemoryEnabled":false}']);

  const codebuddy = isolateAcpNativeAutoMemory(getAcpRuntimeSpec("codebuddy-acp")!, original);
  assert.equal(codebuddy.verified, true);
  assert.equal(codebuddy.env.CODEBUDDY_DISABLE_AUTO_MEMORY, "1");

  const cline = isolateAcpNativeAutoMemory(getAcpRuntimeSpec("cline-acp")!, original);
  const workbuddy = isolateAcpNativeAutoMemory(getAcpRuntimeSpec("workbuddy-acp")!, original);
  assert.equal(cline.verified, false);
  assert.equal(workbuddy.verified, false);
  assert.deepEqual(original, { QODER_MEMORY: "1", CODEBUDDY_DISABLE_AUTO_MEMORY: "0" });
});
