import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, type TestContext } from "node:test";
import { extractFeature, ExtractionRefusal } from "../src/feature-extraction/index.js";

function fixture(t: TestContext, files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-transplant-extraction-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "donor");
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(sourceRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const options = { sourceRoot, entryFile: "entry.ts", exportName: "parse", outDir: path.join(root, "capsule") };
  return { root, sourceRoot, options };
}

test("extracts a symbol closure with type edges, pruning unrelated declarations and imports", t => {
  const { options } = fixture(t, {
    "entry.ts": 'import { normalize, unused } from "./helper.js";\nimport type { Options } from "./helper.js";\nexport function parse(input: string, options?: Options) { return normalize(input) + (options?.suffix ?? ""); }\nexport function irrelevant() { return unused(); }\n',
    "helper.ts": 'const PREFIX = "value:";\nexport interface Options { suffix?: string }\nexport interface UnusedOptions { unrelated: number }\nexport function normalize(input: string) { return PREFIX + input.trim(); }\nexport function unused() { return "unrelated"; }\n',
  });
  const manifest = extractFeature(options);
  assert.deepEqual(manifest.files.map(file => file.path), ["entry.ts", "helper.ts"]);
  assert.equal(manifest.schema, "code-transplant.capsule.v1");
  const output = fs.readFileSync(path.join(options.outDir, "src", "helper.ts"), "utf8");
  assert.match(output, /function normalize/);
  assert.match(output, /interface Options/);
  assert.doesNotMatch(output, /UnusedOptions|function unused|unrelated/);
  const entry = fs.readFileSync(path.join(options.outDir, "src", "entry.ts"), "utf8");
  assert.match(entry, /\.\/helper\.js/);
  assert.doesNotMatch(entry, /irrelevant|unused/);
  const optionSymbol = manifest.symbols.find(symbol => symbol.name === "Options")!;
  assert.ok(manifest.edges.some(edge => edge.to === optionSymbol.id && edge.kind === "type"));
  assert.equal(new Set(manifest.symbols.map(symbol => symbol.id)).size, manifest.symbols.length);
  for (const edge of manifest.edges) {
    assert.ok(manifest.symbols.some(symbol => symbol.id === edge.from));
    assert.ok(manifest.symbols.some(symbol => symbol.id === edge.to));
  }
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(options.outDir, "src", file.path));
    assert.equal(file.outputSha256, createHash("sha256").update(bytes).digest("hex"));
  }
});

test("preserves a selected named re-export chain and prunes sibling exports", t => {
  const { options } = fixture(t, {
    "entry.ts": 'export { parser as parse } from "./barrel.js";',
    "barrel.ts": 'export { decode as parser, unrelated } from "./core.js";',
    "core.ts": 'export function decode(input: string) { return Number(input); }\nexport function unrelated() { return 0; }',
  });
  const manifest = extractFeature(options);
  assert.deepEqual(manifest.files.map(file => file.path), ["barrel.ts", "core.ts", "entry.ts"]);
  assert.match(fs.readFileSync(path.join(options.outDir, "src", "barrel.ts"), "utf8"), /decode as parser/);
  assert.doesNotMatch(fs.readFileSync(path.join(options.outDir, "src", "core.ts"), "utf8"), /unrelated/);
});

test("manifest hashes and output are reproducible across destination paths", t => {
  const { root, options } = fixture(t, { "entry.ts": 'const base = 3; export function parse(input: string) { return Number(input) + base; }' });
  const first = extractFeature(options);
  const second = extractFeature({ ...options, outDir: path.join(root, "second-capsule") });
  assert.deepEqual(second, first);
  assert.ok(!JSON.stringify(first).includes(root));
  const { digest, ...base } = first;
  assert.equal(digest, createHash("sha256").update(JSON.stringify(base)).digest("hex"));
});

