type ZoomInput = { type: string; key: string; control: boolean; meta: boolean; alt: boolean };

/** Session-only view scaling; document data and optimization settings are untouched. */
export function zoomFactorForInput(current: number, input: ZoomInput): number | undefined {
  if (input.type !== "keyDown" || input.alt || (!input.control && !input.meta)) return undefined;
  if (input.key === "0") return 1;
  const direction = ["+", "=", "Add"].includes(input.key) ? 1 : ["-", "Subtract"].includes(input.key) ? -1 : 0;
  if (!direction) return undefined;
  return Math.max(0.75, Math.min(2.25, Math.round(current * 4 + direction) / 4));
}
