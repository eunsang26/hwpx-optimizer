/** Proportional target share for one file under aggregate batch mode. */
export function allocateAggregateTargetBytes(input: {
  batchTargetBytes: number;
  itemOriginalBytes: number;
  selectedOriginalTotal: number;
}): number | undefined {
  if (input.batchTargetBytes <= 0 || input.itemOriginalBytes <= 0 || input.selectedOriginalTotal <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor((input.batchTargetBytes * input.itemOriginalBytes) / input.selectedOriginalTotal));
}
