import { parentPort } from "node:worker_threads";
parentPort.on("message", ({ index, job }) => {
  const counts = new Int32Array(job.counts);
  const active = Atomics.add(counts, 0, 1) + 1;
  let peak = Atomics.load(counts, 1);
  while (peak < active) { const previous = Atomics.compareExchange(counts, 1, peak, active); if (previous === peak) break; peak = previous; }
  setTimeout(() => { Atomics.sub(counts, 0, 1); parentPort.postMessage({ index, result: true }); }, 80);
});
