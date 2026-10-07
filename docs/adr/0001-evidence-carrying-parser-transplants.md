---
id: ADR-0001
status: Accepted
date: 2026-10-06
tags: extraction, typescript, parsers
---

# Evidence-carrying parser transplants

## Context

A working feature carries assumptions beyond its visible function: helper
declarations, module initialization, shared types, ambient runtime semantics,
and interfaces. Copying a function or asking for a rewrite obscures these
dependencies. The first release needs actual extraction and verification.

## Decision

Support named TypeScript exports in a deliberately constrained parser class.
Use the compiler's checker to follow referenced donor declarations and emit
selected modules, a dependency graph, source ranges, hashes, and an assumption
ledger. Preserve donor license notices. Refuse unsupported dependencies and
effects with actionable diagnostics. Extraction never executes donor code.

Keep feature extraction and behavior verification in separate bounded contexts.
Their public APIs export domain and application interfaces; filesystem and
subprocess implementations stay behind those interfaces.

## Alternatives

Whole-package vendoring preserves functionality but does not establish a useful
feature boundary. Manual copying is hard to replay. An unconstrained generated
rewrite loses provenance and makes behavioral changes harder to explain.
Whole-program semantic equivalence is beyond this release's scope.

## Consequences

Users can review a concrete dependency slice. Conservative refusals reduce the
number of supported donors. Static extraction does not establish purity or
security for arbitrary code. The first receiver is an example importer, so a
second mature unrelated host remains a validation milestone.

## Validation

Run extraction tests covering helper/type closure, pruning, provenance,
determinism, source containment, and unsupported boundaries. Run the pinned
date-fns parser proof with a separately compiled original donor. Publish only
counts and claims present in the generated receipt.
