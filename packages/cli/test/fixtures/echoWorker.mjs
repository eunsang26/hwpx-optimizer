import { parentPort } from "node:worker_threads";
parentPort.on("message", ({ index, job }) => {
  if (job.crash) { process.exit(1); }
  if (job.fail) { throw new Error(`boom ${index}`); }
  parentPort.postMessage({ index, result: { doubled: job.n * 2 } });
});
