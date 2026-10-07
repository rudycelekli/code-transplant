# Code Transplant

**Move the feature. Keep the evidence.**

The user selects a mature parser and a receiving interface. Code Transplant
extracts the implementation's declaration closure, produces a dependency
capsule, and compares the adapted program against the original donor.

## Useful first users

An engineer splitting an old application can isolate an established parser
without carrying the whole original application. A company replacing ingestion
infrastructure can preserve input compatibility and review environmental
assumptions. An open-source maintainer can reuse an upstream implementation
while retaining source ownership, license notices, and reproducible evidence.

Package reuse is often the right choice. Transplantation earns its cost when a
whole dependency is unsuitable, the feature is embedded in a larger program,
or reviewers need an explicit boundary and replayable behavioral comparison.

## Delivered first proof

- One language: TypeScript.
- One feature class: deterministic synchronous parsers with named exports.
- One mature donor: pinned date-fns parseISO.
- One example receiver: an audit-event importer with a declared interface.
- Review artifacts: extracted modules, dependency graph, assumptions, license,
  source hashes, tagged comparisons, and detected negative controls.

## Release criteria

The original donor remains unchanged and separately compiled. The receiver has
no date-fns package dependency. Unused declarations disappear from the capsule.
Unsupported dependencies produce actionable refusals. Parser results agree
across the recorded corpus and three timezone contexts. Two deliberate semantic
mutations produce mismatches. Report corruption fails offline verification.
The CLI, tests, evidence, licenses, ADRs, and reproduction instructions ship
together.

## Value we still need to measure

Measure reviewer minutes, extraction/adaptation minutes, dependency reduction,
missed regressions, refusal frequency, and replay effort after upstream changes.
Do not claim a savings percentage from this first example. The next public
benchmark needs several independently chosen mature donor/host pairs and a
manual/package-reuse baseline.

## Next releases

First add a mature receiving program and a minimized witness for each mismatch.
Then add upstream revision replay with changed-symbol diffs. Broader exporters,
async parsers, and additional languages follow only after the initial workflow
demonstrates practical adoption and reliable boundaries.
