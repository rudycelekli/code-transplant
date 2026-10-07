export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Outcome = { kind: "value"; value: JsonValue } | { kind: "thrown"; name: string; message: string };
export interface TestCase { id: string; input: JsonValue; category?: string }
export interface CommandSpec { argv: string[]; cwd?: string; env?: Record<string, string> }
export interface Context { name: string; env: Record<string, string> }
export interface Control { name: string; command: CommandSpec }
export interface EvidenceBinding {
  contract?: JsonValue;
  capsuleDigest?: string;
  files?: { name: string; path: string }[];
}
export interface VerifyOptions {
  reference: CommandSpec;
  candidate: CommandSpec;
  cases: TestCase[];
  contexts?: Context[];
  controls?: Control[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxInputBytes?: number;
  outFile?: string;
  binding?: EvidenceBinding;
  /** Resolve relative command/evidence paths here; this machine-local path is not stored. */
  executionRoot?: string;
}
export interface Execution {
  command: CommandSpec;
  commandDigest: string;
  context: string;
  completed: boolean;
  outcomes: Record<string, Outcome>;
  error?: string;
}
export interface Mismatch {
  context: string;
  caseId: string;
  input: JsonValue;
  reference: Outcome;
  candidate: Outcome;
}
export interface ControlResult {
  name: string;
  detected: boolean;
  comparisons: number;
  mismatches: Mismatch[];
  executions: Execution[];
}
export interface VerificationReport {
  schema: "code-transplant.verification.v1";
  verdict: "VERIFIED" | "REFUSED";
  scope: "Finite corpus agreement; no universal equivalence claim";
  createdAt: string;
  runtime: { node: string; platform: string; arch: string; executable: "node resolves to verifier runtime" };
  cases: TestCase[];
  casesDigest: string;
  contexts: Context[];
  comparisons: number;
  mismatches: Mismatch[];
  executions: Execution[];
  controls: ControlResult[];
  failures: string[];
  binding: { contract?: JsonValue; capsuleDigest?: string; files: { name: string; path: string; sha256: string }[] };
  digest: string;
}
