import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AcpConnection } from "../src/agent-runtime/acpConnection.js";
import { resolveAcpProjectMemoryWorkspaceId } from "../src/agent-runtime/acpProjectMemory.js";
import { getZCodeDataRootDir, setDataBaseDir } from "../src/paths.js";

const FAKE_AGENT = `
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let thought = 'low';
let model = 'auto';
let mode = 'ask';
let pendingPermissionPrompt = null;
const configOptions = () => [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model,
  options: [{ value: 'auto', name: 'Auto' }, { value: 'ultimate', name: 'Ultimate' }] },
  { id: 'reasoning_effort', name: 'Reasoning', category: 'model', type: 'select', currentValue: thought,
  options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
  ...(process.env.ACP_TEST_CONFIG_MODE ? [{ id: 'permission-mode', name: 'Mode', category: 'mode', type: 'select', currentValue: mode,
    options: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }] }] : [])];
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: message.params.protocolVersion,
      agentCapabilities: { loadSession: true }
    } }) + '\\n');
  } else if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'native-123', configOptions: configOptions(), modes: process.env.ACP_TEST_CONFIG_MODE ? undefined : { currentModeId: mode, availableModes: [{ id: 'ask', name: 'Ask' }, { id: 'code', name: 'Code' }] } } }) + '\\n');
  } else if (message.method === 'session/load') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } }) + '\\n');
  } else if (message.method === 'session/set_config_option') {
    if (message.params.configId === 'model') model = message.params.value;
    else if (message.params.configId === 'permission-mode') mode = message.params.value;
    else thought = message.params.value;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } }) + '\\n');
  } else if (message.method === 'session/set_mode') {
    mode = message.params.modeId;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\\n');
  } else if (message.method === 'session/prompt') {
    if (message.params.prompt.some((block) => block.type === 'text' && block.text === 'permission')) {
      pendingPermissionPrompt = message.id;
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'permission-request', method: 'session/request_permission', params: {
        sessionId: message.params.sessionId,
        toolCall: { toolCallId: 'tool-1', title: 'Edit file' },
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' }]
      } }) + '\\n');
      continue;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: message.params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: String(message.params.prompt.length) } }
    } }) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } }) + '\\n');
  } else if (message.id === 'permission-request' && pendingPermissionPrompt !== null) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: 'native-123',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: message.result.outcome.outcome } }
    } }) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: pendingPermissionPrompt, result: { stopReason: 'end_turn' } }) + '\\n');
    pendingPermissionPrompt = null;
  }
}
`;

test("ACP connection initializes, binds a native session, streams updates and deduplicates commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-acp-connection-"));
  const agentFile = join(dir, "agent.mjs");
  await writeFile(agentFile, FAKE_AGENT);
  const updates: string[] = [];
  let connection: AcpConnection | undefined;
  try {
    connection = await AcpConnection.open(
      { executable: process.execPath, args: [agentFile], cwd: dir, env: process.env },
      {
        onUpdate: (notification) => updates.push(notification.update.sessionUpdate),
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      },
    );
    assert.equal(await connection.createSession(dir), "native-123");
    assert.equal(connection.modeState()?.currentModeId, "ask");
    await assert.rejects(connection.setMode("unadvertised"), /does not advertise/);
    assert.equal((await connection.setMode("code")).currentModeId, "code");
    assert.deepEqual(
      connection.modelOptions().map((model) => [model.name, model.selected]),
      [
        ["Auto", true],
        ["Ultimate", false],
      ],
    );
    assert.equal(
      (await connection.setModel("acp:model:model:ultimate")).models.find((model) => model.selected)
        ?.name,
      "Ultimate",
    );
    assert.deepEqual(
      connection.thinkingLevels().map((level) => [level.value, level.selected]),
      [
        ["low", true],
        ["high", false],
      ],
    );
    await assert.rejects(connection.setThinkingLevel("ultra"), /unavailable/);
    assert.deepEqual(
      (await connection.setThinkingLevel("high")).map((level) => [level.value, level.selected]),
      [
        ["low", false],
        ["high", true],
      ],
    );
    const first = await connection.prompt("command-1", [{ type: "text", text: "hello" }]);
    assert.equal(first.stopReason, "end_turn");
    assert.deepEqual(updates, ["agent_message_chunk"]);
    const duplicate = await connection.prompt("command-1", [{ type: "text", text: "ignored" }]);
    assert.deepEqual(duplicate, first);
    await assert.rejects(connection.createSession(dir), /already bound/);
  } finally {
    await connection?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP accepts an advertised mode config option and confirms its value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-acp-config-mode-"));
  const agentFile = join(dir, "agent.mjs");
  let connection: AcpConnection | undefined;
  try {
    await writeFile(agentFile, FAKE_AGENT);
    connection = await AcpConnection.open(
      {
        executable: process.execPath,
        args: [agentFile],
        cwd: dir,
        env: { ...process.env, ACP_TEST_CONFIG_MODE: "1" },
      },
      {
        onUpdate: () => {},
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      },
    );
    await connection.createSession(dir);
    assert.deepEqual(
      connection.modeState()?.availableModes.map(({ id }) => id),
      ["ask", "code"],
    );
    assert.equal((await connection.setMode("code")).currentModeId, "code");
  } finally {
    await connection?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP permission response must select an option offered by the current request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-acp-permission-"));
  const agentFile = join(dir, "agent.mjs");
  let connection: AcpConnection | undefined;
  try {
    await writeFile(agentFile, FAKE_AGENT);
    const updates: string[] = [];
    connection = await AcpConnection.open(
      { executable: process.execPath, args: [agentFile], cwd: dir, env: process.env },
      {
        onUpdate: (notification) => {
          if (
            notification.update.sessionUpdate === "agent_message_chunk" &&
            notification.update.content.type === "text"
          )
            updates.push(notification.update.content.text);
        },
        requestPermission: async () => ({
          outcome: { outcome: "selected", optionId: "not-offered" },
        }),
      },
    );
    await connection.createSession(dir);
    await connection.prompt("permission-command", [{ type: "text", text: "permission" }]);
    assert.deepEqual(updates, ["cancelled"]);
  } finally {
    await connection?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP prompt reads current Project Memory on each turn and stops after disable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-acp-memory-delivery-"));
  setDataBaseDir(dir);
  const agentFile = join(dir, "agent.mjs");
  let enabled = true;
  let connection: AcpConnection | undefined;
  try {
    await writeFile(agentFile, FAKE_AGENT);
    const workspaceId = resolveAcpProjectMemoryWorkspaceId({ workspacePath: dir });
    const memoryRoot = join(
      getZCodeDataRootDir(),
      "cli",
      "memories",
      "projects",
      workspaceId,
      "memory",
    );
    const { mkdir } = await import("node:fs/promises");
    await mkdir(memoryRoot, { recursive: true });
    await writeFile(join(memoryRoot, "MEMORY.md"), "# Memory\n");
    const received: string[] = [];
    connection = await AcpConnection.open(
      {
        executable: process.execPath,
        args: [agentFile],
        cwd: dir,
        env: process.env,
        memory: { isEnabled: () => enabled },
      },
      {
        onUpdate: (notification) => {
          if (
            notification.update.sessionUpdate === "agent_message_chunk" &&
            notification.update.content.type === "text"
          )
            received.push(notification.update.content.text);
        },
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      },
    );
    await connection.createSession(dir);
    await connection.prompt("first", [{ type: "text", text: "first" }]);
    enabled = false;
    await connection.prompt("second", [{ type: "text", text: "second" }]);
    assert.deepEqual(received, ["2", "1"]);
  } finally {
    await connection?.close();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});
