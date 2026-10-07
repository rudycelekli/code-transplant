---
id: ADR-0002
status: Accepted
date: 2026-10-06
tags: verification, reproducibility, negative-controls
depends-on: ADR-0001
---

# Differential evidence and negative controls

## Context

A test that runs the extracted implementation on both sides can agree while
proving nothing. A verifier that collapses crashes or invalid values can report
false agreement. Environmental assumptions also change parser behavior.

## Decision

Compile untouched donor files independently of the capsule. Compare tagged JSON
outcomes from explicit subprocess commands on the same corpus and runtime
contexts. Protocol errors, crashes, timeouts, and output-limit violations refuse
verification. Preserve thrown outcomes separately from valid and invalid dates.

Require the demo's deliberately broken variants to disagree with the original.
Bind the report to corpus, command, context, source files, and capsule digest.
Offline verification checks internal report integrity and decision consistency.
It does not establish independent execution or an authenticated signature.

## Alternatives

Handwritten expected values can miss upstream quirks. Equality of source text
does not verify adapters. A single UTC test conceals local-time assumptions.
Unbounded in-process evaluation cannot reliably isolate crashes and timeouts.

## Consequences

The verdict means agreement on the recorded corpus and contexts. It says
nothing about untested inputs or upstream correctness. Processes provide
operational limits, not a security sandbox. Users select trusted code to run.

## Validation

Test protocol failures, reordered/duplicated responses, malformed output,
timeouts, output limits, source changes, tampered receipts, and missing controls.
Run edge and seeded cases in UTC, America/New_York, and Asia/Kathmandu; confirm
offset and invalid-value mutations are detected.
