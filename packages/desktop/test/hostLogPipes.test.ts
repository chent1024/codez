import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const modulePath = fileURLToPath(new URL("../src/host/hostLogPipes.ts", import.meta.url));

for (const streamName of ["stdout", "stderr"] as const) {
  test(`Host IPC remains alive after ${streamName} log pipe closes`, async () => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { ignoreBrokenHostLogPipes } from ${JSON.stringify(modulePath)};
         ignoreBrokenHostLogPipes();
         process.on('message', () => {
           process.${streamName}.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
           process.send?.('alive');
         });
         process.send?.('ready');`,
      ],
      { stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Host did not start")), 5_000);
        child.once("message", (message) => {
          clearTimeout(timeout);
          assert.equal(message, "ready");
          resolve();
        });
        child.once("exit", (code) => reject(new Error(`Host exited before ready: ${code}`)));
      });
      child[streamName]?.destroy();
      child.send("write");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Host IPC stopped after EPIPE")), 5_000);
        child.once("message", (message) => {
          clearTimeout(timeout);
          assert.equal(message, "alive");
          resolve();
        });
        child.once("exit", (code) => reject(new Error(`Host exited after EPIPE: ${code}`)));
      });
    } finally {
      child.kill();
    }
  });
}
