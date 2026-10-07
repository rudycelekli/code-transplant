import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyBehavior, verifyReport, hashJson, isoParserCorpus, type CommandSpec, type TestCase } from "../src/behavior-verification/index.js";

const cases: TestCase[] = [{ id: "one", input: { b: 2, a: 1 } }, { id: "__proto__", input: null }];
const worker = (body: string): CommandSpec => ({ argv: [process.execPath, "--input-type=module", "-e", `import {createInterface} from 'node:readline';for await(const line of createInterface({input:process.stdin})){const r=JSON.parse(line);${body}}`] });
const echo = worker(`console.log(JSON.stringify({id:r.id,outcome:{kind:'value',value:r.input}}));`);
const wrong = worker(`console.log(JSON.stringify({id:r.id,outcome:{kind:'value',value:'corrupted'}}));`);

test("finite agreement with semantic negative control and explicit context", async () => {
  const report = await verifyBehavior({ reference: echo, candidate: echo, cases,
    contexts: [{ name: "UTC", env: { TZ: "UTC" } }], controls: [{ name: "corrupted-value", command: wrong }] });
  assert.equal(report.verdict, "VERIFIED");
  assert.equal(report.comparisons, 2);
  assert.equal(report.controls[0].detected, true);
  assert.equal(report.controls[0].mismatches.length, 2);
  assert.equal(report.controls[0].mismatches[0].caseId, "one");
  assert.deepEqual(verifyReport(report), { valid: true });
});

test("canonical object order compares semantically and throws stay distinct from values", async () => {
  const reverse = worker(`const value=r.input&&typeof r.input==='object'?Object.fromEntries(Object.entries(r.input).reverse()):r.input;console.log(JSON.stringify({id:r.id,outcome:{kind:'value',value}}));`);
  assert.equal((await verifyBehavior({ reference: echo, candidate: reverse, cases })).verdict, "VERIFIED");
  const throws = worker(`console.log(JSON.stringify({id:r.id,outcome:{kind:'thrown',name:'TypeError',message:'invalid'}}));`);
  assert.equal((await verifyBehavior({ reference: throws, candidate: throws, cases })).verdict, "VERIFIED");
  const report = await verifyBehavior({ reference: echo, candidate: throws, cases });
  assert.equal(report.verdict, "REFUSED");
  assert.equal(report.mismatches.length, 2);
});

test("malformed, duplicate, unknown and incomplete responses cannot establish equivalence", async () => {
  const broken = [worker(`console.log('unstructured log');`),
    worker(`const row=JSON.stringify({id:r.id,outcome:{kind:'value',value:null}});console.log(row);console.log(row);`),
    worker(`console.log(JSON.stringify({id:'unknown',outcome:{kind:'value',value:null}}));`),
    worker(`if(r.id==='one')console.log(JSON.stringify({id:r.id,outcome:{kind:'value',value:null}}));`),
    worker(`console.log(JSON.stringify({id:r.id,outcome:{kind:'value'}}));`)];
  for (const command of broken) {
    const report = await verifyBehavior({ reference: command, candidate: command, cases });
    assert.equal(report.verdict, "REFUSED");
    assert.equal(report.comparisons, 0);
    assert.ok(report.failures.length > 0);
    assert.equal(verifyReport(report).valid, true);
  }
});

test("process failures and time/output/input limits refuse even when both sides fail alike", async () => {
  const commands = [
    { command: { argv: [process.execPath, "-e", "process.exit(1)"] }, timeoutMs: 1000 },
    { command: { argv: [process.execPath, "-e", "setInterval(()=>{},1000)"] }, timeoutMs: 200 },
    { command: { argv: [process.execPath, "-e", "console.log('x'.repeat(10000))"] }, maxOutputBytes: 100 },
    { command: echo, maxInputBytes: 1 },
    { command: { argv: ["/definitely/missing/code-transplant-command"] } },
  ];
  for (const { command, ...limits } of commands) {
    const report = await verifyBehavior({ reference: command, candidate: command, cases, ...limits });
    assert.equal(report.verdict, "REFUSED");
    assert.equal(report.comparisons, 0);
    assert.ok(report.failures.length > 0);
  }
});

test("a control must execute successfully and exhibit an actual discrepancy", async () => {
  for (const command of [echo, { argv: [process.execPath, "-e", "process.exit(1)"] }]) {
    const report = await verifyBehavior({ reference: echo, candidate: echo, cases, controls: [{ name: "bad-control", command }] });
    assert.equal(report.verdict, "REFUSED");
    assert.equal(report.controls[0].detected, false);
    assert.ok(report.failures.some(failure => failure.includes("Negative control")));
  }
});

