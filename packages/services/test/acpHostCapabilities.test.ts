import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AcpHostCapabilities } from "../src/agent-runtime/acpHostCapabilities.js";

test("ACP host file and terminal callbacks stay scoped and require permission", async () => {
  const root = await mkdtemp(join(tmpdir(), "codez-acp-host-"));
  const workspace = join(root, "workspace");
  const outside = join(root, "outside.txt");
  const file = join(workspace, "inside.txt");
  await mkdir(workspace);
  await writeFile(file, "one\ntwo\nthree\n");
  await writeFile(outside, "private");
  await symlink(outside, join(workspace, "escape.txt"));
  let allowed = false;
  const host = new AcpHostCapabilities(
    workspace,
    undefined,
    undefined,
    () => "native-1",
    async () => ({
      outcome: allowed
        ? { outcome: "selected", optionId: "codez-allow-once" }
        : { outcome: "selected", optionId: "codez-reject-once" },
    }),
  );
  try {
    assert.equal(
      (await host.readTextFile({ sessionId: "native-1", path: file, line: 2, limit: 1 })).content,
      "two\n",
    );
    await assert.rejects(
      host.readTextFile({ sessionId: "wrong", path: file }),
      /identity mismatch/,
    );
    await assert.rejects(
      host.readTextFile({ sessionId: "native-1", path: outside }),
      /outside the workspace/,
    );
    await assert.rejects(
      host.readTextFile({ sessionId: "native-1", path: join(workspace, "escape.txt") }),
      /outside the workspace/,
    );
    await assert.rejects(
      host.writeTextFile({ sessionId: "native-1", path: file, content: "blocked" }),
      /denied/,
    );
    assert.equal(await readFile(file, "utf8"), "one\ntwo\nthree\n");
    allowed = true;
    await host.writeTextFile({ sessionId: "native-1", path: file, content: "updated" });
    assert.equal(await readFile(file, "utf8"), "updated");
    await assert.rejects(
      host.writeTextFile({
        sessionId: "native-1",
        path: join(workspace, "escape.txt"),
        content: "bad",
      }),
      /symlink/,
    );
    const { terminalId } = await host.createTerminal({
      sessionId: "native-1",
      command: process.execPath,
      args: ["-e", "process.stdout.write('ok')"],
      cwd: workspace,
    });
    const exited = await host.waitForTerminalExit({ sessionId: "native-1", terminalId });
    assert.equal(exited.exitCode, 0);
    assert.equal((await host.terminalOutput({ sessionId: "native-1", terminalId })).output, "ok");
    await host.releaseTerminal({ sessionId: "native-1", terminalId });
    await assert.rejects(
      host.createTerminal({ sessionId: "native-1", command: process.execPath, cwd: root }),
      /outside the workspace/,
    );
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});
