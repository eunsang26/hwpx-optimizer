import type { ResourceMapping } from "@hwpx-optimizer/core";

export type DesktopImagePreviewInput = {
  originalPath: string;
  optimizedPath: string;
  maxItems?: number;
  maxInputBytes?: number;
  resourceMappings?: ResourceMapping[];
};
