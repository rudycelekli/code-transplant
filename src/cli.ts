#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractFeature } from './feature-extraction/index.js';
import { verifyBehavior, verifyReport } from './behavior-verification/index.js';
import { runDemo } from './demo.js';

const usage = `Code Transplant · Gradia

  code-transplant extract <source-root> <entry-file> <export-name> <out-dir>
  code-transplant check <contract.json>
  code-transplant verify <report.json>
  code-transplant demo [project-root]

Extraction reads TypeScript without executing it. Check executes the trusted
commands declared in the JSON contract. Subprocesses are not security sandboxes.
See README.md for the contract and supported extraction boundary.`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(usage);
    return;
  }
  if (command === 'extract' && args.length === 4) {
    const [sourceRoot, entryFile, exportName, outDir] = args;
    const manifest = extractFeature({ sourceRoot, entryFile, exportName, outDir });
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  if (command === 'demo' && args.length <= 1) {
    const { receipt, report } = await runDemo(resolve(args[0] ?? process.cwd()));
    console.log(JSON.stringify(receipt, null, 2));
    if (report.verdict !== 'VERIFIED') process.exitCode = 1;
    return;
  }
  if (command === 'check' && args.length === 1) {
    const contract = JSON.parse(readFileSync(resolve(args[0]), 'utf8'));
    const report = await verifyBehavior(contract);
    console.log(JSON.stringify(report, null, 2));
    if (report.verdict !== 'VERIFIED') process.exitCode = 1;
    return;
  }
  if (command === 'verify' && args.length === 1) {
    const result = verifyReport(JSON.parse(readFileSync(resolve(args[0]), 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    return;
  }
  throw new Error(`Invalid command or arguments.\n${usage}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
