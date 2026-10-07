export interface Provenance {
  repository: string;
  revision: string;
  /** Path supplied to extraction; manifests normalize this to LICENSE. */
  licenseFile: string;
  licenseSha256?: string;
}

export interface ExtractFeatureOptions {
  sourceRoot: string;
  entryFile: string;
  exportName: string;
  outDir: string;
  provenance?: Provenance;
}

export interface ExtractedFile {
  path: string;
  sourceSha256: string;
  outputSha256: string;
  selectedSymbols: string[];
  sourceLines: number;
  outputLines: number;
}

export interface ExtractedSymbol {
  id: string;
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  kind: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "value" | "type";
}

export interface ArchitecturalAssumption {
  kind: string;
  detail: string;
  file?: string;
  line?: number;
}

export interface Manifest {
  schema: "code-transplant.capsule.v1";
  entry: { file: string; exportName: string };
  files: ExtractedFile[];
  symbols: ExtractedSymbol[];
  edges: DependencyEdge[];
  assumptions: ArchitecturalAssumption[];
  provenance?: Provenance;
  digest: string;
}

/** A refusal is a supported boundary, never an invitation to run the donor. */
export class ExtractionRefusal extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ExtractionRefusal";
  }
}
