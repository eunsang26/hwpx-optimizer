export type HwpxEntryKind = "xml" | "image" | "font" | "ole" | "bindata" | "other";

export type HwpxEntry = {
  path: string;
  data: Buffer;
  size: number;
  kind: HwpxEntryKind;
};

export type HwpxPackage = {
  entries: HwpxEntry[];
};

export type ImageInventoryItem = {
  path: string;
  size: number;
  format: string;
  width?: number;
  height?: number;
  hasMetadata: boolean;
  isBmpCandidate: boolean;
};

export type PackageAnalysis = {
  totalSize: number;
  entriesByKind: Record<HwpxEntryKind, number>;
  images: ImageInventoryItem[];
};

export type ResourceReference = {
  path: string;
  referenced: boolean;
  refs: string[];
};

export type ReferenceGraph = {
  resources: Map<string, ResourceReference>;
  missingReferences: string[];
};

export type OptimizationAction =
  | { type: "minify-xml"; target: string; risk: "safe" }
  | { type: "strip-metadata"; target: string; risk: "safe" }
  | { type: "convert-bmp-to-png"; target: string; risk: "medium"; outputPath: string }
  | { type: "resize-jpeg"; target: string; risk: "medium" }
  | { type: "remove-unused"; target: string; risk: "safe" }
  | { type: "repack-zip"; target: "*"; risk: "safe" };

export type OptimizationPlan = {
  mode: "safe" | "balanced";
  actions: OptimizationAction[];
};

export type OptimizationOpportunity = {
  id: string;
  label: string;
  action: "strip-metadata" | "convert-bmp-to-png" | "resize-jpeg" | "optimize-png" | "clean-shape-comment";
  target: string;
  estimatedSavingBytes: number;
  beforeSize: number;
  afterSize: number;
  confidence: "exact" | "estimated";
  risk: "safe" | "medium" | "high";
  visualImpact: "none" | "low" | "medium" | "high";
  defaultEnabledIn: Array<"safe" | "balanced" | "aggressive">;
};

export type AppliedAction = {
  type: OptimizationAction["type"];
  target: string;
  beforeSize?: number;
  afterSize?: number;
};

export type OptimizationReport = {
  originalSize: number;
  optimizedSize?: number;
  savedBytes?: number;
  savedPercent?: number;
  images: ImageInventoryItem[];
  actions: {
    planned: OptimizationAction[];
    applied: AppliedAction[];
    skipped: AppliedAction[];
  };
  opportunities: OptimizationOpportunity[];
  warnings: string[];
};
