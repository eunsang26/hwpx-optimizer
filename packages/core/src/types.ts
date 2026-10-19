export type HwpxEntryKind = "xml" | "image" | "font" | "ole" | "bindata" | "other";

export type HwpxEntry = {
  path: string;
  data: Buffer;
  size: number;
  kind: HwpxEntryKind;
  /** Original ZIP payload bytes; absent for newly constructed entries. */
  compressedSize?: number;
};

export type HwpxPackage = {
  entries: HwpxEntry[];
  /** Byte length of the source archive, including headers and comments. */
  sourceSize?: number;
};

export type ImageInventoryItem = {
  path: string;
  size: number;
  format: string;
  width?: number;
  height?: number;
  hasMetadata: boolean;
  preservationReason?: string;
  isBmpCandidate: boolean;
  displayRefs: ImageDisplayReference[];
  largestDisplay?: ImageDisplaySummary;
  oversizeRatio?: number;
};

export type ImageDisplayReference = {
  sourceXml: string;
  binaryItemIDRef: string;
  widthHwpUnit: number;
  heightHwpUnit: number;
  widthPx96: number;
  heightPx96: number;
};

export type ImageDisplaySummary = ImageDisplayReference & {
  recommendedWidthPx: number;
  recommendedHeightPx: number;
};

export type PackageAnalysis = {
  totalSize: number;
  entriesByKind: Record<HwpxEntryKind, number>;
  categorySizes: Record<HwpxEntryKind, number>;
  images: ImageInventoryItem[];
  duplicateImages: DuplicateImageGroup[];
  sameVisualDuplicateImages: DuplicateImageGroup[];
  nearDuplicateImages?: NearDuplicateImageGroup[];
  unusedBinData: UnusedResource[];
  riskyResources: RiskyResource[];
  resourceDiagnostics?: ResourceDiagnostic[];
  referenceGraph?: ReferenceGraph;
};

export type DuplicateImageGroup = {
  hash: string;
  paths: string[];
  count: number;
  totalBytes: number;
  wastedBytes: number;
};

export type NearDuplicateImageGroup = DuplicateImageGroup & {
  maxDistance: number;
  reason: string;
};

export type UnusedResource = {
  path: string;
  kind: HwpxEntryKind;
  size: number;
};

export type RiskyResource = {
  path: string;
  kind: "font" | "ole";
  size: number;
  reason: string;
};

