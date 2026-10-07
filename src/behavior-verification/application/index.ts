import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalJson, hashJson, sha256 } from "../domain/index.js";
import type { Execution, Mismatch, VerificationReport, VerifyOptions } from "../domain/index.js";
import { isOutcome, runCommand } from "../infrastructure/run-command.js";
export * from "./corpus.js";

function compare(reference: Execution, candidate: Execution, cases: VerifyOptions["cases"]): { comparisons: number; mismatches: Mismatch[] } {
  if (!reference.completed || !candidate.completed) return { comparisons: 0, mismatches: [] };
  return { comparisons: cases.length, mismatches: cases.filter(test => canonicalJson(reference.outcomes[test.id]) !== canonicalJson(candidate.outcomes[test.id]))
    .map(test => ({ context: reference.context, caseId: test.id, input: test.input, reference: reference.outcomes[test.id], candidate: candidate.outcomes[test.id] })) };
}

export async function verifyBehavior(options: VerifyOptions): Promise<VerificationReport> {
  const contexts = options.contexts ?? [{ name: "default", env: {} }];
  if (options.cases.length === 0 || options.cases.length > 10000) throw new Error("Verification requires 1–10000 cases");
  const ids = options.cases.map(test => test.id);
  if (ids.some(id => !id || typeof id !== "string") || new Set(ids).size !== ids.length) throw new Error("Case ids must be unique, nonempty strings");
  if (contexts.length === 0 || contexts.length > 16 || contexts.some(context => typeof context.name !== "string" || !context.name) || new Set(contexts.map(context => context.name)).size !== contexts.length) throw new Error("Contexts must be unique and nonempty (maximum 16)");
  const controls = options.controls ?? [];
  if (controls.length > 16 || new Set(controls.map(control => control.name)).size !== controls.length) throw new Error("Controls must have unique names (maximum 16)");
  canonicalJson(options.cases);
  const limits = { timeoutMs: options.timeoutMs ?? 10000, maxOutputBytes: options.maxOutputBytes ?? 4 * 1024 * 1024, maxInputBytes: options.maxInputBytes ?? 1024 * 1024 };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error("Limits must be positive integers");
  const report: VerificationReport = { schema: "code-transplant.verification.v1", verdict: "REFUSED", scope: "Finite corpus agreement; no universal equivalence claim", createdAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, executable: "node resolves to verifier runtime" },
    cases: options.cases, casesDigest: hashJson(options.cases), contexts, comparisons: 0, mismatches: [], executions: [], controls: [], failures: [],
    binding: { ...(options.binding?.contract !== undefined ? { contract: options.binding.contract } : {}), ...(options.binding?.capsuleDigest ? { capsuleDigest: options.binding.capsuleDigest } : {}), files: [] }, digest: "" };
  for (const file of options.binding?.files ?? []) {
    try { report.binding.files.push({ ...file, sha256: sha256(await readFile(resolve(options.executionRoot ?? process.cwd(), file.path))) }); }
    catch { report.failures.push("Unavailable evidence binding: " + file.name); }
  }
  for (const control of controls) report.controls.push({ name: control.name, detected: false, comparisons: 0, mismatches: [], executions: [] });
  for (const context of contexts) {
    const [reference, candidate, ...mutants] = await Promise.all([options.reference, options.candidate, ...controls.map(control => control.command)].map(command => runCommand(command, options.cases, context, limits, options.executionRoot)));
    report.executions.push(reference, candidate);
    for (const execution of [reference, candidate]) if (!execution.completed) report.failures.push(`${context.name}: ${execution.error}`);
    const comparison = compare(reference, candidate, options.cases);
    report.comparisons += comparison.comparisons; report.mismatches.push(...comparison.mismatches);
    mutants.forEach((mutant, i) => {
      const comparison = compare(reference, mutant, options.cases), control = report.controls[i];
      control.executions.push(mutant); control.comparisons += comparison.comparisons; control.mismatches.push(...comparison.mismatches);
      if (!mutant.completed) report.failures.push(`${context.name}: control ${control.name}: ${mutant.error}`);
    });
  }
  for (const control of report.controls) {
    control.detected = control.mismatches.length > 0 && control.executions.every(execution => execution.completed);
    if (!control.detected) report.failures.push("Negative control was not detected: " + control.name);
  }
  for (const file of report.binding.files) {
    try { if (sha256(await readFile(resolve(options.executionRoot ?? process.cwd(), file.path))) !== file.sha256) report.failures.push("Evidence changed during verification: " + file.name); }
    catch { report.failures.push("Evidence disappeared during verification: " + file.name); }
  }
  if (report.failures.length === 0 && report.mismatches.length === 0 && report.comparisons === options.cases.length * contexts.length) report.verdict = "VERIFIED";
  const { digest: _, ...unsigned } = report; report.digest = hashJson(unsigned);
  if (options.outFile) { await mkdir(dirname(options.outFile), { recursive: true }); await writeFile(options.outFile, JSON.stringify(report, null, 2) + "\n"); }
  return report;
}

