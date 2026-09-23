import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AcpRuntimeCoordinator } from "../src/agent-runtime/acpRuntimeCoordinator.js";
import { AcpV4Bridge } from "../src/agent-runtime/acpV4Bridge.js";
import { saveAgentServerConfig } from "../src/agent-runtime/agentServersRegistry.js";
import { setDataBaseDir } from "../src/paths.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";

const AGENT = `
import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
let model = 'auto';
let thought = 'low';
const configOptions = () => [
  {id:'model',name:'Model',category:'model',type:'select',currentValue:model,
    options:[{value:'auto',name:'Auto'},{value:'ultimate',name:'Ultimate'}]},
  {id:'reasoning_effort',name:'Effort',category:'model',type:'select',currentValue:thought,
    options:[{value:'low',name:'Low'},{value:'high',name:'High'}]}
];
for await (const line of input) {
  const request = JSON.parse(line);
  const answer = (result) => process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result})+'\\n');
  if (request.method === 'initialize') answer({protocolVersion:request.params.protocolVersion,agentCapabilities:{loadSession:true}});
  if (request.method === 'session/new') answer({sessionId:'native-session',configOptions:configOptions()});
  if (request.method === 'session/load') answer({configOptions:configOptions()});
  if (request.method === 'session/set_config_option') {
    if (request.params.configId === 'model') model = request.params.value;
    else thought = request.params.value;
    answer({configOptions:configOptions()});
  }
  if (request.method === 'session/prompt') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{
      sessionId:request.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'reply'}}
    }})+'\\n');
    answer({stopReason:'end_turn'});
  }
}
`;

test("ACP coordinator binds workbench identity, deduplicates and restores V4 history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-acp-coordinator-"));
  const agentFile = join(dir, "agent.mjs");
  const repo = new TaskIndexRepo(join(dir, "tasks.sqlite"));
  setDataBaseDir(dir);
  const snapshots: string[] = [];
  const makeCoordinator = () =>
    new AcpRuntimeCoordinator(
      repo,
      {
        onSnapshot: (_target, snapshot) => snapshots.push(snapshot.control.phase),
      },
      async () => ({ executable: process.execPath, args: [agentFile] }),
    );
  let coordinator = makeCoordinator();
  const target = { workspacePath: dir, workspaceIdentity: "remote-a", taskId: "create-1" };
  try {
    await writeFile(agentFile, AGENT);
    const config = { modelId: "acp:model:model:ultimate", thoughtLevel: "high" };
    const preview = await coordinator.discoverConfig({
      ...target,
      runtimeId: "cline-acp",
      modelId: config.modelId,
    });
    assert.equal(preview.selectedModel, config.modelId);
    assert.deepEqual(
      preview.thoughtLevels.map((level) => level.value),
      ["low", "high"],
    );
    const [first, duplicate] = await Promise.all([
      coordinator.create({
        ...target,
        commandId: target.taskId,
        runtimeId: "cline-acp",
        ...config,
      }),
      coordinator.create({
        ...target,
        commandId: target.taskId,
        runtimeId: "cline-acp",
        ...config,
      }),
    ]);
    assert.equal(first.nativeSessionId, "native-session");
    assert.deepEqual(duplicate, first);
    assert.equal((await repo.getTaskMeta(target))?.runtimeId, "cline-acp");
    assert.equal(first.model, config.modelId);
    assert.equal(first.thoughtLevel, config.thoughtLevel);
    assert.equal(
      await coordinator.sendPrompt({ ...target, commandId: "prompt-1", text: "hello" }),
      "accepted",
    );
    assert.equal(
      await coordinator.sendPrompt({ ...target, commandId: "prompt-1", text: "hello" }),
      "duplicate",
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("ACP turn did not complete")), 3000);
      const poll = () => {
        if (coordinator.snapshot(target)?.control.phase === "completedSuccess") {
          clearTimeout(timeout);
          resolve();
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
    });
    await coordinator.closeAll();
    coordinator = makeCoordinator();
    const restored = await coordinator.load(target);
    assert.equal(restored.control.phase, "completedSuccess");
    assert.equal(restored.config.model, config.modelId);
    assert.equal(restored.config.thought, config.thoughtLevel);
    assert.ok(
      restored.rows.window.some((row) => row.kind === "assistantText" && row.text === "reply"),
    );
    assert.equal(
      await coordinator.sendPrompt({ ...target, commandId: "prompt-1", text: "hello" }),
      "duplicate",
    );
    assert.ok(snapshots.includes("running"));
    await coordinator.closeAll();
    const unavailable = new AcpRuntimeCoordinator(repo, {}, async () => {
      throw new Error("Agent executable is missing");
    });
    const offline = await unavailable.load(target);
    assert.equal(offline.control.phase, "error");
    assert.equal(offline.control.lastError?.code, "acpRuntimeUnavailable");
    assert.equal(offline.inputRouting.mode, "reject");
    assert.ok(
      offline.rows.window.some((row) => row.kind === "assistantText" && row.text === "reply"),
    );
    assert.ok(unavailable.rowsRange({ ...target, limit: 100 }).rows.length > 0);
    await unavailable.closeAll();
  } finally {
    await coordinator.closeAll();
    repo.close();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a configured ACP Agent absent from the built-in catalog can create and restore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codez-acp-custom-"));
  setDataBaseDir(dir);
  const repo = new TaskIndexRepo(join(dir, "tasks.sqlite"));
  const agentFile = join(dir, "agent.mjs");
  const target = { workspacePath: dir, taskId: "custom-create" };
  let coordinator = new AcpRuntimeCoordinator(repo);
  try {
    await writeFile(agentFile, AGENT);
    await saveAgentServerConfig({
      id: "unlisted-agent",
      name: "Unlisted Agent",
      command: process.execPath,
      args: [agentFile],
    });
    const preview = await coordinator.discoverConfig({ ...target, runtimeId: "unlisted-agent" });
    assert.ok(preview.models.length > 0);
    const meta = await coordinator.create({
      ...target,
      commandId: target.taskId,
      runtimeId: "unlisted-agent",
      modelId: preview.selectedModel,
    });
    assert.equal(meta.runtimeId, "unlisted-agent");
    assert.ok(meta.agentServerFingerprint);
    await coordinator.closeAll();
    coordinator = new AcpRuntimeCoordinator(repo);
    const restored = await coordinator.load(target);
    assert.equal(restored.meta.runtimeId, "unlisted-agent");
    assert.notEqual(restored.control.phase, "error");

    const frames: Array<{ kind: string; deliveryKind?: string }> = [];
    const bridge = new AcpV4Bridge(
      repo,
      (_target, frame) => frames.push(frame),
      () => false,
    );
    try {
      const subscribed = await bridge.subscribe(target);
      assert.equal(frames.at(-1)?.deliveryKind, "initial");
      assert.equal(bridge.resync(subscribed.ack.subscriptionId)?.ack.mode, "snapshot");
      assert.equal(frames.at(-1)?.deliveryKind, "recovery");
      assert.equal((await repo.getTaskMeta(target))?.nativeSessionId, meta.nativeSessionId);
    } finally {
      await bridge.dispose();
    }
  } finally {
    await coordinator.closeAll();
    repo.close();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});
