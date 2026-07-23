// Dev-mode worker bootstrap: worker_threads does not inherit the parent
// process's tsx/ESM loader hooks via execArgv (module.register() hooks are
// per-thread), so a worker spawned directly against optimizeWorker.ts fails
// to load with "Unknown file extension .ts". This plain .mjs entry point
// registers tsx's loader inside the worker's own realm first, then imports
// the real (TypeScript) worker module. It is only used when running from
// source (see resolveOptimizeWorkerUrl in index.ts) - built/packaged runs
// use dist/optimizeWorker.js directly and never load this file, so the
// tsx devDependency is never required at runtime in production.
import { register } from "tsx/esm/api";

register();
await import("./optimizeWorker.ts");
