/** 日志管道与 Host 服务 IPC 独立；管道关闭不应终止仍可用的会话进程。 */
export function ignoreBrokenHostLogPipes(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
  }
}
