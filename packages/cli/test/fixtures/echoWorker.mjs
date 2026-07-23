import { parentPort } from "node:worker_threads";
parentPort.on("message", ({ index, job }) => {
  if (job.crash) { process.exit(1); }
  if (job.fail) { throw new Error(`boom ${index}`); }
  if (job.silent) { process.exit(0); }
  if (job.wrongIndex) { parentPort.postMessage({ index: index + 1000, result: { doubled: job.n * 2 } }); return; }
  parentPort.postMessage({ index, result: { doubled: job.n * 2 } });
});