test("digest and recomputed comparison evidence detect changed reports", async () => {
  const report = await verifyBehavior({ reference: echo, candidate: wrong, cases });
  const changed = structuredClone(report); changed.verdict = "VERIFIED";
  assert.equal(verifyReport(changed).valid, false);
  const { digest: _, ...unsigned } = changed; changed.digest = hashJson(unsigned);
  assert.equal(verifyReport(changed).valid, false);
  const incorrect = structuredClone(report); incorrect.mismatches = [];
  const { digest: __, ...unsignedIncorrect } = incorrect; incorrect.digest = hashJson(unsignedIncorrect);
  assert.equal(verifyReport(incorrect).valid, false);
});

test("offline validation recomputes control evidence even after digest is recomputed", async () => {
  const report = await verifyBehavior({ reference: echo, candidate: echo, cases, controls: [{ name: "corruption", command: wrong }] });
  const altered = structuredClone(report);
  // Re-authoring a digest must not conceal inconsistent outcomes/counts/detection.
  altered.controls[0].executions[0].outcomes = structuredClone(altered.executions[0].outcomes);
  const { digest: _, ...unsigned } = altered; altered.digest = hashJson(unsigned);
  assert.equal(verifyReport(altered).valid, false);
  const incomplete = structuredClone(report); incomplete.controls[0].executions = [];
  const { digest: __, ...unsignedIncomplete } = incomplete; incomplete.digest = hashJson(unsignedIncomplete);
  assert.equal(verifyReport(incomplete).valid, false);
  const malformed = structuredClone(report);
  malformed.executions[0].outcomes.one = { kind: "value" } as never;
  const { digest: ___, ...unsignedMalformed } = malformed; malformed.digest = hashJson(unsignedMalformed);
  assert.equal(verifyReport(malformed).valid, false);
});

test("bound source changes and unavailable evidence refuse verification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code-transplant-binding-"));
  try {
    const path = join(directory, "source.ts"); await writeFile(path, "original");
    const mutating = worker(`await (await import('node:fs/promises')).writeFile(${JSON.stringify(path)},'modified');console.log(JSON.stringify({id:r.id,outcome:{kind:'value',value:r.input}}));`);
    const report = await verifyBehavior({ reference: echo, candidate: mutating, cases, binding: { files: [{ name: "source", path }] } });
    assert.equal(report.verdict, "REFUSED");
    assert.ok(report.failures.some(failure => failure.includes("changed during")));
    const unavailable = await verifyBehavior({ reference: echo, candidate: echo, cases, binding: { files: [{ name: "missing", path: join(directory, "missing") }] } });
    assert.equal(unavailable.verdict, "REFUSED");
    assert.ok(unavailable.failures.some(failure => failure.includes("Unavailable")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("relative paths run from an explicit execution root and node uses the recorded runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code-transplant-root-"));
  try {
    await writeFile(join(directory, "worker.mjs"), `import {createInterface} from 'node:readline';for await(const l of createInterface({input:process.stdin})){const r=JSON.parse(l);console.log(JSON.stringify({id:r.id,outcome:{kind:'value',value:r.input}}))}`);
    const relative: CommandSpec = { argv: ["node", "worker.mjs"], cwd: "." };
    const report = await verifyBehavior({ reference: relative, candidate: relative, cases, executionRoot: directory, binding: { files: [{ name: "worker", path: "worker.mjs" }] } });
    assert.equal(report.verdict, "VERIFIED");
    assert.equal(report.binding.files[0].path, "worker.mjs");
    assert.equal(report.runtime.node, process.version);
    assert.equal(JSON.stringify(report).includes(directory), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("empty and duplicate case ids are rejected and corpus is deterministic", async () => {
  await assert.rejects(verifyBehavior({ reference: echo, candidate: echo, cases: [] }), /1–10000/);
  await assert.rejects(verifyBehavior({ reference: echo, candidate: echo, cases: [cases[0], cases[0]] }), /unique/);
  const corpus = isoParserCorpus();
  assert.ok(corpus.length > 650);
  assert.deepEqual(corpus, isoParserCorpus());
  assert.notEqual(hashJson(corpus), hashJson(isoParserCorpus(123)));
  assert.ok(corpus.some(test => test.category === "dst"));
  assert.ok(corpus.some(test => test.category === "expanded-year"));
});

test("non-JSON objects, sparse/custom arrays, accessors and cycles are rejected before transport", async () => {
  const accessor = Object.defineProperty({}, "changing", { enumerable: true, get: () => new Date() });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const custom = Object.assign([1], { toJSON: () => "different" });
  const hidden = Object.defineProperty({}, "toJSON", { value: () => "different" });
  for (const input of [new Date(0), Array(2), custom, hidden, accessor, cycle, NaN, Infinity, undefined]) {
    await assert.rejects(verifyBehavior({ reference: echo, candidate: echo, cases: [{ id: "bad", input: input as never }] }), /Evidence/);
  }
});
