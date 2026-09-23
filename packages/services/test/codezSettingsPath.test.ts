import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSettingService } from "../src/setting/settingService.js";
import { setDataBaseDir } from "../src/paths.js";

test("CodeZ settings use the selected .codez data root without reading .zcode", async () => {
  const base = await mkdtemp(join(tmpdir(), "codez-settings-path-"));
  setDataBaseDir(base);
  try {
    await mkdir(join(base, ".zcode", "v2"), { recursive: true });
    await writeFile(
      join(base, ".zcode", "v2", "setting.json"),
      '{"recentProjects":["/legacy-project"]}',
    );
    const service = createSettingService();
    const initial = await service.get();
    assert.ok(!initial.recentProjects?.includes("/legacy-project"));
    await service.update({ locale: "zh-CN" });
    const persisted = JSON.parse(
      await readFile(join(base, ".codez", "v2", "setting.json"), "utf8"),
    );
    assert.equal(persisted.locale, "zh-CN");
    assert.equal(
      await readFile(join(base, ".zcode", "v2", "setting.json"), "utf8"),
      '{"recentProjects":["/legacy-project"]}',
    );
  } finally {
    setDataBaseDir(null);
    await rm(base, { recursive: true, force: true });
  }
});