test("retains source license banners when their original declaration is pruned", t => {
  const { options } = fixture(t, { "entry.ts": '/*! Copyright Acme. SPDX-License-Identifier: MIT */\nexport function unused() { return 0; }\nexport function parse(input: string) { return input; }' });
  extractFeature(options);
  assert.match(fs.readFileSync(path.join(options.outDir, "src", "entry.ts"), "utf8"), /Copyright Acme\. SPDX-License-Identifier: MIT/);
});

test("copies donor license and binds its bytes to provenance and capsule digest", t => {
  const { root, options } = fixture(t, { "entry.ts": 'export function parse(input: string) { return input; }' });
  const licenseFile = path.join(root, "LICENSE");
  fs.writeFileSync(licenseFile, "Donor license A\n");
  const provenance = { repository: "https://example.test/donor", revision: "abc123", licenseFile };
  const first = extractFeature({ ...options, provenance });
  assert.equal(fs.readFileSync(path.join(options.outDir, "LICENSE"), "utf8"), "Donor license A\n");
  assert.equal(first.provenance?.licenseFile, "LICENSE");
  assert.equal(first.provenance?.licenseSha256, createHash("sha256").update("Donor license A\n").digest("hex"));
  fs.writeFileSync(licenseFile, "Donor license B\n");
  const second = extractFeature({ ...options, outDir: path.join(root, "second"), provenance });
  assert.notEqual(second.digest, first.digest);
});

const refusals: [string, string, string][] = [
  ["unknown package", 'import { missing } from "some-package"; export function parse(input: string) { return input; }', "EXTERNAL_DEPENDENCY"],
  ["unresolved local dependency", 'import { missing } from "./missing.js"; export function parse(input: string) { return input; }', "UNRESOLVED_IMPORT"],
  ["dynamic import", 'export function parse(input: string) { return import(input); }', "DYNAMIC_CODE"],
  ["eval", 'export function parse(input: string) { return eval(input); }', "DYNAMIC_CODE"],
  ["dynamic function", 'export function parse(input: string) { return new Function(input); }', "DYNAMIC_CODE"],
  ["top-level effect", 'Number("1"); export function parse(input: string) { return input; }', "TOP_LEVEL_EFFECT"],
  ["effectful initializer", 'const now = Date.now(); export function parse(input: string) { return input + now; }', "TOP_LEVEL_EFFECT"],
  ["unresolved initializer read", 'const crash = unknownIdentifier; export function parse(input: string) { return input; }', "TOP_LEVEL_EFFECT"],
  ["temporal dead zone initializer", 'const crash = later; const later = 1; export function parse(input: string) { return input; }', "TOP_LEVEL_EFFECT"],
  ["custom object coercion initializer", 'const custom = { valueOf: () => 5 }; const hidden = Math.pow(custom as any, 2); export function parse(input: string) { return input; }', "TOP_LEVEL_EFFECT"],
  ["mutable module binding", 'let counter = 0; export function parse(input: string) { return input; }', "MUTABLE_MODULE_GLOBAL"],
  ["mutable module object", 'const state = { count: 0 }; export function parse(input: string) { return ++state.count; }', "MUTABLE_MODULE_GLOBAL"],
  ["mutable module array", 'const state: string[] = []; export function parse(input: string) { state.push(input); return state.length; }', "MUTABLE_MODULE_GLOBAL"],
  ["module object alias", 'const state: string[] = []; export function parse(input: string) { const local = state; local.push(input); return local.length; }', "MODULE_STATE_ESCAPE"],
  ["module object passed to helper", 'const state: string[] = []; function update(s: string[], input: string) { s.push(input); return s.length; } export function parse(input: string) { return update(state, input); }', "MODULE_STATE_ESCAPE"],
  ["stateful regex", 'const pattern = /a/g; export function parse(input: string) { return pattern.test(input); }', "MUTABLE_MODULE_GLOBAL"],
  ["ambient process", 'export function parse(input: string) { return process.env.TZ + input; }', "AMBIENT_DEPENDENCY"],
  ["pruned capsule type error", 'export function parse(input: string): number { return input; }', "CAPSULE_TYPECHECK"],
];
for (const [name, source, code] of refusals) {
  test(`refuses ${name} without producing a capsule`, t => {
    const { options } = fixture(t, { "entry.ts": source });
    assert.throws(() => extractFeature(options), error => error instanceof ExtractionRefusal && error.code === code);
    assert.equal(fs.existsSync(options.outDir), false);
  });
}

