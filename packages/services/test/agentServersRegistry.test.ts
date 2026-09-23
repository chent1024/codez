import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readAgentServersRegistry,
  fingerprintAcpServer,
  saveAgentServerConfig,
  deleteAgentServerConfig,
} from "../src/agent-runtime/agentServersRegistry.js";
import { setDataBaseDir } from "../src/paths.js";
import { readSavedAcpModels, saveAcpModels } from "../src/agent-runtime/acpProviderModels.js";

test("agent_servers isolates invalid entries and keeps validated absolute argv", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-agent-servers-"));
  try {
    const executable = join(dir, "unknown-agent");
    const configPath = join(dir, "agent-servers.json");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o700);
    await writeFile(
      configPath,
      JSON.stringify({
        agent_servers: {
          kiro: { name: "Kiro Agent", command: executable, args: ["acp"] },
          broken: { name: "Broken", command: "relative", args: ["--acp"] },
          injected: { name: "Injected", command: executable, args: ["--acp"], shell: true },
        },
      }),
    );
    const result = await readAgentServersRegistry(configPath);
    assert.deepEqual(
      result.servers.map((server) => server.id),
      ["kiro"],
    );
    assert.deepEqual(result.servers[0]?.args, ["acp"]);
    assert.equal(
      result.servers[0]?.fingerprint,
      fingerprintAcpServer(result.servers[0]!.command, ["acp"]),
    );
    assert.deepEqual(
      result.issues.map((issue) => issue.id),
      ["broken", "injected"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing agent_servers file is an empty registry", async () => {
  const result = await readAgentServersRegistry(join(tmpdir(), "missing-codez-agents.json"));
  assert.deepEqual(result.servers, []);
  assert.deepEqual(result.issues, []);
});

test("configured ACP can update one stable ID and delete it without changing peers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-agent-servers-edit-"));
  setDataBaseDir(dir);
  try {
    const executable = join(dir, "agent");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o700);
    await saveAgentServerConfig({ id: "first", name: "First", command: executable, args: [] });
    await saveAgentServerConfig({ id: "second", name: "Second", command: executable, args: [] });
    const originalFingerprint = (await readAgentServersRegistry()).servers[0]?.fingerprint;
    assert.ok(originalFingerprint);
    await saveAcpModels("first", originalFingerprint, [{ id: "old-model", name: "Old Model" }]);
    await saveAgentServerConfig({
      id: "first",
      name: "Renamed",
      command: executable,
      args: ["--acp"],
    });
    const updated = await readAgentServersRegistry();
    assert.notEqual(updated.servers[0]?.fingerprint, originalFingerprint);
    assert.deepEqual(await readSavedAcpModels("first", updated.servers[0]!.fingerprint), []);
    assert.deepEqual(
      updated.servers.map(({ id, name, args }) => ({ id, name, args })),
      [
        { id: "first", name: "Renamed", args: ["--acp"] },
        { id: "second", name: "Second", args: [] },
      ],
    );

    await deleteAgentServerConfig("first");
    const afterDelete = await readAgentServersRegistry();
    assert.deepEqual(
      afterDelete.servers.map(({ id }) => id),
      ["second"],
    );
    await assert.rejects(deleteAgentServerConfig("qoder-acp"));
    await assert.rejects(deleteAgentServerConfig("missing"));
    assert.deepEqual(
      (await readAgentServersRegistry()).servers.map(({ id }) => id),
      ["second"],
    );

    await assert.rejects(
      saveAgentServerConfig({ id: "second", name: "Bad", command: "/missing", args: [] }),
    );
    const raw = JSON.parse(await readFile(afterDelete.path, "utf8")) as {
      agent_servers: Record<string, { name: string }>;
    };
    assert.equal(raw.agent_servers.second?.name, "Second");
  } finally {
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});
