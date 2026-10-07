# Code Transplant research — 2026-10-06

The useful opportunity is a local, reproducible workflow for a constrained
feature class: expose the dependency boundary, preserve mature implementation
behavior, and give reviewers an inspectable receipt. Software transplantation
and differential testing have substantial prior art. We make no claim to have
invented either technique or to be the first project combining them.

## Questions and findings

| Question | Finding | Evidence |
| --- | --- | --- |
| Is automated feature transplantation new? | No. μScalpel and Foundry/prodScalpel explore extraction and integration; Foundry's implementation targets C and feature annotations. | High: [μScalpel author paper](https://earlbarr.com/publications/autotransplant.pdf), [Foundry author manuscript](https://discovery.ucl.ac.uk/id/eprint/10196236/). |
| Can TypeScript expose useful dependency structure? | The compiler represents declarations as symbols and supports resolution through a checker. Declaration closure can retain types and helpers while pruning unrelated exports. | High for API capability: [official compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API). Coverage of this project's extraction remains bounded by its tests. |
| Which donor makes hidden assumptions measurable? | Pinned date-fns parseISO reaches date construction, a shared symbol registry, constants, helpers, and types; strings without offsets use local date semantics. | High: [pinned source](https://github.com/date-fns/date-fns/blob/313b902b9a72c64501074db9bc2b9897d2db5140/src/parseISO/index.ts), local unchanged source inspection. |
| What does behavioral agreement establish? | Differential comparison finds disagreements on tested inputs. Shared defects and untested behavior can survive. Runtime context must be controlled. | High: [Csmith author paper](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf). |
| Who could benefit? | Teams moving parsers during service splits, replacing old ingestion code, or isolating a feature from a large dependency could use the capsule and receipt as review artifacts. | Medium: product hypothesis; no customer interviews or savings study conducted. |

## Product decision

Start with named TypeScript parser exports and an explicit JSON boundary. Keep
the original donor independently executable. Record value and type dependencies,
provenance, hashes, ambient assumptions, corpus, and runtime contexts. Deliberate
bad variants must be detected. Refuse unsupported effects rather than generate
an adaptation with silently unresolved dependencies.

The potential distinction is the integrated review artifact and replay workflow,
not a new transplantation algorithm. This is an engineering hypothesis until
independent teams adopt it and real mature donor/host pairs are measured.

## Open questions and next validation

1. Transplant into a second mature, unrelated TypeScript host at a reviewed seam.
2. Compare extraction plus reviewer effort against manual copying, package reuse,
   and coding assistance, reporting elapsed minutes and regressions.
3. Replay capsules on a newer donor revision and surface the exact changed
   dependencies; measure whether teams can keep security fixes current.
4. Add mismatch minimization and meaningful branch coverage before widening the
   parser family. A large random case count alone is not a coverage claim.
5. Test prototype mutation, asynchronous behavior, aliases, and broader module
   effects before supporting them. Avoid presenting conservative static analysis
   as a general security or purity proof.

## Research record

```json
{
  "version": 1,
  "question": "Which extraction and verification workflow makes TypeScript parser transplantation useful, reproducible, and distinct from ordinary coding assistance?",
  "depth": "standard",
  "capUsd": 2,
  "spentUsd": null,
  "status": "done",
  "at": "2026-10-06",
  "screened": false,
  "screening": "AIDefence MCP scan was unavailable; fetched result text passed the installed plugin's local screenWith(COMMON_SECRETS) with no findings before consumption. This is a documented fallback, not an MCP scan.",
  "memoryPersistence": "Not stored in the research namespace; acceptance is required by the invoked deep-research skill before that optional step."
}
```

Existing-memory retrieval had no initial database; the local swarm memory was
initialized afterward for ADRs and domain context. API spend was not observable;
the stated cap cannot be certified. Research used two small search batches and
local source inspection. All listed questions were investigated; adoption and
cost benefits remain hypotheses.
