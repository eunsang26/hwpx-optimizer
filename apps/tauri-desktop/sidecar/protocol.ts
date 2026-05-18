export type SidecarRequest = {
  id: number;
  method: string;
  params?: unknown;
};

export type SidecarResponse =
  | {
      id: number;
      ok: true;
      result: unknown;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

export type SidecarEvent = {
  id: number;
  event: "progress";
  progress: { percent: number; item: string };
};

export function parseSidecarRequest(line: string): SidecarRequest {
  const parsed = JSON.parse(line) as Partial<SidecarRequest>;
  if (typeof parsed.id !== "number" || !Number.isSafeInteger(parsed.id) || parsed.id < 0) {
    throw new Error("Invalid sidecar request: id must be a non-negative safe integer.");
  }
  const id = parsed.id;
  if (typeof parsed.method !== "string" || parsed.method.length === 0) {
    throw new Error("Invalid sidecar request: method must be a non-empty string.");
  }
  return { id, method: parsed.method, params: parsed.params };
}

export function serializeSidecarResponse(response: SidecarResponse): string {
  return `${JSON.stringify(response)}\n`;
}

export function serializeSidecarEvent(event: SidecarEvent): string {
  return `${JSON.stringify(event)}\n`;
}
