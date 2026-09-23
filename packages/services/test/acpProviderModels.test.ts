import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readAcpModelCatalog, saveAcpModels } from "../src/agent-runtime/acpProviderModels.js";
import { setDataBaseDir } from "../src/paths.js";

test("ACP manual discovery catalog survives reopen while selected models stay separate", async () => {
  const base = await mkdtemp(join(tmpdir(), "codez-acp-model-cache-"));
  setDataBaseDir(base);
  try {
    const available = [
      { id: "free", name: "Free", description: "Free access" },
      { id: "paid", name: "Paid", description: "Standard access" },
    ];
    await saveAcpModels("other-agent", "fingerprint-a", [available[0]!], available);
    const cached = await readAcpModelCatalog("other-agent", "fingerprint-a");
    assert.deepEqual(cached.availableModels, available);
    assert.deepEqual(cached.models, [available[0]]);
    assert.deepEqual(await readAcpModelCatalog("other-agent", "fingerprint-b"), {
      models: [],
      availableModels: [],
    });
  } finally {
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});