/** Checks consistency and accidental/tamper changes. An unkeyed digest is not a signature. */
export function verifyReport(value: unknown): { valid: boolean; reason?: string } {
  try {
    const report = value as VerificationReport;
    if (!report || report.schema !== "code-transplant.verification.v1" || !["VERIFIED", "REFUSED"].includes(report.verdict)) throw new Error("Unsupported report schema or verdict");
    const { digest, ...unsigned } = report;
    if (hashJson(unsigned) !== digest) throw new Error("Report digest mismatch");
    if (hashJson(report.cases) !== report.casesDigest || report.cases.length === 0) throw new Error("Case evidence mismatch");
    if (report.cases.some(test => typeof test.id !== "string" || !test.id) || report.contexts.some(context => typeof context.name !== "string" || !context.name) || new Set(report.cases.map(test => test.id)).size !== report.cases.length || new Set(report.contexts.map(context => context.name)).size !== report.contexts.length) throw new Error("Duplicate or empty evidence identifiers");
    if (new Set(report.controls.map(control => control.name)).size !== report.controls.length) throw new Error("Duplicate control names");
    const ids = new Set(report.cases.map(test => test.id));
    for (const execution of [...report.executions, ...report.controls.flatMap(control => control.executions)]) {
      if (hashJson(execution.command) !== execution.commandDigest) throw new Error("Command digest mismatch");
      if (!report.contexts.some(context => context.name === execution.context)) throw new Error("Unknown execution context");
      if (Object.entries(execution.outcomes).some(([id, outcome]) => !ids.has(id) || !isOutcome(outcome))) throw new Error("Invalid recorded outcome");
      if (execution.completed && (execution.error !== undefined || Object.keys(execution.outcomes).length !== report.cases.length || report.cases.some(test => !Object.hasOwn(execution.outcomes, test.id)))) throw new Error("Incomplete execution marked complete");
    }
    let comparisons = 0; const mismatches: Mismatch[] = [];
    for (const context of report.contexts) {
      const executions = report.executions.filter(execution => execution.context === context.name);
      if (executions.length !== 2) throw new Error("Expected reference and candidate execution per context");
      for (const execution of executions) if (execution.completed && (Object.keys(execution.outcomes).length !== report.cases.length || report.cases.some(test => !Object.hasOwn(execution.outcomes, test.id)))) throw new Error("Incomplete execution marked complete");
      const result = compare(executions[0], executions[1], report.cases); comparisons += result.comparisons; mismatches.push(...result.mismatches);
    }
    if (report.comparisons !== comparisons || canonicalJson(report.mismatches) !== canonicalJson(mismatches)) throw new Error("Comparison evidence mismatch");
    for (const control of report.controls) {
      let comparisons = 0; const mismatches: Mismatch[] = [];
      if (control.executions.length !== report.contexts.length) throw new Error("Control context coverage mismatch");
      for (const context of report.contexts) {
        const executions = control.executions.filter(execution => execution.context === context.name);
        if (executions.length !== 1) throw new Error("Control context coverage mismatch");
        const reference = report.executions.filter(execution => execution.context === context.name)[0];
        const result = compare(reference, executions[0], report.cases); comparisons += result.comparisons; mismatches.push(...result.mismatches);
      }
      const detected = mismatches.length > 0 && control.executions.every(execution => execution.completed);
      if (control.comparisons !== comparisons || canonicalJson(control.mismatches) !== canonicalJson(mismatches) || control.detected !== detected) throw new Error("Control comparison evidence mismatch");
    }
    const validAgreement = report.contexts.length > 0 && report.comparisons === report.cases.length * report.contexts.length && report.mismatches.length === 0 && report.failures.length === 0 && report.executions.every(execution => execution.completed) && report.controls.every(control => control.detected && control.mismatches.length > 0 && control.executions.every(execution => execution.completed));
    if ((report.verdict === "VERIFIED") !== validAgreement) throw new Error("Verdict inconsistent with evidence");
    return { valid: true };
  } catch (error) { return { valid: false, reason: (error as Error).message }; }
}
