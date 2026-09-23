import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readAgentServersRegistry,
  fingerprintAcpServer,
} from "../src/agent-runtime/agentServersRegistry.js";

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
