# Retained first proof

These files contain the actual local release run, not illustrative expectations.

| Check | Observed result |
| --- | --- |
| Build and regression suite | 41 tests passed, zero failures |
| Corpus | 695 deterministic edge and seeded cases |
| Contexts | UTC, America/New_York, Asia/Kathmandu |
| Original vs transplant | 2,085 comparisons, zero disagreements |
| Offset-sign control | Detected, 558 disagreements |
| Invalid-date-collapse control | Detected, 840 disagreements |
| Selected closure | 33 symbols, 44 edges, 5 modules |
| Required donor source tree | 7 files, 40,628 bytes |
| Extracted source | 5 files, 16,815 bytes |

The source-size comparison includes the donor modules required for independent
compilation, not the entire date-fns library. Source bytes do not measure runtime
performance, test coverage, developer savings, or independent host adoption.

```sh
npm ci
npm run build
node dist/cli.js verify docs/evidence/report.json
npm run demo
```

`report.json` retains every recorded outcome and control discrepancy. It is
minified without changing its canonical digest. `receipt.json` is the concise
run summary. `capsule-manifest.json` contains selected declarations, source
identity, dependency edges, assumptions, and the retained license hash.

Report digest:
`e2f900b89ba7d0c7a4155da14de8f92bcb5b04efdce1851bd3d65f764d179010`.

The recorded environment is Node v22.19.0, TypeScript 5.9.3, macOS arm64.
The report binds relative artifact paths from that particular generated run.
`verify` checks internal consistency without executing those commands or
reading historical artifact paths. A new `demo` creates fresh artifacts,
validates source identities, and performs the comparison again. Its timestamp
and run paths yield a new report digest; the capsule and corpus identities can
be compared directly.

The receiver is a new audit-importer example. The proof excludes custom Date
contexts and does not establish correctness against an independent ISO
specification or equivalence for all inputs. The digest is not an authenticated
signature or an independent execution attestation.
