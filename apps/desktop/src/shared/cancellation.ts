export type CancellationResult = { cancelled: boolean; completed?: boolean; error?: string };

/** A queue-stop request alone does not make an individual file cancelled. */
export function isDocumentCancellation(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method.*?: (?:Error: )?/, "");
  return /^(?:Analysis|Optimization) cancelled\.$/.test(message) || /^(?:분석이|최적화가) 취소되었습니다\.$/.test(message);
}
