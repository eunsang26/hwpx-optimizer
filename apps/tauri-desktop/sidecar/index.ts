import { createInterface } from "node:readline/promises";
import { handleCoreRequest } from "./desktopCore.js";
import { parseSidecarRequest, serializeSidecarEvent, serializeSidecarResponse } from "./protocol.js";

async function main(): Promise<void> {
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    if (line.trim().length === 0) continue;
    let id = 0;
    try {
      const request = parseSidecarRequest(line);
      id = request.id;
      const result = await handleCoreRequest(request.method, request.params, (progress) => {
        process.stdout.write(serializeSidecarEvent({ id, event: "progress", progress }));
      });
      process.stdout.write(serializeSidecarResponse({ id, ok: true, result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(serializeSidecarResponse({ id, ok: false, error: message }));
    }
  }
}

await main();