export type ResourceDiagnostic = {
  type: "large-font" | "duplicate-font" | "large-ole" | "ole-size-share";
  kind: "font" | "ole";
  paths: string[];
  sizeBytes: number;
  reason: string;
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
  | { type: "resize-png"; target: string; risk: "medium" }
  | { type: "convert-tiff-to-png"; target: string; risk: "medium"; outputPath: string }
  | { type: "optimize-png"; target: string; risk: "safe" }
  | { type: "clean-shape-comment"; target: string; risk: "safe" }
  | { type: "consolidate-duplicate-images"; target: string; risk: "medium" }
  | { type: "remove-unused"; target: string; risk: "safe" }
  | { type: "repack-zip"; target: "*"; risk: "safe" };

export type OptimizationPlan = {
  mode: "safe" | "balanced" | "aggressive";
  actions: OptimizationAction[];
};

export type OptimizationOpportunity = {
  id: string;
  label: string;
  action:
    | "minify-xml"
    | "remove-unused"
    | "strip-metadata"
    | "convert-bmp-to-png"
    | "resize-jpeg"
    | "resize-png"
    | "convert-tiff-to-png"
    | "optimize-png"
    | "clean-shape-comment"
    | "consolidate-duplicate-images";
  target: string;
  estimatedSavingBytes: number;
  beforeSize: number;
  afterSize: number;
  /** Measured DEFLATE level-9 bytes of an encoded candidate, not final archive bytes. */
  compressedAfterSize?: number;
  confidence: "exact" | "estimated";
  risk: "safe" | "medium" | "high";
  visualImpact: "none" | "low" | "medium" | "high";
  defaultEnabledIn: Array<"safe" | "balanced" | "aggressive">;
};

export type OptimizationOpportunityGroup = {
  action: OptimizationOpportunity["action"];
  label: string;
  count: number;
  estimatedSavingBytes: number;
  beforeSize: number;
  afterSize: number;
  confidence: OptimizationOpportunity["confidence"];
  risk: OptimizationOpportunity["risk"];
  visualImpact: OptimizationOpportunity["visualImpact"];
  defaultEnabledIn: Array<"safe" | "balanced" | "aggressive">;
  targets: string[];
};

export type AppliedAction = {
  type: OptimizationAction["type"];
  target: string;
  beforeSize?: number;
  afterSize?: number;
  /** Actual resource destination after conversion/collision allocation or consolidation. */
  outputPath?: string;
};

export type ResourceMapping = {
  originalPath: string;
  outputPath: string;
  originalId?: string;
  outputId?: string;
};

export type AnalysisMode = "quick" | "deep";
export type AnalysisCoverage = {
  mode: AnalysisMode;
  imageSizes: "estimated" | "encoded";
  visualDuplicatesChecked: boolean;
};

export type TargetStatus = "met" | "missed" | "already-under-target";
export type PackageSizeEstimate = {
  basis: "source-zip" | "entry-model";
  originalSize: number;
  minimumSize: number;
  adjustments: Array<{ target: string; action: OptimizationOpportunity["action"]; savingBytes: number; jpegBytes: number }>;
};

export type OptimizationReport = {
  /** Missing only on legacy reports. New reports always declare their phase. */
  kind?: "analysis" | "optimization";
  estimatedSize?: number;
  estimatedSavingBytes?: number;
  estimatedSavingPercent?: number;
  estimatedTargetStatus?: TargetStatus;
  estimates?: Record<"safe" | "balanced" | "aggressive", PackageSizeEstimate>;
  /** Analysis work actually performed; absent on older and optimization reports. */
  analysis?: AnalysisCoverage;
  /** Surviving image identities in the returned output, including duplicate aliases. */
  resourceMappings?: ResourceMapping[];
  originalSize: number;
  optimizedSize?: number;
  savedBytes?: number;
  savedPercent?: number;
  targetBytes?: number;
  targetStatus?: TargetStatus;
  targetMissReason?: string;
  /** Planned/applied JPEG quality (1–100) when advanced image compress ran. */
  plannedJpegQuality?: number;
  categorySizes: Record<HwpxEntryKind, number>;
  images: ImageInventoryItem[];
  duplicateImages: DuplicateImageGroup[];
  sameVisualDuplicateImages: DuplicateImageGroup[];
  nearDuplicateImages?: NearDuplicateImageGroup[];
  unusedBinData: UnusedResource[];
  riskyResources: RiskyResource[];
  resourceDiagnostics?: ResourceDiagnostic[];
  actions: {
    planned: OptimizationAction[];
    applied: AppliedAction[];
    skipped: AppliedAction[];
  };
  opportunities: OptimizationOpportunity[];
  opportunityGroups: OptimizationOpportunityGroup[];
  /**
   * ZIP-aware package size projection for aggressive/auto floor quality.
   * Present on analysis reports; candidate sizes can be estimated or measured.
   */
  aggressiveProjectedOptimizedSize?: number;
  warnings: string[];
  performance?: PerformanceSummary;
};

export type PerformanceStage = {
  name: string;
  durationMs: number;
};

export type PerformanceSummary = {
  totalMs: number;
  stages: PerformanceStage[];
};

/** Analysis cannot contain measured output fields or an actual submission verdict. */
export type AnalysisReport = Omit<OptimizationReport,
  "kind" | "optimizedSize" | "savedBytes" | "savedPercent" | "targetStatus" | "targetMissReason"
> & {
  kind: "analysis";
  estimatedSize: number;
  estimatedSavingBytes: number;
  estimatedSavingPercent: number;
  optimizedSize?: never;
  savedBytes?: never;
  savedPercent?: never;
  targetStatus?: never;
  targetMissReason?: never;
};

export type CompletedOptimizationReport = Omit<OptimizationReport,
  "kind" | "optimizedSize" | "savedBytes" | "savedPercent" | "estimatedSize" | "estimatedSavingBytes" | "estimatedSavingPercent" | "estimatedTargetStatus" | "estimates"
> & {
  kind: "optimization";
  optimizedSize: number;
  savedBytes: number;
  savedPercent: number;
  estimatedSize?: never;
  estimatedSavingBytes?: never;
  estimatedSavingPercent?: never;
  estimatedTargetStatus?: never;
  estimates?: never;
};
