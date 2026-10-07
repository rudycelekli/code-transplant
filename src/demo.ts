import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { extractFeature } from "./feature-extraction/index.js";
import { isoParserCorpus, sha256, verifyBehavior, verifyReport, type CommandSpec } from "./behavior-verification/index.js";

const repository = "https://github.com/date-fns/date-fns";
const revision = "313b902b9a72c64501074db9bc2b9897d2db5140";
async function files(root: string, extension: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async entry => entry.isDirectory() ? files(join(root, entry.name), extension) : entry.name.endsWith(extension) ? [join(root, entry.name)] : []));
  return paths.flat().sort();
}
async function compileTree(sourceRoot: string, outDir: string, nodeTypes = false) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "package.json"), '{"type":"module"}\n');
  const program = ts.createProgram(await files(sourceRoot, ".ts"), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    rootDir: sourceRoot, outDir, strict: true, skipLibCheck: true, noEmitOnError: true, types: nodeTypes ? ["node"] : [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: name => name, getNewLine: () => "\n" }));
  const result = program.emit();
  if (result.emitSkipped) throw new Error("Independent compilation failed");
}

export async function runDemo(root: string, outDir?: string) {
  root = resolve(root);
  const output = resolve(outDir ?? join(root, ".transplant/runs", randomUUID()));
  const donor = join(root, "examples/donor/date-fns");
  const donorRoot = join(donor, "src");
  const donorPaths = await files(donorRoot, ".ts");
  const provenance = JSON.parse(await readFile(join(donor, "provenance.json"), "utf8")) as { revision: string; files: { path: string; sha256: string }[] };
  if (provenance.revision !== revision) throw new Error("Donor revision differs from the declared proof");
  for (const file of provenance.files) if (sha256(await readFile(join(donor, file.path))) !== file.sha256) throw new Error("Donor provenance hash mismatch: " + file.path);
  const capsule = join(output, "capsule");
  extractFeature({ sourceRoot: donorRoot, entryFile: "parseISO/index.ts", exportName: "parseISO", outDir: capsule,
    provenance: { repository, revision, licenseFile: join(donor, "LICENSE") } });
  const capsuleRoot = join(capsule, "src");
  const capsulePaths = await files(capsuleRoot, ".ts");
  const originalOutput = join(output, "reference"), candidateOutput = join(output, "candidate"), hostOutput = join(output, "receiver");
  // Separate compiler programs: the oracle uses every untouched upstream module.
  await compileTree(donorRoot, originalOutput);
  await compileTree(capsuleRoot, candidateOutput);
  await compileTree(join(root, "examples/receiver"), hostOutput, true);
  const mutationOutput = join(output, "controls/offset-sign");
  await cp(candidateOutput, mutationOutput, { recursive: true });
  const mutationPath = join(mutationOutput, "parseISO/index.js");
  const pristine = await readFile(mutationPath, "utf8");
  const broken = pristine.replace('captures[1] === "+" ? -1 : 1', 'captures[1] === "+" ? 1 : -1');
  if (broken === pristine) throw new Error("Expected offset-sign mutation site was not found");
  await writeFile(mutationPath, broken);
  const worker = join(hostOutput, "worker.js");
  const command = (parser: string, mode?: string): CommandSpec => ({ argv: ["node", relative(root, worker), relative(root, parser), ...(mode ? [mode] : [])], cwd: "." });
  const reference = command(join(originalOutput, "parseISO/index.js"));
  const candidate = command(join(candidateOutput, "parseISO/index.js"));
  const contract = JSON.parse(await readFile(join(root, "examples/contracts/iso-parser.json"), "utf8"));
  const evidencePaths = [...donorPaths, ...capsulePaths, ...await files(join(root, "examples/receiver"), ".ts"), ...await files(join(root, "src"), ".ts"), ...await files(originalOutput, ".js"), ...await files(candidateOutput, ".js"), ...await files(hostOutput, ".js"), ...await files(mutationOutput, ".js"), join(capsule, "manifest.json"), join(donor, "LICENSE"), join(donor, "provenance.json"), join(root, "examples/contracts/iso-parser.json"), join(root, "package.json"), join(root, "package-lock.json")];
  const reportPath = join(output, "report.json");
  const manifest = JSON.parse(await readFile(join(capsule, "manifest.json"), "utf8")) as { digest: string };
  const report = await verifyBehavior({ reference, candidate, cases: isoParserCorpus(), executionRoot: root,
    contexts: [{ name: "UTC", env: { TZ: "UTC" } }, { name: "New_York", env: { TZ: "America/New_York" } }, { name: "Kathmandu", env: { TZ: "Asia/Kathmandu" } }],
    controls: [{ name: "offset-sign-corruption", command: command(mutationPath) }, { name: "invalid-date-collapse", command: command(join(candidateOutput, "parseISO/index.js"), "collapse-invalid") }],
    outFile: reportPath, binding: { contract, capsuleDigest: manifest.digest, files: evidencePaths.map(path => ({ name: relative(root, path), path: relative(root, path) })) } });
  const integrity = verifyReport(report);
  if (!integrity.valid) throw new Error("Produced report did not pass offline integrity: " + integrity.reason);
  const byteCount = async (paths: string[]) => (await Promise.all(paths.map(async path => (await readFile(path)).byteLength))).reduce((a, b) => a + b, 0);
  const donorBytes = await byteCount(donorPaths), capsuleBytes = await byteCount(capsulePaths);
  const receipt = { schema: "code-transplant.demo.v1", verdict: report.verdict, donor: { repository, revision },
    cases: report.cases.length, contexts: report.contexts.map(context => context.name), comparisons: report.comparisons, mismatches: report.mismatches.length,
    controls: report.controls.map(control => ({ name: control.name, detected: control.detected, mismatches: control.mismatches.length, example: control.mismatches[0] })),
    reduction: { donorFiles: donorPaths.length, capsuleFiles: capsulePaths.length, donorBytes, capsuleBytes, excludedBytes: donorBytes - capsuleBytes },
    receiver: { kind: "new audit-importer example", parserPort: contract.parserPort, donorPackageDependency: false, customDateContexts: "excluded" },
    runtime: { node: process.version, typescript: ts.version, platform: process.platform, arch: process.arch }, reportPath: relative(root, reportPath), capsulePath: relative(root, capsule), reportDigest: report.digest,
    scope: report.scope };
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  if (!outDir) {
    await cp(reportPath, join(root, ".transplant/report.json"));
    await cp(join(output, "receipt.json"), join(root, ".transplant/receipt.json"));
  }
  return { report, receipt };
}