test("unrelated dynamic functions are pruned without being executed", t => {
  const { options } = fixture(t, { "entry.ts": 'export function unused(input: string) { return eval(input); } export function parse(input: string) { return input.trim(); }' });
  extractFeature(options);
  assert.doesNotMatch(fs.readFileSync(path.join(options.outDir, "src", "entry.ts"), "utf8"), /eval|unused/);
});

test("read-only table lookups and ordinary regex remain supported", t => {
  const { options } = fixture(t, { "entry.ts": 'const table = [2, 3]; const pattern = /^x$/; export function parse(input: string) { return pattern.test(input) ? table[0] : table[1]; }' });
  const result = extractFeature(options);
  assert.deepEqual(result.files[0].selectedSymbols, ["parse", "pattern", "table"]);
});

test("rejects effects in an imported donor module even when the affected export is unused", t => {
  const { options } = fixture(t, {
    "entry.ts": 'import { helper } from "./helper.js"; export function parse(input: string) { return helper(input); }',
    "helper.ts": 'export function helper(input: string) { return input; } Number("42");',
  });
  assert.throws(() => extractFeature(options), error => error instanceof ExtractionRefusal && error.code === "TOP_LEVEL_EFFECT");
});

test("refuses an output inside the donor and never overwrites existing output", t => {
  const { sourceRoot, options } = fixture(t, { "entry.ts": 'export function parse(input: string) { return input; }' });
  assert.throws(() => extractFeature({ ...options, outDir: path.join(sourceRoot, "capsule") }), error => error instanceof ExtractionRefusal && error.code === "OUTPUT_OVERLAP");
  fs.mkdirSync(options.outDir);
  fs.writeFileSync(path.join(options.outDir, "keep.txt"), "retain");
  assert.throws(() => extractFeature(options), error => error instanceof ExtractionRefusal && error.code === "OUTPUT_EXISTS");
  assert.equal(fs.readFileSync(path.join(options.outDir, "keep.txt"), "utf8"), "retain");
});

test("rejects entry and dependency symlinks escaping the declared donor root", t => {
  const { root, sourceRoot, options } = fixture(t, { "entry.ts": 'export function parse(input: string) { return input; }' });
  const outside = path.join(root, "outside.ts");
  fs.writeFileSync(outside, 'export function helper(input: string) { return input; }');
  fs.symlinkSync(outside, path.join(sourceRoot, "escaped.ts"));
  assert.throws(() => extractFeature({ ...options, entryFile: "escaped.ts" }), error => error instanceof ExtractionRefusal && error.code === "PATH_ESCAPE");
  fs.writeFileSync(path.join(sourceRoot, "entry.ts"), 'import { helper } from "./escaped.js"; export function parse(input: string) { return helper(input); }');
  assert.throws(() => extractFeature(options), error => error instanceof ExtractionRefusal && error.code === "PATH_ESCAPE");
});

test("never overwrites a dangling output symlink", t => {
  const { root, options } = fixture(t, { "entry.ts": 'export function parse(input: string) { return input; }' });
  const target = path.join(root, "missing-output-target");
  fs.symlinkSync(target, options.outDir);
  assert.throws(() => extractFeature(options), error => error instanceof ExtractionRefusal && error.code === "OUTPUT_EXISTS");
  assert.equal(fs.lstatSync(options.outDir).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(options.outDir), target);
});

test("rejects a source-root escape through entry traversal", t => {
  const { options } = fixture(t, { "entry.ts": 'export function parse(input: string) { return input; }' });
  assert.throws(() => extractFeature({ ...options, entryFile: "../outside.ts" }), error => error instanceof ExtractionRefusal && error.code === "PATH_ESCAPE");
});
